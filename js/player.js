/**
 * player.js — the cube: state + rendering (movement lives in physics.js).
 *
 * Coordinates: (x, y) is the cube's bottom-left corner in world blocks.
 * gravityDir:  1 = normal (floor below), -1 = flipped (ceiling is "floor").
 */
import { CONFIG } from './config.js';
import { DEG } from './utils.js';

export class Player {
  constructor() {
    this.color = [0, 0.94, 1];        // body — cyan
    this.color2 = [1, 0.18, 0.65];    // face plate — magenta
    this.reset();
  }

  reset() {
    this.x = CONFIG.PLAYER.SPAWN_X;
    this.y = 0;
    this.vy = 0;
    this.size = CONFIG.PLAYER.SIZE;
    this.gravityDir = 1;
    this.speedMul = 1;
    this.mode = 'cube';               // 'cube' | 'ship'
    this.thrust = false;              // ship: is the engine firing this step?
    this.onGround = true;
    this.rotation = 0;                // cube: spin (deg); ship: tilt (deg)
    this.dead = false;
    this.won = false;
  }

  get centerX() { return this.x + this.size / 2; }
  get centerY() { return this.y + this.size / 2; }

  /**
   * Cube — airborne: spin in the travel direction; grounded: settle to the
   * nearest quarter turn. Ship — smooth tilt following vertical velocity.
   */
  updateRotation(dt) {
    if (this.mode === 'ship') {
      const S = CONFIG.SHIP;
      const target = Math.max(-S.TILT_MAX, Math.min(S.TILT_MAX, this.vy * S.TILT));
      this.rotation += (target - this.rotation) * Math.min(1, dt * 14);
      return;
    }
    if (this.onGround) {
      const target = Math.round(this.rotation / 90) * 90;
      const diff = target - this.rotation;
      this.rotation += diff * Math.min(1, dt * 25);
      if (Math.abs(diff) < 0.5) this.rotation = target;
    } else {
      this.rotation -= CONFIG.PHYS.ROT_SPEED * dt * this.gravityDir;
    }
  }

  render(r, time) {
    if (this.dead) return;            // the explosion replaces the cube
    if (this.mode === 'ship') return this._renderShip(r, time);
    const s = this.size;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;

    // halo
    r.glow(cx, cy, s * 1.7, this.color, 0.5);

    // body + border + face, all rotating around the cube center
    r.quad(this.x, this.y, s, s, [1, 1, 1], 1, rot, cx, cy);                       // white border
    const inset = s * 0.09;
    r.quad(this.x + inset, this.y + inset, s - inset * 2, s - inset * 2,
           this.color, 1, rot, cx, cy);                                            // cyan body
    const plate = s * 0.22;
    r.quad(this.x + plate, this.y + plate, s - plate * 2, s - plate * 2,
           this.color2, 1, rot, cx, cy);                                           // magenta core
    // eyes
    const ew = s * 0.14, eh = s * 0.2, eyeY = this.y + s * 0.52;
    r.quad(this.x + s * 0.3 - ew / 2, eyeY, ew, eh, [1, 1, 1], 1, rot, cx, cy);
    r.quad(this.x + s * 0.7 - ew / 2, eyeY, ew, eh, [1, 1, 1], 1, rot, cx, cy);
  }

  /** The ship: a winged hull carrying a mini version of the cube. */
  _renderShip(r, time) {
    const s = this.size;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;

    r.glow(cx, cy, s * 1.8, this.color, 0.5);

    // hull (lower half) + nose cone, all pivoting on the ship center
    r.quad(this.x - s * 0.08, this.y, s * 1.0, s * 0.42, [1, 1, 1], 1, rot, cx, cy);
    r.quad(this.x - s * 0.02, this.y + s * 0.06, s * 0.9, s * 0.3, this.color, 1, rot, cx, cy);
    // nose (front tip) — rotate manually around the center
    const c = Math.cos(rot), sn = Math.sin(rot);
    const pt = (px, py) => [cx + (px - cx) * c - (py - cy) * sn, cy + (px - cx) * sn + (py - cy) * c];
    const [n1x, n1y] = pt(this.x + s * 0.92, this.y + s * 0.42);
    const [n2x, n2y] = pt(this.x + s * 0.92, this.y);
    const [n3x, n3y] = pt(this.x + s * 1.25, this.y + s * 0.21);
    r.tri(n1x, n1y, n2x, n2y, n3x, n3y, [1, 1, 1], 1);
    // tail fin
    r.quad(this.x - s * 0.08, this.y + s * 0.3, s * 0.2, s * 0.34, this.color2, 1, rot, cx, cy);

    // pilot cube (smaller, riding on top)
    const ps = s * 0.5;
    const pxl = cx - ps / 2, pyb = this.y + s * 0.38;
    r.quad(pxl, pyb, ps, ps, [1, 1, 1], 1, rot, cx, cy);
    r.quad(pxl + ps * 0.1, pyb + ps * 0.1, ps * 0.8, ps * 0.8, this.color, 1, rot, cx, cy);
    r.quad(pxl + ps * 0.26, pyb + ps * 0.26, ps * 0.48, ps * 0.48, this.color2, 1, rot, cx, cy);

    // engine flame while thrusting
    if (this.thrust) {
      const flick = 0.7 + 0.3 * Math.sin(time * 40);
      const [fx, fy] = pt(this.x - s * 0.18, this.y + s * 0.2);
      r.glow(fx, fy, s * 0.55 * flick, [1, 0.75, 0.2], 0.85);
    }
  }
}
