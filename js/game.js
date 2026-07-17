/**
 * game.js — the conductor: owns every subsystem, the state machine and the
 * main loop.
 *
 * States: 'menu' (any DOM menu screen), 'playing', 'dead' (explosion +
 * auto-restart), 'paused', 'victory'.
 *
 * The loop uses a fixed-timestep accumulator (240 Hz substeps) so physics
 * is identical on a 60 Hz laptop and a 240 Hz monitor.
 */
import { CONFIG } from './config.js';
import { clamp, hexToRgb } from './utils.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Physics } from './physics.js';
import { ParticleSystem } from './particles.js';
import { LevelManager } from './levelManager.js';
import { SaveManager } from './saveManager.js';
import { AudioManager } from './audioManager.js';
import { UI } from './ui.js';
import { DRAW } from './gameObjects.js';
import { drawBackgroundLayers, drawGround } from './background.js';
import { Editor, preparePlayDef } from './editor/editor.js';
import { LevelStore } from './editor/storage.js';
import { Backend } from './backend/backend.js';
import { AccountUI } from './accountUI.js';
import { CharacterUI } from './characterUI.js';

/** Fallback theme rendered behind the menus. */
const MENU_THEME = {
  bg1: [0.02, 0.004, 0.055], bg2: [0.1, 0.03, 0.22],
  accent: [0, 0.94, 1], accent2: [1, 0.18, 0.65],
  ground: [0.05, 0.02, 0.13], block: [0.13, 0.07, 0.3],
};

export class Game {
  constructor(canvas) {
    this.renderer = new Renderer(canvas);
    this.camera = new Camera(this.renderer);
    this.input = new Input();
    this.player = new Player();
    this.particles = new ParticleSystem();
    this.levels = new LevelManager();
    this.save = new SaveManager();
    this.audio = new AudioManager(this.save.settings);
    this.applyCustomisation();   // colours + icon variants from the save

    this.state = 'menu';
    this.level = null;            // current LevelRuntime
    this.levelIndex = -1;
    this.isCustom = false;        // playing a custom level (no save records)
    this.testReturnTo = null;     // 'editor' | 'mylevels' | null after a custom run
    this.testStartX = null;       // "test from here" spawn override
    this.sessionAttempts = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.elapsed = 0;             // wall-clock time for shader animation
    this.deathTimer = 0;
    this.winTimer = 0;
    this.trailTimer = 0;
    this.settingsFrom = 'menu';

    this.physics = new Physics({
      onJump: () => this.audio.playSfx('jump'),
      onLand: () => {},
      onDie: () => this._onDeath(),
      onPad: (pad) => {
        this.audio.playSfx('pad');
        this.particles.burst(pad.x + 0.5, pad.y + 0.3, [1, 0.84, 0.1], 12, 8);
      },
      onRing: (ring) => {
        this.audio.playSfx('ring');
        this.particles.burst(ring.cx, ring.cy, [1, 0.84, 0.1], 14, 9);
      },
      onPortal: (portal) => {
        this.audio.playSfx('portal');
        this.particles.burst(portal.x + 0.5, this.player.centerY, [0.7, 0.5, 1], 18, 10);
      },
      onCoin: (coin) => {
        this.audio.playSfx('coin');
        this.particles.burst(coin.cx, coin.cy, [1, 0.9, 0.3], 20, 9);
        this._refreshHudCoins();
      },
      onWin: () => this._onWin(),
    });

    this.ui = new UI({
      uiSound: (n) => { this.audio.unlock(); this.audio.playSfx(n); },
      levelSelected: (i) => this.startLevel(i),
      showMainLevels: () => this.showMainLevels(),
      showUGC: () => this.showUGC(),
      showSearch: () => this.showSearch(),
      showRecent: () => this.showRecent(),
      showCommunity: () => this.showCommunity(),
      showCharacter: () => this.characterUI.open(),
      showMyLevels: () => this.showMyLevels(),
      showLeaderboards: () => this.showLeaderboards(),
      newCustomLevel: () => this.newCustomLevel(),
      playCustom: (id) => this.playCustom(id),
      editCustom: (id, openSettings) => this.editCustom(id, openSettings),
      openEditor: () => this.openEditor(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      restart: () => this.restartFromMenu(),
      quit: () => this.quitToMenu(),
      continueFromVictory: () => this.quitToMenu(),
      openSettings: () => this.openSettings(),
      closeSettings: () => this.closeSettings(),
      settingChanged: (k, v) => this._settingChanged(k, v),
    });

    // the level editor shares the renderer / audio / level systems
    this.editor = new Editor(this);

    // character customisation screen
    this.characterUI = new CharacterUI(this);

    // online accounts (Supabase) — fully optional, see SETUP.md
    this.user = null;
    this.accountUI = new AccountUI(this);
    this._statsSyncTimer = null;
    Backend.init((user) => this._onAuth(user));

    // global input hooks
    this.input.bindPointer(canvas);
    this.input.onAnyInput = () => this.audio.unlock();
    this.input.onPause = (code) => {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'editor' && code === 'Escape') this.editor.onEscape();
    };
    this.input.onRestart = () => {
      if (this.state === 'playing' || this.state === 'dead') this._startAttempt();
    };
  }

  /* ================================================= boot ==== */

  async start() {
    this.levels.loadAll();   // internal module — instant, no network
    this.ui.syncSettings(this.save.settings);
    this.ui.initCarousel({
      metas: this.levels.defs,
      save: this.save,
      play: (i) => this.startLevel(i),
    });
    this.ui.show('menu');
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  /* ---- online accounts ---- */

  async _onAuth(user) {
    this.user = user;
    if (!user) {
      this.accountUI.setSession(null, null);
      this.ui.setCommunityUser(null);
      return;
    }
    const { data: profile, error: profileError } = await Backend.ensureProfile(user);
    if (profileError) console.warn('[auth] profile load/create failed:', profileError);
    this.accountUI.setSession(user, profile);
    // community actions (voting; rating for the moderator account)
    this.ui.setCommunityUser({
      userId: user.id,
      isMod: !!(profile && profile.is_mod),
      vote: (levelId, v) => Backend.castDifficultyVote(levelId, user.id, v),
      getMyVote: async (levelId) => (await Backend.getMyVote(levelId, user.id)).data,
      rate: (levelId, d, type) => Backend.rateLevel(levelId, d, type),
    });
    // share this device's customisation on the public profile
    Backend.pushProfileStyle(user.id, this.save.custom);
    // cloud save sync: merge both directions, then push the result
    const { data: cloud } = await Backend.getStats(user.id);
    const merged = Backend.mergeSaves(this.save.data, cloud ? cloud.data : null);
    this.save.data.levels = merged.levels;
    this.save.data.recent = merged.recent || this.save.data.recent;
    this.save.save();
    this._queueStatsSync(0);
  }

  /** Debounced cloud push — called after progress / history changes. */
  _queueStatsSync(delay = 4000) {
    if (!this.user) return;
    clearTimeout(this._statsSyncTimer);
    this._statsSyncTimer = setTimeout(() => {
      Backend.pushStats(this.user.id, {
        levels: this.save.data.levels,
        recent: this.save.data.recent,
      });
    }, delay);
  }

  /* ---- character customisation ---- */

  /** Convert saved customisation (hex colours) into player style and apply. */
  applyCustomisation() {
    const c = this.save.custom;
    this.player.setStyle({
      primary: hexToRgb(c.primary) || [0, 0.94, 1],
      secondary: hexToRgb(c.secondary) || [1, 0.18, 0.65],
      icons: c.icons,
    });
    if (this.user) Backend.pushProfileStyle(this.user.id, c);   // keep profile in sync
  }

  /* ---- play-hub navigation ---- */

  showMainLevels() {
    this.ui.populateMainLevels(this.levels.defs, this.save);
    this.ui.show('levels');
  }

  showCommunity() {
    this.ui.showCommunity({
      configured: Backend.isConfigured(),
      weekly: () => Backend.getWeeklyLevel(),
      play: (id) => this.playCommunity(id, 'community'),
    });
  }

  showUGC() {
    this.ui.showUGC({
      configured: Backend.isConfigured(),
      fetch: (opts) => Backend.listPublishedLevels(opts),
      play: (id) => this.playCommunity(id, 'ugc'),
    });
  }

  showSearch() {
    this.ui.showSearch({
      configured: Backend.isConfigured(),
      fetch: (opts) => Backend.listPublishedLevels(opts),
      play: (id) => this.playCommunity(id, 'search'),
    });
  }

  showRecent() {
    this.ui.showRecent({
      entries: this.save.recent,
      play: (entry) => this.playRecent(entry),
    });
  }

  /** Reopen a recently played level. Returns an error string or null. */
  async playRecent(entry) {
    if (entry.type === 'main') {
      const index = CONFIG.LEVEL_LIST.indexOf(entry.id);
      if (index < 0) return 'That level no longer exists.';
      this.startLevel(index);
      return null;
    }
    return this.playCommunity(entry.id, 'recent');
  }

  /** Download and run a community level. Returns an error string or null. */
  async playCommunity(id, returnTo = 'ugc') {
    const { data, error } = await Backend.downloadLevel(id);
    const def = data && data.data;
    if (error || !def || !Array.isArray(def.objects)) {
      return error || 'That level could not be loaded.';
    }
    Backend.recordLevelDownload(id);   // fire-and-forget play counter
    if (data.owner && data.owner.username) def.creator = data.owner.username;
    this.save.recordRecent({ type: 'community', id, name: data.name || def.name,
                             creator: def.creator || 'unknown' });
    this._queueStatsSync();
    this.editor.deactivate();
    this.level = this.levels.buildFromDef(preparePlayDef(def));
    this.level.onlineId = id;   // DB id — used for Triangles on completion
    this.levelIndex = -1;
    this.isCustom = true;
    this.testReturnTo = returnTo;
    this.testStartX = null;
    this.sessionAttempts = 0;
    this.state = 'playing';
    this.ui.show('hud');
    this._startAttempt();
    return null;
  }

  showMyLevels() {
    this.ui.populateMyLevels(LevelStore.list());
    this.ui.show('mylevels');
  }

  showLeaderboards() {
    this.ui.showLeaderboards({
      configured: Backend.isConfigured(),
      local: { metas: this.levels.defs, save: this.save },
      fetchTop: (stat, n) => Backend.leaderboard(stat, n),
      myRank: (stat, value) => Backend.myRank(stat, value),
      me: () => this.accountUI.profile,
    });
  }

  newCustomLevel() {
    this.openEditor();
    this.editor.newLevel();          // prompts if the open level has changes
  }

  /** Playtest a saved custom level straight from the My Levels menu. */
  playCustom(id) {
    const def = LevelStore.get(id);
    if (!def) return;
    this.editor.deactivate();
    this.level = this.levels.buildFromDef(preparePlayDef(def));
    this.levelIndex = -1;
    this.isCustom = true;
    this.testReturnTo = 'mylevels';
    this.testStartX = null;
    this.sessionAttempts = 0;
    this.state = 'playing';
    this.ui.show('hud');
    this._startAttempt();
  }

  editCustom(id, openSettings = false) {
    this.openEditor();
    this.editor.load(id);
    if (openSettings) this.editor.ui.open('settings');
  }

  /* ================================================= flow ==== */

  startLevel(index) {
    this.levelIndex = index;
    this.level = this.levels.build(index);
    const meta = this.levels.meta(index);
    this.save.recordRecent({ type: 'main', id: meta.id, name: meta.name, creator: 'NEOVOLT' });
    this._queueStatsSync();
    this.isCustom = false;
    this.testReturnTo = null;
    this.testStartX = null;
    this.sessionAttempts = 0;
    this.state = 'playing';
    this.ui.show('hud');
    this._startAttempt();
  }

  /* ---- level editor integration ---- */

  openEditor() {
    this.audio.stopMusic();
    this.level = null;
    this.testReturnTo = null;
    this.state = 'editor';
    this.ui.show('editor');
    this.editor.activate();
  }

  exitEditor() {
    this.editor.deactivate();
    this.audio.stopMusic();
    this.state = 'menu';
    this.ui.show('menu');
  }

  /** Play an editor level. startX (optional) spawns mid-level ("test here"). */
  testLevel(def, startX = null) {
    this.editor.deactivate();
    this.level = this.levels.buildFromDef(def);
    this.levelIndex = -1;
    this.isCustom = true;
    this.testReturnTo = 'editor';
    this.testStartX = startX;
    this.sessionAttempts = 0;
    this.state = 'playing';
    this.ui.show('hud');
    this._startAttempt();
  }

  /** (Re)spawn: used for level entry, deaths and manual restarts. */
  _startAttempt() {
    const lv = this.level;
    lv.resetTransients();
    this.player.reset();
    if (this.testStartX !== null) this.player.x = this.testStartX;
    this.camera.reset(this.player.x);
    this.particles.clear();
    this.input.clear();
    this.accumulator = 0;
    this.deathTimer = 0;
    this.sessionAttempts++;
    if (!this.isCustom) this.save.recordAttempt(lv.id);
    this.state = 'playing';
    this.ui.flashAttempt(this.sessionAttempts);
    this.ui.setProgress(0);
    this._refreshHudCoins();
    if (lv.customMusic && lv.customMusic.url) {
      this.audio.playStream(lv.customMusic.url, lv.bpm);
    } else {
      this.audio.startMusic(lv.track, lv.bpm);
    }
  }

  _onDeath() {
    this.state = 'dead';
    this.deathTimer = 0;
    this.audio.stopMusic();
    this.audio.playSfx('death');
    this.camera.shake();
    this.particles.explosion(this.player.centerX, this.player.centerY, this.player.color);
    if (!this.isCustom) {
      this.save.recordProgress(this.level.id, this._progressPct());
      this._queueStatsSync();
    }
  }

  _onWin() {
    this.state = 'victory';
    this.winTimer = 0;
    this.audio.stopMusic();
    this.audio.playSfx('victory');
    const coins = this.level.coins.map((c) => c.collected);
    let coinsGot, best;
    if (this.isCustom) {
      coinsGot = coins.filter(Boolean).length;
      best = 100;
    } else {
      const rec = this.save.recordComplete(this.level.id, coins);
      coinsGot = rec.coins.filter(Boolean).length;
      best = rec.best;
      this._queueStatsSync();
    }
    this._victoryStats = {
      levelName: this.level.name,
      pct: 100,
      coins: coinsGot,
      coinsTotal: Math.max(3, this.level.coins.length),
      best,
      attempts: this.sessionAttempts,
    };

    // Triangles: first completion of a community level, awarded server-side
    if (this.level.onlineId && this.user) {
      const stats = this._victoryStats;
      Backend.recordCompletion(this.level.onlineId).then(({ data }) => {
        if (data > 0) {
          if (this._victoryStats === stats) stats.triangles = data;
          if (this.accountUI.profile) this.accountUI.profile.triangles = (this.accountUI.profile.triangles || 0) + data;
        }
      });
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showModal('pause');
    if (this.audio.ctx) this.audio.ctx.suspend();
    this.audio.pauseStream();
  }

  resume() {
    if (this.state !== 'paused') return;
    if (this.audio.ctx) this.audio.ctx.resume();
    this.audio.resumeStream();
    this.state = 'playing';
    this.ui.showModal('none');
    this.lastTime = performance.now();   // don't integrate the paused time
  }

  restartFromMenu() {
    if (this.audio.ctx) this.audio.ctx.resume();
    this.ui.showModal('none');
    this._startAttempt();
  }

  quitToMenu() {
    if (this.audio.ctx) this.audio.ctx.resume();
    this.audio.stopMusic();
    this.particles.clear();
    const dest = this.testReturnTo;
    this.level = null;
    if (dest === 'editor') { this.openEditor(); return; }
    this.state = 'menu';
    if (dest === 'mylevels') { this.showMyLevels(); return; }
    if (dest === 'ugc') { this.showUGC(); return; }
    if (dest === 'search') { this.showSearch(); return; }
    if (dest === 'recent') { this.showRecent(); return; }
    if (dest === 'community') { this.showCommunity(); return; }
    this.ui.show('menu');   // main levels launch from the menu carousel now
  }

  openSettings() {
    this.settingsFrom = this.state === 'paused' ? 'pause' : 'menu';
    if (this.settingsFrom === 'pause') this.ui.showModal('settings');
    else this.ui.show('settings');
  }

  closeSettings() {
    if (this.settingsFrom === 'pause') this.ui.showModal('pause');
    else this.ui.show('menu');
  }

  _settingChanged(key, value) {
    this.save.setSetting(key, value);
    if (key === 'music') this.audio.setMusicVolume(value);
    if (key === 'sfx') this.audio.setSfxVolume(value);
  }

  /* ================================================= loop ==== */

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = clamp(dt, 0, CONFIG.PHYS.MAX_FRAME);
    this.elapsed += dt;

    this.audio.update();   // keep the music scheduler fed in every state

    switch (this.state) {
      case 'playing': this._updatePlaying(dt); break;
      case 'dead': this._updateDead(dt); break;
      case 'victory': this._updateVictory(dt); break;
      case 'editor': this.editor.update(dt); break;
      // menu/paused: nothing to simulate
    }

    this._render(dt);
  }

  _updatePlaying(dt) {
    // fixed-timestep physics
    this.accumulator += dt;
    this.physics.attach(this.level, this.player, this.input);
    while (this.accumulator >= CONFIG.PHYS.STEP && this.state === 'playing') {
      this.physics.step(CONFIG.PHYS.STEP);
      this.accumulator -= CONFIG.PHYS.STEP;
    }

    // move/alpha triggers tween per rendered frame (smooth at any fps)
    this.level.updateTriggers(this.player.x, dt);

    this.camera.update(this.player, dt, this.save.settings.shake, this._camMax());
    this.particles.update(dt);

    // player trail: solid ribbon for the wave, particles for everything else
    if (this.player.mode === 'wave') {
      this.player.sampleTrail();
    } else {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0 && !this.player.dead) {
        this.trailTimer = 0.022;
        this.particles.trail(this.player.x + 0.1, this.player.centerY, this.player.color);
      }
    }

    this.ui.setProgress(this._progressPct());
  }

  _updateDead(dt) {
    this.deathTimer += dt;
    // brief hit-stop, then let the explosion and shake play out
    if (this.deathTimer > CONFIG.DEATH_FREEZE) {
      this.particles.update(dt);
      this.camera.update(this.player, dt, this.save.settings.shake, this._camMax());
    }
    if (this.deathTimer >= CONFIG.DEATH_RESTART) this._startAttempt();
  }

  _updateVictory(dt) {
    this.winTimer += dt;
    this.particles.update(dt);
    this.camera.update(this.player, dt, false, this._camMax());
    if (this._victoryStats && this.winTimer >= CONFIG.VICTORY_DELAY) {
      this.ui.showVictory(this._victoryStats);
      this._victoryStats = null;
    }
  }

  /** Camera clamp: the view's right edge stops at the level's end wall. */
  _camMax() {
    return this.level ? this.level.length - this.renderer.viewW : Infinity;
  }

  _progressPct() {
    return clamp((this.player.x / this.level.length) * 100, 0, 100);
  }

  _refreshHudCoins() {
    const banked = this.isCustom ? [false, false, false] : this.save.level(this.level.id).coins;
    const collected = [false, false, false];
    for (const c of this.level.coins) if (c.collected && c.idx < 3) collected[c.idx] = true;
    this.ui.setCoins(collected, banked);
  }

  /* ================================================= render ==== */

  _render(dt) {
    const r = this.renderer;

    // the editor drives its own camera/zoom and draw passes
    if (this.state === 'editor') {
      this.editor.render(this.elapsed);
      return;
    }

    const inLevel = this.level !== null;
    const theme = inLevel ? this.level.theme : MENU_THEME;
    const pulse = this.audio.getPulse();

    // menus get a slow ambient scroll so the world feels alive behind them
    if (!inLevel) {
      this.camera.x += dt * 1.6;
      this.camera.y = CONFIG.CAM_Y_MIN;
      this.particles.update(dt);
    }

    const cam = this.camera.renderPos;
    r.begin(cam);

    // 1. shader background + tower silhouettes + ground
    drawBackgroundLayers(r, cam, theme, this.elapsed, pulse);
    drawGround(r, cam, theme, this.elapsed, pulse, inLevel ? this.level.length : 0);
    r.flushSolidLayer();

    if (inLevel) {
      // 2. level objects (glow halos under, solids on top)
      const x0 = cam.x - 3, x1 = cam.x + r.viewW + 3;
      const banked = this.isCustom ? [] : this.save.level(this.level.id).coins;
      const lv = this.level;

      // draw with the object's alpha-trigger group fade applied
      const drawFaded = (o, fn, ...extra) => {
        const a = lv.groupAlpha(o);
        if (a <= 0.004) return;                 // fully faded groups skip work
        if (a !== 1) r.alphaMul = a;
        fn(r, o, theme, this.elapsed, pulse, ...extra);
        r.alphaMul = 1;
      };

      // background decorations (editor levels)
      lv.eachDecoBg(x0 - 60, x1, (o) => drawFaded(o, DRAW.deco));

      lv.eachRenderable(x0, x1, (o) => {
        const fn = DRAW[o.type];
        if (!fn) return;
        drawFaded(o, fn, o.type === 'coin' ? banked[o.idx] : undefined);
        // ambient shimmer rising out of portals
        if (o.type === 'portal' && Math.random() < dt * 8) {
          this.particles.shimmer(o.x + 0.5, o.y + 0.4, [0.75, 0.6, 1]);
        }
      });

      // 3. the wave ribbon, the player, then foreground decorations
      this.player.renderTrail(r);
      this.player.render(r, this.elapsed);
      lv.eachDecoFg(x0 - 60, x1, (o) => drawFaded(o, DRAW.deco));

      r.flushGlowLayer();     // halos
      r.flushSolidLayer();    // shapes above their halos
    }

    // 4. particles + trail on top of everything
    this.particles.render(r);
    r.flushGlowLayer();
  }
}
