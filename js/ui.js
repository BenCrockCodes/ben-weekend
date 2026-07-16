/**
 * ui.js — DOM overlay: screens, HUD, transitions and widgets.
 *
 * The UI never owns game state; it renders what game.js tells it to and
 * forwards user intent back through the `actions` callback table.
 */
export class UI {
  /**
   * @param {object} actions {play, levelSelected(i), pause, resume, restart,
   *                          quit, continue, settings(open), closeSettings,
   *                          settingChanged(key, value), uiSound(name)}
   */
  constructor(actions) {
    this.actions = actions;
    this.screens = {};
    for (const el of document.querySelectorAll('[data-screen]')) {
      this.screens[el.dataset.screen] = el;
    }
    this.settingsReturnTo = 'menu';   // settings modal can open from menu or pause

    // cached HUD nodes (must exist before the click handlers are wired)
    this.$fill = document.getElementById('progress-fill');
    this.$cube = document.getElementById('progress-cube');
    this.$pct = document.getElementById('progress-pct');
    this.$attempt = document.getElementById('attempt-label');
    this.$hudCoins = [...document.querySelectorAll('.hud-coin')];
    this.$levelCards = document.getElementById('level-cards');
    this.$myLevelList = document.getElementById('mylevel-list');
    this.$ugcGrid = document.getElementById('ugc-grid');
    this.$ugcSearch = document.getElementById('ugc-search');
    this.$ugcSort = document.getElementById('ugc-sort');
    this.$ugcScroll = document.getElementById('ugc-scroll');
    this.$ugcStatus = document.getElementById('ugc-status');
    this.$ugcMore = document.getElementById('ugc-more');
    this.$lbTable = document.getElementById('lb-table');
    this.ugc = null;   // community browser state while the screen is open

    this._bindButtons();
    this._bindSettings();
    this._bindUGC();
  }

  /* ------------------------------------------------ wiring ---- */

  _bindButtons() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.actions.uiSound('click');
      const a = btn.dataset.action;
      switch (a) {
        case 'play': this.show('playhub'); break;
        case 'menu': this.show('menu'); break;
        case 'mainlevels': this.actions.showMainLevels(); break;
        case 'ugc': this.actions.showUGC(); break;
        case 'mylevels': this.actions.showMyLevels(); break;
        case 'leaderboards': this.actions.showLeaderboards(); break;
        case 'new-level': this.actions.newCustomLevel(); break;
        case 'character': this.show('character'); break;
        case 'settings': this.actions.openSettings(); break;
        case 'close-settings': this.actions.closeSettings(); break;
        case 'resume': this.actions.resume(); break;
        case 'restart': this.actions.restart(); break;
        case 'quit': this.actions.quit(); break;
        case 'continue': this.actions.continueFromVictory(); break;
      }
    });

    // hover blips on every button
    document.body.addEventListener('pointerover', (e) => {
      if (e.target.closest('.btn, .level-card:not(.locked), .icon-btn')) {
        this.actions.uiSound('hover');
      }
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      this.actions.uiSound('click');
      this.actions.pause();
    });
  }

  _bindSettings() {
    const music = document.getElementById('vol-music');
    const sfx = document.getElementById('vol-sfx');
    const shake = document.getElementById('opt-shake');
    music.addEventListener('input', () => this.actions.settingChanged('music', music.value / 100));
    sfx.addEventListener('input', () => this.actions.settingChanged('sfx', sfx.value / 100));
    sfx.addEventListener('change', () => this.actions.uiSound('coin'));   // audible preview
    shake.addEventListener('change', () => this.actions.settingChanged('shake', shake.checked));
  }

  /** Reflect persisted settings into the widgets. */
  syncSettings(settings) {
    document.getElementById('vol-music').value = Math.round(settings.music * 100);
    document.getElementById('vol-sfx').value = Math.round(settings.sfx * 100);
    document.getElementById('opt-shake').checked = !!settings.shake;
  }

  /* ------------------------------------------------ screens ---- */

  /** Show exactly one screen ('none' hides everything but the canvas). */
  show(name) {
    for (const key of Object.keys(this.screens)) {
      this.screens[key].classList.toggle('active', key === name);
    }
  }

  /** Modals (pause/settings/victory) stack on top of the HUD. */
  showModal(name) {
    this.screens.hud.classList.add('active');
    for (const key of ['pause', 'settings', 'victory']) {
      this.screens[key].classList.toggle('active', key === name);
    }
  }

  /* ------------------------------------------------ main levels ---- */

  populateMainLevels(levelMetas, save) {
    this.$levelCards.innerHTML = '';
    levelMetas.forEach((meta, i) => {
      const rec = save.level(meta.id);
      const unlocked = save.isUnlocked(i);
      const card = document.createElement('article');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      const stars = '★'.repeat(meta.stars || 1);
      const song = meta.song ? meta.song.name : '';
      card.innerHTML = `
        <div class="lc-glow"></div>
        <h3 class="lc-name">${meta.name}</h3>
        <p class="lc-diff">${meta.difficulty.toUpperCase()} <span class="lc-stars">${stars}</span></p>
        <p class="lc-song">♪ ${song}</p>
        <div class="lc-bar"><div class="lc-bar-fill" style="width:${rec.best}%"></div></div>
        <p class="lc-best">${rec.completed ? 'COMPLETE ✓' : `BEST ${rec.best}%`}</p>
        <p class="lc-attempts">ATTEMPTS ${rec.attempts}</p>
        <div class="lc-coins">
          ${[0, 1, 2].map((ci) => `<span class="lc-coin${rec.coins[ci] ? ' got' : ''}"></span>`).join('')}
        </div>
        <button class="btn lc-play">PLAY</button>
        <div class="lc-lock">🔒<small>Complete ${i > 0 ? levelMetas[i - 1].name : ''} to unlock</small></div>`;
      const [r, g, b] = meta.theme.accent.map((v) => Math.round(v * 255));
      card.style.setProperty('--accent', `rgb(${r},${g},${b})`);
      card.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.35)`);
      if (unlocked) card.addEventListener('click', () => this.actions.levelSelected(i));
      this.$levelCards.append(card);
    });
  }

  /* ------------------------------------------------ my levels ---- */

  populateMyLevels(list) {
    this.$myLevelList.innerHTML = '';
    if (!list.length) {
      this.$myLevelList.innerHTML =
        '<p class="empty-note">No levels yet — hit <b>+ CREATE NEW</b> and build something!</p>';
      return;
    }
    for (const def of list) {
      const row = document.createElement('article');
      row.className = 'mylevel-card';
      const grad = this._themeGradient(def.theme);
      row.innerHTML = `
        <div class="ml-thumb" style="background:${grad}"></div>
        <div class="ml-info">
          <h3>${def.name || 'UNTITLED'}</h3>
          <p class="ml-desc">${def.description ? this._esc(def.description) : '<i>No description</i>'}</p>
          <p class="ml-meta">${def.difficulty || 'Custom'} · ${(def.objects || []).length} objects ·
            v${def.version || 1} · ${new Date(def._modified || 0).toLocaleDateString()}</p>
        </div>
        <div class="ml-actions">
          <button class="btn btn-primary" data-ml="play">PLAYTEST</button>
          <button class="btn" data-ml="edit">EDIT</button>
          <button class="btn" data-ml="settings">SETTINGS</button>
        </div>`;
      row.querySelector('[data-ml="play"]').onclick = () => this.actions.playCustom(def.id);
      row.querySelector('[data-ml="edit"]').onclick = () => this.actions.editCustom(def.id, false);
      row.querySelector('[data-ml="settings"]').onclick = () => this.actions.editCustom(def.id, true);
      this.$myLevelList.append(row);
    }
  }

  _themeGradient(theme) {
    if (!theme) return '#111';
    const hex = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
    return `linear-gradient(135deg, ${hex(theme.bg2)}, ${hex(theme.bg1)} 60%, ${hex(theme.accent)}33)`;
  }

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ------------------------------------------------ community browser ---- */

  _bindUGC() {
    let debounce = null;
    this.$ugcSearch.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!this.ugc) return;
        const v = this.$ugcSearch.value.trim();
        if (v === this.ugc.search) return;
        this.ugc.search = v;
        this._ugcLoad(true);
      }, 300);
    });
    this.$ugcSort.addEventListener('change', () => {
      if (!this.ugc) return;
      this.ugc.sort = this.$ugcSort.value;
      this._ugcLoad(true);
    });
    this.$ugcMore.addEventListener('click', () => this._ugcLoad(false));
    // lazy loading: fetch the next page as the footer nears the viewport
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) &&
            this.ugc && this.ugc.hasMore && !this.ugc.busy) {
          this._ugcLoad(false);
        }
      }, { root: this.$ugcScroll, rootMargin: '200px' }).observe(this.$ugcMore);
    }
  }

  /** Open the community browser. ctx = { configured, fetch(opts), play(id) }. */
  showUGC(ctx) {
    this.ugc = {
      ctx,
      page: 0, total: 0, hasMore: false,
      search: this.$ugcSearch.value.trim(),
      sort: this.$ugcSort.value,
      busy: false, gen: 0,
    };
    this.show('ugc');
    this._ugcLoad(true);
  }

  async _ugcLoad(reset) {
    const u = this.ugc;
    if (!u || u.busy) return;
    const grid = this.$ugcGrid;

    if (!u.ctx.configured) {
      grid.innerHTML = '';
      grid.append(this._ugcNote(
        'Online features are not configured yet.<br>' +
        'See <b>SETUP.md</b> to enable accounts and community levels.'));
      this.$ugcStatus.textContent = '';
      this.$ugcMore.hidden = true;
      return;
    }

    const gen = ++u.gen;   // stale responses (rapid search/sort changes) are dropped
    u.busy = true;
    if (reset) {
      u.page = 0;
      grid.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        const sk = document.createElement('div');
        sk.className = 'ugc-skel';
        sk.style.animationDelay = `${i * 0.08}s`;
        grid.append(sk);
      }
    }
    this.$ugcMore.disabled = true;
    this.$ugcStatus.textContent = 'LOADING…';

    const res = await u.ctx.fetch({ page: u.page, pageSize: 24, search: u.search, sort: u.sort });
    if (this.ugc !== u || gen !== u.gen) return;
    u.busy = false;
    this.$ugcMore.disabled = false;
    if (reset) grid.innerHTML = '';

    if (res.error) {
      this.$ugcStatus.textContent = 'COULD NOT LOAD LEVELS';
      if (reset) {
        grid.append(this._ugcNote(`⚠ ${this._esc(res.error)}`, true));
        this.$ugcMore.hidden = true;
      }
      return;   // page not advanced — LOAD MORE retries the same page
    }

    const { rows, total, hasExtras } = res.data;
    u.total = total;
    if (u.page === 0 && !rows.length) {
      grid.append(this._ugcNote(u.search
        ? `No levels matching "<b>${this._esc(u.search)}</b>".`
        : 'No community levels yet.<br>Open the <b>EDITOR</b>, build something great and hit <b>PUBLISH</b> to be the first!'));
    }
    for (const row of rows) grid.append(this._ugcCard(row, hasExtras));

    const shown = grid.querySelectorAll('.ugc-card').length;
    u.page++;
    u.hasMore = shown < total;
    this.$ugcMore.hidden = !u.hasMore;
    this.$ugcStatus.textContent =
      total ? `SHOWING ${shown} OF ${total} LEVEL${total === 1 ? '' : 'S'}` : '';
    // likes sorting only exists once the DB upgrade has run
    const top = this.$ugcSort.querySelector('option[value="top"]');
    if (top) top.disabled = !hasExtras;
  }

  _ugcCard(row, hasExtras) {
    const card = document.createElement('article');
    card.className = 'ugc-card';
    const owner = row.owner || {};
    const diff = row.difficulty || 'Custom';
    const date = new Date(row.created_at).toLocaleDateString();
    const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n || 0}`);
    card.innerHTML = `
      <div class="ugc-card-head">
        <h3 class="ugc-name">${this._esc(row.name)}</h3>
        <span class="ugc-diff diff-${diff.toLowerCase()}">${this._esc(diff.toUpperCase())}</span>
      </div>
      <p class="ugc-creator">
        <span class="char-cube c${Number(owner.icon) || 0} ugc-cube"></span>${this._esc(owner.username || 'unknown')}
      </p>
      <p class="ugc-desc">${row.description ? this._esc(row.description) : '<i>No description</i>'}</p>
      <div class="ugc-meta">
        <span class="ugc-stat" title="Plays">&#9654; ${fmt(row.downloads)}</span>
        ${hasExtras ? `<span class="ugc-stat" title="Likes">&#9829; ${fmt(row.likes)}</span>` : ''}
        ${row.song ? `<span class="ugc-stat ugc-song" title="Song">&#9834; ${this._esc(row.song)}</span>` : ''}
        <span class="ugc-date" title="Published">${date}</span>
      </div>
      <button class="btn btn-primary ugc-play">PLAY</button>`;
    const play = card.querySelector('.ugc-play');
    const go = async () => {
      if (card.classList.contains('busy')) return;
      card.classList.add('busy');
      play.textContent = 'LOADING…';
      const err = await this.ugc.ctx.play(row.id);
      card.classList.remove('busy');
      play.textContent = 'PLAY';
      if (err) this.$ugcStatus.textContent = `⚠ ${err}`;
    };
    play.addEventListener('click', (e) => { e.stopPropagation(); go(); });
    card.addEventListener('click', go);
    return card;
  }

  _ugcNote(html, retry = false) {
    const note = document.createElement('div');
    note.className = 'empty-note ugc-note';
    note.innerHTML = `<p>${html}</p>`;
    if (retry) {
      const b = document.createElement('button');
      b.className = 'btn ugc-retry';
      b.textContent = 'RETRY';
      b.onclick = () => this._ugcLoad(true);
      note.append(b);
    }
    return note;
  }

  /* ------------------------------------------------ leaderboards ---- */

  populateLeaderboards(levelMetas, save) {
    const rows = levelMetas.map((meta) => {
      const rec = save.level(meta.id);
      return `<tr>
        <td>${meta.name}</td>
        <td>${'★'.repeat(meta.stars || 1)}</td>
        <td>${rec.best}%</td>
        <td>${rec.attempts}</td>
        <td>${rec.coins.filter(Boolean).length}/3</td>
        <td>${rec.completed ? '✓' : '—'}</td>
      </tr>`;
    }).join('');
    this.$lbTable.innerHTML = `
      <table class="lb">
        <thead><tr><th>LEVEL</th><th>DIFF</th><th>BEST</th><th>ATTEMPTS</th><th>COINS</th><th>DONE</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* ------------------------------------------------ HUD ---- */

  setProgress(pct) {
    const clamped = Math.min(100, Math.max(0, pct));
    this.$fill.style.width = `${clamped}%`;
    this.$cube.style.left = `${clamped}%`;
    this.$pct.textContent = `${Math.floor(clamped)}%`;
  }

  setCoins(collected, banked) {
    this.$hudCoins.forEach((el, i) => {
      el.classList.toggle('got', !!collected[i]);
      el.style.opacity = banked[i] && !collected[i] ? 0.35 : 1;
    });
  }

  flashAttempt(n) {
    this.$attempt.textContent = `ATTEMPT ${n}`;
    this.$attempt.classList.add('show');
    clearTimeout(this._attemptTimer);
    this._attemptTimer = setTimeout(() => this.$attempt.classList.remove('show'), 1400);
  }

  /* ------------------------------------------------ victory ---- */

  showVictory({ levelName, pct, coins, coinsTotal, best, attempts }) {
    document.getElementById('victory-level-name').textContent = levelName;
    document.getElementById('v-pct').textContent = `${pct}%`;
    document.getElementById('v-coins').textContent = `${coins}/${coinsTotal}`;
    document.getElementById('v-best').textContent = `${best}%`;
    document.getElementById('v-attempts').textContent = attempts;
    this.showModal('victory');
  }
}
