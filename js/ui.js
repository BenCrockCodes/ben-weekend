/**
 * ui.js — DOM overlay: screens, HUD, transitions and widgets.
 *
 * The UI never owns game state; it renders what game.js tells it to and
 * forwards user intent back through the `actions` callback table.
 */
import { DIFFICULTY_SCALE, difficultyLabel } from './backend/backend.js';

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
    this.$searchGrid = document.getElementById('search-grid');
    this.$searchScroll = document.getElementById('search-scroll');
    this.$searchStatus = document.getElementById('search-status');
    this.$searchMore = document.getElementById('search-more');
    this.$recentList = document.getElementById('recent-list');
    this.$carCard = document.getElementById('car-card');
    this.$weekly = document.getElementById('weekly-banner');
    this.ugc = null;      // community browser state while the screen is open
    this.searchCtx = null; // search page state
    this.car = null;       // main-menu level carousel
    this.comUser = null;   // { userId, isMod, vote(), getMyVote(), rate() } when signed in
    this.lb = null;        // leaderboards context
    this.lbTab = 'triangles';

    this._bindButtons();
    this._bindSettings();
    this._bindUGC();
    this._bindSearch();
    this._bindCarousel();
    this._bindLeaderboards();
  }

  /* ------------------------------------------------ wiring ---- */

  _bindButtons() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.actions.uiSound('click');
      const a = btn.dataset.action;
      switch (a) {
        case 'menu': this.show('menu'); break;
        case 'community': this.actions.showCommunity(); break;
        case 'mainlevels': this.actions.showMainLevels(); break;
        case 'ugc': this.actions.showUGC(); break;
        case 'search': this.actions.showSearch(); break;
        case 'recent': this.actions.showRecent(); break;
        case 'mylevels': this.actions.showMyLevels(); break;
        case 'leaderboards': this.actions.showLeaderboards(); break;
        case 'new-level': this.actions.newCustomLevel(); break;
        case 'character': this.actions.showCharacter(); break;
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
    if (name === 'menu' && this.car) this._renderCarousel();   // fresh stats
  }

  /* ------------------------------------------------ main-menu carousel ---- */

  _bindCarousel() {
    document.getElementById('car-prev').addEventListener('click', () => this._carStep(-1));
    document.getElementById('car-next').addEventListener('click', () => this._carStep(1));
    window.addEventListener('keydown', (e) => {
      if (!this.car || !this.screens.menu.classList.contains('active')) return;
      if (e.code === 'ArrowLeft') { e.preventDefault(); this._carStep(-1); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this._carStep(1); }
    });
  }

  /** ctx = { metas, save, play(index) } — every official level, no locks. */
  initCarousel(ctx) {
    this.car = { ...ctx, index: 0 };
    this._renderCarousel();
  }

  _carStep(dir) {
    const c = this.car;
    if (!c) return;
    this.actions.uiSound('click');
    c.index = (c.index + dir + c.metas.length) % c.metas.length;
    this._renderCarousel(dir);
  }

  _renderCarousel(dir = 0) {
    const c = this.car;
    const meta = c.metas[c.index];
    const rec = c.save.level(meta.id);
    const coins = rec.coins.filter(Boolean).length;
    const card = this.$carCard;
    card.innerHTML = `
      <p class="car-count">LEVEL ${c.index + 1} / ${c.metas.length}</p>
      <h3 class="car-name">${meta.name}</h3>
      <p class="car-meta">${meta.difficulty.toUpperCase()}
        <span class="lc-stars">${'★'.repeat(meta.stars || 1)}</span>
        &nbsp;·&nbsp; ♪ ${meta.song ? meta.song.name : ''}</p>
      <div class="lc-bar"><div class="lc-bar-fill" style="width:${rec.best}%"></div></div>
      <p class="car-best">${rec.completed ? 'COMPLETE ✓' : `BEST ${rec.best}%`} &nbsp;·&nbsp; ${coins}/3 COINS</p>
      <button class="btn btn-primary car-play">PLAY</button>`;
    const [r, g, b] = meta.theme.accent.map((v) => Math.round(v * 255));
    card.style.setProperty('--accent', `rgb(${r},${g},${b})`);
    card.querySelector('.car-play').onclick = () => c.play(c.index);
    if (dir !== 0) {
      card.classList.remove('slide-left', 'slide-right');
      void card.offsetWidth;   // restart the slide animation
      card.classList.add(dir > 0 ? 'slide-left' : 'slide-right');
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

  /** Every official level is always playable — no locks, no gating. */
  populateMainLevels(levelMetas, save) {
    this.$levelCards.innerHTML = '';
    levelMetas.forEach((meta, i) => {
      const rec = save.level(meta.id);
      const card = document.createElement('article');
      card.className = 'level-card';
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
        <button class="btn lc-play">PLAY</button>`;
      const [r, g, b] = meta.theme.accent.map((v) => Math.round(v * 255));
      card.style.setProperty('--accent', `rgb(${r},${g},${b})`);
      card.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.35)`);
      card.addEventListener('click', () => this.actions.levelSelected(i));
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

  /* ------------------------------------------------ community hub ---- */

  /** Set the signed-in community context (null when signed out).
   *  { userId, isMod, vote(levelId,v), getMyVote(levelId), rate(levelId,d,type) } */
  setCommunityUser(ctx) { this.comUser = ctx; }

  /** ctx = { configured, weekly(): Promise<{data,error}>, play(id) }. */
  showCommunity(ctx) {
    this.show('community');
    this._renderWeekly(ctx);
  }

  async _renderWeekly(ctx) {
    const b = this.$weekly;
    if (!ctx.configured) { b.innerHTML = ''; return; }
    const gen = (this._weeklyGen = (this._weeklyGen || 0) + 1);
    b.innerHTML = '<div class="ugc-skel weekly-skel"></div>';
    const { data, error } = await ctx.weekly();
    if (gen !== this._weeklyGen) return;
    if (error || !data) {
      // no pick yet (empty community / upgrade SQL pending) — stay quiet
      b.innerHTML = '';
      return;
    }
    const owner = data.owner || {};
    b.innerHTML = `
      <div class="weekly-card">
        <div class="weekly-badge">&#9733;<span>WEEKLY<br>LEVEL</span></div>
        <div class="weekly-info">
          <h3>${this._esc(data.name)}</h3>
          <p>by ${this._esc(owner.username || 'unknown')} · &#9654; ${data.downloads || 0}</p>
        </div>
        ${this._diffChipHTML(data)}
        <button class="btn btn-primary weekly-play">PLAY</button>
      </div>`;
    const btn = b.querySelector('.weekly-play');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'LOADING…';
      const err = await ctx.play(data.id);
      btn.disabled = false; btn.textContent = 'PLAY';
      if (err) b.querySelector('.weekly-info p').textContent = `⚠ ${err}`;
    };
  }

  /* ------------------------------------------------ difficulty chips ---- */

  /** The level's displayed difficulty: official rating wins, else the
   *  community's most-voted option, else UNRATED. Rating types decorate
   *  the chip (star icon / glow / animated fire). */
  _diffChipHTML(row) {
    const official = row.official_difficulty || null;
    const v = official || row.community_difficulty || null;
    const label = v ? `${v} · ${difficultyLabel(v).toUpperCase()}` : 'UNRATED';
    const tier = v ? `diff-t${v}` : 'diff-t0';
    const rating = row.rating ? ` rated-${row.rating}` : '';
    const star = row.rating === 'star' ? ' <i class="rate-star">★</i>' : '';
    return `<span class="ugc-diff ${tier}${rating}" title="${official ? 'Official rating' : (v ? 'Community vote' : 'Not yet voted')}">${label}${star}</span>`;
  }

  /** Voting / moderating panel under a level card's chip. */
  _votePanel(row, host) {
    const cu = this.comUser;
    if (!cu) return null;
    const canVote = !row.official_difficulty;
    if (!canVote && !cu.isMod) return null;

    const wrap = document.createElement('div');
    wrap.className = 'vote-wrap';
    const toggle = document.createElement('button');
    toggle.className = 'vote-toggle';
    toggle.textContent = cu.isMod ? 'RATE' : 'VOTE';
    wrap.append(toggle);

    toggle.onclick = async (e) => {
      e.stopPropagation();
      if (wrap.querySelector('.vote-panel')) { wrap.querySelector('.vote-panel').remove(); return; }
      const panel = document.createElement('div');
      panel.className = 'vote-panel';
      panel.onclick = (ev) => ev.stopPropagation();
      const nums = document.createElement('div');
      nums.className = 'vote-nums';
      let picked = null;
      const mine = !cu.isMod ? await cu.getMyVote(row.id) : null;
      for (const d of DIFFICULTY_SCALE) {
        const nb = document.createElement('button');
        nb.className = 'vote-num' + (mine === d.v ? ' on' : '');
        nb.textContent = d.v;
        nb.title = d.label;
        nb.onclick = async (ev) => {
          ev.stopPropagation();
          if (cu.isMod) {   // moderators pick the number, then the rating type
            picked = d.v;
            nums.querySelectorAll('.vote-num').forEach((x) => x.classList.remove('on'));
            nb.classList.add('on');
            return;
          }
          const { error } = await cu.vote(row.id, d.v);
          panel.innerHTML = `<p class="vote-done">${error ? '⚠ ' + this._esc(error) : 'VOTED ✓ — thanks!'}</p>`;
        };
        nums.append(nb);
      }
      panel.append(nums);
      if (cu.isMod) {
        const types = document.createElement('div');
        types.className = 'vote-types';
        for (const [t, label] of [[null, 'RATE ONLY'], ['star', '★ STAR'], ['feature', '◆ FEATURE'], ['epic', '🔥 EPIC']]) {
          const tb = document.createElement('button');
          tb.className = 'vote-type';
          tb.textContent = label;
          tb.onclick = async (ev) => {
            ev.stopPropagation();
            if (!picked) { panel.querySelector('.vote-nums').classList.add('shake'); return; }
            const { error } = await cu.rate(row.id, picked, t);
            panel.innerHTML = `<p class="vote-done">${error ? '⚠ ' + this._esc(error) : 'RATED ✓'}</p>`;
          };
          types.append(tb);
        }
        panel.append(types);
      }
      wrap.append(panel);
    };
    return wrap;
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

  _ugcCard(row, hasExtras, playFn = null) {
    const card = document.createElement('article');
    card.className = 'ugc-card';
    const owner = row.owner || {};
    const date = new Date(row.created_at).toLocaleDateString();
    const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n || 0}`);
    card.innerHTML = `
      <div class="ugc-card-head">
        <h3 class="ugc-name">${this._esc(row.name)}</h3>
        ${this._diffChipHTML(row)}
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
    // difficulty voting / moderator rating (signed-in, extras schema only)
    if (hasExtras) {
      const votes = this._votePanel(row, card);
      if (votes) card.querySelector('.ugc-meta').append(votes);
    }
    const play = card.querySelector('.ugc-play');
    const doPlay = playFn || ((id) => this.ugc.ctx.play(id));
    const go = async () => {
      if (card.classList.contains('busy')) return;
      card.classList.add('busy');
      play.textContent = 'LOADING…';
      const err = await doPlay(row.id);
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

  /* ------------------------------------------------ search levels ---- */

  _bindSearch() {
    document.getElementById('search-filters').addEventListener('submit', (e) => {
      e.preventDefault();
      this._searchLoad(true);
    });
    this.$searchMore.addEventListener('click', () => this._searchLoad(false));
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        const s = this.searchCtx;
        if (entries.some((en) => en.isIntersecting) && s && s.hasMore && !s.busy) {
          this._searchLoad(false);
        }
      }, { root: this.$searchScroll, rootMargin: '200px' }).observe(this.$searchMore);
    }
  }

  /** Open the search page. ctx = { configured, fetch(opts), play(id) }. */
  showSearch(ctx) {
    this.searchCtx = { ctx, page: 0, hasMore: false, busy: false, gen: 0 };
    this.show('search');
    if (!this.$searchGrid.childElementCount) this._searchLoad(true);
  }

  async _searchLoad(reset) {
    const s = this.searchCtx;
    if (!s || s.busy) return;
    const grid = this.$searchGrid;

    if (!s.ctx.configured) {
      grid.innerHTML = '';
      grid.append(this._ugcNote('Online features are not configured yet — see <b>SETUP.md</b>.'));
      this.$searchMore.hidden = true;
      return;
    }

    const filters = {
      search: document.getElementById('sf-name').value,
      creator: document.getElementById('sf-creator').value,
      difficulty: document.getElementById('sf-difficulty').value,
    };
    const gen = ++s.gen;
    s.busy = true;
    if (reset) {
      s.page = 0;
      grid.innerHTML = '';
      for (let i = 0; i < 3; i++) grid.append(Object.assign(document.createElement('div'), { className: 'ugc-skel' }));
    }
    this.$searchMore.disabled = true;
    this.$searchStatus.textContent = 'SEARCHING…';

    const res = await s.ctx.fetch({ page: s.page, pageSize: 24, sort: 'newest', ...filters });
    if (this.searchCtx !== s || gen !== s.gen) return;
    s.busy = false;
    this.$searchMore.disabled = false;
    if (reset) grid.innerHTML = '';

    if (res.error) {
      this.$searchStatus.textContent = 'SEARCH FAILED';
      if (reset) grid.append(this._ugcNote(`⚠ ${this._esc(res.error)}`));
      return;
    }
    const { rows, total, hasExtras } = res.data;
    if (s.page === 0 && !rows.length) {
      grid.append(this._ugcNote('No levels match those filters.'));
    }
    for (const row of rows) grid.append(this._ugcCard(row, hasExtras, s.ctx.play));
    const shown = grid.querySelectorAll('.ugc-card').length;
    s.page++;
    s.hasMore = shown < total;
    this.$searchMore.hidden = !s.hasMore;
    this.$searchStatus.textContent = total ? `${shown} OF ${total} RESULT${total === 1 ? '' : 'S'}` : '';
  }

  /* ------------------------------------------------ recently played ---- */

  /** ctx = { entries: [{type,id,name,creator,at}], play(entry) }. */
  showRecent(ctx) {
    this.show('recent');
    const list = this.$recentList;
    list.innerHTML = '';
    if (!ctx.entries.length) {
      list.append(this._ugcNote('Nothing here yet — levels you play appear in this list.'));
      return;
    }
    for (const e of ctx.entries) {
      const row = document.createElement('article');
      row.className = 'recent-row';
      const when = new Date(e.at || 0).toLocaleString();
      row.innerHTML = `
        <span class="recent-kind ${e.type === 'main' ? 'kind-main' : 'kind-community'}">${e.type === 'main' ? 'MAIN' : 'COMMUNITY'}</span>
        <div class="recent-info">
          <h3>${this._esc(e.name || 'UNKNOWN')}</h3>
          <p>by ${this._esc(e.creator || 'unknown')} · last played ${when}</p>
        </div>
        <button class="btn btn-primary recent-play">PLAY</button>`;
      const btn = row.querySelector('.recent-play');
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'LOADING…';
        const err = await ctx.play(e);
        btn.disabled = false;
        btn.textContent = 'PLAY';
        if (err) row.querySelector('p').textContent = `⚠ ${err}`;
      };
      list.append(row);
    }
  }

  /* ------------------------------------------------ leaderboards ---- */

  _bindLeaderboards() {
    for (const tab of document.querySelectorAll('.lb-tab')) {
      tab.addEventListener('click', () => {
        this.lbTab = tab.dataset.lb;
        document.querySelectorAll('.lb-tab').forEach((t) =>
          t.classList.toggle('on', t === tab));
        this._lbLoad();
      });
    }
  }

  /** ctx = { configured, local: {metas, save}, fetchTop(stat, n),
   *          myRank(stat, value), me(): profile|null }. */
  showLeaderboards(ctx) {
    this.lb = ctx;
    this.show('leaderboards');
    this._lbLoad();
  }

  async _lbLoad() {
    const ctx = this.lb;
    if (!ctx) return;
    const box = this.$lbTable;

    if (this.lbTab === 'local') return this._lbLocal(box, ctx.local);

    if (!ctx.configured) {
      box.innerHTML = '';
      box.append(this._ugcNote('Online leaderboards need the Supabase setup — see <b>SETUP.md</b>.'));
      return;
    }
    const stat = this.lbTab;
    const gen = (this._lbGen = (this._lbGen || 0) + 1);
    box.innerHTML = '<div class="ugc-skel weekly-skel"></div>';
    const limit = stat === 'creator_points' ? 25 : 100;
    const res = await ctx.fetchTop(stat, limit);
    if (gen !== this._lbGen || this.lbTab !== stat) return;
    if (res.error) {
      box.innerHTML = '';
      box.append(this._ugcNote(/column|schema/i.test(res.error)
        ? 'Global leaderboards unlock once <b>supabase/upgrade-progression.sql</b> has been run.'
        : `⚠ ${this._esc(res.error)}`));
      return;
    }
    const rows = res.data || [];
    const unit = stat === 'creator_points' ? 'CP' : '▲';
    const me = ctx.me();
    let html = rows.length ? '' : '';
    if (!rows.length) {
      box.innerHTML = '';
      box.append(this._ugcNote(stat === 'creator_points'
        ? 'No creator points awarded yet — rated levels earn their creators CP.'
        : 'No triangles earned yet — complete community levels to appear here!'));
    } else {
      html = `<table class="lb"><thead><tr><th>#</th><th>PLAYER</th><th>${stat === 'creator_points' ? 'CREATOR POINTS' : 'TRIANGLES'}</th></tr></thead><tbody>`;
      rows.forEach((r, i) => {
        const meRow = me && r.username === me.username;
        html += `<tr class="${meRow ? 'lb-me' : ''}${i < 3 ? ` lb-top${i + 1}` : ''}">
          <td>${i + 1}</td>
          <td><span class="char-cube c${Number(r.icon) || 0} ugc-cube"></span> ${this._esc(r.username)}</td>
          <td>${unit} ${(r[stat] || 0).toLocaleString()}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      box.innerHTML = html;
    }
    // the player's own position when outside the visible top
    const mine = me ? (me[stat] || 0) : 0;
    const inTop = me && rows.some((r) => r.username === me.username);
    if (me && mine > 0 && !inTop) {
      const rank = await ctx.myRank(stat, mine);
      if (gen !== this._lbGen) return;
      const foot = document.createElement('div');
      foot.className = 'lb-mine';
      foot.innerHTML = `<span>YOUR POSITION</span>
        <b>#${rank.data ? rank.data.toLocaleString() : '—'}</b>
        <span>${unit} ${mine.toLocaleString()}</span>`;
      box.append(foot);
    }
  }

  _lbLocal(box, { metas, save }) {
    const rows = metas.map((meta) => {
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
    box.innerHTML = `
      <table class="lb">
        <thead><tr><th>LEVEL</th><th>STARS</th><th>BEST</th><th>ATTEMPTS</th><th>COINS</th><th>DONE</th></tr></thead>
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

  showVictory({ levelName, pct, coins, coinsTotal, best, attempts, triangles }) {
    document.getElementById('victory-level-name').textContent = levelName;
    document.getElementById('v-pct').textContent = `${pct}%`;
    document.getElementById('v-coins').textContent = `${coins}/${coinsTotal}`;
    document.getElementById('v-best').textContent = `${best}%`;
    document.getElementById('v-attempts').textContent = attempts;
    const tri = document.getElementById('v-triangles');
    tri.hidden = !triangles;
    if (triangles) tri.innerHTML = `&#9650; +${triangles} TRIANGLE${triangles === 1 ? '' : 'S'}`;
    this.showModal('victory');
  }
}
