/**
 * physics.js — the fixed-timestep gameplay simulation.
 *
 * One Physics instance drives one player through one level. Per-gamemode
 * movement/tuning lives in gamemodes.js (MODES); this file owns the parts
 * every mode shares: horizontal auto-scroll, collision resolution,
 * interactive objects (pads/rings/portals/coins), triggers and win/lose.
 *
 * It never talks to audio/UI directly; instead it fires events through the
 * `events` callback object supplied by game.js:
 *
 *   onJump, onLand, onDie, onPad(pad), onRing(ring), onPortal(portal),
 *   onCoin(coin), onWin
 */
import { CONFIG } from './config.js';
import { clamp, aabb, dist2 } from './utils.js';
import { playerBox, playerHurtBox, resolveSolid, resolveSolidFly, resolvePlatform, hitsHazard } from './collision.js';
import { MODES, modeOf } from './gamemodes.js';

const P = CONFIG.PHYS;

export class Physics {
  constructor(events) {
    this.events = events;
  }

  attach(level, player, input) {
    this.level = level;
    this.player = player;
    this.input = input;
  }

  /** One fixed substep (dt = CONFIG.PHYS.STEP). */
  step(dt) {
    const pl = this.player, lv = this.level, input = this.input;
    if (pl.dead || pl.won) return;

    input.tick(dt);
    const mode = modeOf(pl);
    const dir = pl.gravityDir;

    /* ---------- horizontal: constant auto-scroll ---------- */
    const speed = lv.speed * pl.speedMul;
    pl.x += speed * dt;

    /* ---------- vertical integration (per gamemode) ---------- */
    const prevY = pl.y;
    mode.integrate(pl, input, dt, { dir, speed });
    pl.y += pl.vy * dt;

    let grounded = false;
    const qx0 = pl.x - 2, qx1 = pl.x + pl.size + 2;
    const style = mode.collision;

    // the world floor (fly + wave modes ride it in either gravity)
    if (pl.y <= 0 && pl.vy <= 0 && (dir === 1 || style !== 'cube')) {
      pl.y = 0; pl.vy = 0; grounded = true;
    }

    // solid blocks: land/slide or die (the wave dies on ANY solid contact)
    let died = false;
    lv.eachSolid(qx0, qx1, (s) => {
      if (died) return;
      if (style === 'wave') {
        if (aabb(playerHurtBox(pl), s)) died = true;
      } else if (style === 'fly') {
        const res = resolveSolidFly(pl, s);
        if (res === 'floor') { pl.vy = 0; grounded = true; }
        else if (res === 'ceil') { pl.vy = 0; }
        else if (res === 'die') died = true;
      } else {
        const res = resolveSolid(pl, s, dir);
        if (res === 'land') { pl.vy = 0; grounded = true; }
        else if (res === 'die') died = true;
      }
    });
    if (died) return this._die();

    // one-way platforms: land only (the wave passes straight through)
    if (style !== 'wave') {
      lv.eachPlatform(qx0, qx1, (p) => {
        if (resolvePlatform(pl, p, dir, prevY) === 'land') {
          pl.vy = 0; grounded = true;
        }
      });
    }

    const justLanded = grounded && !pl.onGround;
    pl.onGround = grounded;
    if (grounded) pl.holdT = 0;          // landing always ends a robot boost
    if (justLanded) this.events.onLand();

    /* ---------- hazards ---------- */
    let hitHazard = false;
    lv.eachHazard(qx0, qx1, (hz) => { if (!hitHazard && hitsHazard(pl, hz)) hitHazard = true; });
    if (hitHazard) return this._die();

    // fell out of the world (or flew away while gravity-flipped)
    if (pl.y < -7 || pl.y > 44) return this._die();

    /* ---------- interactive objects ---------- */
    const pb = playerBox(pl);

    lv.eachPad(qx0, qx1, (pad) => {
      if (!pad.used && aabb(pb, pad.box)) {
        pad.used = true;
        pl.vy = P.PAD_V * dir;
        pl.onGround = false;
        pl.holdT = 0;
        this.events.onPad(pad);
      }
    });

    lv.eachRing(qx0, qx1, (ring) => {
      if (!ring.used && !pl.onGround &&
          dist2(pl.centerX, pl.centerY, ring.cx, ring.cy) < ring.r * ring.r &&
          this.input.jumpQueued) {
        ring.used = true;
        this.input.consumeJump();
        pl.vy = P.RING_V * dir;
        pl.holdT = 0;
        this.events.onRing(ring);
      }
    });

    lv.eachPortal(qx0, qx1, (portal) => {
      if (!portal.used && aabb(pb, portal.box)) {
        portal.used = true;
        this._applyPortal(portal);
        this.events.onPortal(portal);
      }
    });

    lv.eachCoin(qx0, qx1, (coin) => {
      if (!coin.collected &&
          dist2(pl.centerX, pl.centerY, coin.cx, coin.cy) < coin.r * coin.r) {
        coin.collected = true;
        this.events.onCoin(coin);
      }
    });

    /* ---------- mode-specific jumping ---------- */
    if (mode.tryJump) mode.tryJump(pl, input, this.events, dir);

    pl.updateRotation(dt);

    /* ---------- finish line ---------- */
    if (pl.x >= lv.length) {
      pl.won = true;
      this.events.onWin();
    }
  }

  _applyPortal(portal) {
    const pl = this.player;
    switch (portal.kind) {
      case 'gravity':
        pl.gravityDir = portal.value;      // 1 = normal, -1 = flipped
        pl.onGround = false;
        break;
      case 'speed':
        pl.speedMul = CONFIG.SPEEDS[portal.value] || 1;
        break;
      case 'size': {
        // keep the player's bottom edge in place while resizing
        const newSize = portal.value === 'mini' ? CONFIG.PLAYER.MINI_SIZE : CONFIG.PLAYER.SIZE;
        if (pl.gravityDir === -1) pl.y += pl.size - newSize;
        pl.size = newSize;
        break;
      }
      case 'mode': {
        // any gamemode → any gamemode: momentum is capped by the TARGET
        // mode so transitions feel smooth and predictable
        const next = MODES[portal.value] ? portal.value : 'cube';
        pl.setMode(next);   // keeps the lethal-hitbox margin in sync
        pl.vy = clamp(pl.vy, -MODES[next].enterCap, MODES[next].enterCap);
        pl.rotation = 0;
        pl.holdT = 0;
        pl.onGround = false;
        break;
      }
    }
  }

  _die() {
    this.player.dead = true;
    this.events.onDie();
  }
}
