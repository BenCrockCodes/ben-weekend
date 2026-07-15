/**
 * backend/backend.js — the game's only doorway to Supabase.
 *
 * Service areas (mirrors the production architecture plan):
 *   auth      — sign up / sign in / sign out / session watching
 *   profiles  — public player profiles + icon/username updates
 *   stats     — cloud save (jsonb) with local⇄cloud merging
 *   messages  — profile wall messages
 *   levels    — user-generated level upload/browse (table live, UI future)
 *
 * Design rules:
 *   - supabase-js is loaded lazily from a PINNED CDN build, and only when
 *     the config is filled in — an unconfigured or offline game never pays
 *     any network cost and keeps working from localStorage.
 *   - Every call returns { data, error } with a printable error string;
 *     callers never need try/catch.
 *   - Only the publishable key is used; RLS in supabase/schema.sql is the
 *     security boundary.
 */
import { SUPABASE_URL, SUPABASE_KEY } from './backendConfig.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.6/+esm';

let client = null;
let clientPromise = null;

export function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL) &&
         SUPABASE_KEY.length > 20 && !SUPABASE_KEY.startsWith('YOUR-');
}

async function getClient() {
  if (!isConfigured()) return null;
  if (client) return client;
  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS).then(({ createClient }) => {
      client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      return client;
    });
  }
  return clientPromise;
}

/** Translate low-level errors into player-readable ones. */
function friendly(msg) {
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server — check your connection (or the Supabase settings in backendConfig.js).';
  }
  return msg;
}

/** Normalise any supabase call into { data, error:string|null }. */
async function run(fn) {
  try {
    const sb = await getClient();
    if (!sb) return { data: null, error: 'Online features are not configured yet.' };
    const { data, error } = await fn(sb);
    return { data, error: error ? friendly(error.message || String(error)) : null };
  } catch (e) {
    return { data: null, error: friendly(e.message || 'Network error — check your connection.') };
  }
}

export const Backend = {
  isConfigured,

  /* ================================================= auth ==== */

  /** Start watching the session; fires cb(user|null) now and on changes. */
  async init(cb) {
    if (!isConfigured()) { cb(null); return; }
    const sb = await getClient();
    const { data: { session } } = await sb.auth.getSession();
    cb(session ? session.user : null);
    sb.auth.onAuthStateChange((_event, s) => cb(s ? s.user : null));
  },

  signUp({ email, password, username }) {
    return run((sb) => sb.auth.signUp({
      email, password,
      options: { data: { username } },   // display name only — never used for authorization
    }));
  },

  signIn({ email, password }) {
    return run((sb) => sb.auth.signInWithPassword({ email, password }));
  },

  signOut() {
    return run((sb) => sb.auth.signOut());
  },

  async currentUser() {
    const sb = await getClient();
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    return session ? session.user : null;
  },

  /* ================================================= profiles ==== */

  getProfile(userId) {
    return run((sb) => sb.from('profiles').select('*').eq('id', userId).single());
  },

  getProfileByUsername(username) {
    return run((sb) => sb.from('profiles').select('*')
      .ilike('username', username).limit(1).maybeSingle());
  },

  updateProfile(userId, fields) {   // fields ⊆ { username, icon }
    return run((sb) => sb.from('profiles').update(fields).eq('id', userId)
      .select().single());
  },

  /* ================================================= stats ==== */

  getStats(userId) {
    return run((sb) => sb.from('stats').select('data, updated_at')
      .eq('user_id', userId).maybeSingle());
  },

  pushStats(userId, data) {
    return run((sb) => sb.from('stats')
      .upsert({ user_id: userId, data }, { onConflict: 'user_id' }));
  },

  /**
   * Merge a local save with a cloud save — progress is never lost in
   * either direction: best/attempts take the max, unlocks and coins union.
   */
  mergeSaves(local, cloud) {
    if (!cloud || !cloud.levels) return local;
    const merged = structuredClone(local);
    for (const [id, c] of Object.entries(cloud.levels)) {
      const l = merged.levels[id] || { best: 0, coins: [false, false, false], attempts: 0, completed: false };
      merged.levels[id] = {
        best: Math.max(l.best || 0, c.best || 0),
        attempts: Math.max(l.attempts || 0, c.attempts || 0),
        completed: !!(l.completed || c.completed),
        coins: [0, 1, 2].map((i) => !!((l.coins && l.coins[i]) || (c.coins && c.coins[i]))),
      };
    }
    return merged;   // settings stay local (per-device preference)
  },

  /* ================================================= messages ==== */

  /** Wall of `profileId`, newest first, with author names/icons joined in. */
  getMessages(profileId, limit = 30) {
    return run((sb) => sb.from('messages')
      .select('id, body, created_at, author_id, author:profiles!messages_author_id_fkey(username, icon)')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(limit));
  },

  postMessage(profileId, authorId, body) {
    return run((sb) => sb.from('messages')
      .insert({ profile_id: profileId, author_id: authorId, body })
      .select().single());
  },

  deleteMessage(id) {
    return run((sb) => sb.from('messages').delete().eq('id', id));
  },

  /* ================================================= levels (future UI) ==== */

  listPublishedLevels(limit = 50) {
    return run((sb) => sb.from('levels')
      .select('id, name, description, difficulty, downloads, created_at, owner:profiles!levels_owner_id_fkey(username, icon)')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(limit));
  },

  publishLevel(ownerId, def) {
    return run((sb) => sb.from('levels').insert({
      owner_id: ownerId,
      name: (def.name || 'UNTITLED').slice(0, 24),
      description: (def.description || '').slice(0, 200),
      difficulty: def.difficulty || 'Custom',
      data: def,
      published: true,
    }).select().single());
  },

  downloadLevel(id) {
    return run((sb) => sb.from('levels').select('data').eq('id', id).single());
  },
};
