/**
 * player.js — player state + per-gamemode rendering (movement lives in
 * physics.js, tuning in gamemodes.js).
 *
 * Coordinates: (x, y) is the player's bottom-left corner in world blocks.
 * gravityDir:  1 = normal (floor below), -1 = flipped (ceiling is "floor").
 *
 * Appearance is customisable: a primary + secondary colour and one icon
 * variant (0–5) per gamemode, applied via setStyle() from the save data.
 * Variants are parametric — each tweaks proportions/details of the same
 * base drawing, so every mode gets six distinct looks from one function.
 */
import { CONFIG } from './config.js';
import { DEG } from './utils.js';
import { MODES, modeOf } from './gamemodes.js';

const WHITE = [1, 1, 1];

export class Player {
  constructor() {
    this.color = [0, 0.94, 1];        // primary — body
    this.color2 = [1, 0.18, 0.65];    // secondary — core / details
    this.icons = { cube: 0, ship: 0, ufo: 0, wave: 0, robot: 0 };
    this.reset();
  }

  reset() {
    this.x = CONFIG.PLAYER.SPAWN_X;
    this.y = 0;
    this.vy = 0;
    this.size = CONFIG.PLAYER.SIZE;
    this.gravityDir = 1;
    this.speedMul = 1;
    this.setMode('cube');
    this.thrust = false;              // engine/boost firing this step?
    this.holdT = 0;                   // robot: remaining hold-boost time
    this.onGround = true;
    this.rotation = 0;                // degrees; meaning depends on the mode
    this.trail = [];                  // wave: solid ribbon sample points
    this.dead = false;
    this.won = false;
  }

  /** Sample the wave ribbon (called once per rendered frame by game.js). */
  sampleTrail() {
    if (this.mode !== 'wave' || this.dead) return;
    const last = this.trail[this.trail.length - 1];
    const cx = this.x, cy = this.centerY;   // anchor at the dart's tail
    if (!last || Math.abs(cx - last.x) > 0.12 || Math.abs(cy - last.y) > 0.05) {
      this.trail.push({ x: cx, y: cy });
      if (this.trail.length > 160) this.trail.shift();
    }
  }

  /**
   * The wave's solid ribbon trail — drawn under the player in the primary
   * colour, tapering toward the tail. Pure geometry (no particles), so it
   * looks identical at any frame rate.
   */
  renderTrail(r) {
    const t = this.trail;
    if (t.length < 2) return;
    const head = { x: this.x, y: this.centerY };
    const pts = [...t, head];
    const n = pts.length;
    const width = this.size * 0.26;
    let px = 0, py = 0, first = true;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // taper: thin at the tail, full width at the head
      const k = i / (n - 1);
      const w = width * (0.15 + 0.85 * k);
      const nx = (-dy / len) * w, ny = (dx / len) * w;
      if (first) { px = nx; py = ny; first = false; }
      const alpha = 0.28 + 0.5 * k;
      r.tri(a.x + px, a.y + py, a.x - px, a.y - py, b.x + nx, b.y + ny, this.color, alpha);
      r.tri(a.x - px, a.y - py, b.x - nx, b.y - ny, b.x + nx, b.y + ny, this.color, alpha);
      px = nx; py = ny;
    }
  }

  /** Switch gamemode, keeping the lethal-hitbox margin in sync. */
  setMode(id) {
    this.mode = MODES[id] ? id : 'cube';
    this.hurtShrink = MODES[this.mode].hurtShrink;
  }

  /** Apply saved customisation: { primary:[r,g,b], secondary:[r,g,b],
   *  icons:{cube:0..5, …} }. Missing fields keep their defaults. */
  setStyle(style) {
    if (!style) return;
    if (style.primary) this.color = style.primary;
    if (style.secondary) this.color2 = style.secondary;
    if (style.icons) this.icons = { ...this.icons, ...style.icons };
  }

  get centerX() { return this.x + this.size / 2; }
  get centerY() { return this.y + this.size / 2; }
  get variant() { return this.icons[this.mode] || 0; }

  /** Rotation model comes from the gamemode table. */
  updateRotation(dt) {
    const m = modeOf(this);
    switch (m.rotate) {
      case 'tilt': {   // ship / ufo: smooth tilt following vertical velocity
        const target = Math.max(-m.tiltMax, Math.min(m.tiltMax, this.vy * m.tilt));
        this.rotation += (target - this.rotation) * Math.min(1, dt * m.tiltLerp);
        return;
      }
      case 'wave': {   // dart snaps toward its ±45° travel diagonal
        const target = this.onGround ? 0 : Math.sign(this.vy) * 45;
        this.rotation += (target - this.rotation) * Math.min(1, dt * 22);
        return;
      }
      case 'upright': { // robot: stays upright with a slight airborne lean
        const target = this.onGround ? 0 : Math.max(-14, Math.min(14, -this.vy * 0.9));
        this.rotation += (target - this.rotation) * Math.min(1, dt * 12);
        return;
      }
      default:         // cube: spin airborne, settle to a quarter-turn grounded
        if (this.onGround) {
          const target = Math.round(this.rotation / 90) * 90;
          const diff = target - this.rotation;
          this.rotation += diff * Math.min(1, dt * 25);
          if (Math.abs(diff) < 0.5) this.rotation = target;
        } else {
          this.rotation -= CONFIG.PHYS.ROT_SPEED * dt * this.gravityDir;
        }
    }
  }

  render(r, time) {
    if (this.dead) return;            // the explosion replaces the player
    switch (this.mode) {
      case 'ship': return this._renderShip(r, time);
      case 'ufo': return this._renderUfo(r, time);
      case 'wave': return this._renderWave(r, time);
      case 'robot': return this._renderRobot(r, time);
      default: return this._renderCube(r, time);
    }
  }

  /** Rotate a point around the player center (for triangle shapes). */
  _pt(rot) {
    const cx = this.centerX, cy = this.centerY;
    const c = Math.cos(rot), s = Math.sin(rot);
    return (px, py) => [cx + (px - cx) * c - (py - cy) * s,
                        cy + (px - cx) * s + (py - cy) * c];
  }

  /* ---------------------------------------------------------- cube ---- */

  _renderCube(r, time) {
    const s = this.size, v = this.variant;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;

    r.glow(cx, cy, s * 1.7, this.color, 0.5);

    r.quad(this.x, this.y, s, s, WHITE, 1, rot, cx, cy);                 // border
    const inset = s * 0.09;
    r.quad(this.x + inset, this.y + inset, s - inset * 2, s - inset * 2,
           this.color, 1, rot, cx, cy);                                  // body
    const plate = s * (0.18 + (v % 3) * 0.05);                           // variant: core size
    r.quad(this.x + plate, this.y + plate, s - plate * 2, s - plate * 2,
           this.color2, 1, rot, cx, cy);                                 // core

    // variant: face style — 0/3 bars · 1/4 dots · 2/5 visor
    const face = v % 3;
    if (face === 2) {
      r.quad(this.x + s * 0.2, this.y + s * 0.5, s * 0.6, s * 0.18, WHITE, 1, rot, cx, cy);
    } else {
      const ew = s * (face === 1 ? 0.16 : 0.14), eh = s * (face === 1 ? 0.16 : 0.2);
      const eyeY = this.y + s * 0.52;
      r.quad(this.x + s * 0.3 - ew / 2, eyeY, ew, eh, WHITE, 1, rot, cx, cy);
      r.quad(this.x + s * 0.7 - ew / 2, eyeY, ew, eh, WHITE, 1, rot, cx, cy);
    }
  }

  /* ---------------------------------------------------------- ship ---- */

  _renderShip(r, time) {
    const s = this.size, v = this.variant;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;
    const pt = this._pt(rot);

    r.glow(cx, cy, s * 1.8, this.color, 0.5);

    // hull + nose cone (variant: nose length / fin height)
    const noseLen = 1.15 + (v % 3) * 0.12;
    r.quad(this.x - s * 0.08, this.y, s * 1.0, s * 0.42, WHITE, 1, rot, cx, cy);
    r.quad(this.x - s * 0.02, this.y + s * 0.06, s * 0.9, s * 0.3, this.color, 1, rot, cx, cy);
    const [n1x, n1y] = pt(this.x + s * 0.92, this.y + s * 0.42);
    const [n2x, n2y] = pt(this.x + s * 0.92, this.y);
    const [n3x, n3y] = pt(this.x + s * noseLen, this.y + s * 0.21);
    r.tri(n1x, n1y, n2x, n2y, n3x, n3y, WHITE, 1);
    const finH = 0.3 + (v >= 3 ? 0.12 : 0);
    r.quad(this.x - s * 0.08, this.y + s * 0.3, s * 0.2, s * finH, this.color2, 1, rot, cx, cy);

    // pilot cube riding on top
    const ps = s * 0.5;
    const pxl = cx - ps / 2, pyb = this.y + s * 0.38;
    r.quad(pxl, pyb, ps, ps, WHITE, 1, rot, cx, cy);
    r.quad(pxl + ps * 0.1, pyb + ps * 0.1, ps * 0.8, ps * 0.8, this.color, 1, rot, cx, cy);
    r.quad(pxl + ps * 0.26, pyb + ps * 0.26, ps * 0.48, ps * 0.48, this.color2, 1, rot, cx, cy);

    if (this.thrust) {
      const flick = 0.7 + 0.3 * Math.sin(time * 40);
      const [fx, fy] = pt(this.x - s * 0.18, this.y + s * 0.2);
      r.glow(fx, fy, s * 0.55 * flick, [1, 0.75, 0.2], 0.85);
    }
  }

  /* ---------------------------------------------------------- ufo ---- */

  _renderUfo(r, time) {
    const s = this.size, v = this.variant;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;
    const pt = this._pt(rot);

    r.glow(cx, cy, s * 1.8, this.color, 0.5);

    // saucer base (variant: base width) — a slab with tapered side fins
    const baseW = 1.25 + (v % 3) * 0.12;
    const bx = cx - (s * baseW) / 2, by = this.y + s * 0.16;
    r.quad(bx, by, s * baseW, s * 0.26, WHITE, 1, rot, cx, cy);
    r.quad(bx + s * 0.06, by + s * 0.05, s * baseW - s * 0.12, s * 0.16, this.color, 1, rot, cx, cy);
    // side lights
    for (let i = 0; i < 3; i++) {
      const lx = bx + s * (0.2 + i * (baseW - 0.4) / 2);
      r.quad(lx, by + s * 0.08, s * 0.09, s * 0.09, this.color2, 1, rot, cx, cy);
    }

    // glass dome (variant: dome height) with the pilot cube inside
    const domeH = 0.5 + (v >= 3 ? 0.12 : 0);
    const [dcx, dcy] = pt(cx, by + s * 0.26);
    r.circle(dcx, dcy, s * domeH * 0.72, [0.8, 0.95, 1], 0.35, 18);
    const ps = s * 0.34;
    r.quad(cx - ps / 2, by + s * 0.3, ps, ps, this.color2, 1, rot, cx, cy);

    // underside repulsor glow (flashes on each tap impulse)
    const punch = this.vy * this.gravityDir > 4 ? 0.9 : 0.35;
    const [gx, gy] = pt(cx, this.y + s * 0.06);
    r.glow(gx, gy, s * 0.8, this.color, punch);
  }

  /* ---------------------------------------------------------- wave ---- */

  _renderWave(r, time) {
    const s = this.size, v = this.variant;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;
    const pt = this._pt(rot);

    r.glow(cx, cy, s * 1.6, this.color, 0.65);

    // dart: an arrowhead pointing along the travel direction
    // (variant: sharper nose / wider tail)
    const nose = 0.72 + (v % 3) * 0.1;
    const tail = 0.34 + (v >= 3 ? 0.1 : 0);
    const [t1x, t1y] = pt(cx + s * nose, cy);                 // tip
    const [t2x, t2y] = pt(cx - s * 0.5, cy + s * tail);       // top tail
    const [t3x, t3y] = pt(cx - s * 0.5, cy - s * tail);       // bottom tail
    const [m2x, m2y] = pt(cx - s * 0.34, cy + s * tail * 0.55);
    const [m3x, m3y] = pt(cx - s * 0.34, cy - s * tail * 0.55);
    r.tri(t1x, t1y, t2x, t2y, t3x, t3y, WHITE, 1);
    r.tri(t1x, t1y, m2x, m2y, m3x, m3y, this.color, 1);
    // core stripe
    const [c1x, c1y] = pt(cx + s * (nose - 0.28), cy);
    r.glow(c1x, c1y, s * 0.3, this.color2, 0.9);
  }

  /* ---------------------------------------------------------- robot ---- */

  /** Forward-facing runner: head and visor lead in the travel direction,
   *  legs stride behind — silhouette reads "running right" like ship/wave. */
  _renderRobot(r, time) {
    const s = this.size, v = this.variant;
    const cx = this.centerX, cy = this.centerY;
    const rot = this.rotation * DEG;
    const pt = this._pt(rot);

    r.glow(cx, cy, s * 1.7, this.color, 0.5);

    // striding legs (cadence follows distance travelled; tucked in the air)
    const phase = this.onGround ? Math.sin(this.x * 4.2) : 0.4;
    const legLen = (0.34 + (v >= 3 ? 0.06 : 0)) * s;
    const backX = cx - s * 0.3, frontX = cx - s * 0.02;
    r.quad(backX + phase * s * 0.12, this.y, s * 0.13, legLen, WHITE, 1, rot, cx, cy);
    r.quad(frontX - phase * s * 0.12, this.y, s * 0.13, legLen, WHITE, 1, rot, cx, cy);

    // torso: leans into the run, nose edge toward travel
    const torsoY = this.y + legLen * 0.85;
    const torsoH = s * 0.4;
    r.quad(cx - s * 0.36, torsoY, s * 0.68, torsoH, WHITE, 1, rot, cx, cy);
    r.quad(cx - s * 0.3, torsoY + s * 0.05, s * 0.56, torsoH - s * 0.1, this.color, 1, rot, cx, cy);
    // front arm nub
    r.quad(cx + s * 0.28, torsoY + torsoH * 0.3, s * 0.14, s * 0.14, this.color2, 1, rot, cx, cy);

    // head at the FRONT with a forward visor (variant: head size)
    const headS = s * (0.32 + (v % 3) * 0.04);
    const headX = cx + s * 0.06, headY = torsoY + torsoH;
    r.quad(headX - headS * 0.2, headY, headS, headS, WHITE, 1, rot, cx, cy);
    r.quad(headX + headS * 0.28, headY + headS * 0.3, headS * 0.5, headS * 0.32, this.color2, 1, rot, cx, cy);
    // antenna
    const [a1x, a1y] = pt(headX, headY + headS);
    r.glow(a1x, a1y + s * 0.08, s * 0.14, this.color, 0.6);

    // hold-boost exhaust under the heels
    if (this.thrust) {
      const flick = 0.6 + 0.4 * Math.sin(time * 36);
      const [fx, fy] = pt(cx - s * 0.2, this.y - s * 0.02);
      r.glow(fx, fy, s * 0.5 * flick, [1, 0.75, 0.2], 0.8);
    }
  }
}
