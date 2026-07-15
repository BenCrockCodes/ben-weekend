/**
 * audioManager.js — WebAudio: synthesized SFX + a procedural music sequencer.
 *
 * There are no audio files at all: every sound effect is synthesized on
 * demand and each level's soundtrack is an original chip/synthwave loop
 * played by a 16th-note step sequencer with a look-ahead scheduler.
 *
 * Because levels place obstacles on a 4-block beat grid and set
 * `speed = bpm / 15`, the action and the music stay locked together.
 */

const LOOKAHEAD = 0.12;      // seconds of audio scheduled ahead of "now"
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ============================================================
 * Track library — 4-bar loops, 16 steps per bar (64 steps).
 * Drum rows are strings ('1' = hit). Bass/lead rows are arrays of
 * MIDI notes (null = rest), written per bar then concatenated.
 * ============================================================ */
const N = null;
const bar = (s) => s.replace(/\s/g, '');

const TRACKS = {
  /* Level 1 — "Neon Runner": bright, driving A-minor groove */
  runner: {
    kick:  bar('1000 1000 1000 1000').repeat(4),
    snare: bar('0000 1000 0000 1000').repeat(4),
    hat:   bar('0010 0010 0010 0011').repeat(4),
    bass: [
      // A minor: A A F G — root 8ths with octave pops
      ...[45,N,45,N,57,N,45,N,45,N,45,57,45,N,48,N],
      ...[45,N,45,N,57,N,45,N,45,N,45,57,45,N,43,N],
      ...[41,N,41,N,53,N,41,N,41,N,41,53,41,N,45,N],
      ...[43,N,43,N,55,N,43,N,43,N,43,55,43,N,47,N],
    ],
    lead: [
      // sparse pentatonic hook
      ...[69,N,N,N,72,N,69,N,N,N,67,N,64,N,N,N],
      ...[69,N,N,N,72,N,74,N,N,N,72,N,69,N,N,N],
      ...[65,N,N,N,69,N,65,N,N,N,64,N,60,N,N,N],
      ...[67,N,N,N,71,N,74,N,76,N,74,N,71,N,67,N],
    ],
    leadWave: 'square', leadGain: 0.055, bassCut: 700,
  },

  /* Level 2 — "Voltage": moodier E-minor stomp, busier bass */
  voltage: {
    kick:  bar('1000 0010 1000 0000') + bar('1000 0010 1000 0010') +
           bar('1000 0010 1000 0000') + bar('1000 0010 1010 0010'),
    snare: bar('0000 1000 0000 1000').repeat(3) + bar('0000 1000 0000 1010'),
    hat:   bar('1010 1010 1010 1010').repeat(4),
    bass: [
      ...[40,N,40,52,40,N,40,N,40,52,40,N,40,N,52,N],
      ...[43,N,43,55,43,N,43,N,43,55,43,N,43,N,55,N],
      ...[36,N,36,48,36,N,36,N,36,48,36,N,36,N,48,N],
      ...[38,N,38,50,38,N,38,N,38,50,38,N,40,N,41,N],
    ],
    lead: [
      ...[N,N,64,N,N,67,N,N,64,N,N,N,62,N,N,N],
      ...[N,N,67,N,N,71,N,N,67,N,N,N,64,N,N,N],
      ...[N,N,60,N,N,64,N,N,60,N,N,N,59,N,N,N],
      ...[N,N,62,N,N,65,N,N,69,N,N,N,71,N,72,N],
    ],
    leadWave: 'sawtooth', leadGain: 0.04, bassCut: 550,
  },

  /* Level 3 — "Gravity Storm": relentless D-minor arps, double-time hats */
  storm: {
    kick:  bar('1000 1000 1000 1000').repeat(3) + bar('1000 1000 1010 1000'),
    snare: bar('0000 1000 0000 1000').repeat(4),
    hat:   bar('1101 1101 1101 1101').repeat(4),
    bass: [
      ...[38,38,50,38,38,50,38,50,38,38,50,38,38,50,38,50],
      ...[34,34,46,34,34,46,34,46,34,34,46,34,34,46,34,46],
      ...[41,41,53,41,41,53,41,53,41,41,53,41,41,53,41,53],
      ...[36,36,48,36,36,48,36,48,36,36,48,36,38,50,40,52],
    ],
    lead: [
      ...[62,N,65,N,69,N,65,N,62,N,65,N,69,N,74,N],
      ...[58,N,62,N,65,N,62,N,58,N,62,N,65,N,70,N],
      ...[65,N,69,N,72,N,69,N,65,N,69,N,72,N,77,N],
      ...[60,N,64,N,67,N,64,N,60,N,64,N,72,N,76,N],
    ],
    leadWave: 'square', leadGain: 0.045, bassCut: 620,
  },
};

export class AudioManager {
  constructor(settings) {
    this.ctx = null;
    this.settings = settings;      // live reference to save.settings
    this.playing = false;
    this.track = null;
    this.step = 0;
    this.stepDur = 0;
    this.nextStepTime = 0;
    this.startTime = 0;
    this.bpm = 120;
    // streamed custom music (editor levels with an imported URL)
    this.stream = null;
    this.streamBpm = 120;
    this.streamStart = 0;
  }

  /** Human-readable catalog of the built-in tracks (editor music picker). */
  static get TRACK_INFO() {
    return [
      { id: 'runner', name: 'Neon Runner Theme', mood: 'bright · driving', loopBars: 4 },
      { id: 'voltage', name: 'Voltage Theme', mood: 'dark · stomping', loopBars: 4 },
      { id: 'storm', name: 'Gravity Storm Theme', mood: 'relentless · arps', loopBars: 4 },
    ];
  }

  /** Browsers require a user gesture before audio — call this from input. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();

      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this.setMusicVolume(this.settings.music);
      this.setSfxVolume(this.settings.sfx);

      // dotted-eighth feedback delay for the lead synth
      this.delay = this.ctx.createDelay(1.0);
      this.delayFb = this.ctx.createGain();
      this.delayFb.gain.value = 0.3;
      const delayFilter = this.ctx.createBiquadFilter();
      delayFilter.type = 'lowpass'; delayFilter.frequency.value = 2400;
      this.delay.connect(delayFilter);
      delayFilter.connect(this.delayFb);
      this.delayFb.connect(this.delay);
      this.delay.connect(this.musicGain);

      // shared white-noise buffer for drums
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusicVolume(v) {
    if (this.musicGain) this.musicGain.gain.value = v * v;
    if (this.stream) this.stream.volume = Math.min(1, v * v);
  }
  setSfxVolume(v) { if (this.sfxGain) this.sfxGain.gain.value = v * v; }

  /* ================================================= music ==== */

  startMusic(trackId, bpm) {
    if (!this.ctx) return;
    this.stopMusic();
    this.track = TRACKS[trackId] || TRACKS.runner;
    this.bpm = bpm;
    this.stepDur = 60 / bpm / 4;                      // one 16th note
    this.delay.delayTime.value = this.stepDur * 3;    // dotted eighth
    this.step = 0;
    this.startTime = this.ctx.currentTime + 0.06;
    this.nextStepTime = this.startTime;
    this.playing = true;
  }

  /** Play an imported audio URL (custom editor music). Falls back silently
   *  if the browser refuses to load/play it — gameplay must never break. */
  playStream(url, bpm = 120, loop = true) {
    this.stopMusic();
    try {
      // no crossOrigin attribute: opaque playback works without CORS headers
      this.stream = new Audio(url);
      this.stream.loop = loop;
      this.stream.volume = Math.min(1, this.settings.music * this.settings.music);
      const p = this.stream.play();
      if (p) p.catch((e) => console.warn('Custom music failed to play:', e));
      this.streamBpm = bpm;
      this.streamStart = performance.now();
    } catch (e) {
      console.warn('Custom music failed:', e);
      this.stream = null;
    }
  }

  pauseStream() { if (this.stream) this.stream.pause(); }
  resumeStream() {
    if (this.stream) {
      const p = this.stream.play();
      if (p) p.catch(() => {});
    }
  }

  stopMusic() {
    this.playing = false;
    if (this.stream) {
      this.stream.pause();
      this.stream.src = '';
      this.stream = null;
    }
  }

  /** Call every frame — schedules any steps inside the look-ahead window. */
  update() {
    if (!this.playing || !this.ctx) return;
    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this.step % 64, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.stepDur;
    }
  }

  /** 0..1 saw synced to the beat — drives visual pulsing. */
  getPulse() {
    if (this.stream && !this.stream.paused) {
      const beat = (performance.now() - this.streamStart) / 1000 * (this.streamBpm / 60);
      const phase = beat - Math.floor(beat);
      return Math.pow(1 - phase, 2);
    }
    if (!this.playing || !this.ctx) return 0;
    const beat = (this.ctx.currentTime - this.startTime) / (this.stepDur * 4);
    const phase = beat - Math.floor(beat);
    return Math.pow(1 - phase, 2);                    // sharp attack, soft decay
  }

  _scheduleStep(s, t) {
    const trk = this.track;
    if (trk.kick[s] === '1') this._kick(t);
    if (trk.snare[s] === '1') this._snare(t);
    if (trk.hat[s] === '1') this._hat(t);
    const b = trk.bass[s];
    if (b !== null && b !== undefined) this._bass(t, b, trk.bassCut);
    const l = trk.lead[s];
    if (l !== null && l !== undefined) this._lead(t, l, trk.leadWave, trk.leadGain);
  }

  /* ---- tiny synth instruments (all routed into musicGain) ---- */

  /** Disconnect one-shot node chains once the source finishes, so the
   *  audio graph doesn't grow without bound during long sessions. */
  _autoCleanup(src, ...nodes) {
    src.onended = () => {
      try { src.disconnect(); for (const n of nodes) n.disconnect(); } catch (e) { /* already gone */ }
    };
  }

  _env(t, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(this.musicGain);
    return g;
  }

  _kick(t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = this._env(t, 0.5, 0.16);
    o.connect(g);
    this._autoCleanup(o, g);
    o.start(t); o.stop(t + 0.18);
  }

  _snare(t) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = this._env(t, 0.25, 0.13);
    n.connect(f); f.connect(g);
    this._autoCleanup(n, f, g);
    n.start(t); n.stop(t + 0.15);
  }

  _hat(t) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7500;
    const g = this._env(t, 0.07, 0.04);
    n.connect(f); f.connect(g);
    this._autoCleanup(n, f, g);
    n.start(t); n.stop(t + 0.06);
  }

  _bass(t, midi, cutoff) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(midi);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.2);
    const g = this._env(t, 0.22, 0.22);
    o.connect(f); f.connect(g);
    this._autoCleanup(o, f, g);
    o.start(t); o.stop(t + 0.24);
  }

  _lead(t, midi, wave, gain) {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.value = midiHz(midi);
    const g = this._env(t, gain, 0.2);
    o.connect(g);
    g.connect(this.delay);                            // echo send
    this._autoCleanup(o, g);
    o.start(t); o.stop(t + 0.22);
  }

  /* ================================================= SFX ==== */

  playSfx(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'jump':   this._blip(t, 300, 560, 'square', 0.16, 0.09); break;
      case 'ring':   this._blip(t, 500, 880, 'square', 0.16, 0.1); break;
      case 'pad':    this._blip(t, 190, 760, 'sine', 0.22, 0.13); break;
      case 'portal': this._sweep(t); break;
      case 'coin':   this._coin(t); break;
      case 'death':  this._death(t); break;
      case 'click':  this._blip(t, 720, 640, 'square', 0.1, 0.035); break;
      case 'hover':  this._blip(t, 900, 940, 'sine', 0.05, 0.03); break;
      case 'victory': this._victory(t); break;
    }
  }

  _sfxEnv(t, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(this.sfxGain);
    return g;
  }

  _blip(t, f0, f1, wave, vol, dur) {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this._sfxEnv(t, vol, dur + 0.03);
    o.connect(g);
    this._autoCleanup(o, g);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _sweep(t) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(920, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.26);
    const g = this._sfxEnv(t, 0.2, 0.3);
    o.connect(g);
    this._autoCleanup(o, g);
    o.start(t); o.stop(t + 0.32);
  }

  _coin(t) {
    this._blip(t, 988, 988, 'square', 0.12, 0.07);
    this._blip(t + 0.07, 1319, 1319, 'square', 0.12, 0.12);
  }

  _death(t) {
    // falling saw + noise crunch
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.32);
    const g1 = this._sfxEnv(t, 0.3, 0.36);
    o.connect(g1);
    this._autoCleanup(o, g1);
    o.start(t); o.stop(t + 0.4);

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    const g2 = this._sfxEnv(t, 0.3, 0.25);
    n.connect(f); f.connect(g2);
    this._autoCleanup(n, f, g2);
    n.start(t); n.stop(t + 0.28);
  }

  _victory(t) {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => this._blip(t + i * 0.1, f, f, 'square', 0.16, 0.16));
  }
}
