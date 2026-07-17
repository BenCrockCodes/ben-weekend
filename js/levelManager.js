/**
 * levelManager.js — the internal level system.
 *
 * Main levels ship as an internal module (js/levelData.js) rather than
 * fetched files; player-created levels come from the editor's LevelStore;
 * online levels arrive through the same buildFromDef() door.
 *
 * Object records are compact: {"t":"spike","x":40,"y":0,...}. At build time
 * they expand into typed arrays (solids, hazards, pads, ...) with
 * precomputed hitboxes, each sorted by x so gameplay and rendering only
 * ever touch the objects near the player / camera.
 *
 * GROUPS & TRIGGERS
 * Any object record may carry `group` (1–99). Trigger records
 * ({t:'trigger', kind:'move'|'alpha', …}) fire once per attempt when the
 * player passes their x position and tween every object in their target
 * group: Move offsets positions (gameplay collision follows — the hitboxes
 * really move), Alpha fades the group's rendering (visual only, exactly
 * like the original game). Because moved objects keep their build-time
 * sort position, the spatial query window is widened by the maximum move
 * distance in the level (`movePad`).
 */
import { CONFIG } from './config.js';
import { MAIN_LEVELS } from './levelData.js';
import { clamp, lerp } from './utils.js';

const HB = CONFIG.HITBOX;

/** Easing library for triggers (t in [0,1] → eased [0,1]). */
export const EASE = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => t * (2 - t),
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
};
export const EASE_OPTIONS = [
  { v: 'linear', label: 'Linear' },
  { v: 'in', label: 'Ease In' },
  { v: 'out', label: 'Ease Out' },
  { v: 'inout', label: 'Ease In-Out' },
  { v: 'back', label: 'Back (overshoot)' },
];

/** Binary search: first index in `arr` (sorted by .sortX) with sortX >= x. */
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].sortX < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Positional fields a move trigger may shift, per runtime object. */
function snapshotBase(o) {
  const b = { x: o.x, y: o.y, cx: o.cx, cy: o.cy };
  if (o.box) b.box = { x: o.box.x, y: o.box.y };
  return b;
}
function applyOffset(o, base, ox, oy) {
  if (base.x !== undefined) { o.x = base.x + ox; o.y = base.y + oy; }
  if (base.cx !== undefined) { o.cx = base.cx + ox; o.cy = base.cy + oy; }
  if (base.box) { o.box.x = base.box.x + ox; o.box.y = base.box.y + oy; }
}

export class LevelRuntime {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.id = def.id;
    this.length = def.length;
    this.speed = def.speed;
    this.bpm = def.bpm;
    this.track = def.track;
    this.customMusic = def.customMusic || null;
    this.theme = def.theme;

    this.solids = [];      // blocks: deadly from the side, walkable on top
    this.platforms = [];   // one-way: land from the gravity side only
    this.hazards = [];     // spikes + saws: instant death
    this.pads = [];        // auto-launch
    this.rings = [];       // tap-to-jump orbs
    this.portals = [];     // gravity / speed / size / gamemode gates
    this.coins = [];       // hidden collectibles
    this.decosBg = [];     // non-colliding decoration behind gameplay objects
    this.decosFg = [];     // non-colliding decoration in front of the player

    this.triggers = [];    // move/alpha triggers, fired by player x
    this.groups = new Map();      // group id → [{obj, base}] members
    this.groupState = new Map();  // group id → {ox, oy, alpha}
    this.tweens = [];             // active trigger tweens

    let coinIdx = 0;
    const track = (o, rec) => {   // register an object with its group
      o.g = rec.group | 0;
      if (o.g > 0) {
        if (!this.groups.has(o.g)) this.groups.set(o.g, []);
        this.groups.get(o.g).push({ obj: o, base: snapshotBase(o) });
      }
      return o;
    };

    for (const rec of def.objects) {
      const x = rec.x, y = rec.y || 0;
      switch (rec.t) {
        case 'block': {
          // split wide runs into chunks no wider than the query window pad,
          // or collision would miss them
          const w = rec.w || 1, h = rec.h || 1;
          for (let cx = 0; cx < w; cx += 6) {
            const cw = Math.min(6, w - cx);
            this.solids.push(track({ type: 'block', x: x + cx, y, w: cw, h, sortX: x + cx }, rec));
          }
          break;
        }
        case 'platform': {
          const w = rec.w || 3;
          this.platforms.push(track({ type: 'platform', x, y, w, h: 0.5, sortX: x }, rec));
          break;
        }
        case 'spike': {
          const flip = rec.flip || 1;
          const n = rec.n || 1;                 // n consecutive spikes
          for (let i = 0; i < n; i++) {
            const sx = x + i;
            this.hazards.push(track({
              type: 'spike', x: sx, y, flip, sortX: sx,
              box: {
                x: sx + 0.5 - HB.SPIKE_W / 2,
                y: flip < 0 ? y - HB.SPIKE_H : y,
                w: HB.SPIKE_W, h: HB.SPIKE_H,
              },
            }, rec));
          }
          break;
        }
        case 'saw': {
          const r = rec.r || 1;
          this.hazards.push(track({ type: 'saw', cx: x, cy: y, r, sortX: x - r,
                                    hitR: r * HB.SAW_R }, rec));
          break;
        }
        case 'pad':
          this.pads.push(track({ type: 'pad', x, y, sortX: x, used: false,
                                 box: { x: x + (1 - HB.PAD_W) / 2, y, w: HB.PAD_W, h: HB.PAD_H } }, rec));
          break;
        case 'ring':
          this.rings.push(track({ type: 'ring', cx: x + 0.5, cy: y + 0.5, sortX: x,
                                  r: HB.RING_R, used: false }, rec));
          break;
        case 'portal':
          this.portals.push(track({
            type: 'portal', kind: rec.kind, value: rec.value, x, y, sortX: x,
            used: false,
            box: { x: x + (1 - HB.PORTAL_W) / 2, y, w: HB.PORTAL_W, h: HB.PORTAL_H },
          }, rec));
          break;
        case 'coin':
          this.coins.push(track({ type: 'coin', cx: x + 0.5, cy: y + 0.5, sortX: x,
                                  idx: coinIdx++, collected: false, r: HB.COIN_R }, rec));
          break;
        case 'deco': {
          const d = track({
            type: 'deco', shape: rec.shape || 'rect', x, y,
            w: rec.w || 1, h: rec.h || 1, r: rec.r || 1,
            color: rec.color || [1, 1, 1],
            opacity: rec.opacity !== undefined ? rec.opacity : 0.5,
            rot: rec.rot || 0, layer: rec.layer || 'bg',
            sortX: x - (rec.r || 0),
          }, rec);
          (d.layer === 'fg' ? this.decosFg : this.decosBg).push(d);
          break;
        }
        case 'trigger':
          this.triggers.push({
            kind: rec.kind || 'move', x, y,
            target: rec.target | 0,
            dx: rec.dx || 0, dy: rec.dy || 0,
            dur: Math.max(0, rec.dur !== undefined ? rec.dur : 1),
            ease: EASE[rec.ease] ? rec.ease : 'linear',
            opacity: rec.opacity !== undefined ? clamp(rec.opacity, 0, 1) : 1,
            fired: false,
          });
          break;
        default:
          console.warn('Unknown level object type:', rec.t);
      }
    }

    // widen spatial queries by the furthest any group can travel, so moved
    // objects are still found by collision/render culling (sortX is static)
    let movePad = 0;
    const perGroup = new Map();
    for (const tr of this.triggers) {
      if (tr.kind !== 'move' || !tr.target) continue;
      const d = (perGroup.get(tr.target) || 0) + Math.abs(tr.dx);
      perGroup.set(tr.target, d);
      movePad = Math.max(movePad, d);
    }
    this.movePad = Math.min(48, Math.ceil(movePad));
    this.queryPad = 8 + this.movePad;

    this.triggers.sort((a, b) => a.x - b.x);
    this._nextTrigger = 0;

    // sort every list by x for windowed iteration
    const byX = (a, b) => a.sortX - b.sortX;
    for (const arr of [this.solids, this.platforms, this.hazards,
                       this.pads, this.rings, this.portals, this.coins,
                       this.decosBg, this.decosFg]) {
      arr.sort(byX);
    }

    // one combined render list (draw order: portals under everything,
    // then solids/platforms, hazards, pads, rings, coins on top)
    this.renderList = [
      ...this.portals, ...this.solids, ...this.platforms,
      ...this.hazards, ...this.pads, ...this.rings, ...this.coins,
    ].sort(byX);
  }

  /* ------------------------------------------------ triggers ---- */

  _state(g) {
    if (!this.groupState.has(g)) this.groupState.set(g, { ox: 0, oy: 0, alpha: 1 });
    return this.groupState.get(g);
  }

  /** Rendering alpha multiplier for an object (1 when ungrouped/unfaded). */
  groupAlpha(o) {
    if (!o.g) return 1;
    const st = this.groupState.get(o.g);
    return st ? st.alpha : 1;
  }

  /**
   * Advance the trigger system one frame. Called once per rendered frame
   * (not per physics substep — tweens are time-based and stay smooth).
   */
  updateTriggers(playerX, dt) {
    // fire every trigger the player has passed (list is sorted by x)
    while (this._nextTrigger < this.triggers.length &&
           this.triggers[this._nextTrigger].x <= playerX) {
      const tr = this.triggers[this._nextTrigger++];
      if (tr.fired || !tr.target) continue;
      tr.fired = true;
      const st = this._state(tr.target);
      if (tr.kind === 'alpha') {
        this.tweens.push({ kind: 'alpha', g: tr.target, t: 0, dur: tr.dur,
                           from: st.alpha, to: tr.opacity });
      } else {
        this.tweens.push({ kind: 'move', g: tr.target, t: 0, dur: tr.dur,
                           ease: EASE[tr.ease], dx: tr.dx, dy: tr.dy, lastK: 0 });
      }
    }

    if (!this.tweens.length) return;
    const dirty = new Set();
    for (const tw of this.tweens) {
      tw.t += dt;
      const raw = tw.dur <= 0.0001 ? 1 : Math.min(1, tw.t / tw.dur);
      const st = this._state(tw.g);
      if (tw.kind === 'alpha') {
        st.alpha = lerp(tw.from, tw.to, raw);
      } else {
        // moves are RELATIVE and stack: apply only this frame's delta,
        // so overlapping move triggers add together like the original
        const k = tw.ease(raw);
        st.ox += (k - tw.lastK) * tw.dx;
        st.oy += (k - tw.lastK) * tw.dy;
        tw.lastK = k;
        dirty.add(tw.g);
      }
      tw.done = raw >= 1;
    }
    this.tweens = this.tweens.filter((tw) => !tw.done);

    for (const g of dirty) {
      const st = this.groupState.get(g);
      const members = this.groups.get(g);
      if (!members) continue;
      for (const m of members) applyOffset(m.obj, m.base, st.ox, st.oy);
    }
  }

  /* ------------------------------------------------ attempts ---- */

  /** Reset one-shot object state at the start of every attempt. */
  resetTransients() {
    for (const p of this.pads) p.used = false;
    for (const r of this.rings) r.used = false;
    for (const p of this.portals) p.used = false;
    for (const c of this.coins) c.collected = false;
    // triggers: unfire, stop tweens, restore every group to its base pose
    for (const t of this.triggers) t.fired = false;
    this._nextTrigger = 0;
    this.tweens = [];
    for (const [g, members] of this.groups) {
      const st = this._state(g);
      st.ox = 0; st.oy = 0; st.alpha = 1;
      for (const m of members) applyOffset(m.obj, m.base, 0, 0);
    }
  }

  /* ------------------------------------------------ queries ---- */
  /* Iterate objects whose base x lies within [x0 - pad, x1 + movePad]; the
   * pad covers wide objects and the furthest trigger movement. */

  _forRange(arr, x0, x1, cb) {
    const pad = this.queryPad;
    for (let i = lowerBound(arr, x0 - pad); i < arr.length; i++) {
      const o = arr[i];
      if (o.sortX > x1 + this.movePad) break;
      cb(o);
    }
  }

  eachSolid(x0, x1, cb) { this._forRange(this.solids, x0, x1, cb); }
  eachPlatform(x0, x1, cb) { this._forRange(this.platforms, x0, x1, cb); }
  eachHazard(x0, x1, cb) { this._forRange(this.hazards, x0, x1, cb); }
  eachPad(x0, x1, cb) { this._forRange(this.pads, x0, x1, cb); }
  eachRing(x0, x1, cb) { this._forRange(this.rings, x0, x1, cb); }
  eachPortal(x0, x1, cb) { this._forRange(this.portals, x0, x1, cb); }
  eachCoin(x0, x1, cb) { this._forRange(this.coins, x0, x1, cb); }
  eachRenderable(x0, x1, cb) { this._forRange(this.renderList, x0, x1, cb); }
  eachDecoBg(x0, x1, cb) { this._forRange(this.decosBg, x0, x1, cb); }
  eachDecoFg(x0, x1, cb) { this._forRange(this.decosFg, x0, x1, cb); }
}

export class LevelManager {
  constructor() {
    this.defs = [];        // main-level definitions, index-aligned with CONFIG.LEVEL_LIST
  }

  /** Main levels live in an internal module — no fetches, instant load. */
  loadAll() {
    this.defs = CONFIG.LEVEL_LIST
      .map((id) => MAIN_LEVELS.find((d) => d.id === id))
      .filter(Boolean)
      .map((d) => structuredClone(d));
  }

  get count() { return this.defs.length; }
  meta(index) { return this.defs[index]; }

  /** Build a fresh runtime level (call once per level entry, not per attempt). */
  build(index) { return new LevelRuntime(this.defs[index]); }

  /** Build a runtime straight from a definition object — used by the level
   *  editor's test mode and community levels. */
  buildFromDef(def) { return new LevelRuntime(def); }
}
