/**
 * accountUI.js — the online account screen: sign in / sign up, your
 * profile (icon picker, stats, wall), and viewing other players' profiles.
 *
 * Pure view layer over backend/backend.js. When Supabase isn't configured
 * the screen degrades to a friendly setup notice and the game stays fully
 * playable offline.
 */
import { Backend } from './backend/backend.js';
import { CONFIG } from './config.js';

const el = (tag, cls = '', html = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html) n.innerHTML = html;
  return n;
};
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const ICONS = 6;   // matches the character-select cube skins c0..c5

export class AccountUI {
  constructor(game) {
    this.game = game;
    this.$body = document.getElementById('account-body');
    this.$chip = document.getElementById('account-chip');
    this.user = null;        // supabase auth user
    this.profile = null;     // own profiles row
    this.$chip.addEventListener('click', () => {
      this.game.audio.unlock();
      this.game.audio.playSfx('click');
      this.open();
    });
    this._syncChip();
  }

  /** Called by game.js whenever the session changes. */
  setSession(user, profile) {
    this.user = user;
    this.profile = profile;
    this._syncChip();
    if (document.getElementById('screen-account').classList.contains('active')) {
      this.open();   // re-render if the screen is visible
    }
  }

  _syncChip() {
    if (!Backend.isConfigured()) { this.$chip.textContent = '⚡ ONLINE SETUP'; return; }
    this.$chip.textContent = this.profile ? `◈ ${this.profile.username}` : '◈ SIGN IN';
  }

  open() {
    this.game.ui.show('account');
    const b = this.$body;
    b.innerHTML = '';
    if (!Backend.isConfigured()) return this._renderOffline(b);
    b.append(this._searchRow());
    if (this.user && this.profile) this._renderProfile(b, this.profile, true);
    else this._renderAuth(b);
  }

  /* ---------------------------------------------- offline notice ---- */

  _renderOffline(b) {
    b.append(el('div', 'acc-panel', `
      <h3>ONLINE FEATURES NOT CONFIGURED</h3>
      <p class="acc-hint">This build is running in local mode — progress is saved on this
      device and everything is playable.</p>
      <p class="acc-hint">To enable accounts, profiles and wall messages, create a free
      Supabase project and paste its URL + publishable key into
      <b>js/backend/backendConfig.js</b>.<br><br>
      The full walkthrough is in <b>SETUP.md</b> (database schema included).</p>`));
  }

  /* ---------------------------------------------- search ---- */

  _searchRow() {
    const row = el('div', 'acc-search');
    const input = el('input');
    input.placeholder = 'Find a player by username…';
    input.maxLength = 16;
    const btn = el('button', 'btn', 'VIEW');
    const go = async () => {
      const name = input.value.trim();
      if (name.length < 3) return;
      btn.disabled = true;
      const { data, error } = await Backend.getProfileByUsername(name);
      btn.disabled = false;
      if (error || !data) return this._flash(row, error || `No player called "${esc(name)}"`);
      this.$body.querySelectorAll('.acc-panel').forEach((p) => p.remove());
      this._renderProfile(this.$body, data, this.user && data.id === this.user.id);
    };
    btn.onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    row.append(input, btn);
    return row;
  }

  _flash(anchor, msg) {
    let e = anchor.querySelector('.acc-error');
    if (!e) { e = el('p', 'acc-error'); anchor.append(e); }
    e.textContent = msg;
  }

  /* ---------------------------------------------- auth forms ---- */

  _renderAuth(b, mode = 'signin') {
    const panel = el('div', 'acc-panel');
    panel.innerHTML = `
      <div class="acc-tabs">
        <button class="acc-tab ${mode === 'signin' ? 'on' : ''}" data-m="signin">SIGN IN</button>
        <button class="acc-tab ${mode === 'signup' ? 'on' : ''}" data-m="signup">CREATE ACCOUNT</button>
      </div>`;
    panel.querySelectorAll('.acc-tab').forEach((t) => {
      t.onclick = () => { panel.remove(); this._renderAuth(b, t.dataset.m); };
    });

    const form = el('form', 'acc-form');
    const email = el('input'); email.type = 'email'; email.placeholder = 'Email'; email.required = true;
    const pass = el('input'); pass.type = 'password'; pass.placeholder = 'Password (6+ characters)';
    pass.required = true; pass.minLength = 6;
    let uname = null;
    if (mode === 'signup') {
      uname = el('input'); uname.placeholder = 'Username (3–16, letters/numbers/_)';
      uname.pattern = '[A-Za-z0-9_]{3,16}'; uname.required = true;
    }
    const submit = el('button', 'btn btn-primary', mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT');
    submit.type = 'submit';
    const status = el('p', 'acc-error');

    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      status.textContent = '…';
      const res = mode === 'signin'
        ? await Backend.signIn({ email: email.value.trim(), password: pass.value })
        : await Backend.signUp({ email: email.value.trim(), password: pass.value, username: uname.value.trim() });
      submit.disabled = false;
      if (res.error) { status.textContent = res.error; return; }
      if (mode === 'signup' && res.data && !res.data.session) {
        status.textContent = 'Account created! Check your email to confirm, then sign in.';
        return;
      }
      status.textContent = '';   // game._onAuth re-renders via setSession
    };

    form.append(email, ...(uname ? [uname] : []), pass, submit, status);
    panel.append(form);
    b.append(panel);
  }

  /* ---------------------------------------------- profile view ---- */

  async _renderProfile(b, profile, isOwn) {
    const panel = el('div', 'acc-panel acc-profile');
    const since = new Date(profile.created_at).toLocaleDateString();
    panel.innerHTML = `
      <div class="acc-head">
        <div class="char-cube c${profile.icon} acc-cube"></div>
        <div>
          <h3>${esc(profile.username)}</h3>
          <p class="acc-hint">Player since ${since}${isOwn ? ' · this is you' : ''}</p>
        </div>
      </div>`;

    if (isOwn) {
      // icon picker
      const pick = el('div', 'acc-icons');
      for (let i = 0; i < ICONS; i++) {
        const c = el('button', `acc-icon ${i === profile.icon ? 'on' : ''}`);
        c.append(el('div', `char-cube c${i}`));
        c.onclick = async () => {
          const { error } = await Backend.updateProfile(profile.id, { icon: i });
          if (error) return this._flash(panel, error);
          this.profile.icon = i;
          this.open();
        };
        pick.append(c);
      }
      panel.append(el('p', 'acc-label', 'PROFILE ICON'), pick);
    }

    // stats block (own stats come from the local save; others' from the cloud)
    const statsBox = el('div', 'acc-stats', '<p class="acc-hint">Loading stats…</p>');
    panel.append(el('p', 'acc-label', 'STATISTICS'), statsBox);
    this._fillStats(statsBox, profile, isOwn);

    // wall
    panel.append(el('p', 'acc-label', 'WALL'));
    const wall = el('div', 'acc-wall', '<p class="acc-hint">Loading messages…</p>');
    panel.append(wall);
    this._fillWall(wall, profile);

    if (this.user) {
      const post = el('form', 'acc-post');
      const inp = el('input');
      inp.placeholder = isOwn ? 'Write on your wall…' : `Message ${esc(profile.username)}…`;
      inp.maxLength = 280;
      const send = el('button', 'btn', 'POST'); send.type = 'submit';
      post.onsubmit = async (e) => {
        e.preventDefault();
        const body = inp.value.trim();
        if (!body) return;
        send.disabled = true;
        const { error } = await Backend.postMessage(profile.id, this.user.id, body);
        send.disabled = false;
        if (error) return this._flash(panel, error);
        inp.value = '';
        this._fillWall(wall, profile);
      };
      post.append(inp, send);
      panel.append(post);
    }

    if (isOwn) {
      const out = el('button', 'btn btn-danger acc-signout', 'SIGN OUT');
      out.onclick = async () => { await Backend.signOut(); };
      panel.append(out);
    }
    b.append(panel);
  }

  async _fillStats(box, profile, isOwn) {
    let levels = null;
    if (isOwn) {
      levels = this.game.save.data.levels;
    } else {
      const { data } = await Backend.getStats(profile.id);
      levels = data && data.data ? data.data.levels : null;
    }
    const ids = CONFIG.LEVEL_LIST;
    let completed = 0, attempts = 0, coins = 0;
    if (levels) for (const id of ids) {
      const r = levels[id];
      if (!r) continue;
      if (r.completed) completed++;
      attempts += r.attempts || 0;
      coins += (r.coins || []).filter(Boolean).length;
    }
    box.innerHTML = `
      <div class="acc-stat"><b>${completed}/${ids.length}</b><span>LEVELS</span></div>
      <div class="acc-stat"><b>${coins}</b><span>COINS</span></div>
      <div class="acc-stat"><b>${attempts}</b><span>ATTEMPTS</span></div>`;
  }

  async _fillWall(wall, profile) {
    const { data, error } = await Backend.getMessages(profile.id);
    if (error) { wall.innerHTML = `<p class="acc-error">${esc(error)}</p>`; return; }
    if (!data || !data.length) {
      wall.innerHTML = '<p class="acc-hint">No messages yet — be the first!</p>';
      return;
    }
    wall.innerHTML = '';
    for (const m of data) {
      const mine = this.user && (m.author_id === this.user.id || profile.id === this.user.id);
      const row = el('div', 'acc-msg', `
        <div class="char-cube c${m.author ? m.author.icon : 0} acc-msg-cube"></div>
        <div class="acc-msg-body">
          <b>${esc(m.author ? m.author.username : '?')}</b>
          <span class="acc-msg-time">${new Date(m.created_at).toLocaleString()}</span>
          <p>${esc(m.body)}</p>
        </div>`);
      if (mine) {
        const del = el('button', 'acc-msg-del', '✕');
        del.title = 'Delete message';
        del.onclick = async () => {
          const { error: e2 } = await Backend.deleteMessage(m.id);
          if (!e2) row.remove();
        };
        row.append(del);
      }
      wall.append(row);
    }
  }
}
