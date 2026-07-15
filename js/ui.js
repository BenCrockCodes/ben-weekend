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
    this.$lbTable = document.getElementById('lb-table');

    this._bindButtons();
    this._bindSettings();
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

  /* ------------------------------------------------ community (future) ---- */

  populateUGC(state) {
    this.$ugcGrid.innerHTML = '';
    // skeleton cards make the future layout tangible
    for (let i = 0; i < 6; i++) {
      const sk = document.createElement('div');
      sk.className = 'ugc-skel';
      sk.style.animationDelay = `${i * 0.12}s`;
      this.$ugcGrid.append(sk);
    }
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.innerHTML = state && state.error
      ? `⚠ ${state.error}`
      : 'ONLINE LEVELS ARE COMING SOON.<br>Uploading, searching, rating and creator pages are on the roadmap — ' +
        'the game already loads any shared level file through <b>MY LEVELS → editor → IMPORT</b>.';
    this.$ugcGrid.append(note);
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
