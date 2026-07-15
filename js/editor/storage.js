/**
 * editor/storage.js — persistence for custom levels + editor preferences.
 *
 * Custom levels live under one localStorage key as { id → definition }.
 * Definitions are plain level JSON (formatVersion 2) so they load through
 * the exact same LevelRuntime as official levels. Export/import moves them
 * as .json files for sharing until online publishing exists.
 */
const LEVELS_KEY = 'neovolt.customLevels.v1';
const PREFS_KEY = 'neovolt.editorPrefs.v1';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('Unreadable storage for', key, e);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Could not write', key, e);   // quota — surfaced by caller
    return false;
  }
}

export const LevelStore = {
  all() { return readJson(LEVELS_KEY, {}); },

  list() {
    return Object.values(this.all())
      .sort((a, b) => (b._modified || 0) - (a._modified || 0));
  },

  get(id) { return this.all()[id] || null; },

  save(def) {
    const all = this.all();
    def._modified = Date.now();
    all[def.id] = def;
    return writeJson(LEVELS_KEY, all);
  },

  remove(id) {
    const all = this.all();
    delete all[id];
    writeJson(LEVELS_KEY, all);
  },

  newId() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
};

export const EditorPrefs = {
  load() {
    return {
      recent: [], favorites: [], grid: true, snap: true, snapStep: 1,
      lastLevelId: null,
      ...readJson(PREFS_KEY, {}),
    };
  },
  save(prefs) { writeJson(PREFS_KEY, prefs); },
};

/** Download a level definition as a shareable .json file. */
export function exportLevelFile(def) {
  const blob = new Blob([JSON.stringify(def, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(def.name || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
