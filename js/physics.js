/**
 * physics.js — the fixed-timestep gameplay simulation.
 *
 * One Physics instance drives one player through one level. It never talks
 * to audio/UI directly; instead it fires events through the `events`
 * callback object supplied by game.js:
 *
 *   onJump, onLand, onDie, onPad(pad), onRing(ring), onPortal(portal),
 *   onCoin(coin), onWin
 */
import { CONFIG } from './config.js';
import { clamp, aabb, dist2 } from './utils.js';
import { playerBox, resolveSolid, resolveSolidShip, resolvePlatform, hitsHazard } from './collision.js';

const P = CONFIG.PHYS;
const SHIP = CONFIG.SHIP;

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

    /* ---------- horizontal: constant auto-scroll ---------- */
    const speed = lv.speed * pl.speedMul;
    pl.x += speed * dt;

    /* ---------- vertical integration (per gamemode) ---------- */
    const dir = pl.gravityDir;
    const prevY = pl.y;
    if (pl.mode === 'ship') {
      // bang-bang thrust: hold = accelerate against gravity, release = fall
      pl.thrust = input.held;
      pl.vy += SHIP.ACC * (input.held ? 1 : -1) * dir * dt;
      pl.vy = clamp(pl.vy, -SHIP.MAX_V, SHIP.MAX_V);
    } else {
      pl.thrust = false;
      pl.vy -= P.GRAVITY * dir * dt;
      pl.vy = clamp(pl.vy, -P.MAX_FALL, P.MAX_FALL);
    }
    pl.y += pl.vy * dt;

    let grounded = false;
    const qx0 = pl.x - 2, qx1 = pl.x + pl.size + 2;

    // the world floor (the ship slides along it in either gravity)
    if ((dir === 1 || pl.mode === 'ship') && pl.y <= 0 && pl.vy <= 0) {
      pl.y = 0; pl.vy = 0; grounded = true;
    }

    // solid blocks: land/slide or die
    let died = false;
    lv.eachSolid(qx0, qx1, (s) => {
      if (died) return;
      if (pl.mode === 'ship') {
        const res = resolveSolidShip(pl, s);
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

    // one-way platforms: land only
    lv.eachPlatform(qx0, qx1, (p) => {
      if (resolvePlatform(pl, p, dir, prevY) === 'land') {
        pl.vy = 0; grounded = true;
      }
    });

    const justLanded = grounded && !pl.onGround;
    pl.onGround = grounded;
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

    /* ---------- jumping — cube only (the ship flies continuously) ---------- */
    if (pl.mode === 'cube' && pl.onGround && (this.input.jumpQueued || this.input.held)) {
      this.input.consumeJump();
      pl.vy = P.JUMP_V * dir;
      pl.onGround = false;
      this.events.onJump();
    }

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
        // keep the cube's bottom edge in place while resizing
        const newSize = portal.value === 'mini' ? CONFIG.PLAYER.MINI_SIZE : CONFIG.PLAYER.SIZE;
        if (pl.gravityDir === -1) pl.y += pl.size - newSize;
        pl.size = newSize;
        break;
      }
      case 'mode':
        // cube ↔ ship: keep (capped) momentum so transitions feel smooth
        pl.mode = portal.value === 'ship' ? 'ship' : 'cube';
        pl.vy = clamp(pl.vy, -SHIP.ENTER_V_CAP, SHIP.ENTER_V_CAP);
        pl.rotation = 0;
        pl.onGround = false;
        break;
    }
  }

  _die() {
    this.player.dead = true;
    this.events.onDie();
  }
}
