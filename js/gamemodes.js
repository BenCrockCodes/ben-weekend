/**
 * gamemodes.js — the gamemode behaviour table.
 *
 * Every playable mode (cube, ship, ufo, wave, robot) is one entry here:
 * its physics tuning, how it integrates vertical motion, how it responds
 * to input, which collision style it uses and how it rotates. physics.js
 * and player.js dispatch through this table, so adding a future mode
 * (spider, ball, …) means adding one entry + one render function — no
 * engine changes.
 *
 * Tuning targets classic rhythm-platformer feel (units: blocks, seconds;
 * ~10.4 blocks/s horizontal at normal speed, like the original):
 *   cube  — gravity 94, jump 20.8 → ~2.3-block apex in ~0.44 s
 *   ship  — asymmetric thrust: climbing pulls harder than falling, with
 *           separate up/down speed caps, so taps produce small precise
 *           corrections near the top of a climb (the "GD ship" feel)
 *   ufo   — lighter gravity + fixed tap impulses, no hold behaviour
 *   wave  — no gravity: velocity locks to ±45° of travel (steeper if mini)
 *   robot — hold-to-jump: an initial hop sustained by a decaying boost
 *           window, giving analogue jump heights
 *
 * `collision`: 'cube' = land on tops, die on sides;
 *              'fly'  = slide along tops AND undersides (ship/ufo);
 *              'wave' = any solid contact is lethal, slides on the floor.
 */

export const MODES = {
  cube: {
    name: 'Cube',
    collision: 'cube',
    enterCap: 20.8,       // |vy| clamp when entering through a portal
    hurtShrink: 0.12,     // lethal hitbox shrink (fairness margin)
    gravity: 94,
    jumpV: 20.8,
    maxFall: 34,
    rotate: 'spin',
    integrate(pl, input, dt, ctx) {
      pl.thrust = false;
      pl.vy -= this.gravity * ctx.dir * dt;
      pl.vy = Math.max(-this.maxFall, Math.min(this.maxFall, pl.vy));
    },
    tryJump(pl, input, events, dir) {
      // buffered press or hold-to-rejump, from the ground only
      if (pl.onGround && (input.jumpQueued || input.held)) {
        input.consumeJump();
        pl.vy = this.jumpV * dir;
        pl.onGround = false;
        events.onJump();
      }
    },
  },

  ship: {
    name: 'Ship',
    collision: 'fly',
    enterCap: 8,
    hurtShrink: 0.12,
    thrustAcc: 52,        // climbing acceleration (hold)
    fallAcc: 40,          // falling acceleration (release) — asymmetric on purpose
    maxUp: 8.6,
    maxDown: 11.2,
    rotate: 'tilt',
    tilt: 3.6, tiltMax: 40, tiltLerp: 16,
    integrate(pl, input, dt, ctx) {
      pl.thrust = input.held;
      pl.vy += (input.held ? this.thrustAcc : -this.fallAcc) * ctx.dir * dt;
      // caps are relative to gravity: "up" means against the pull
      const up = this.maxUp * ctx.dir, down = -this.maxDown * ctx.dir;
      const lo = Math.min(up, down), hi = Math.max(up, down);
      pl.vy = Math.max(lo, Math.min(hi, pl.vy));
    },
  },

  ufo: {
    name: 'UFO',
    collision: 'fly',
    enterCap: 10,
    hurtShrink: 0.12,
    gravity: 80,
    jumpV: 16.2,
    maxFall: 30,
    rotate: 'tilt',
    tilt: 1.5, tiltMax: 18, tiltLerp: 12,
    integrate(pl, input, dt, ctx) {
      pl.thrust = false;
      pl.vy -= this.gravity * ctx.dir * dt;
      pl.vy = Math.max(-this.maxFall, Math.min(this.maxFall, pl.vy));
    },
    tryJump(pl, input, events, dir) {
      // fixed impulse per fresh tap — works on the ground AND mid-air
      if (input.jumpQueued) {
        input.consumeJump();
        pl.vy = this.jumpV * dir;
        pl.onGround = false;
        events.onJump();
      }
    },
  },

  wave: {
    name: 'Wave',
    collision: 'wave',
    enterCap: 0,
    hurtShrink: 0.34,     // the wave's dart is much smaller than a block
    rotate: 'wave',
    integrate(pl, input, dt, ctx) {
      pl.thrust = false;
      // velocity locks to the travel diagonal: hold = climb, release = dive
      // (mini wave rides a steeper diagonal, like the original)
      const steep = pl.size < 1 ? 2 : 1;
      pl.vy = (input.held ? 1 : -1) * ctx.dir * ctx.speed * steep;
    },
  },

  robot: {
    name: 'Robot',
    collision: 'cube',
    enterCap: 12,
    hurtShrink: 0.12,
    gravity: 94,
    jumpV: 10.8,          // tap → ~1.1-block hop
    holdLift: 78,         // extra upward acceleration while the press is held…
    holdMax: 0.34,        // …for at most this long → full hold ≈ 2.9 blocks
    maxFall: 34,
    rotate: 'upright',
    integrate(pl, input, dt, ctx) {
      pl.thrust = pl.holdT > 0 && input.held;
      if (pl.holdT > 0) {
        if (input.held) {
          pl.holdT -= dt;
          pl.vy += this.holdLift * ctx.dir * dt;   // sustained boost
        } else {
          pl.holdT = 0;                            // releasing ends the boost
        }
      }
      pl.vy -= this.gravity * ctx.dir * dt;
      pl.vy = Math.max(-this.maxFall, Math.min(this.maxFall, pl.vy));
    },
    tryJump(pl, input, events, dir) {
      if (pl.onGround && (input.jumpQueued || input.held)) {
        input.consumeJump();
        pl.vy = this.jumpV * dir;
        pl.holdT = this.holdMax;
        pl.onGround = false;
        events.onJump();
      }
    },
  },
};

/** Ordered list for UI (character select, editor portals, …). */
export const MODE_IDS = ['cube', 'ship', 'ufo', 'wave', 'robot'];

export function modeOf(player) {
  return MODES[player.mode] || MODES.cube;
}
