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

/* Community-level column sets. The full set needs
 * supabase/upgrade-community-levels.sql; until it has run we detect the
 * missing columns once and fall back so the browser keeps working
 * (likes/song simply don't render). */
const LEVEL_COLS_FULL =
  'id, name, description, difficulty, song, downloads, likes, created_at, ' +
  'owner:profiles!levels_owner_id_fkey(username, icon)';
const LEVEL_COLS_LEGACY =
  'id, name, description, difficulty, downloads, created_at, ' +
  'owner:profiles!levels_owner_id_fkey(username, icon)';
let hasCommunityColumns = null;   // null = unknown → probe on first query

const DIFFICULTIES = ['Easy', 'Normal', 'Hard', 'Insane', 'Custom'];
const MAX_LEVEL_BYTES = 262144;   // matches the DB check constraint (256 KB)

const isMissingColumnError = (error, col) =>
  typeof error === 'string' && error.includes(col) && /column|schema|exist/i.test(error);

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
  // gateway timeouts (e.g. auth 504s) surface as raw upstream text or "{}"
  if (/upstream request timeout|gateway time-?out|^\{\}$/i.test(msg)) {
    return 'The server timed out — please try again in a moment.';
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
      options: {
        data: { username },              // display name only — never used for authorization
        // confirmation-email links return to this site (the origin must be
        // listed under Auth → URL Configuration → Redirect URLs, SETUP.md 1.3)
        emailRedirectTo: location.origin,
      },
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
    return run((sb) => sb.from('profiles').select('*').eq('id', userId).maybeSingle());
  },

  /**
   * The signed-in player's profile — created on the spot if signup ran
   * while the DB trigger was missing. Mirrors handle_new_user(): use the
   * signup username, fall back to a generated name if invalid or taken.
   * (Client-side creation needs the "create own profile" RLS policy from
   * supabase/fix-missing-trigger.sql.)
   */
  async ensureProfile(user) {
    const found = await this.getProfile(user.id);
    if (found.data || found.error) return found;
    const meta = (user.user_metadata && user.user_metadata.username) || '';
    const fallback = 'player_' + user.id.replace(/-/g, '').slice(0, 8);
    const wanted = /^[A-Za-z0-9_]{3,16}$/.test(meta) ? meta : fallback;
    let created = await run((sb) => sb.from('profiles')
      .insert({ id: user.id, username: wanted }).select().single());
    if (created.error && wanted !== fallback) {
      created = await run((sb) => sb.from('profiles')
        .insert({ id: user.id, username: fallback }).select().single());
    }
    if (!created.error) {
      await run((sb) => sb.from('stats')
        .upsert({ user_id: user.id }, { onConflict: 'user_id' }));
    }
    return created;
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

  /* ================================================= levels (community) ==== */

  /**
   * One page of the community browser.
   * opts = { page, pageSize, search, sort: 'newest'|'popular'|'top'|'name' }
   * → { data: { rows, total, hasExtras }, error }  (total = full match count)
   */
  async listPublishedLevels({ page = 0, pageSize = 24, search = '', sort = 'newest' } = {}) {
    const query = (cols) => {
      const extras = cols === LEVEL_COLS_FULL;
      return run(async (sb) => {
        let q = sb.from('levels')
          .select(cols, { count: 'exact' })
          .eq('published', true);
        const s = search.trim().replace(/[\\%_]/g, '\\$&');   // no pattern injection
        if (s) q = q.ilike('name', `%${s}%`);
        const orders = {
          newest: ['created_at', false],
          popular: ['downloads', false],
          top: [extras ? 'likes' : 'downloads', false],   // likes needs the upgrade
          name: ['name', true],
        };
        const [col, ascending] = orders[sort] || orders.newest;
        q = q.order(col, { ascending })
          .order('id', { ascending: true })               // stable page order on ties
          .range(page * pageSize, page * pageSize + pageSize - 1);
        const { data, error, count } = await q;
        return {
          data: error ? null : { rows: data, total: count ?? 0, hasExtras: extras },
          error,
        };
      });
    };

    if (hasCommunityColumns !== false) {
      const res = await query(LEVEL_COLS_FULL);
      if (!res.error) { hasCommunityColumns = true; return res; }
      if (!isMissingColumnError(res.error, 'likes') && !isMissingColumnError(res.error, 'song')) return res;
      hasCommunityColumns = false;   // upgrade SQL not run yet — degrade quietly
    }
    return query(LEVEL_COLS_LEGACY);
  },

  /** The playable payload only — nothing else leaves the table. */
  downloadLevel(id) {
    return run((sb) => sb.from('levels')
      .select('id, name, data, owner:profiles!levels_owner_id_fkey(username)')
      .eq('id', id).single());
  },

  /** Fire-and-forget play counter (SECURITY DEFINER RPC — players cannot
   *  update rows they don't own). Errors are ignored by callers. */
  recordLevelDownload(id) {
    return run((sb) => sb.rpc('record_level_download', { level_id: id }));
  },

  /**
   * Publish (or re-publish) a level from the editor.
   * Validates locally, strips editor-only state from the payload, and
   * UPDATEs the existing row when this level was already published so
   * re-uploads never create duplicates. meta = { name, description,
   * difficulty, song }. → { data: { id }, error }
   */
  async publishLevel(ownerId, def, meta) {
    const name = (meta.name || '').trim().toUpperCase().slice(0, 24);
    const description = (meta.description || '').trim().slice(0, 200);
    const difficulty = DIFFICULTIES.includes(meta.difficulty) ? meta.difficulty : 'Custom';
    const song = (meta.song || '').trim().slice(0, 60);
    if (!name) return { data: null, error: 'Give the level a name first.' };
    if (!def || !Array.isArray(def.objects) || def.objects.length < 5) {
      return { data: null, error: 'The level is too empty to publish — place at least 5 objects.' };
    }
    const data = structuredClone(def);
    data.name = name;
    data.description = description;
    data.difficulty = difficulty;
    delete data.editor;          // camera position is private editor state
    delete data._modified;
    delete data._publishedId;
    if (JSON.stringify(data).length > MAX_LEVEL_BYTES) {
      return { data: null, error: 'Level is too large to publish (limit 256 KB).' };
    }

    const row = { name, description, difficulty, data, published: true };
    if (hasCommunityColumns !== false) row.song = song;

    const attempt = async (r) => {
      if (def._publishedId) {
        const upd = await run((sb) => sb.from('levels')
          .update(r).eq('id', def._publishedId).eq('owner_id', ownerId)
          .select('id').maybeSingle());
        if (upd.error || upd.data) return upd;
        // previously-published row no longer exists — publish fresh below
      }
      return run((sb) => sb.from('levels')
        .insert({ ...r, owner_id: ownerId }).select('id').single());
    };

    let res = await attempt(row);
    if (res.error && 'song' in row && isMissingColumnError(res.error, 'song')) {
      hasCommunityColumns = false;
      delete row.song;
      res = await attempt(row);
    }
    return res;
  },
};
