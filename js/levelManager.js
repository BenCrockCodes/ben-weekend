/**
 * levelManager.js — the internal level system.
 *
 * Main levels ship as an internal module (js/levelData.js) rather than
 * fetched files; player-created levels come from the editor's LevelStore;
 * future online levels will arrive through the same buildFromDef() door.
 *
 * Object records are compact: {"t":"spike","x":40,"y":0,...}. At build time
 * they expand into typed arrays (solids, hazards, pads, ...) with
 * precomputed hitboxes, each sorted by x so gameplay and rendering only
 * ever touch the objects near the player / camera.
 */
import { CONFIG } from './config.js';
import { MAIN_LEVELS } from './levelData.js';

const HB = CONFIG.HITBOX;

/** Binary search: first index in `arr` (sorted by .sortX) with sortX >= x. */
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].sortX < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Iterate objects whose x lies in [x0 - pad, x1]. `pad` covers wide objects
 *  (the widest object in a level is a multi-block run, capped at 8). */
function forRange(arr, x0, x1, cb) {
  for (let i = lowerBound(arr, x0 - 8); i < arr.length; i++) {
    const o = arr[i];
    if (o.sortX > x1) break;
    cb(o);
  }
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
    this.portals = [];     // gravity / speed / size gates
    this.coins = [];       // 3 hidden collectibles
    this.decosBg = [];     // non-colliding decoration behind gameplay objects
    this.decosFg = [];     // non-colliding decoration in front of the player

    let coinIdx = 0;
    for (const rec of def.objects) {
      const x = rec.x, y = rec.y || 0;
      switch (rec.t) {
        case 'block': {
          // split wide runs (e.g. gravity-section ceilings) into chunks no
          // wider than the query window pad, or collision would miss them
          const w = rec.w || 1, h = rec.h || 1;
          for (let cx = 0; cx < w; cx += 6) {
            const cw = Math.min(6, w - cx);
            this.solids.push({ type: 'block', x: x + cx, y, w: cw, h, sortX: x + cx });
          }
          break;
        }
        case 'platform': {
          const w = rec.w || 3;
          this.platforms.push({ type: 'platform', x, y, w, h: 0.5, sortX: x });
          break;
        }
        case 'spike': {
          const flip = rec.flip || 1;
          // n consecutive spikes can be encoded with "n"
          const n = rec.n || 1;
          for (let i = 0; i < n; i++) {
            const sx = x + i;
            this.hazards.push({
              type: 'spike', x: sx, y, flip, sortX: sx,
              box: {
                x: sx + 0.5 - HB.SPIKE_W / 2,
                y: flip < 0 ? y - HB.SPIKE_H : y,
                w: HB.SPIKE_W, h: HB.SPIKE_H,
              },
            });
          }
          break;
        }
        case 'saw': {
          const r = rec.r || 1;
          this.hazards.push({ type: 'saw', cx: x, cy: y, r, sortX: x - r,
                              hitR: r * HB.SAW_R });
          break;
        }
        case 'pad':
          this.pads.push({ type: 'pad', x, y, sortX: x, used: false,
                           box: { x: x + (1 - HB.PAD_W) / 2, y, w: HB.PAD_W, h: HB.PAD_H } });
          break;
        case 'ring':
          this.rings.push({ type: 'ring', cx: x + 0.5, cy: y + 0.5, sortX: x,
                            r: HB.RING_R, used: false });
          break;
        case 'portal':
          this.portals.push({
            type: 'portal', kind: rec.kind, value: rec.value, x, y, sortX: x,
            used: false,
            box: { x: x + (1 - HB.PORTAL_W) / 2, y, w: HB.PORTAL_W, h: HB.PORTAL_H },
          });
          break;
        case 'coin':
          this.coins.push({ type: 'coin', cx: x + 0.5, cy: y + 0.5, sortX: x,
                            idx: coinIdx++, collected: false, r: HB.COIN_R });
          break;
        case 'deco': {
          // pure visuals — no collision, editor-authored
          const d = {
            type: 'deco', shape: rec.shape || 'rect', x, y,
            w: rec.w || 1, h: rec.h || 1, r: rec.r || 1,
            color: rec.color || [1, 1, 1],
            opacity: rec.opacity !== undefined ? rec.opacity : 0.5,
            rot: rec.rot || 0, layer: rec.layer || 'bg',
            sortX: x - (rec.r || 0),
          };
          (d.layer === 'fg' ? this.decosFg : this.decosBg).push(d);
          break;
        }
        default:
          console.warn('Unknown level object type:', rec.t);
      }
    }

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

  /** Reset one-shot object state at the start of every attempt. */
  resetTransients() {
    for (const p of this.pads) p.used = false;
    for (const r of this.rings) r.used = false;
    for (const p of this.portals) p.used = false;
    for (const c of this.coins) c.collected = false;
  }

  /* windowed queries used by physics + rendering */
  eachSolid(x0, x1, cb) { forRange(this.solids, x0, x1, cb); }
  eachPlatform(x0, x1, cb) { forRange(this.platforms, x0, x1, cb); }
  eachHazard(x0, x1, cb) { forRange(this.hazards, x0, x1, cb); }
  eachPad(x0, x1, cb) { forRange(this.pads, x0, x1, cb); }
  eachRing(x0, x1, cb) { forRange(this.rings, x0, x1, cb); }
  eachPortal(x0, x1, cb) { forRange(this.portals, x0, x1, cb); }
  eachCoin(x0, x1, cb) { forRange(this.coins, x0, x1, cb); }
  eachRenderable(x0, x1, cb) { forRange(this.renderList, x0, x1, cb); }
  eachDecoBg(x0, x1, cb) { forRange(this.decosBg, x0, x1, cb); }
  eachDecoFg(x0, x1, cb) { forRange(this.decosFg, x0, x1, cb); }
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
   *  editor's test mode and (future) community levels. */
  buildFromDef(def) { return new LevelRuntime(def); }
}
