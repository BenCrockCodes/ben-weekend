/**
 * renderer.js — minimal batched WebGL renderer.
 *
 * Three programs, three batches per frame:
 *   1. background  — one fullscreen quad, shader-animated gradient/grid
 *   2. glow        — additive radial sprites (halos, trails, particles)
 *   3. solid       — colored triangles for every game object
 *
 * The glow batch is flushed twice per frame: once *under* the solids
 * (object halos) and once *over* them (particles / trail), giving a cheap
 * but convincing bloom without a post-processing pass.
 *
 * World space: 1 unit = 1 block, y-up. The camera supplies the bottom-left
 * corner of the viewport in world units.
 */
import { SOLID_VS, SOLID_FS, GLOW_VS, GLOW_FS, BG_VS, BG_FS } from '../shaders/shaders.js';
import { CONFIG } from './config.js';

const MAX_QUADS = 4096;                 // per batch, plenty for one screen

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    this.gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!this.gl) throw new Error('WebGL is not supported in this browser.');

    this._initPrograms();
    this._initBuffers();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ------------------------------------------------ setup ---- */

  _compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  _program(vsSrc, fsSrc) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  _initPrograms() {
    const gl = this.gl;

    this.progSolid = this._program(SOLID_VS, SOLID_FS);
    this.solidLoc = {
      pos: gl.getAttribLocation(this.progSolid, 'a_pos'),
      color: gl.getAttribLocation(this.progSolid, 'a_color'),
      cam: gl.getUniformLocation(this.progSolid, 'u_cam'),
      res: gl.getUniformLocation(this.progSolid, 'u_res'),
      scale: gl.getUniformLocation(this.progSolid, 'u_scale'),
    };

    this.progGlow = this._program(GLOW_VS, GLOW_FS);
    this.glowLoc = {
      pos: gl.getAttribLocation(this.progGlow, 'a_pos'),
      uv: gl.getAttribLocation(this.progGlow, 'a_uv'),
      color: gl.getAttribLocation(this.progGlow, 'a_color'),
      cam: gl.getUniformLocation(this.progGlow, 'u_cam'),
      res: gl.getUniformLocation(this.progGlow, 'u_res'),
      scale: gl.getUniformLocation(this.progGlow, 'u_scale'),
    };

    this.progBg = this._program(BG_VS, BG_FS);
    this.bgLoc = {
      pos: gl.getAttribLocation(this.progBg, 'a_pos'),
      res: gl.getUniformLocation(this.progBg, 'u_res'),
      c1: gl.getUniformLocation(this.progBg, 'u_c1'),
      c2: gl.getUniformLocation(this.progBg, 'u_c2'),
      accent: gl.getUniformLocation(this.progBg, 'u_accent'),
      camx: gl.getUniformLocation(this.progBg, 'u_camx'),
      camy: gl.getUniformLocation(this.progBg, 'u_camy'),
      time: gl.getUniformLocation(this.progBg, 'u_time'),
      pulse: gl.getUniformLocation(this.progBg, 'u_pulse'),
      scale: gl.getUniformLocation(this.progBg, 'u_scale'),
    };
  }

  _initBuffers() {
    const gl = this.gl;

    // solid batch: 6 verts/quad * 6 floats (x,y,r,g,b,a)
    this.solidData = new Float32Array(MAX_QUADS * 6 * 6);
    this.solidCount = 0;   // floats written
    this.solidBuf = gl.createBuffer();

    // glow batch: 6 verts/quad * 8 floats (x,y,u,v,r,g,b,a)
    this.glowData = new Float32Array(MAX_QUADS * 6 * 8);
    this.glowCount = 0;
    this.glowBuf = gl.createBuffer();

    // fullscreen triangle for the background shader
    this.bgBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.baseScale = h / CONFIG.VIEW_H;          // px per world unit at zoom 1
    this.scale = this.baseScale * (this.zoom || 1);
    this.viewW = w / this.scale;                 // world units visible horizontally
    this.dpr = dpr;
  }

  /* ------------------------------------------------ frame ---- */

  /** Start a frame. cam = {x, y} world coords of the viewport bottom-left.
   *  `zoom` (used by the level editor) scales the whole view around cam. */
  begin(cam, zoom = 1) {
    this.cam = cam;
    this.zoom = zoom;
    this.scale = this.baseScale * zoom;
    this.viewW = this.canvas.width / this.scale;
    this.solidCount = 0;
    this.glowCount = 0;
    this.alphaMul = 1;   // global alpha multiplier (alpha-trigger group fades)
  }

  drawBackground(theme, camX, camY, time, pulse) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.useProgram(this.progBg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuf);
    gl.enableVertexAttribArray(this.bgLoc.pos);
    gl.vertexAttribPointer(this.bgLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.bgLoc.res, this.canvas.width, this.canvas.height);
    gl.uniform3fv(this.bgLoc.c1, theme.bg1);
    gl.uniform3fv(this.bgLoc.c2, theme.bg2);
    gl.uniform3fv(this.bgLoc.accent, theme.accent);
    gl.uniform1f(this.bgLoc.camx, camX);
    gl.uniform1f(this.bgLoc.camy, camY);
    gl.uniform1f(this.bgLoc.time, time);
    gl.uniform1f(this.bgLoc.pulse, pulse);
    gl.uniform1f(this.bgLoc.scale, this.scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ------------------------------------------------ shape pushers ---- */

  /** Axis-aligned or rotated rect. (x,y) = bottom-left, rot in radians.
   *  Rotation pivots around the rect center unless (px, py) is given —
   *  the pivot lets composed shapes (e.g. the player's face) spin as one. */
  quad(x, y, w, h, color, alpha = 1, rot = 0, px = null, py = null) {
    if (this.solidCount + 36 > this.solidData.length) this._flushSolid();
    const d = this.solidData;
    let i = this.solidCount;
    const [r, g, b] = color;
    alpha *= this.alphaMul;
    let x0, y0, x1, y1, x2, y2, x3, y3;
    if (rot === 0) {
      x0 = x;      y0 = y;
      x1 = x + w;  y1 = y;
      x2 = x + w;  y2 = y + h;
      x3 = x;      y3 = y + h;
    } else {
      const cx = px === null ? x + w / 2 : px;
      const cy = py === null ? y + h / 2 : py;
      const c = Math.cos(rot), s = Math.sin(rot);
      const rot2 = (vx, vy) => [cx + (vx - cx) * c - (vy - cy) * s,
                                cy + (vx - cx) * s + (vy - cy) * c];
      [x0, y0] = rot2(x, y);
      [x1, y1] = rot2(x + w, y);
      [x2, y2] = rot2(x + w, y + h);
      [x3, y3] = rot2(x, y + h);
    }
    // two triangles: 0-1-2, 0-2-3
    const verts = [x0, y0, x1, y1, x2, y2, x0, y0, x2, y2, x3, y3];
    for (let v = 0; v < 12; v += 2) {
      d[i++] = verts[v]; d[i++] = verts[v + 1];
      d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = alpha;
    }
    this.solidCount = i;
  }

  /** Arbitrary triangle. */
  tri(x1, y1, x2, y2, x3, y3, color, alpha = 1) {
    if (this.solidCount + 18 > this.solidData.length) this._flushSolid();
    const d = this.solidData;
    let i = this.solidCount;
    const [r, g, b] = color;
    alpha *= this.alphaMul;
    const verts = [x1, y1, x2, y2, x3, y3];
    for (let v = 0; v < 6; v += 2) {
      d[i++] = verts[v]; d[i++] = verts[v + 1];
      d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = alpha;
    }
    this.solidCount = i;
  }

  /** Filled circle approximated with a triangle fan. */
  circle(cx, cy, radius, color, alpha = 1, segs = 20) {
    let prevX = cx + radius, prevY = cy;
    for (let s = 1; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const nx = cx + Math.cos(a) * radius, ny = cy + Math.sin(a) * radius;
      this.tri(cx, cy, prevX, prevY, nx, ny, color, alpha);
      prevX = nx; prevY = ny;
    }
  }

  /** Additive glow sprite centered at (cx, cy). */
  glow(cx, cy, radius, color, intensity = 1) {
    if (this.glowCount + 48 > this.glowData.length) return; // drop, never crash
    const d = this.glowData;
    let i = this.glowCount;
    const [r, g, b] = color;
    intensity *= this.alphaMul;
    const x0 = cx - radius, y0 = cy - radius, x1 = cx + radius, y1 = cy + radius;
    // x, y, u, v per corner; uv spans -1..1
    const verts = [
      x0, y0, -1, -1,  x1, y0, 1, -1,  x1, y1, 1, 1,
      x0, y0, -1, -1,  x1, y1, 1, 1,  x0, y1, -1, 1,
    ];
    for (let v = 0; v < 24; v += 4) {
      d[i++] = verts[v]; d[i++] = verts[v + 1]; d[i++] = verts[v + 2]; d[i++] = verts[v + 3];
      d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = intensity;
    }
    this.glowCount = i;
  }

  /* ------------------------------------------------ flushes ---- */

  _flushSolid() {
    if (this.solidCount === 0) return;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied alpha
    gl.useProgram(this.progSolid);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.solidData.subarray(0, this.solidCount), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.solidLoc.pos);
    gl.enableVertexAttribArray(this.solidLoc.color);
    gl.vertexAttribPointer(this.solidLoc.pos, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.solidLoc.color, 4, gl.FLOAT, false, 24, 8);
    gl.uniform2f(this.solidLoc.cam, this.cam.x, this.cam.y);
    gl.uniform2f(this.solidLoc.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.solidLoc.scale, this.scale);
    gl.drawArrays(gl.TRIANGLES, 0, this.solidCount / 6);
    this.solidCount = 0;
  }

  _flushGlow() {
    if (this.glowCount === 0) return;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);                   // additive
    gl.useProgram(this.progGlow);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.glowData.subarray(0, this.glowCount), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.glowLoc.pos);
    gl.enableVertexAttribArray(this.glowLoc.uv);
    gl.enableVertexAttribArray(this.glowLoc.color);
    gl.vertexAttribPointer(this.glowLoc.pos, 2, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(this.glowLoc.uv, 2, gl.FLOAT, false, 32, 8);
    gl.vertexAttribPointer(this.glowLoc.color, 4, gl.FLOAT, false, 32, 16);
    gl.uniform2f(this.glowLoc.cam, this.cam.x, this.cam.y);
    gl.uniform2f(this.glowLoc.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.glowLoc.scale, this.scale);
    gl.drawArrays(gl.TRIANGLES, 0, this.glowCount / 8);
    this.glowCount = 0;
  }

  /** Flush whatever has been pushed since the last flush. The game calls
   *  this in layer order: halos → solids → particles. */
  flushGlowLayer() { this._flushGlow(); }
  flushSolidLayer() { this._flushSolid(); }
}
