/**
 * gameObjects.js — visual + hitbox definitions for every level object type.
 *
 * The level JSON stores compact records like {"t":"spike","x":40,"y":0}.
 * levelManager.js turns those into runtime objects; this module knows how
 * to draw each one and what its hitbox looks like. Adding a new obstacle
 * type means adding one entry to HIT builders + one draw function here —
 * no core-engine changes.
 */
import { CONFIG } from './config.js';
import { DEG, TAU } from './utils.js';

const HB = CONFIG.HITBOX;

/* Common palette bits derived from a level theme at draw time. */
const WHITE = [1, 1, 1];
const YELLOW = [1, 0.84, 0.1];
const ORANGE = [1, 0.55, 0.1];
const GREEN = [0.2, 1, 0.5];
const PINK = [1, 0.3, 0.75];

/* ============================================================ drawing ==== */
/* Every draw fn gets (r = renderer, o = runtime object, theme, time, pulse) */

export function drawBlock(r, o, theme, time, pulse) {
  const edge = 0.07;
  r.glow(o.x + o.w / 2, o.y + o.h / 2, Math.max(o.w, o.h) * 0.9, theme.accent, 0.10 + pulse * 0.06);
  r.quad(o.x, o.y, o.w, o.h, theme.block, 1);
  // neon rim
  const rim = theme.accent, a = 0.85;
  r.quad(o.x, o.y + o.h - edge, o.w, edge, rim, a);           // top
  r.quad(o.x, o.y, o.w, edge, rim, a * 0.5);                  // bottom
  r.quad(o.x, o.y, edge, o.h, rim, a * 0.5);                  // left
  r.quad(o.x + o.w - edge, o.y, edge, o.h, rim, a * 0.5);     // right
}

export function drawPlatform(r, o, theme, time, pulse) {
  r.glow(o.x + o.w / 2, o.y + o.h, o.w * 0.55, theme.accent, 0.14 + pulse * 0.08);
  r.quad(o.x, o.y, o.w, o.h, theme.block, 0.95);
  r.quad(o.x, o.y + o.h - 0.08, o.w, 0.08, theme.accent, 0.95);
}

export function drawSpike(r, o, theme) {
  const { x, y, flip } = o;                       // x = left edge of the 1-wide cell
  const tipY = flip < 0 ? y - 1 : y + 1;          // flipped spikes hang from ceilings
  r.glow(x + 0.5, y + (flip < 0 ? -0.5 : 0.5), 0.85, theme.accent2, 0.22);
  r.tri(x + 0.02, y, x + 0.98, y, x + 0.5, tipY, theme.accent2, 1);
  // darker core adds depth
  r.tri(x + 0.24, y, x + 0.76, y, x + 0.5, y + (flip < 0 ? -0.62 : 0.62), theme.bg2, 0.85);
}

export function drawSaw(r, o, theme, time) {
  const rot = time * 4.2;                          // constant spin
  r.glow(o.cx, o.cy, o.r * 2.1, theme.accent2, 0.3);
  // teeth: 8 rotated quads poking out of the disc
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * TAU;
    const tx = o.cx + Math.cos(a) * o.r * 0.72;
    const ty = o.cy + Math.sin(a) * o.r * 0.72;
    r.quad(tx - o.r * 0.22, ty - o.r * 0.22, o.r * 0.44, o.r * 0.44, theme.accent2, 1, a);
  }
  r.circle(o.cx, o.cy, o.r * 0.72, theme.accent2, 1, 22);
  r.circle(o.cx, o.cy, o.r * 0.45, theme.bg1, 1, 18);
  r.circle(o.cx, o.cy, o.r * 0.16, theme.accent2, 1, 12);
}

export function drawPad(r, o, theme, time, pulse) {
  const bounce = 0.05 * Math.sin(time * 6);
  r.glow(o.x + 0.5, o.y + 0.15, 1.0, YELLOW, 0.5 + pulse * 0.3);
  r.quad(o.x + 0.05, o.y, 0.9, 0.16 + bounce, YELLOW, 1);
  r.quad(o.x + 0.18, o.y + 0.16 + bounce, 0.64, 0.08, WHITE, 0.9);
}

export function drawRing(r, o, theme, time, pulse) {
  const throb = 1 + 0.08 * Math.sin(time * 5);
  const R = 0.55 * throb;
  r.glow(o.cx, o.cy, 1.5, YELLOW, o.used ? 0.12 : 0.4 + pulse * 0.25);
  r.circle(o.cx, o.cy, R, YELLOW, o.used ? 0.3 : 1, 24);
  r.circle(o.cx, o.cy, R * 0.62, theme.bg1, 1, 20);
  r.circle(o.cx, o.cy, R * 0.2, YELLOW, o.used ? 0.3 : 0.9, 10);
}

export function drawPortal(r, o, theme, time, pulse) {
  // color communicates function: gravity = cyan/orange, speed = green/pink,
  // mode = magenta (ship) / lime (cube), size = violet
  let col;
  if (o.kind === 'gravity') col = o.value === -1 ? ORANGE : [0.2, 0.85, 1];
  else if (o.kind === 'speed') col = o.value >= 1 ? GREEN : PINK;
  else if (o.kind === 'mode') col = o.value === 'ship' ? [1, 0.35, 0.8] : [0.5, 1, 0.35];
  else col = [0.65, 0.4, 1];
  const cx = o.x + 0.5, cy = o.y + HB.PORTAL_H / 2;
  const sway = 0.06 * Math.sin(time * 3 + o.x);
  r.glow(cx, cy, 2.4, col, 0.35 + pulse * 0.2);
  // two tall capsule-ish bars forming the gate
  r.quad(cx - 0.55 + sway, o.y, 0.28, HB.PORTAL_H, col, 0.9, 0.12);
  r.quad(cx + 0.27 - sway, o.y, 0.28, HB.PORTAL_H, col, 0.9, -0.12);
  // inner shimmer
  r.glow(cx, o.y + ((time * 2 + o.x) % 1) * HB.PORTAL_H, 0.5, WHITE, 0.35);
  // speed portals get chevrons showing direction
  if (o.kind === 'speed') {
    const ch = o.value >= 1 ? 1 : -1;
    for (let i = 0; i < 2; i++) {
      const bx = cx - 0.3 + i * 0.35 * ch;
      r.tri(bx, cy - 0.35, bx, cy + 0.35, bx + 0.3 * ch, cy, WHITE, 0.85);
    }
  }
  // mode portals carry the gamemode glyph: wings for ship, a square for cube
  if (o.kind === 'mode') {
    if (o.value === 'ship') {
      r.tri(cx - 0.35, cy - 0.15, cx + 0.35, cy - 0.15, cx + 0.45, cy + 0.1, WHITE, 0.9);
      r.quad(cx - 0.12, cy - 0.05, 0.24, 0.28, WHITE, 0.9);
    } else {
      r.quad(cx - 0.2, cy - 0.2, 0.4, 0.4, WHITE, 0.9);
      r.quad(cx - 0.1, cy - 0.1, 0.2, 0.2, col, 1);
    }
  }
}

export function drawCoin(r, o, theme, time, pulse, alreadyOwned) {
  if (o.collected) return;                        // picked up this attempt
  const bob = 0.1 * Math.sin(time * 3 + o.cx * 0.7);
  const cy = o.cy + bob;
  const spin = Math.abs(Math.sin(time * 2.4 + o.cx));  // fake 3D spin
  const alpha = alreadyOwned ? 0.35 : 1;               // ghost if banked already
  r.glow(o.cx, cy, 1.2, YELLOW, alreadyOwned ? 0.12 : 0.35 + pulse * 0.2);
  r.quad(o.cx - 0.38 * spin, cy - 0.38, 0.76 * spin, 0.76, YELLOW, alpha, time);
  r.quad(o.cx - 0.2 * spin, cy - 0.2, 0.4 * spin, 0.4, [1, 0.95, 0.6], alpha, time);
}

export function drawDeco(r, o, theme, time, pulse) {
  const a = o.opacity;
  const rot = (o.rot || 0) * DEG;
  switch (o.shape) {
    case 'tri':
      // rotation for triangles is applied as a flip when |rot| >= 90
      if (Math.abs(o.rot) >= 90) r.tri(o.x, o.y + o.h, o.x + o.w, o.y + o.h, o.x + o.w / 2, o.y, o.color, a);
      else r.tri(o.x, o.y, o.x + o.w, o.y, o.x + o.w / 2, o.y + o.h, o.color, a);
      break;
    case 'circle':
      r.circle(o.x, o.y, o.r, o.color, a, 24);
      break;
    case 'glow':
      r.glow(o.x, o.y, o.r * 2, o.color, a * (0.7 + 0.3 * pulse));
      break;
    case 'beam':
      r.glow(o.x + o.w / 2, o.y + o.h / 2, Math.max(o.w, o.h), o.color, a * 0.5);
      r.quad(o.x, o.y, o.w, o.h, o.color, a, rot);
      break;
    default: // rect
      r.quad(o.x, o.y, o.w, o.h, o.color, a, rot);
  }
}

/** Dispatch table used by the render loop. */
export const DRAW = {
  block: drawBlock,
  platform: drawPlatform,
  spike: drawSpike,
  saw: drawSaw,
  pad: drawPad,
  ring: drawRing,
  portal: drawPortal,
  coin: drawCoin,
  deco: drawDeco,
};
