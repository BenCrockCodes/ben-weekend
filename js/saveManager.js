/**
 * saveManager.js — localStorage persistence.
 *
 * Stores per-level progress (unlocked / best % / coins / attempts), user
 * settings and (future) character selection under a single versioned key.
 * All writes are whole-object so the schema can be migrated easily later.
 */
import { CONFIG } from './config.js';
import { clamp } from './utils.js';

const DEFAULTS = () => ({
  version: 2,
  levels: {},          // id → { best, coins:[bool,bool,bool], attempts, completed }
  settings: { music: 0.7, sfx: 0.8, shake: true },
  custom: {            // character customisation (see js/gamemodes.js MODE_IDS)
    primary: '#46e6f5',
    secondary: '#f0509e',
    icons: { cube: 0, ship: 0, ufo: 0, wave: 0, robot: 0 },
  },
  recent: [],          // recently played: newest-first {type, id, name, creator, at}
  achievements: [],    // future
});

export class SaveManager {
  constructor() {
    this.data = DEFAULTS();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const d = DEFAULTS();
        // merge over defaults so new fields appear after updates
        this.data = {
          ...d, ...parsed,
          settings: { ...d.settings, ...(parsed.settings || {}) },
          custom: {
            ...d.custom, ...(parsed.custom || {}),
            icons: { ...d.custom.icons, ...((parsed.custom || {}).icons || {}) },
          },
          recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        };
        delete this.data.character;   // superseded by custom.icons (v2)
      }
    } catch (e) {
      console.warn('Save data unreadable, starting fresh.', e);
      this.data = DEFAULTS();
    }
  }

  save() {
    try {
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Could not persist save data.', e);
    }
  }

  /** Per-level record (created on demand). */
  level(id) {
    if (!this.data.levels[id]) {
      this.data.levels[id] = { best: 0, coins: [false, false, false], attempts: 0, completed: false };
    }
    return this.data.levels[id];
  }

  /** Every official level is always playable — no progression gating. */
  isUnlocked() { return true; }

  /* ---- character customisation ---- */

  get custom() { return this.data.custom; }

  setCustom(patch) {
    this.data.custom = {
      ...this.data.custom, ...patch,
      icons: { ...this.data.custom.icons, ...(patch.icons || {}) },
    };
    this.save();
  }

  /* ---- recently played ---- */

  /** Record a play (newest first, deduped by id, capped at 20). */
  recordRecent(entry) {
    const rec = { ...entry, at: Date.now() };
    this.data.recent = [rec, ...this.data.recent.filter((r) => r.id !== rec.id)].slice(0, 20);
    this.save();
  }

  get recent() { return this.data.recent; }

  recordAttempt(id) {
    this.level(id).attempts++;
    this.save();
  }

  /** Called on death — keep the best % reached. */
  recordProgress(id, pct) {
    const rec = this.level(id);
    rec.best = clamp(Math.max(rec.best, Math.round(pct)), 0, 100);
    this.save();
  }

  /** Called on completion — coins only persist when the run is finished. */
  recordComplete(id, coinsCollected) {
    const rec = this.level(id);
    rec.best = 100;
    rec.completed = true;
    coinsCollected.forEach((got, i) => { if (got) rec.coins[i] = true; });
    this.save();
    return rec;
  }

  get settings() { return this.data.settings; }
  setSetting(key, value) { this.data.settings[key] = value; this.save(); }
}
