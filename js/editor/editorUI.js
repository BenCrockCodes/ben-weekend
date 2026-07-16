/**
 * editor/editorUI.js — all DOM for the level editor.
 *
 * Builds the five sections (top toolbar, left tools, right properties,
 * bottom object palette, viewport status) plus modals, the context menu and
 * toasts. Pure view layer: every mutation goes through editor.js methods.
 */
import { CATEGORIES, PALETTE, PALETTE_BY_ID, propsFor, paletteIdFor } from './editorObjects.js';
import { LevelStore, EditorPrefs, exportLevelFile } from './storage.js';
import { AudioManager } from '../audioManager.js';
import { Backend } from '../backend/backend.js';

/* tiny DOM helpers */
const el = (tag, cls = '', html = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html) n.innerHTML = html;
  return n;
};
const rgbToHex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const THEME_FIELDS = [
  ['bg1', 'Background · bottom'],
  ['bg2', 'Background · top'],
  ['accent', 'Primary accent / ground line'],
  ['accent2', 'Hazard accent'],
  ['ground', 'Ground fill'],
  ['block', 'Block fill'],
];

const TOOLS = [
  ['select', '⬚', 'Select / Move (1)'],
  ['paint', '✏', 'Place / Paint (2)'],
  ['delete', '✖', 'Delete (3)'],
  ['picker', '⊙', 'Eyedropper (4)'],
];
const ACTIONS = [
  ['duplicate', '⧉', 'Duplicate (Ctrl+D)'],
  ['flipH', '⇋', 'Flip horizontally'],
  ['flipV', '⇵', 'Flip vertically'],
  ['rotate', '⟳', 'Rotate decoration 45°'],
  ['alignY', '≡', 'Align selection to a row'],
  ['undo', '↶', 'Undo (Ctrl+Z)'],
  ['redo', '↷', 'Redo (Ctrl+Y)'],
];

export class EditorUI {
  constructor(editor) {
    this.editor = editor;
    this.activeCat = 'blocks';
    this.search = '';
    this.openModal = null;
    this._buildTop();
    this._buildLeft();
    this._buildRight();
    this._buildBottom();
    this._buildOverlays();
  }

  /* ================================================== top bar ==== */

  _buildTop() {
    const bar = document.getElementById('ed-top');
    bar.innerHTML = '';
    const title = el('div', 'ed-title', 'EDITOR');
    this.$levelName = el('button', 'ed-levelname', 'UNTITLED');
    this.$levelName.title = 'Level settings';
    this.$levelName.onclick = () => this.open('settings');

    const mk = (label, title, fn, cls = '') => {
      const b = el('button', 'ed-btn ' + cls, label);
      b.title = title;
      b.onclick = () => { this.editor.game.audio.unlock(); this.editor.game.audio.playSfx('click'); fn(); };
      return b;
    };
    bar.append(
      title, this.$levelName,
      mk('NEW', 'New level', () => this.editor.newLevel()),
      mk('LOAD', 'Open a saved level', () => this.open('load')),
      mk('SAVE', 'Save (Ctrl+S)', () => this.editor.save()),
      mk('SAVE AS', 'Save a copy under a new name', () => this.open('saveas')),
      el('span', 'ed-sep'),
      mk('▶ TEST', 'Play from the start', () => this.editor.testLevel(false), 'ed-accent'),
      mk('▶ HERE', 'Play from the camera position', () => this.editor.testLevel(true)),
      el('span', 'ed-sep'),
      mk('COLOURS', 'Level colour palette', () => this.open('colors')),
      mk('MUSIC', 'Soundtrack', () => this.open('music')),
      mk('SETTINGS', 'Level settings', () => this.open('settings')),
      mk('PUBLISH', 'Share this level with every player', () => this.open('publish')),
      el('span', 'ed-flex'),
      mk('EXIT', 'Back to the main menu', () => {
        if (this.editor.dirty && !window.confirm('Exit with unsaved changes?')) return;
        this.editor.game.exitEditor();
      }, 'ed-danger'),
    );
  }

  /* ================================================== left bar ==== */

  _buildLeft() {
    const bar = document.getElementById('ed-left');
    bar.innerHTML = '';
    this.$toolBtns = {};
    for (const [id, glyph, tip] of TOOLS) {
      const b = el('button', 'ed-tool', glyph);
      b.title = tip;
      b.onclick = () => this.editor.setTool(id);
      this.$toolBtns[id] = b;
      bar.append(b);
    }
    bar.append(el('div', 'ed-tooldiv'));
    this.$actionBtns = {};
    for (const [id, glyph, tip] of ACTIONS) {
      const b = el('button', 'ed-tool ed-action', glyph);
      b.title = tip;
      b.onclick = () => this._runAction(id);
      this.$actionBtns[id] = b;
      bar.append(b);
    }
    bar.append(el('div', 'ed-tooldiv'));
    this.$gridBtn = el('button', 'ed-tool', '▦');
    this.$gridBtn.title = 'Toggle grid (G)';
    this.$gridBtn.onclick = () => {
      this.editor.prefs.grid = !this.editor.prefs.grid;
      EditorPrefs.save(this.editor.prefs);
      this.syncToggles();
    };
    this.$snapBtn = el('button', 'ed-tool', '⌗');
    this.$snapBtn.title = 'Toggle grid snapping';
    this.$snapBtn.onclick = () => {
      this.editor.prefs.snap = !this.editor.prefs.snap;
      EditorPrefs.save(this.editor.prefs);
      this.syncToggles();
    };
    this.$stepBtn = el('button', 'ed-tool', '1');
    this.$stepBtn.title = 'Snap step (1 or ½ block)';
    this.$stepBtn.onclick = () => {
      this.editor.prefs.snapStep = this.editor.prefs.snapStep === 1 ? 0.5 : 1;
      EditorPrefs.save(this.editor.prefs);
      this.syncToggles();
    };
    bar.append(this.$gridBtn, this.$snapBtn, this.$stepBtn);
    this.syncTool();
    this.syncToggles();
  }

  _runAction(id) {
    const ed = this.editor;
    switch (id) {
      case 'duplicate': ed.duplicateSelection(); break;
      case 'flipH': ed.flipSelection(true); break;
      case 'flipV': ed.flipSelection(false); break;
      case 'rotate': ed.rotateSelection(); break;
      case 'alignY': ed.alignSelectionY(); break;
      case 'undo': ed.undo(); break;
      case 'redo': ed.redo(); break;
    }
  }

  syncTool() {
    for (const [id, b] of Object.entries(this.$toolBtns)) {
      b.classList.toggle('on', this.editor.tool === id);
    }
  }

  syncToggles() {
    this.$gridBtn.classList.toggle('on', !!this.editor.prefs.grid);
    this.$snapBtn.classList.toggle('on', !!this.editor.prefs.snap);
    this.$stepBtn.textContent = this.editor.prefs.snapStep === 0.5 ? '½' : '1';
  }

  refreshUndo() {
    this.$actionBtns.undo.classList.toggle('dim', !this.editor.history.canUndo);
    this.$actionBtns.redo.classList.toggle('dim', !this.editor.history.canRedo);
  }

  /* ================================================== right panel ==== */

  _buildRight() {
    const panel = document.getElementById('ed-right');
    panel.innerHTML = '<h3>PROPERTIES</h3><div id="ed-props"></div>';
    this.$props = panel.querySelector('#ed-props');
    this.onSelectionChanged();
  }

  onSelectionChanged(light = false) {
    if (light && this._propRecs) { this._updatePropValues(); return; }
    const sel = [...this.editor.selection];
    this._propRecs = sel;
    const box = this.$props;
    box.innerHTML = '';

    if (sel.length === 0) {
      const d = this.editor.def;
      box.append(el('p', 'ed-hint',
        'Click an object to edit it.<br><br>' +
        `<b>${d ? d.objects.length : 0}</b> objects<br>` +
        `Length <b>${d ? (d.lengthOverride || this.editor.autoLength()) : 0}</b> blocks<br><br>` +
        'Right-click objects for quick actions.'));
      return;
    }

    if (sel.length > 1) {
      box.append(el('p', 'ed-hint', `<b>${sel.length}</b> objects selected`));
      const row = el('div', 'ed-btnrow');
      const mk = (label, fn) => { const b = el('button', 'ed-btn', label); b.onclick = fn; return b; };
      row.append(
        mk('ALIGN ROW', () => this.editor.alignSelectionY()),
        mk('FLIP H', () => this.editor.flipSelection(true)),
        mk('FLIP V', () => this.editor.flipSelection(false)),
        mk('DELETE', () => this.editor.deleteSelection()),
      );
      box.append(row);
      return;
    }

    const rec = sel[0];
    const item = PALETTE_BY_ID[paletteIdFor(rec)];
    box.append(el('h4', 'ed-proptitle', item ? item.name : rec.t.toUpperCase()));

    this._propInputs = {};
    for (const f of propsFor(rec)) {
      const row = el('label', 'ed-proprow');
      row.append(el('span', '', f.label));
      let input;
      if (f.type === 'select') {
        input = el('select');
        for (const o of f.options) {
          const opt = el('option', '', o.label);
          opt.value = String(o.v);
          input.append(opt);
        }
        input.value = String(rec[f.key]);
        input.onchange = () => {
          const raw = f.options.find((o) => String(o.v) === input.value).v;
          this.editor.applyProp(f.key, raw);
          this.editor.commitEdit();
        };
      } else if (f.type === 'color') {
        input = el('div', 'ed-colorwrap');
        const pick = el('input');
        pick.type = 'color';
        pick.value = rgbToHex(rec[f.key] || [1, 1, 1]);
        const hex = el('input', 'ed-hex');
        hex.value = pick.value;
        pick.oninput = () => { hex.value = pick.value; this.editor.applyProp(f.key, hexToRgb(pick.value), true); };
        pick.onchange = () => this.editor.commitEdit();
        hex.onchange = () => {
          const rgb = hexToRgb(hex.value);
          if (rgb) { pick.value = rgbToHex(rgb); this.editor.applyProp(f.key, rgb); this.editor.commitEdit(); }
        };
        input.append(pick, hex);
      } else {   // number / range
        input = el('input');
        input.type = f.type === 'range' ? 'range' : 'number';
        if (f.min !== undefined) input.min = f.min;
        if (f.max !== undefined) input.max = f.max;
        input.step = f.step || 1;
        input.value = rec[f.key] ?? 0;
        input.oninput = () => {
          const v = parseFloat(input.value);
          if (!Number.isNaN(v)) this.editor.applyProp(f.key, v, true);
        };
        input.onchange = () => this.editor.commitEdit();
      }
      this._propInputs[f.key] = input;
      row.append(input);
      box.append(row);
    }

    const row = el('div', 'ed-btnrow');
    const dup = el('button', 'ed-btn', 'DUPLICATE');
    dup.onclick = () => this.editor.duplicateSelection();
    const del = el('button', 'ed-btn ed-danger', 'DELETE');
    del.onclick = () => this.editor.deleteSelection();
    row.append(dup, del);
    box.append(row);
  }

  _updatePropValues() {
    if (!this._propRecs || this._propRecs.length !== 1 || !this._propInputs) return;
    const rec = this._propRecs[0];
    for (const [key, input] of Object.entries(this._propInputs)) {
      if (input.tagName !== 'INPUT' || document.activeElement === input) continue;
      if (input.type === 'number' || input.type === 'range') input.value = rec[key] ?? 0;
    }
  }

  /* ================================================== bottom palette ==== */

  _buildBottom() {
    const panel = document.getElementById('ed-bottom');
    panel.innerHTML = '';
    const tabs = el('div', 'ed-tabs');
    this.$tabBtns = {};
    for (const cat of CATEGORIES) {
      const b = el('button', 'ed-tab', `<i>${cat.icon}</i>${cat.name}`);
      b.onclick = () => { this.activeCat = cat.id; this.search = ''; this.$search.value = ''; this._renderPalette(); };
      this.$tabBtns[cat.id] = b;
      tabs.append(b);
    }
    const side = el('div', 'ed-palside');
    this.$search = el('input', 'ed-search');
    this.$search.placeholder = 'Search objects…';
    this.$search.oninput = () => { this.search = this.$search.value.trim().toLowerCase(); this._renderPalette(); };
    side.append(this.$search, tabs);

    this.$palGrid = el('div', 'ed-palgrid');
    panel.append(side, this.$palGrid);
    this._renderPalette();
  }

  _paletteItems() {
    if (this.search) {
      return PALETTE.filter((p) => p.name.toLowerCase().includes(this.search));
    }
    if (this.activeCat === 'recent') {
      return this.editor.prefs.recent.map((id) => PALETTE_BY_ID[id]).filter(Boolean);
    }
    if (this.activeCat === 'favorites') {
      return this.editor.prefs.favorites.map((id) => PALETTE_BY_ID[id]).filter(Boolean);
    }
    return PALETTE.filter((p) => p.cat === this.activeCat);
  }

  _renderPalette() {
    for (const [id, b] of Object.entries(this.$tabBtns)) {
      b.classList.toggle('on', !this.search && id === this.activeCat);
    }
    const grid = this.$palGrid;
    grid.innerHTML = '';
    const items = this._paletteItems();

    if (!items.length) {
      const msg = this.activeCat === 'triggers' && !this.search
        ? 'Triggers arrive in a future update — colour, move and pulse triggers are on the roadmap.'
        : this.activeCat === 'favorites' && !this.search
          ? 'No favourites yet — click the ★ on any object.'
          : 'Nothing here yet.';
      grid.append(el('p', 'ed-hint ed-palempty', msg));
      return;
    }

    for (const item of items) {
      const cell = el('button', 'ed-pal');
      cell.title = item.name;
      cell.innerHTML = `<span class="ed-palthumb">${item.thumb}</span><span class="ed-palname">${item.name}</span>`;
      const star = el('i', 'ed-star', '★');
      const fav = this.editor.prefs.favorites.includes(item.id);
      star.classList.toggle('on', fav);
      star.onclick = (e) => { e.stopPropagation(); this._toggleFavorite(item.id); };
      cell.append(star);
      cell.classList.toggle('on', this.editor.currentItem === item.id);
      cell.onclick = () => this.editor.setCurrentItem(item.id);
      grid.append(cell);
    }
  }

  _toggleFavorite(id) {
    const favs = this.editor.prefs.favorites;
    const i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(id);
    EditorPrefs.save(this.editor.prefs);
    this._renderPalette();
  }

  noteUsed(id) {
    const rec = this.editor.prefs.recent;
    const i = rec.indexOf(id);
    if (i >= 0) rec.splice(i, 1);
    rec.unshift(id);
    rec.length = Math.min(rec.length, 12);
    EditorPrefs.save(this.editor.prefs);
    if (this.activeCat === 'recent' && !this.search) this._renderPalette();
  }

  syncPaletteSelection() { this._renderPalette(); }

  /* ================================================== overlays ==== */

  _buildOverlays() {
    this.$status = document.getElementById('ed-status');
    this.$toasts = document.getElementById('ed-toasts');
    this.$context = document.getElementById('ed-context');
    this.$modals = document.getElementById('ed-modals');
    document.addEventListener('pointerdown', (e) => {
      if (this.$context.style.display === 'block' && !this.$context.contains(e.target)) {
        this.hideContextMenu();
      }
    }, true);
  }

  setStatus(x, y, zoom) {
    this.$status.textContent =
      `X ${x.toFixed(1)}  Y ${y.toFixed(1)}  ·  ${Math.round(zoom * 100)}%` +
      (this.editor.dirty ? '  ·  unsaved' : '');
  }

  toast(msg, isError = false) {
    const t = el('div', 'ed-toast' + (isError ? ' err' : ''), msg);
    this.$toasts.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  showContextMenu(cx, cy, hit) {
    const m = this.$context;
    m.innerHTML = '';
    const add = (label, fn, disabled = false) => {
      const b = el('button', 'ed-ctx' + (disabled ? ' dim' : ''), label);
      if (!disabled) b.onclick = () => { this.hideContextMenu(); fn(); };
      m.append(b);
    };
    const ed = this.editor;
    if (hit) {
      add('Duplicate', () => ed.duplicateSelection());
      add('Copy', () => ed.copySelection());
      add('Flip horizontal', () => ed.flipSelection(true));
      add('Flip vertical', () => ed.flipSelection(false));
      add('Rotate 45°', () => ed.rotateSelection());
      const pid = paletteIdFor(hit);
      if (pid) add(ed.prefs.favorites.includes(pid) ? '★ Unfavourite type' : '★ Favourite type',
                   () => this._toggleFavorite(pid));
      add('Delete', () => ed.deleteSelection());
    } else {
      add('Paste here', () => ed.paste(), !ed.clipboard.length);
      add('Select all', () => {
        ed.selection = new Set(ed.def.objects);
        this.onSelectionChanged();
      }, !ed.def.objects.length);
    }
    m.style.display = 'block';
    m.style.left = Math.min(cx, window.innerWidth - 190) + 'px';
    m.style.top = Math.min(cy, window.innerHeight - m.offsetHeight - 10) + 'px';
  }

  hideContextMenu() { this.$context.style.display = 'none'; }

  /* ================================================== modals ==== */

  closeTopmost() {
    if (this.$context.style.display === 'block') { this.hideContextMenu(); return true; }
    if (this.openModal) { this.closeModal(); return true; }
    return false;
  }

  closeModal() {
    this.openModal = null;
    this.$modals.style.display = 'none';
    this.$modals.innerHTML = '';
    this.editor.game.audio.stopMusic();     // stop any music preview
  }

  open(name) {
    this.openModal = name;
    const wrap = this.$modals;
    wrap.innerHTML = '';
    wrap.style.display = 'flex';
    const box = el('div', 'ed-modal');
    wrap.append(box);
    wrap.onclick = (e) => { if (e.target === wrap) this.closeModal(); };
    if (name === 'settings') this._modalSettings(box);
    else if (name === 'colors') this._modalColors(box);
    else if (name === 'music') this._modalMusic(box);
    else if (name === 'load') this._modalLoad(box);
    else if (name === 'saveas') this._modalSaveAs(box);
    else if (name === 'publish') this._modalPublish(box);
  }

  _modalHeader(box, title) {
    const h = el('div', 'ed-modalhead', `<h3>${title}</h3>`);
    const x = el('button', 'ed-btn ed-close', '✕');
    x.onclick = () => this.closeModal();
    h.append(x);
    box.append(h);
  }

  _field(label, input) {
    const row = el('label', 'ed-proprow ed-modalrow');
    row.append(el('span', '', label), input);
    return row;
  }

  _modalSettings(box) {
    this._modalHeader(box, 'LEVEL SETTINGS');
    const d = this.editor.def;

    const name = el('input'); name.value = d.name; name.maxLength = 24;
    name.onchange = () => { d.name = name.value.toUpperCase() || 'UNTITLED'; this.editor.dirty = true; this.onLevelChanged(); };
    const creator = el('input'); creator.value = d.creator; creator.maxLength = 20;
    creator.onchange = () => { d.creator = creator.value; this.editor.dirty = true; };
    const desc = el('textarea'); desc.value = d.description; desc.rows = 3; desc.maxLength = 200;
    desc.onchange = () => { d.description = desc.value; this.editor.dirty = true; };
    const diff = el('select');
    for (const opt of ['Custom', 'Easy', 'Normal', 'Hard', 'Insane']) {
      const o = el('option', '', opt); o.value = opt; diff.append(o);
    }
    diff.value = d.difficulty;
    diff.onchange = () => { d.difficulty = diff.value; this.editor.dirty = true; };
    const bpm = el('input'); bpm.type = 'number'; bpm.min = 60; bpm.max = 240; bpm.value = d.bpm;
    bpm.onchange = () => {
      d.bpm = Math.max(60, Math.min(240, parseInt(bpm.value, 10) || 150));
      this.editor.dirty = true;
      speedNote.innerHTML = this._speedNote();
    };
    const len = el('input'); len.type = 'number'; len.min = 30;
    len.placeholder = `auto (${this.editor.autoLength()})`;
    len.value = d.lengthOverride || '';
    len.onchange = () => {
      const v = parseInt(len.value, 10);
      d.lengthOverride = Number.isFinite(v) && v >= 30 ? v : null;
      this.editor.dirty = true;
    };
    const speedNote = el('p', 'ed-hint');
    speedNote.innerHTML = this._speedNote();

    box.append(
      this._field('Name', name),
      this._field('Creator', creator),
      this._field('Description', desc),
      this._field('Difficulty', diff),
      this._field('BPM', bpm),
      this._field('Length (blocks)', len),
      speedNote,
      el('p', 'ed-hint', `Version ${d.version || 1} · ${d.objects.length} objects · id ${d.id}`),
    );
  }

  _speedNote() {
    const d = this.editor.def;
    return `Speed is locked to the music: <b>${(d.bpm / 15).toFixed(2)} blocks/s</b> at ${d.bpm} BPM ` +
           '(one beat = 4 blocks, so obstacles on the grid land on the rhythm).';
  }

  _modalColors(box) {
    this._modalHeader(box, 'LEVEL COLOURS');
    const d = this.editor.def;
    this._themeInputs = {};
    for (const [key, label] of THEME_FIELDS) {
      const wrap = el('div', 'ed-colorwrap');
      const pick = el('input'); pick.type = 'color'; pick.value = rgbToHex(d.theme[key]);
      const hex = el('input', 'ed-hex'); hex.value = pick.value;
      pick.oninput = () => { hex.value = pick.value; this.editor.setThemeColor(key, hexToRgb(pick.value)); };
      pick.onchange = () => this.editor.commitEdit();
      hex.onchange = () => {
        const rgb = hexToRgb(hex.value);
        if (rgb) { pick.value = rgbToHex(rgb); this.editor.setThemeColor(key, rgb); this.editor.commitEdit(); }
      };
      wrap.append(pick, hex);
      this._themeInputs[key] = pick;
      box.append(this._field(label, wrap));
    }
    box.append(el('p', 'ed-hint',
      'Changes apply instantly — the viewport behind this window is the live preview. ' +
      'Pickers support RGB, HSV and hex.'));
  }

  onThemeChanged() {
    if (this.openModal === 'colors' && this._themeInputs) {
      for (const [key] of THEME_FIELDS) {
        this._themeInputs[key].value = rgbToHex(this.editor.def.theme[key]);
      }
    }
  }

  _modalMusic(box) {
    this._modalHeader(box, 'MUSIC');
    const d = this.editor.def;
    const audio = this.editor.game.audio;

    box.append(el('h4', 'ed-subhead', 'BUILT-IN SOUNDTRACKS'));
    for (const trk of AudioManager.TRACK_INFO) {
      const row = el('div', 'ed-trackrow');
      const radio = el('input'); radio.type = 'radio'; radio.name = 'ed-track';
      radio.checked = !d.customMusic && d.track === trk.id;
      radio.onchange = () => { d.track = trk.id; d.customMusic = null; this.editor.dirty = true; this.open('music'); };
      const beatLen = (60 / d.bpm) * 16 * trk.loopBars;
      const info = el('span', 'ed-trackinfo',
        `<b>${trk.name}</b><br>${trk.mood} · ${beatLen.toFixed(0)}s loop @ ${d.bpm} BPM`);
      const prev = el('button', 'ed-btn', '▶ PREVIEW');
      prev.onclick = () => { audio.unlock(); audio.startMusic(trk.id, d.bpm); };
      row.append(radio, info, prev);
      box.append(row);
    }
    const stop = el('button', 'ed-btn', '■ STOP PREVIEW');
    stop.onclick = () => audio.stopMusic();
    box.append(stop);

    box.append(el('h4', 'ed-subhead', 'NEWGROUNDS IMPORT'));
    const ngWrap = el('div', 'ed-ngrow');
    const ngId = el('input'); ngId.placeholder = 'Newgrounds Song ID (e.g. 467339)';
    const ngBtn = el('button', 'ed-btn', 'IMPORT');
    const ngStatus = el('p', 'ed-hint');
    if (d.customMusic && d.customMusic.source === 'newgrounds') {
      ngStatus.innerHTML = `Current: <b>${d.customMusic.title}</b>${d.customMusic.artist ? ' by ' + d.customMusic.artist : ''}`;
    }
    ngBtn.onclick = async () => {
      const id = ngId.value.trim();
      if (!/^\d+$/.test(id)) { ngStatus.innerHTML = '<span class="err">Enter a numeric song ID.</span>'; return; }
      ngStatus.textContent = 'Contacting Newgrounds…';
      const adopt = (data) => {
        d.customMusic = {
          source: 'newgrounds', ngId: id, url: data.url,
          title: data.title || `NG #${id}`, artist: data.artist || '',
          duration: data.duration || 0,
        };
        this.editor.dirty = true;
        ngStatus.innerHTML =
          (data.icon ? `<img class="ed-ngart" src="${data.icon}" alt="">` : '') +
          `Imported <b>${d.customMusic.title}</b>` +
          (d.customMusic.artist ? ` by ${d.customMusic.artist}` : '') +
          (data.duration ? ` · ${Math.round(data.duration)}s` : '') +
          '<br>Match the level BPM in Settings to keep obstacles on the beat.';
      };
      // 1) try Newgrounds directly (fails in browsers: no CORS headers)
      try {
        const res = await fetch(`https://www.newgrounds.com/audio/load/${id}/3`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const url = data?.sources?.[0]?.src || data?.url || data?.stream_url;
        if (!url) throw new Error('No stream in response');
        return adopt({ url, title: data.title, artist: data.artist, duration: data.duration });
      } catch (e) { /* expected: CORS — fall through to the local proxy */ }
      // 2) local music proxy (node tools/musicProxy.js)
      try {
        ngStatus.textContent = 'Trying the local music proxy…';
        const res = await fetch(`http://localhost:8642/ng/${id}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);
        return adopt(data);
      } catch (e) {
        ngStatus.innerHTML =
          '<span class="err">Couldn\'t retrieve the song. Newgrounds blocks direct browser requests ' +
          '(CORS), and the local music proxy isn\'t running.</span><br>' +
          'Start it with <b>node tools/musicProxy.js</b> and press IMPORT again — ' +
          'or paste a <b>direct audio URL</b> below.';
      }
    };
    ngWrap.append(ngId, ngBtn);
    box.append(ngWrap, ngStatus);

    box.append(el('h4', 'ed-subhead', 'DIRECT AUDIO URL'));
    const urlWrap = el('div', 'ed-ngrow');
    const urlIn = el('input'); urlIn.placeholder = 'https://…/song.mp3 (or .ogg)';
    if (d.customMusic && d.customMusic.source === 'url') urlIn.value = d.customMusic.url;
    const useBtn = el('button', 'ed-btn', 'USE');
    const prevBtn = el('button', 'ed-btn', '▶');
    prevBtn.title = 'Preview';
    useBtn.onclick = () => {
      const url = urlIn.value.trim();
      if (!/^https?:\/\/.+/.test(url)) return this.toast('Enter a valid http(s) URL', true);
      d.customMusic = { source: 'url', url, title: url.split('/').pop() || 'Custom track' };
      this.editor.dirty = true;
      this.toast('Custom track set — sync it by matching the BPM in Settings');
    };
    prevBtn.onclick = () => {
      const url = urlIn.value.trim();
      if (url) { audio.unlock(); audio.playStream(url, d.bpm, false); }
    };
    const clearBtn = el('button', 'ed-btn', 'USE BUILT-IN INSTEAD');
    clearBtn.onclick = () => { d.customMusic = null; this.editor.dirty = true; this.open('music'); };
    urlWrap.append(urlIn, prevBtn, useBtn);
    box.append(urlWrap);
    if (d.customMusic) box.append(clearBtn);
  }

  _modalLoad(box) {
    this._modalHeader(box, 'MY LEVELS');
    const list = LevelStore.list();
    if (!list.length) box.append(el('p', 'ed-hint', 'No saved levels yet. Build something and hit SAVE!'));

    for (const def of list) {
      const row = el('div', 'ed-levelrow');
      const when = new Date(def._modified || 0).toLocaleString();
      row.append(el('span', 'ed-trackinfo',
        `<b>${def.name}</b>${def.id === this.editor.def.id ? ' · <i>open</i>' : ''}<br>` +
        `${(def.objects || []).length} objects · ${when}`));
      const load = el('button', 'ed-btn', 'LOAD');
      load.onclick = () => {
        if (this.editor.dirty && !window.confirm('Discard unsaved changes?')) return;
        this.editor.load(def.id);
        this.closeModal();
      };
      const exp = el('button', 'ed-btn', 'EXPORT');
      exp.onclick = () => exportLevelFile(def);
      const del = el('button', 'ed-btn ed-danger', '✕');
      del.title = 'Delete';
      del.onclick = () => {
        if (!window.confirm(`Delete "${def.name}" forever?`)) return;
        LevelStore.remove(def.id);
        this.open('load');
      };
      row.append(load, exp, del);
      box.append(row);
    }

    const imp = el('button', 'ed-btn', 'IMPORT .JSON FILE');
    const file = el('input'); file.type = 'file'; file.accept = '.json'; file.style.display = 'none';
    imp.onclick = () => file.click();
    file.onchange = async () => {
      if (!file.files[0]) return;
      try {
        this.editor.importDef(JSON.parse(await file.files[0].text()));
        this.closeModal();
      } catch (e) {
        this.toast('That file is not valid level JSON', true);
      }
    };
    box.append(el('div', 'ed-btnrow'), imp, file);
  }

  _modalPublish(box) {
    this._modalHeader(box, 'PUBLISH TO COMMUNITY');
    const d = this.editor.def;
    const game = this.editor.game;
    const profile = game.accountUI && game.accountUI.profile;

    if (!Backend.isConfigured()) {
      box.append(el('p', 'ed-hint',
        'Online features are not configured — add your Supabase settings ' +
        '(see <b>SETUP.md</b>) to enable community publishing.'));
      return;
    }
    if (!game.user || !profile) {
      box.append(el('p', 'ed-hint',
        'Publishing needs an account so the level is linked to its creator.<br><br>' +
        'Sign in from the <b>main menu</b> (gold chip, top right), then come back here.'));
      return;
    }
    if (!d.objects.length) {
      box.append(el('p', 'ed-hint', 'This level is empty — place some objects first!'));
      return;
    }

    if (d._publishedId) {
      box.append(el('p', 'ed-hint',
        '&#10003; This level is already published — publishing again <b>updates</b> ' +
        'the online copy instead of creating a duplicate.'));
    }

    const name = el('input'); name.value = d.name; name.maxLength = 24;
    const desc = el('textarea'); desc.value = d.description || ''; desc.rows = 3; desc.maxLength = 200;
    desc.placeholder = 'Tell players what to expect…';
    const diff = el('select');
    for (const opt of ['Easy', 'Normal', 'Hard', 'Insane', 'Custom']) {
      const o = el('option', '', opt); o.value = opt; diff.append(o);
    }
    diff.value = d.difficulty || 'Custom';
    // song info: auto-derived from the level's soundtrack, still editable
    const builtIn = AudioManager.TRACK_INFO.find((t) => t.id === d.track);
    const song = el('input'); song.maxLength = 60;
    song.value = (d.customMusic && d.customMusic.title)
      ? `${d.customMusic.title}${d.customMusic.artist ? ' — ' + d.customMusic.artist : ''}`.slice(0, 60)
      : (builtIn ? builtIn.name : '');
    const creator = el('input'); creator.value = profile.username; creator.disabled = true;
    creator.title = 'Linked to your account automatically';

    const status = el('p', 'ed-hint ed-pubstatus');
    const go = el('button', 'ed-btn ed-accent ed-publishgo',
      d._publishedId ? 'UPDATE PUBLISHED LEVEL' : 'PUBLISH');

    go.onclick = async () => {
      const meta = {
        name: name.value, description: desc.value,
        difficulty: diff.value, song: song.value,
      };
      if (!meta.name.trim()) { status.innerHTML = '<span class="err">The level needs a name.</span>'; return; }
      if (d.objects.length < 5) {
        status.innerHTML = '<span class="err">Too empty to publish — place at least 5 objects.</span>';
        return;
      }
      go.disabled = true;
      go.textContent = 'UPLOADING…';
      status.textContent = 'Uploading level…';

      // keep the local copy in sync with what goes online
      d.name = meta.name.trim().toUpperCase().slice(0, 24) || 'UNTITLED';
      d.description = meta.description.trim().slice(0, 200);
      d.difficulty = meta.difficulty;

      const { data, error } = await Backend.publishLevel(game.user.id, d, meta);
      go.disabled = false;
      if (error) {
        go.textContent = d._publishedId ? 'UPDATE PUBLISHED LEVEL' : 'PUBLISH';
        status.innerHTML = `<span class="err">${error}</span>`;
        this.toast('Publish failed', true);
        return;
      }
      d._publishedId = data.id;
      this.editor.save();   // persists _publishedId locally so re-uploads update
      this.onLevelChanged();
      go.textContent = 'UPDATE PUBLISHED LEVEL';
      status.innerHTML = '&#10003; <b>Published!</b> Your level is live in COMMUNITY LEVELS for everyone.';
      this.toast(`Published "${d.name}" to the community!`);
    };

    box.append(
      this._field('Name', name),
      this._field('Description', desc),
      this._field('Difficulty', diff),
      this._field('Song', song),
      this._field('Creator', creator),
      go, status,
    );
  }

  _modalSaveAs(box) {
    this._modalHeader(box, 'SAVE AS');
    const name = el('input');
    name.placeholder = 'New level name';
    name.value = this.editor.def.name;
    name.maxLength = 24;
    const go = el('button', 'ed-btn ed-accent', 'SAVE COPY');
    go.onclick = () => { this.editor.saveAs(name.value); this.closeModal(); };
    name.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
    box.append(this._field('Name', name), go);
    setTimeout(() => name.select(), 50);
  }

  /* ================================================== sync ==== */

  onActivate() {
    this.onLevelChanged();
    this.syncTool();
    this.syncToggles();
    this.refreshUndo();
  }

  onLevelChanged() {
    this.$levelName.textContent = this.editor.def ? this.editor.def.name : '—';
    this.onSelectionChanged();
    this.refreshUndo();
  }
}
