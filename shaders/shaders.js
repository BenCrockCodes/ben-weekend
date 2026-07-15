/**
 * shaders/shaders.js — all GLSL sources for the engine.
 *
 * Kept as exported template strings (rather than fetched .glsl files) so the
 * game boots with zero extra network round-trips; the module still lives in
 * /shaders to keep rendering code and shading code separated.
 *
 * All programs are WebGL1-compatible (GLSL ES 1.00) for Safari support.
 */

/* ---------- solid geometry: world-space colored triangles ---------- */
export const SOLID_VS = `
attribute vec2 a_pos;      // world-space position (blocks)
attribute vec4 a_color;
uniform vec2 u_cam;        // world coords of the viewport's bottom-left corner
uniform vec2 u_res;        // canvas size in px
uniform float u_scale;     // px per world unit
varying vec4 v_color;
void main() {
  vec2 px = (a_pos - u_cam) * u_scale;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}`;

export const SOLID_FS = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = vec4(v_color.rgb * v_color.a, v_color.a); }`;

/* ---------- glow sprites: additive radial falloff quads ---------- */
export const GLOW_VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;       // -1..1 across the quad
attribute vec4 a_color;
uniform vec2 u_cam;
uniform vec2 u_res;
uniform float u_scale;
varying vec2 v_uv;
varying vec4 v_color;
void main() {
  vec2 px = (a_pos - u_cam) * u_scale;
  gl_Position = vec4(px / u_res * 2.0 - 1.0, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;

export const GLOW_FS = `
precision mediump float;
varying vec2 v_uv;
varying vec4 v_color;
void main() {
  float d = length(v_uv);
  // soft-bloom falloff: bright core, long feathered tail
  float fall = pow(max(0.0, 1.0 - d), 2.4);
  gl_FragColor = vec4(v_color.rgb * fall * v_color.a, 0.0); // additive
}`;

/* ---------- animated background: gradient + neon grid + horizon ---------- */
export const BG_VS = `
attribute vec2 a_pos;      // fullscreen clip-space triangle
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_pos * 0.5 + 0.5;
}`;

export const BG_FS = `
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform vec3 u_c1;         // deep base color (bottom)
uniform vec3 u_c2;         // upper gradient color
uniform vec3 u_accent;     // theme accent for grid / horizon glow
uniform float u_camx;      // camera world x — scrolls the grid
uniform float u_camy;
uniform float u_time;
uniform float u_pulse;     // 0..1 beat pulse from the music
uniform float u_scale;     // px per world unit

void main() {
  vec2 uv = v_uv;

  // vertical gradient with a slow breathing drift
  float g = uv.y + 0.06 * sin(u_time * 0.35 + uv.x * 3.0);
  vec3 col = mix(u_c1, u_c2, clamp(g, 0.0, 1.0));

  // world coordinates of this fragment (for parallax-locked grid lines)
  float wx = u_camx * 0.55 + uv.x * u_res.x / u_scale;
  float wy = u_camy * 0.55 + uv.y * u_res.y / u_scale;

  // large neon grid, pulsing with the beat
  vec2 cell = abs(fract(vec2(wx, wy) / 4.0) - 0.5);
  float line = smoothstep(0.5, 0.47, max(cell.x, cell.y));
  float gridA = 0.05 + 0.07 * u_pulse;
  col += u_accent * line * gridA * (0.35 + 0.65 * uv.y);

  // glowing horizon band ~ one third up the screen
  float horizon = exp(-abs(uv.y - 0.33) * 9.0);
  col += u_accent * horizon * (0.10 + 0.10 * u_pulse);

  // gentle vignette to focus the action
  float vig = smoothstep(1.25, 0.35, length(uv - vec2(0.5, 0.45)));
  col *= mix(0.72, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}`;
