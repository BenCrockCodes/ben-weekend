/**
 * editor/editorObjects.js — the object catalog for the level editor.
 *
 * Defines every placeable object: its palette entry (category, name, SVG
 * thumbnail), how to create its JSON record, its selection bounds, how to
 * expand it into drawable items for the shared renderer, and which
 * properties the right-hand panel should expose.
 *
 * Adding a new placeable object = adding one PALETTE entry (and, if it is a
 * brand-new gameplay type, its runtime support in levelManager/gameObjects).
 */
import { EASE_OPTIONS } from '../levelManager.js';

/* ================================================= categories ==== */

export const CATEGORIES = [
  { id: 'recent', name: 'Recent', icon: '↺' },
  { id: 'favorites', name: 'Favorites', icon: '★' },
  { id: 'blocks', name: 'Blocks', icon: '▦' },
  { id: 'spikes', name: 'Spikes', icon: '▲' },
  { id: 'hazards', name: 'Hazards', icon: '✸' },
  { id: 'platforms', name: 'Platforms', icon: '▬' },
  { id: 'pads', name: 'Jump Pads', icon: '⏶' },
  { id: 'rings', name: 'Jump Rings', icon: '◎' },
  { id: 'gravity', name: 'Gravity Portals', icon: '⇅' },
  { id: 'speed', name: 'Speed Portals', icon: '»' },
  { id: 'size', name: 'Size Portals', icon: '⤢' },
  { id: 'mode', name: 'Gamemode Portals', icon: '▸' },
  { id: 'deco', name: 'Decorations', icon: '✦' },
  { id: 'bg', name: 'Background', icon: '▤' },
  { id: 'effects', name: 'Effects', icon: '✧' },
  { id: 'triggers', name: 'Triggers', icon: '⚑' },
  { id: 'collect', name: 'Collectibles', icon: '◉' },
  { id: 'misc', name: 'Misc', icon: '⋯' },
];

/* ================================================= thumbnails ==== */
/* Compact neon SVG previews, 48x48 viewbox. */

const S = (body) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const CY = '#00f0ff', MG = '#ff2ea6', YL = '#ffd60a', GR = '#3dff8b',
      PK = '#ff4d9e', OR = '#ff8c1f', VI = '#a86bff', BL = '#20144d';

const thumbBlock = (w, h) => {
  const bw = Math.min(38, w * 14), bh = Math.min(38, h * 14);
  const x = 24 - bw / 2, y = 24 - bh / 2;
  return S(`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${BL}" stroke="${CY}" stroke-width="2.5"/>`);
};
const thumbSpike = (n, flip = 1) => {
  let tris = '';
  const w = Math.min(14, 40 / n);
  const x0 = 24 - (n * w) / 2;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w, b = a + w, m = a + w / 2;
    tris += flip < 0
      ? `<polygon points="${a},10 ${b},10 ${m},34" fill="${MG}"/>`
      : `<polygon points="${a},38 ${b},38 ${m},14" fill="${MG}"/>`;
  }
  return S(tris);
};
const thumbSaw = (r) => S(
  `<circle cx="24" cy="24" r="${10 + r * 6}" fill="${OR}"/>` +
  `<circle cx="24" cy="24" r="${5 + r * 3}" fill="${BL}"/>` +
  `<circle cx="24" cy="24" r="2.5" fill="${OR}"/>`);
const thumbPlatform = (w) => S(
  `<rect x="${24 - w * 3}" y="21" width="${w * 6}" height="7" fill="${BL}" stroke="${CY}" stroke-width="2"/>`);
const thumbPad = S(
  `<rect x="10" y="30" width="28" height="7" rx="2" fill="${YL}"/><rect x="15" y="25" width="18" height="4" rx="2" fill="#fff"/>`);
const thumbRing = S(
  `<circle cx="24" cy="24" r="13" fill="none" stroke="${YL}" stroke-width="5"/><circle cx="24" cy="24" r="3" fill="${YL}"/>`);
const thumbPortal = (col, label) => S(
  `<rect x="13" y="6" width="6" height="36" rx="3" fill="${col}" transform="rotate(-6 24 24)"/>` +
  `<rect x="29" y="6" width="6" height="36" rx="3" fill="${col}" transform="rotate(6 24 24)"/>` +
  (label ? `<text x="24" y="29" font-size="13" text-anchor="middle" fill="#fff" font-family="monospace" font-weight="bold">${label}</text>` : ''));
const thumbCoin = S(
  `<circle cx="24" cy="24" r="12" fill="${YL}"/><circle cx="24" cy="24" r="6" fill="#fff2a8"/>`);
const thumbDecoRect = (col, op) => S(
  `<rect x="10" y="10" width="28" height="28" fill="${col}" opacity="${op}" stroke="${col}" stroke-width="1.5"/>`);
const thumbDecoTri = S(`<polygon points="10,38 38,38 24,10" fill="${VI}" opacity="0.7"/>`);
const thumbDecoCircle = S(`<circle cx="24" cy="24" r="14" fill="${CY}" opacity="0.55"/>`);
const thumbGlow = S(
  `<circle cx="24" cy="24" r="16" fill="${CY}" opacity="0.2"/><circle cx="24" cy="24" r="9" fill="${CY}" opacity="0.4"/><circle cx="24" cy="24" r="4" fill="#fff"/>`);
const thumbBeam = S(`<rect x="21" y="6" width="6" height="36" fill="${MG}" opacity="0.8"/>`);
const thumbTrigger = (col, glyph) => S(
  `<rect x="21" y="8" width="3" height="32" fill="#fff" opacity="0.85"/>` +
  `<polygon points="24,8 40,14 24,20" fill="${col}"/>` +
  `<text x="16" y="38" font-size="13" text-anchor="middle" fill="${col}" font-family="monospace" font-weight="bold">${glyph}</text>`);
const thumbTower = S(`<rect x="14" y="12" width="20" height="30" fill="${CY}" opacity="0.18" stroke="${CY}" stroke-opacity="0.4"/>`);

/* ================================================= palette ==== */
/* make(x, y) receives the SNAPPED bottom-left cell corner of the click. */

export const PALETTE = [
  // -------- blocks
  { id: 'block1', cat: 'blocks', name: 'Block', thumb: thumbBlock(1, 1),
    make: (x, y) => ({ t: 'block', x, y, w: 1, h: 1 }) },
  { id: 'block2', cat: 'blocks', name: 'Block 2×1', thumb: thumbBlock(2, 1),
    make: (x, y) => ({ t: 'block', x, y, w: 2, h: 1 }) },
  { id: 'block4', cat: 'blocks', name: 'Block 4×1', thumb: thumbBlock(4, 1),
    make: (x, y) => ({ t: 'block', x, y, w: 4, h: 1 }) },
  { id: 'block22', cat: 'blocks', name: 'Block 2×2', thumb: thumbBlock(2, 2),
    make: (x, y) => ({ t: 'block', x, y, w: 2, h: 2 }) },
  { id: 'pillar', cat: 'blocks', name: 'Pillar 1×4', thumb: thumbBlock(1, 4),
    make: (x, y) => ({ t: 'block', x, y, w: 1, h: 4 }) },
  // -------- spikes
  { id: 'spike1', cat: 'spikes', name: 'Spike', thumb: thumbSpike(1),
    make: (x, y) => ({ t: 'spike', x, y }) },
  { id: 'spike2', cat: 'spikes', name: 'Double Spike', thumb: thumbSpike(2),
    make: (x, y) => ({ t: 'spike', x, y, n: 2, flip: 1 }) },
  { id: 'spike3', cat: 'spikes', name: 'Triple Spike', thumb: thumbSpike(3),
    make: (x, y) => ({ t: 'spike', x, y, n: 3, flip: 1 }) },
  { id: 'spikeCeil', cat: 'spikes', name: 'Ceiling Spike', thumb: thumbSpike(1, -1),
    make: (x, y) => ({ t: 'spike', x, y: y + 1, n: 1, flip: -1 }) },
  // -------- hazards
  { id: 'sawS', cat: 'hazards', name: 'Saw (small)', thumb: thumbSaw(0.6),
    make: (x, y) => ({ t: 'saw', x: x + 0.5, y: y + 0.5, r: 0.7 }) },
  { id: 'sawM', cat: 'hazards', name: 'Saw', thumb: thumbSaw(1),
    make: (x, y) => ({ t: 'saw', x: x + 0.5, y: y + 0.5, r: 1 }) },
  { id: 'sawL', cat: 'hazards', name: 'Saw (large)', thumb: thumbSaw(1.5),
    make: (x, y) => ({ t: 'saw', x: x + 0.5, y: y + 0.5, r: 1.4 }) },
  // -------- platforms
  { id: 'plat3', cat: 'platforms', name: 'Platform 3', thumb: thumbPlatform(3),
    make: (x, y) => ({ t: 'platform', x, y, w: 3 }) },
  { id: 'plat6', cat: 'platforms', name: 'Platform 6', thumb: thumbPlatform(6),
    make: (x, y) => ({ t: 'platform', x, y, w: 6 }) },
  // -------- pads / rings
  { id: 'pad', cat: 'pads', name: 'Jump Pad', thumb: thumbPad,
    make: (x, y) => ({ t: 'pad', x, y }) },
  { id: 'ring', cat: 'rings', name: 'Jump Ring', thumb: thumbRing,
    make: (x, y) => ({ t: 'ring', x, y }) },
  // -------- portals
  { id: 'gravUp', cat: 'gravity', name: 'Gravity: Ceiling', thumb: thumbPortal(OR, '↑'),
    make: (x, y) => ({ t: 'portal', kind: 'gravity', value: -1, x, y }) },
  { id: 'gravDown', cat: 'gravity', name: 'Gravity: Floor', thumb: thumbPortal('#20d6ff', '↓'),
    make: (x, y) => ({ t: 'portal', kind: 'gravity', value: 1, x, y }) },
  { id: 'spdSlow', cat: 'speed', name: 'Speed: Slow', thumb: thumbPortal(PK, '‹'),
    make: (x, y) => ({ t: 'portal', kind: 'speed', value: 'slow', x, y }) },
  { id: 'spdNorm', cat: 'speed', name: 'Speed: Normal', thumb: thumbPortal(GR, '›'),
    make: (x, y) => ({ t: 'portal', kind: 'speed', value: 'normal', x, y }) },
  { id: 'spdFast', cat: 'speed', name: 'Speed: Fast', thumb: thumbPortal(GR, '»'),
    make: (x, y) => ({ t: 'portal', kind: 'speed', value: 'fast', x, y }) },
  { id: 'sizeMini', cat: 'size', name: 'Size: Mini', thumb: thumbPortal(VI, '·'),
    make: (x, y) => ({ t: 'portal', kind: 'size', value: 'mini', x, y }) },
  { id: 'sizeNorm', cat: 'size', name: 'Size: Normal', thumb: thumbPortal(VI, '●'),
    make: (x, y) => ({ t: 'portal', kind: 'size', value: 'normal', x, y }) },
  { id: 'modeCube', cat: 'mode', name: 'Cube Portal', thumb: thumbPortal('#7fff59', '■'),
    make: (x, y) => ({ t: 'portal', kind: 'mode', value: 'cube', x, y }) },
  { id: 'modeShip', cat: 'mode', name: 'Ship Portal', thumb: thumbPortal('#ff59cc', '▲'),
    make: (x, y) => ({ t: 'portal', kind: 'mode', value: 'ship', x, y }) },
  { id: 'modeUfo', cat: 'mode', name: 'UFO Portal', thumb: thumbPortal('#ff9926', '◍'),
    make: (x, y) => ({ t: 'portal', kind: 'mode', value: 'ufo', x, y }) },
  { id: 'modeWave', cat: 'mode', name: 'Wave Portal', thumb: thumbPortal('#40bfff', '◅'),
    make: (x, y) => ({ t: 'portal', kind: 'mode', value: 'wave', x, y }) },
  { id: 'modeRobot', cat: 'mode', name: 'Robot Portal', thumb: thumbPortal('#f2f266', '⊓'),
    make: (x, y) => ({ t: 'portal', kind: 'mode', value: 'robot', x, y }) },
  // -------- triggers (fire when the player passes their x position)
  { id: 'trigMove', cat: 'triggers', name: 'Move Trigger', thumb: thumbTrigger('#33ff99', '⇄'),
    make: (x, y) => ({ t: 'trigger', kind: 'move', x, y, target: 1, dx: 0, dy: 2, dur: 1, ease: 'inout' }) },
  { id: 'trigAlpha', cat: 'triggers', name: 'Alpha Trigger', thumb: thumbTrigger('#a86bff', '◐'),
    make: (x, y) => ({ t: 'trigger', kind: 'alpha', x, y, target: 1, opacity: 0, dur: 0.5 }) },
  // -------- decorations
  { id: 'decoRect', cat: 'deco', name: 'Neon Panel', thumb: thumbDecoRect(CY, 0.4),
    make: (x, y) => ({ t: 'deco', shape: 'rect', x, y, w: 2, h: 2, color: [0, 0.94, 1], opacity: 0.35, rot: 0, layer: 'bg' }) },
  { id: 'decoTri', cat: 'deco', name: 'Neon Triangle', thumb: thumbDecoTri,
    make: (x, y) => ({ t: 'deco', shape: 'tri', x, y, w: 2, h: 2, color: [0.66, 0.42, 1], opacity: 0.5, rot: 0, layer: 'bg' }) },
  { id: 'decoCircle', cat: 'deco', name: 'Neon Disc', thumb: thumbDecoCircle,
    make: (x, y) => ({ t: 'deco', shape: 'circle', x: x + 0.5, y: y + 0.5, r: 1, color: [0, 0.94, 1], opacity: 0.4, layer: 'bg' }) },
  { id: 'decoStripe', cat: 'misc', name: 'Neon Stripe', thumb: thumbBeam,
    make: (x, y) => ({ t: 'deco', shape: 'rect', x, y, w: 0.25, h: 4, color: [1, 0.18, 0.65], opacity: 0.7, rot: 0, layer: 'bg' }) },
  // -------- background objects
  { id: 'bgTower', cat: 'bg', name: 'Tower Silhouette', thumb: thumbTower,
    make: (x, y) => ({ t: 'deco', shape: 'rect', x, y, w: 4, h: 9, color: [0.5, 0.75, 1], opacity: 0.12, rot: 0, layer: 'bg' }) },
  { id: 'bgPanel', cat: 'bg', name: 'Backdrop Panel', thumb: thumbDecoRect('#7ab8ff', 0.15),
    make: (x, y) => ({ t: 'deco', shape: 'rect', x, y, w: 8, h: 4, color: [0.4, 0.6, 1], opacity: 0.1, rot: 0, layer: 'bg' }) },
  // -------- effects
  { id: 'fxGlow', cat: 'effects', name: 'Glow Orb', thumb: thumbGlow,
    make: (x, y) => ({ t: 'deco', shape: 'glow', x: x + 0.5, y: y + 0.5, r: 1.6, color: [0, 0.94, 1], opacity: 0.8, layer: 'bg' }) },
  { id: 'fxBeam', cat: 'effects', name: 'Light Beam', thumb: thumbBeam,
    make: (x, y) => ({ t: 'deco', shape: 'beam', x, y, w: 0.4, h: 9, color: [1, 0.18, 0.65], opacity: 0.5, rot: 0, layer: 'fg' }) },
  // -------- collectibles
  { id: 'coin', cat: 'collect', name: 'Coin', thumb: thumbCoin,
    make: (x, y) => ({ t: 'coin', x, y }) },
];

export const PALETTE_BY_ID = Object.fromEntries(PALETTE.map((p) => [p.id, p]));

/* ================================================= geometry ==== */

/** Selection/hit bounds for a record: {x, y, w, h} (bottom-left origin). */
export function recBounds(rec) {
  switch (rec.t) {
    case 'block': return { x: rec.x, y: rec.y, w: rec.w || 1, h: rec.h || 1 };
    case 'platform': return { x: rec.x, y: rec.y, w: rec.w || 3, h: 0.5 };
    case 'spike': {
      const n = rec.n || 1;
      return (rec.flip || 1) < 0
        ? { x: rec.x, y: rec.y - 1, w: n, h: 1 }
        : { x: rec.x, y: rec.y, w: n, h: 1 };
    }
    case 'saw': return { x: rec.x - rec.r, y: rec.y - rec.r, w: rec.r * 2, h: rec.r * 2 };
    case 'pad': return { x: rec.x, y: rec.y, w: 1, h: 0.5 };
    case 'ring': return { x: rec.x, y: rec.y, w: 1, h: 1 };
    case 'portal': return { x: rec.x, y: rec.y, w: 1, h: 3 };
    case 'coin': return { x: rec.x, y: rec.y, w: 1, h: 1 };
    case 'trigger': return { x: rec.x, y: rec.y, w: 1, h: 1 };
    case 'deco':
      if (rec.shape === 'circle' || rec.shape === 'glow') {
        return { x: rec.x - rec.r, y: rec.y - rec.r, w: rec.r * 2, h: rec.r * 2 };
      }
      return { x: rec.x, y: rec.y, w: rec.w || 1, h: rec.h || 1 };
    default: return { x: rec.x, y: rec.y, w: 1, h: 1 };
  }
}

/** Expand a JSON record into items the shared DRAW table understands. */
export function recToDrawItems(rec) {
  switch (rec.t) {
    case 'block': return [{ type: 'block', x: rec.x, y: rec.y, w: rec.w || 1, h: rec.h || 1 }];
    case 'platform': return [{ type: 'platform', x: rec.x, y: rec.y, w: rec.w || 3, h: 0.5 }];
    case 'spike': {
      const out = [];
      const n = rec.n || 1, flip = rec.flip || 1;
      for (let i = 0; i < n; i++) out.push({ type: 'spike', x: rec.x + i, y: rec.y, flip });
      return out;
    }
    case 'saw': return [{ type: 'saw', cx: rec.x, cy: rec.y, r: rec.r || 1 }];
    case 'pad': return [{ type: 'pad', x: rec.x, y: rec.y }];
    case 'ring': return [{ type: 'ring', cx: rec.x + 0.5, cy: rec.y + 0.5, used: false }];
    case 'portal': return [{ type: 'portal', kind: rec.kind, value: rec.value, x: rec.x, y: rec.y }];
    case 'coin': return [{ type: 'coin', cx: rec.x + 0.5, cy: rec.y + 0.5, collected: false }];
    case 'trigger': return [{ type: 'trigger', kind: rec.kind, x: rec.x, y: rec.y }];
    case 'deco': return [{ type: 'deco', ...rec }];
    default: return [];
  }
}

/* ================================================= properties ==== */
/* Field schema for the right-hand panel. Only relevant fields appear. */

const F = {
  x: { key: 'x', label: 'X', type: 'number', step: 0.5 },
  y: { key: 'y', label: 'Y', type: 'number', step: 0.5 },
  w: { key: 'w', label: 'Width', type: 'number', step: 0.5, min: 0.25, max: 60 },
  h: { key: 'h', label: 'Height', type: 'number', step: 0.5, min: 0.25, max: 30 },
  r: { key: 'r', label: 'Radius', type: 'number', step: 0.1, min: 0.3, max: 4 },
  n: { key: 'n', label: 'Count', type: 'number', step: 1, min: 1, max: 16 },
  flip: { key: 'flip', label: 'Direction', type: 'select',
          options: [{ v: 1, label: 'Floor' }, { v: -1, label: 'Ceiling' }] },
  rot: { key: 'rot', label: 'Rotation°', type: 'number', step: 15, min: -180, max: 180 },
  color: { key: 'color', label: 'Colour', type: 'color' },
  opacity: { key: 'opacity', label: 'Opacity', type: 'range', min: 0.05, max: 1, step: 0.05 },
  layer: { key: 'layer', label: 'Layer', type: 'select',
           options: [{ v: 'bg', label: 'Behind player' }, { v: 'fg', label: 'In front' }] },
  group: { key: 'group', label: 'Group', type: 'number', step: 1, min: 0, max: 99 },
  // trigger fields
  target: { key: 'target', label: 'Target group', type: 'number', step: 1, min: 1, max: 99 },
  dx: { key: 'dx', label: 'Move X', type: 'number', step: 0.5, min: -48, max: 48 },
  dy: { key: 'dy', label: 'Move Y', type: 'number', step: 0.5, min: -30, max: 30 },
  dur: { key: 'dur', label: 'Duration (s)', type: 'number', step: 0.1, min: 0, max: 10 },
  ease: { key: 'ease', label: 'Easing', type: 'select', options: EASE_OPTIONS },
  fade: { key: 'opacity', label: 'Opacity →', type: 'range', min: 0, max: 1, step: 0.05 },
};

export function propsFor(rec) {
  const base = [F.x, F.y];
  switch (rec.t) {
    case 'block': return [...base, F.w, F.h, F.group];
    case 'platform': return [...base, F.w, F.group];
    case 'spike': return [...base, F.n, F.flip, F.group];
    case 'saw': return [...base, F.r, F.group];
    case 'portal': {
      const opts = rec.kind === 'gravity'
        ? [{ v: 1, label: 'To floor' }, { v: -1, label: 'To ceiling' }]
        : rec.kind === 'speed'
          ? [{ v: 'slow', label: 'Slow' }, { v: 'normal', label: 'Normal' }, { v: 'fast', label: 'Fast' }]
          : rec.kind === 'mode'
            ? [{ v: 'cube', label: 'Cube' }, { v: 'ship', label: 'Ship' }, { v: 'ufo', label: 'UFO' },
               { v: 'wave', label: 'Wave' }, { v: 'robot', label: 'Robot' }]
            : [{ v: 'mini', label: 'Mini' }, { v: 'normal', label: 'Normal' }];
      return [...base, { key: 'value', label: 'Mode', type: 'select', options: opts }, F.group];
    }
    case 'trigger':
      return rec.kind === 'alpha'
        ? [...base, F.target, F.fade, F.dur]
        : [...base, F.target, F.dx, F.dy, F.dur, F.ease];
    case 'deco': {
      const shape = [...base];
      if (rec.shape === 'circle' || rec.shape === 'glow') shape.push(F.r);
      else { shape.push(F.w, F.h); if (rec.shape !== 'tri') shape.push(F.rot); }
      shape.push(F.color, F.opacity, F.layer, F.group);
      return shape;
    }
    default: return [...base, F.group];    // pad / ring / coin
  }
}

/** Best-effort palette id for a record (eyedropper + favorites). */
export function paletteIdFor(rec) {
  switch (rec.t) {
    case 'block': return 'block1';
    case 'platform': return 'plat3';
    case 'spike': return (rec.flip || 1) < 0 ? 'spikeCeil' : ['spike1', 'spike2', 'spike3'][Math.min(2, (rec.n || 1) - 1)];
    case 'saw': return 'sawM';
    case 'pad': return 'pad';
    case 'ring': return 'ring';
    case 'portal':
      if (rec.kind === 'gravity') return rec.value === -1 ? 'gravUp' : 'gravDown';
      if (rec.kind === 'speed') return { slow: 'spdSlow', normal: 'spdNorm', fast: 'spdFast' }[rec.value] || 'spdNorm';
      if (rec.kind === 'mode') {
        return { cube: 'modeCube', ship: 'modeShip', ufo: 'modeUfo',
                 wave: 'modeWave', robot: 'modeRobot' }[rec.value] || 'modeCube';
      }
      return rec.value === 'mini' ? 'sizeMini' : 'sizeNorm';
    case 'trigger': return rec.kind === 'alpha' ? 'trigAlpha' : 'trigMove';
    case 'coin': return 'coin';
    case 'deco':
      if (rec.shape === 'glow') return 'fxGlow';
      if (rec.shape === 'beam') return 'fxBeam';
      if (rec.shape === 'circle') return 'decoCircle';
      if (rec.shape === 'tri') return 'decoTri';
      return 'decoRect';
    default: return null;
  }
}
