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
  version: 1,
  levels: {},          // id → { best, coins:[bool,bool,bool], attempts, completed }
  settings: { music: 0.7, sfx: 0.8, shake: true },
  character: 0,        // future: selected cube skin
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
        // shallow-merge over defaults so new fields appear after updates
        this.data = { ...DEFAULTS(), ...parsed, settings: { ...DEFAULTS().settings, ...(parsed.settings || {}) } };
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

  /** Level N is unlocked when it's first, or level N-1 is completed. */
  isUnlocked(index) {
    if (index <= 0) return true;
    const prev = this.data.levels[CONFIG.LEVEL_LIST[index - 1]];
    return !!(prev && prev.completed);
  }

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
