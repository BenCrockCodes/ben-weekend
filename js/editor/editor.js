/**
 * editor/editor.js — the level editor controller.
 *
 * Owns the working level definition, the free camera, tools, selection,
 * clipboard and undo/redo. Rendering goes through the exact same Renderer /
 * DRAW table as gameplay, so what you see in the editor is what you play.
 *
 * The DOM side (panels, modals, palette) lives in editorUI.js; game.js
 * delegates update/render here while game.state === 'editor'.
 */
import { CONFIG } from '../config.js';
import { clamp } from '../utils.js';
import { DRAW } from '../gameObjects.js';
import { drawBackgroundLayers, drawGround } from '../background.js';
import { PALETTE_BY_ID, recBounds, recToDrawItems, paletteIdFor } from './editorObjects.js';
import { History } from './history.js';
import { LevelStore, EditorPrefs } from './storage.js';
import { EditorUI } from './editorUI.js';

const ZOOM_MIN = 0.25, ZOOM_MAX = 3.5;
const CAM_SPEED = 22;                    // WASD pan speed (world units/s)

/** Turn a stored/custom definition into a playable one: derives speed from
 *  BPM and computes the auto length. Shared by the editor and the
 *  "My Levels" playtest flow. */
export function preparePlayDef(def) {
  const play = structuredClone(def);
  play.speed = play.bpm / 15;
  if (!play.lengthOverride) {
    let max = 40;
    for (const rec of play.objects) {
      const b = recBounds(rec);
      max = Math.max(max, b.x + b.w);
    }
    play.length = Math.ceil(max + 12);
  } else {
    play.length = play.lengthOverride;
  }
  return play;
}

/** Default palette for new custom levels (level 1's look). */
const DEFAULT_THEME = () => ({
  bg1: [0.02, 0.004, 0.055], bg2: [0.09, 0.03, 0.22],
  accent: [0.0, 0.94, 1.0], accent2: [1.0, 0.18, 0.65],
  ground: [0.05, 0.02, 0.13], block: [0.13, 0.07, 0.3],
});

export class Editor {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.active = false;

    this.prefs = EditorPrefs.load();
    this.history = new History();
    this.def = null;
    this.cam = { x: -8, y: -2, zoom: 1 };
    this.tool = 'select';                 // select | paint | delete | picker
    this.currentItem = 'block1';          // palette selection
    this.selection = new Set();
    this.clipboard = [];
    this.hover = null;                    // snapped hover cell {x, y}
    this.hoverRaw = null;                 // unsnapped world position
    this.keys = new Set();
    this.drag = null;                     // active pointer gesture
    this.dirty = false;                   // unsaved changes
    this._liveRecorded = false;

    this.ui = new EditorUI(this);
    this._bindViewport();
    this._bindKeys();
  }

  /* ================================================= lifecycle ==== */

  activate() {
    this.active = true;
    if (!this.def) {
      const last = this.prefs.lastLevelId && LevelStore.get(this.prefs.lastLevelId);
      if (last) this._adoptDef(last); else this.newLevel(true);
    }
    this.ui.onActivate();
  }

  deactivate() {
    this.active = false;
    this.keys.clear();
    this.drag = null;
  }

  /* ================================================= level defs ==== */

  _blankDef() {
    return {
      formatVersion: 2,
      id: LevelStore.newId(),
      name: 'UNTITLED',
      description: '',
      creator: '',
      difficulty: 'Custom',
      version: 1,
      bpm: 150,
      track: 'runner',
      customMusic: null,
      theme: DEFAULT_THEME(),
      lengthOverride: null,
      objects: [],
      editor: { camX: -8, camY: -2, zoom: 1 },
    };
  }

  _adoptDef(def) {
    // merge over a blank def so older saves stay loadable (backwards compat)
    this.def = { ...this._blankDef(), ...structuredClone(def) };
    this.def.theme = { ...DEFAULT_THEME(), ...(def.theme || {}) };
    this.selection.clear();
    this.history.clear();
    this.dirty = false;
    const ed = this.def.editor || {};
    this.cam.x = ed.camX ?? -8;
    this.cam.y = ed.camY ?? -2;
    this.cam.zoom = clamp(ed.zoom ?? 1, ZOOM_MIN, ZOOM_MAX);
    this._sortDirty = true;
    this.ui.onLevelChanged();
  }

  newLevel(silent = false) {
    if (!silent && this.dirty &&
        !window.confirm('Discard unsaved changes and start a new level?')) return;
    this._adoptDef(this._blankDef());
    this.ui.toast('New level created');
  }

  /** Auto length: last object + a victory run. */
  autoLength() {
    let max = 40;
    for (const rec of this.def.objects) {
      const b = recBounds(rec);
      max = Math.max(max, b.x + b.w);
    }
    return Math.ceil(max + 12);
  }

  /** Definition handed to the game for test plays (and future publishing). */
  buildPlayDef() { return preparePlayDef(this.def); }

  save() {
    this.def.editor = { camX: this.cam.x, camY: this.cam.y, zoom: this.cam.zoom };
    this.def.version = (this.def.version || 1);
    const ok = LevelStore.save(this.def);
    if (ok) {
      this.dirty = false;
      this.prefs.lastLevelId = this.def.id;
      EditorPrefs.save(this.prefs);
      this.ui.toast(`Saved "${this.def.name}"`);
    } else {
      this.ui.toast('Save failed — storage is full', true);
    }
  }

  saveAs(name) {
    this.def.id = LevelStore.newId();
    this.def.name = (name || 'UNTITLED').toUpperCase().slice(0, 24);
    this.def.version = 1;
    this.save();
    this.ui.onLevelChanged();
  }

  load(id) {
    const def = LevelStore.get(id);
    if (!def) return this.ui.toast('Level not found', true);
    this._adoptDef(def);
    this.prefs.lastLevelId = id;
    EditorPrefs.save(this.prefs);
    this.ui.toast(`Loaded "${this.def.name}"`);
  }

  importDef(def) {
    if (!def || !Array.isArray(def.objects)) {
      return this.ui.toast('Not a valid level file', true);
    }
    def.id = LevelStore.newId();          // never collide with existing ids
    this._adoptDef(def);
    this.dirty = true;
    this.ui.toast(`Imported "${this.def.name}" — remember to save`);
  }

  testLevel(fromCamera = false) {
    if (!this.def.objects.length) return this.ui.toast('Place some objects first!', true);
    const startX = fromCamera
      ? Math.max(CONFIG.PLAYER.SPAWN_X, this.cam.x + 2)
      : null;
    this.game.testLevel(this.buildPlayDef(), startX);
  }

  /* ================================================= history ==== */

  _snapshot() { return { objects: this.def.objects, theme: this.def.theme }; }

  _record() {
    this.history.record(this._snapshot());
    this.dirty = true;
    this.ui.refreshUndo();
  }

  _restore(state) {
    if (!state) return;
    this.def.objects = state.objects;
    this.def.theme = state.theme;
    this.selection.clear();
    this._sortDirty = true;
    this.dirty = true;
    this.ui.onSelectionChanged();
    this.ui.onThemeChanged();
    this.ui.refreshUndo();
  }

  undo() { this._restore(this.history.undo(this._snapshot())); }
  redo() { this._restore(this.history.redo(this._snapshot())); }

  /* ================================================= editing ops ==== */

  snap(v) {
    if (!this.prefs.snap) return Math.round(v * 100) / 100;
    const s = this.prefs.snapStep || 1;
    return Math.round(v / s) * s;
  }

  /** The grid cell CONTAINING the point (floor, not round) — a click lands
   *  in the cell under the cursor, never the neighbouring one. */
  snapCell(wx, wy) {
    const s = this.prefs.snap ? (this.prefs.snapStep || 1) : 0.01;
    return { x: Math.floor(wx / s) * s, y: Math.floor(wy / s) * s };
  }

  place(item, cellX, cellY, recordHistory = true) {
    const rec = item.make(cellX, cellY);
    // dedupe: don't stack an identical object on an identical spot
    const dup = this.def.objects.some((o) =>
      o.t === rec.t && Math.abs(o.x - rec.x) < 0.01 && Math.abs(o.y - rec.y) < 0.01);
    if (dup) return null;
    if (recordHistory) this._record();
    this.def.objects.push(rec);
    this._sortDirty = true;
    this.ui.noteUsed(item.id);
    return rec;
  }

  deleteRecs(recs, recordHistory = true) {
    if (!recs.length) return;
    if (recordHistory) this._record();
    const kill = new Set(recs);
    this.def.objects = this.def.objects.filter((o) => !kill.has(o));
    for (const r of recs) this.selection.delete(r);
    this._sortDirty = true;
    this.ui.onSelectionChanged();
  }

  deleteSelection() { this.deleteRecs([...this.selection]); }

  duplicateSelection(dx = 2, dy = 0) {
    if (!this.selection.size) return;
    this._record();
    const copies = [...this.selection].map((r) => {
      const c = structuredClone(r);
      c.x += dx; c.y += dy;
      return c;
    });
    this.def.objects.push(...copies);
    this.selection = new Set(copies);
    this._sortDirty = true;
    this.ui.onSelectionChanged();
  }

  copySelection() {
    if (!this.selection.size) return;
    this.clipboard = [...this.selection].map((r) => structuredClone(r));
    this.ui.toast(`Copied ${this.clipboard.length} object(s)`);
  }

  paste() {
    if (!this.clipboard.length) return;
    this._record();
    // paste at the hovered cell (or nudged right of the originals)
    let dx = 2, dy = 0;
    if (this.hover) {
      const minX = Math.min(...this.clipboard.map((r) => recBounds(r).x));
      const minY = Math.min(...this.clipboard.map((r) => recBounds(r).y));
      dx = this.hover.x - minX;
      dy = this.hover.y - minY;
    }
    const copies = this.clipboard.map((r) => {
      const c = structuredClone(r);
      c.x += dx; c.y += dy;
      return c;
    });
    this.def.objects.push(...copies);
    this.selection = new Set(copies);
    this._sortDirty = true;
    this.ui.onSelectionChanged();
  }

  selectionBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of this.selection) {
      const b = recBounds(r);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { minX, minY, maxX, maxY };
  }

  flipSelection(horizontal) {
    if (!this.selection.size) return;
    this._record();
    const bb = this.selectionBounds();
    for (const r of this.selection) {
      const b = recBounds(r);
      if (horizontal) {
        const newMinX = bb.minX + (bb.maxX - (b.x + b.w));
        r.x += newMinX - b.x;
      } else {
        const newMinY = bb.minY + (bb.maxY - (b.y + b.h));
        if (r.t === 'spike') {
          r.flip = (r.flip || 1) * -1;
          r.y = r.flip < 0 ? newMinY + 1 : newMinY;
        } else {
          r.y += newMinY - b.y;
          if (r.t === 'portal' && r.kind === 'gravity') r.value *= -1;
          if (r.t === 'deco' && r.shape === 'tri') r.rot = ((r.rot || 0) + 180) % 360;
        }
      }
    }
    this._sortDirty = true;
    this.ui.onSelectionChanged();
  }

  rotateSelection() {
    const rotatable = [...this.selection].filter(
      (r) => r.t === 'deco' && (r.shape === 'rect' || r.shape === 'beam'));
    if (!rotatable.length) {
      return this.ui.toast('Only decorations rotate — use Flip for gameplay objects', true);
    }
    this._record();
    for (const r of rotatable) r.rot = (((r.rot || 0) + 45 + 180) % 360) - 180;
    this.ui.onSelectionChanged();
  }

  alignSelectionY() {
    if (this.selection.size < 2) return;
    this._record();
    const target = recBounds([...this.selection][0]).y;
    for (const r of this.selection) {
      const b = recBounds(r);
      r.y += target - b.y;
      if (r.t === 'spike' && (r.flip || 1) < 0) { /* keep ceiling anchor */ }
    }
    this._sortDirty = true;
    this.ui.onSelectionChanged();
  }

  nudgeSelection(dx, dy) {
    if (!this.selection.size) return;
    if (!this._liveRecorded) { this._record(); this._liveRecorded = true; }
    for (const r of this.selection) { r.x += dx; r.y += dy; }
    this._sortDirty = true;
    this.ui.onSelectionChanged(true);
  }

  /** Property edits from the right panel. `live` = slider dragging etc. */
  applyProp(key, value, live = false) {
    if (!this.selection.size) return;
    if (!this._liveRecorded) { this._record(); this._liveRecorded = true; }
    for (const r of this.selection) {
      if (key in r || ['w', 'h', 'r', 'n', 'rot', 'color', 'opacity', 'layer', 'flip', 'value',
                       'group', 'target', 'dx', 'dy', 'dur', 'ease'].includes(key)) {
        const old = r[key];
        r[key] = value;
        if (key === 'flip' && r.t === 'spike' && old !== value) {
          // re-anchor so the spike stays in its visual cell
          r.y += value < 0 ? 1 : -1;
        }
      }
    }
    this._sortDirty = true;
    if (!live) this.commitEdit();
    this.ui.onSelectionChanged(true);
  }

  commitEdit() { this._liveRecorded = false; }

  setThemeColor(key, rgb) {
    if (!this._liveRecorded) { this._record(); this._liveRecorded = true; }
    this.def.theme[key] = rgb;
  }

  /* ================================================= picking ==== */

  hitTest(wx, wy) {
    // iterate top-most first (later = drawn later)
    const list = this.def.objects;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = recBounds(list[i]);
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return list[i];
    }
    return null;
  }

  screenToWorld(clientX, clientY) {
    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    const scale = this.renderer.baseScale * this.cam.zoom;
    return { x: this.cam.x + px / scale, y: this.cam.y + (canvas.height - py) / scale };
  }

  /* ================================================= viewport input ==== */

  _bindViewport() {
    const vp = document.getElementById('editor-viewport');
    vp.addEventListener('contextmenu', (e) => e.preventDefault());

    vp.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      vp.setPointerCapture(e.pointerId);
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.ui.hideContextMenu();

      if (e.button === 1 || this.keys.has('Space')) {          // pan
        this.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        return;
      }
      if (e.button === 2) {                                     // context menu
        const hit = this.hitTest(w.x, w.y);
        if (hit && !this.selection.has(hit)) { this.selection = new Set([hit]); this.ui.onSelectionChanged(); }
        this.ui.showContextMenu(e.clientX, e.clientY, hit);
        return;
      }
      if (e.button !== 0) return;

      switch (this.tool) {
        case 'paint': {
          const cell = this.snapCell(w.x, w.y);
          const item = PALETTE_BY_ID[this.currentItem];
          this._record();
          this.place(item, cell.x, cell.y, false);
          this.drag = { kind: 'paint', lastCell: cell };
          break;
        }
        case 'delete': {
          const hit = this.hitTest(w.x, w.y);
          this._record();
          if (hit) this.deleteRecs([hit], false);
          this.drag = { kind: 'erase' };
          break;
        }
        case 'picker': {
          const hit = this.hitTest(w.x, w.y);
          if (hit) {
            const pid = paletteIdFor(hit);
            if (pid) { this.setCurrentItem(pid); this.setTool('paint'); this.ui.toast(`Picked ${PALETTE_BY_ID[pid].name}`); }
          }
          break;
        }
        default: {   // select
          const hit = this.hitTest(w.x, w.y);
          if (hit) {
            if (e.shiftKey) {
              this.selection.has(hit) ? this.selection.delete(hit) : this.selection.add(hit);
            } else if (!this.selection.has(hit)) {
              this.selection = new Set([hit]);
            }
            this.ui.onSelectionChanged();
            this.drag = {
              kind: 'move', startW: w, moved: false,
              orig: new Map([...this.selection].map((r) => [r, { x: r.x, y: r.y }])),
            };
          } else {
            if (!e.shiftKey) { this.selection.clear(); this.ui.onSelectionChanged(); }
            this.drag = { kind: 'band', startW: w, endW: w, keep: e.shiftKey };
          }
        }
      }
    });

    vp.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.hoverRaw = w;
      this.hover = this.snapCell(w.x, w.y);
      this.ui.setStatus(w.x, w.y, this.cam.zoom);
      if (!this.drag) return;

      switch (this.drag.kind) {
        case 'pan': {
          const scale = this.renderer.baseScale * this.cam.zoom;
          const dpr = this.renderer.dpr || 1;
          this.cam.x -= (e.clientX - this.drag.lastX) * dpr / scale;
          this.cam.y += (e.clientY - this.drag.lastY) * dpr / scale;
          this.drag.lastX = e.clientX; this.drag.lastY = e.clientY;
          break;
        }
        case 'paint': {
          const cell = this.snapCell(w.x, w.y);
          if (cell.x !== this.drag.lastCell.x || cell.y !== this.drag.lastCell.y) {
            this.place(PALETTE_BY_ID[this.currentItem], cell.x, cell.y, false);
            this.drag.lastCell = cell;
          }
          break;
        }
        case 'erase': {
          const hit = this.hitTest(w.x, w.y);
          if (hit) this.deleteRecs([hit], false);
          break;
        }
        case 'move': {
          const dx = this.snap(w.x - this.drag.startW.x);
          const dy = this.snap(w.y - this.drag.startW.y);
          if (!this.drag.moved && (dx || dy)) { this._record(); this.drag.moved = true; }
          if (this.drag.moved) {
            for (const [r, o] of this.drag.orig) { r.x = o.x + dx; r.y = o.y + dy; }
            this._sortDirty = true;
            this.ui.onSelectionChanged(true);
          }
          break;
        }
        case 'band':
          this.drag.endW = w;
          break;
      }
    });

    const finish = (e) => {
      if (!this.drag) return;
      if (this.drag.kind === 'band') {
        const a = this.drag.startW, b = this.drag.endW;
        const rx0 = Math.min(a.x, b.x), rx1 = Math.max(a.x, b.x);
        const ry0 = Math.min(a.y, b.y), ry1 = Math.max(a.y, b.y);
        if (rx1 - rx0 > 0.15 || ry1 - ry0 > 0.15) {
          const picked = this.def.objects.filter((rec) => {
            const bb = recBounds(rec);
            return bb.x < rx1 && bb.x + bb.w > rx0 && bb.y < ry1 && bb.y + bb.h > ry0;
          });
          if (!this.drag.keep) this.selection.clear();
          picked.forEach((r) => this.selection.add(r));
          this.ui.onSelectionChanged();
        }
      }
      this.drag = null;
    };
    vp.addEventListener('pointerup', finish);
    vp.addEventListener('pointercancel', finish);

    vp.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      const before = this.screenToWorld(e.clientX, e.clientY);
      this.cam.zoom = clamp(this.cam.zoom * Math.exp(-e.deltaY * 0.0011), ZOOM_MIN, ZOOM_MAX);
      const after = this.screenToWorld(e.clientX, e.clientY);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
      this.ui.setStatus(before.x, before.y, this.cam.zoom);
    }, { passive: false });
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

      this.keys.add(e.code);
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (ctrl && e.code === 'KeyC') { e.preventDefault(); this.copySelection(); }
      else if (ctrl && e.code === 'KeyX') { e.preventDefault(); this.copySelection(); this.deleteSelection(); }
      else if (ctrl && e.code === 'KeyV') { e.preventDefault(); this.paste(); }
      else if (ctrl && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelection(); }
      else if (ctrl && e.code === 'KeyS') { e.preventDefault(); this.save(); }
      else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.deleteSelection(); }
      else if (e.code === 'KeyG') { this.prefs.grid = !this.prefs.grid; EditorPrefs.save(this.prefs); this.ui.syncToggles(); }
      else if (e.code === 'Digit1') this.setTool('select');
      else if (e.code === 'Digit2') this.setTool('paint');
      else if (e.code === 'Digit3') this.setTool('delete');
      else if (e.code === 'Digit4') this.setTool('picker');
      else if (e.code === 'ArrowLeft') { e.preventDefault(); this.nudgeSelection(-(this.prefs.snapStep || 1), 0); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this.nudgeSelection(this.prefs.snapStep || 1, 0); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); this.nudgeSelection(0, this.prefs.snapStep || 1); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); this.nudgeSelection(0, -(this.prefs.snapStep || 1)); }
      else if (e.code === 'Space') e.preventDefault();   // reserved for panning
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) this.commitEdit();
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  onEscape() {
    if (this.ui.closeTopmost()) return;
    if (this.selection.size) { this.selection.clear(); this.ui.onSelectionChanged(); return; }
    this.game.exitEditor();
  }

  setTool(tool) { this.tool = tool; this.ui.syncTool(); }

  /** Zoom about the viewport center (toolbar buttons; wheel zooms at cursor). */
  zoomBy(factor) {
    const midX = this.cam.x + (this.renderer.viewW || 0) / 2;
    const midY = this.cam.y + CONFIG.VIEW_H / this.cam.zoom / 2;
    this.cam.zoom = clamp(this.cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    this.cam.x = midX - this.renderer.viewW / 2;
    this.cam.y = midY - CONFIG.VIEW_H / this.cam.zoom / 2;
  }

  zoomReset() { this.cam.zoom = 1; }

  setCurrentItem(id) {
    this.currentItem = id;
    if (this.tool !== 'paint') this.setTool('paint');
    this.ui.syncPaletteSelection();
  }

  /* ================================================= frame ==== */

  update(dt) {
    const move = CAM_SPEED * dt / Math.sqrt(this.cam.zoom);
    if (this.keys.has('KeyA')) this.cam.x -= move;
    if (this.keys.has('KeyD')) this.cam.x += move;
    if (this.keys.has('KeyW')) this.cam.y += move;
    if (this.keys.has('KeyS') && !this.keys.has('ControlLeft') && !this.keys.has('ControlRight')) this.cam.y -= move;
    this.cam.x = clamp(this.cam.x, -60, 100000);
    this.cam.y = clamp(this.cam.y, -30, 300);
  }

  /** Sorted view of objects for culled rendering. */
  _sorted() {
    if (this._sortDirty || !this._sortedList) {
      this._sortedList = [...this.def.objects].sort((a, b) => recBounds(a).x - recBounds(b).x);
      this._sortDirty = false;
    }
    return this._sortedList;
  }

  render(time) {
    const r = this.renderer;
    const theme = this.def.theme;
    const cam = { x: this.cam.x, y: this.cam.y };
    r.begin(cam, this.cam.zoom);

    const length = this.def.lengthOverride || this.autoLength();
    drawBackgroundLayers(r, cam, theme, time, 0);
    drawGround(r, cam, theme, time, 0, length);
    this._drawGrid(r, cam);
    r.flushSolidLayer();

    // objects — decorations (bg), gameplay, decorations (fg)
    const x0 = cam.x - 64, x1 = cam.x + r.viewW + 8;
    const sorted = this._sorted();
    const passes = [
      (rec) => rec.t === 'deco' && (rec.layer || 'bg') === 'bg',
      (rec) => rec.t !== 'deco',
      (rec) => rec.t === 'deco' && rec.layer === 'fg',
    ];
    for (const pass of passes) {
      for (const rec of sorted) {
        const b = recBounds(rec);
        if (b.x + b.w < x0 || b.x > x1) continue;
        if (!pass(rec)) continue;
        for (const item of recToDrawItems(rec)) {
          const fn = DRAW[item.type];
          if (fn) fn(r, item, theme, time, 0, false);
        }
      }
    }
    r.flushGlowLayer();
    r.flushSolidLayer();

    this._drawOverlays(r, time);
    r.flushSolidLayer();
    r.flushGlowLayer();
  }

  _drawGrid(r, cam) {
    if (!this.prefs.grid) return;
    const scalePx = r.baseScale * this.cam.zoom;
    const step = scalePx > 26 ? 1 : 4;                    // fall back to beat grid when far out
    const thin = 1.2 / scalePx;
    const x0 = Math.floor(cam.x / step) * step, x1 = cam.x + r.viewW + step;
    const y0 = Math.floor(cam.y / step) * step, y1 = cam.y + CONFIG.VIEW_H / this.cam.zoom + step;
    for (let x = x0; x < x1; x += step) {
      const major = ((x % 4) + 4) % 4 === 0;
      r.quad(x - thin / 2, cam.y, thin, y1 - cam.y, [1, 1, 1], major ? 0.09 : 0.045);
    }
    for (let y = y0; y < y1; y += step) {
      const major = ((y % 4) + 4) % 4 === 0;
      r.quad(x0, y - thin / 2, x1 - x0, thin, [1, 1, 1], major ? 0.09 : 0.045);
    }
    // origin/ground marker
    r.quad(x0, -0.02, x1 - x0, 0.04, [0, 0.94, 1], 0.5);
  }

  _drawOverlays(r, time) {
    const scalePx = r.baseScale * this.cam.zoom;
    const line = 2.5 / scalePx;

    // selection outlines
    for (const rec of this.selection) {
      const b = recBounds(rec);
      const pulse = 0.65 + 0.3 * Math.sin(time * 6);
      const c = [1, 1, 1];
      r.quad(b.x - line, b.y - line, b.w + line * 2, line, c, pulse);
      r.quad(b.x - line, b.y + b.h, b.w + line * 2, line, c, pulse);
      r.quad(b.x - line, b.y, line, b.h, c, pulse);
      r.quad(b.x + b.w, b.y, line, b.h, c, pulse);
    }

    // rubber band
    if (this.drag && this.drag.kind === 'band') {
      const a = this.drag.startW, b = this.drag.endW;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      r.quad(x, y, w, h, [0, 0.94, 1], 0.12);
      r.quad(x, y, w, line, [0, 0.94, 1], 0.8);
      r.quad(x, y + h, w, line, [0, 0.94, 1], 0.8);
      r.quad(x, y, line, h, [0, 0.94, 1], 0.8);
      r.quad(x + w, y, line, h, [0, 0.94, 1], 0.8);
    }

    // placement ghost
    if (this.tool === 'paint' && this.hover && !this.drag) {
      const item = PALETTE_BY_ID[this.currentItem];
      if (item) {
        const ghost = item.make(this.hover.x, this.hover.y);
        for (const it of recToDrawItems(ghost)) {
          const fn = DRAW[it.type];
          if (fn) fn(r, it, this.def.theme, time, 0, false);
        }
        const b = recBounds(ghost);
        r.quad(b.x, b.y, b.w, b.h, [1, 1, 1], 0.15);
      }
    }
  }
}
