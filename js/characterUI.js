/**
 * characterUI.js — the character customisation screen.
 *
 * One tab per gamemode (driven by MODE_IDS, so future modes appear
 * automatically), six parametric icon variants per mode, and primary /
 * secondary colour selection. The preview updates instantly and every
 * change is persisted to the save + applied to the live player.
 *
 * The SVG previews intentionally mirror the in-game WebGL drawings in
 * player.js (same proportions, same variant parameters).
 */
import { MODE_IDS, MODES } from './gamemodes.js';

const VARIANTS = 6;
const SWATCHES = [
  '#46e6f5', '#f0509e', '#ffd166', '#8f57ff', '#3dd68c', '#ffb454',
  '#ff5470', '#ffffff', '#7ab8ff', '#b8ff59', '#ff8ff5', '#1fd6a8',
];

const el = (tag, cls = '', html = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html) n.innerHTML = html;
  return n;
};

/** Parametric SVG preview for one mode/variant/colour combo (48×48 box). */
export function iconSVG(mode, v, pri, sec) {
  const open = '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">';
  const close = '</svg>';
  switch (mode) {
    case 'ship': {
      const nose = 40 + (v % 3) * 3;
      const finH = v >= 3 ? 12 : 8;
      return open +
        `<rect x="6" y="24" width="28" height="12" fill="#fff"/>` +
        `<rect x="8" y="26" width="24" height="8" fill="${pri}"/>` +
        `<polygon points="34,24 34,36 ${nose},30" fill="#fff"/>` +
        `<rect x="6" y="${24 - finH}" width="6" height="${finH}" fill="${sec}"/>` +
        `<rect x="16" y="12" width="12" height="12" fill="#fff"/>` +
        `<rect x="18" y="14" width="8" height="8" fill="${pri}"/>` +
        `<rect x="20" y="16" width="4" height="4" fill="${sec}"/>` + close;
    }
    case 'ufo': {
      const bw = 30 + (v % 3) * 4;
      const dome = v >= 3 ? 13 : 10;
      const bx = 24 - bw / 2;
      let lights = '';
      for (let i = 0; i < 3; i++) {
        lights += `<rect x="${bx + 5 + i * (bw - 12) / 2}" y="28" width="3" height="3" fill="${sec}"/>`;
      }
      return open +
        `<ellipse cx="24" cy="20" rx="${dome}" ry="${dome * 0.9}" fill="${pri}" opacity="0.3"/>` +
        `<rect x="19" y="16" width="10" height="10" fill="${sec}"/>` +
        `<rect x="${bx}" y="25" width="${bw}" height="9" rx="3" fill="#fff"/>` +
        `<rect x="${bx + 2}" y="27" width="${bw - 4}" height="5" fill="${pri}"/>` +
        lights + close;
    }
    case 'wave': {
      const nose = 40 + (v % 3) * 3;
      const tail = v >= 3 ? 13 : 9;
      return open +
        `<polygon points="8,${24 - tail} 8,${24 + tail} ${nose},24" fill="#fff"/>` +
        `<polygon points="12,${24 - tail * 0.55} 12,${24 + tail * 0.55} ${nose - 5},24" fill="${pri}"/>` +
        `<circle cx="${nose - 10}" cy="24" r="2.4" fill="${sec}"/>` + close;
    }
    case 'robot': {
      const head = 12 + (v % 3) * 2;
      const leg = v >= 3 ? 11 : 8;
      return open +
        `<rect x="16" y="${38 - leg}" width="4" height="${leg}" fill="#fff"/>` +
        `<rect x="27" y="${38 - leg}" width="4" height="${leg}" fill="#fff"/>` +
        `<rect x="13" y="${20 - leg + 8}" width="22" height="14" fill="#fff"/>` +
        `<rect x="15" y="${22 - leg + 8}" width="18" height="10" fill="${pri}"/>` +
        `<rect x="${24 - head / 2}" y="${16 - leg + 8 - head}" width="${head}" height="${head}" fill="#fff"/>` +
        `<rect x="${24 - head * 0.36}" y="${16 - leg + 8 - head * 0.7}" width="${head * 0.72}" height="${head * 0.3}" fill="${sec}"/>` + close;
    }
    default: {   // cube
      const core = 14 - (v % 3) * 2;
      const face = v % 3;
      let faceSvg = '';
      if (face === 2) faceSvg = `<rect x="14" y="18" width="20" height="6" fill="#fff"/>`;
      else {
        const s = face === 1 ? 5 : 4, h = face === 1 ? 5 : 7;
        faceSvg = `<rect x="${17 - s / 2}" y="17" width="${s}" height="${h}" fill="#fff"/>` +
                  `<rect x="${31 - s / 2}" y="17" width="${s}" height="${h}" fill="#fff"/>`;
      }
      return open +
        `<rect x="6" y="6" width="36" height="36" fill="#fff"/>` +
        `<rect x="9" y="9" width="30" height="30" fill="${pri}"/>` +
        `<rect x="${24 - core}" y="${24 - core}" width="${core * 2}" height="${core * 2}" fill="${sec}"/>` +
        faceSvg + close;
    }
  }
}

export class CharacterUI {
  constructor(game) {
    this.game = game;
    this.mode = 'cube';
    this.$body = document.getElementById('char-body');
  }

  open() {
    this.game.ui.show('character');
    this.render();
  }

  _custom() { return this.game.save.custom; }

  _apply(patch) {
    this.game.save.setCustom(patch);
    this.game.applyCustomisation();
    this.render();
  }

  render() {
    const c = this._custom();
    const b = this.$body;
    b.innerHTML = '';

    // ---- live preview + mode tabs
    const top = el('div', 'char-top');
    const preview = el('div', 'char-preview');
    preview.innerHTML = iconSVG(this.mode, c.icons[this.mode] || 0, c.primary, c.secondary);
    preview.setAttribute('aria-label', `${MODES[this.mode].name} preview`);

    const tabs = el('div', 'char-tabs');
    for (const id of MODE_IDS) {
      const t = el('button', 'char-tab' + (id === this.mode ? ' on' : ''), MODES[id].name.toUpperCase());
      t.onclick = () => { this.mode = id; this.render(); };
      tabs.append(t);
    }
    top.append(preview, tabs);
    b.append(top);

    // ---- icon variants for the active mode
    b.append(el('p', 'acc-label', `${MODES[this.mode].name.toUpperCase()} ICON`));
    const grid = el('div', 'char-variants');
    for (let v = 0; v < VARIANTS; v++) {
      const cell = el('button', 'char-variant' + ((c.icons[this.mode] || 0) === v ? ' on' : ''));
      cell.innerHTML = iconSVG(this.mode, v, c.primary, c.secondary);
      cell.title = `Icon ${v + 1}`;
      cell.onclick = () => this._apply({ icons: { [this.mode]: v } });
      grid.append(cell);
    }
    b.append(grid);

    // ---- colours (shared across every mode, like the original)
    b.append(el('p', 'acc-label', 'PRIMARY COLOUR'));
    b.append(this._swatchRow('primary', c.primary));
    b.append(el('p', 'acc-label', 'SECONDARY COLOUR'));
    b.append(this._swatchRow('secondary', c.secondary));
  }

  _swatchRow(key, current) {
    const row = el('div', 'char-swatches');
    for (const hex of SWATCHES) {
      const s = el('button', 'char-swatch' + (hex.toLowerCase() === String(current).toLowerCase() ? ' on' : ''));
      s.style.background = hex;
      s.title = hex;
      s.onclick = () => this._apply({ [key]: hex });
      row.append(s);
    }
    // free colour picker for anything beyond the presets
    const pick = el('input', 'char-pick');
    pick.type = 'color';
    pick.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#46e6f5';
    pick.title = 'Custom colour';
    pick.oninput = () => this._apply({ [key]: pick.value });
    row.append(pick);
    return row;
  }
}
