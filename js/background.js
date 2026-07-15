/**
 * background.js — layered parallax scenery drawn behind the level.
 *
 * Layer 0: shader gradient + neon grid + horizon (renderer.drawBackground)
 * Layer 1: far tower silhouettes  (parallax factor 0.25)
 * Layer 2: near tower silhouettes (parallax factor 0.5)
 * Layer 3: ground slab, glowing ground line, beat-synced chevrons
 * Also draws the finish-line beam at the end of the level.
 *
 * All decoration is derived from hash01(index) so it is fully deterministic
 * — no flicker, no allocation, infinite scrolling.
 */
import { hash01, mixColor } from './utils.js';
import { CONFIG } from './config.js';

const TOWER_SPACING = 7;

function drawTowerLayer(r, cam, theme, factor, heightScale, alpha, seedOffset) {
  const viewW = r.viewW;
  // world-x where towers of this layer appear on screen:
  // tower i lives at parallax position i*spacing; convert to world space
  const offset = cam.x * (1 - factor);
  const first = Math.floor((cam.x - offset) / TOWER_SPACING) - 1;
  const count = Math.ceil(viewW / TOWER_SPACING) + 3;
  const col = mixColor(theme.bg2, theme.accent, 0.16);

  for (let i = first; i < first + count; i++) {
    const h1 = hash01(i * 3.1 + seedOffset);
    const h2 = hash01(i * 7.7 + seedOffset + 13);
    const w = 2.5 + h1 * 3;
    const h = (2 + h2 * 6) * heightScale;
    const wx = i * TOWER_SPACING + h1 * 2.4 + offset;
    r.quad(wx, cam.y - 1, w, (0 - (cam.y - 1)) + h, col, alpha);
    // antenna glow on some towers
    if (h2 > 0.6) r.glow(wx + w / 2, h + 0.3, 0.5, theme.accent, 0.25 * alpha * 4);
  }
}

export function drawBackgroundLayers(r, cam, theme, time, pulse) {
  // shader layer (gradient / grid / horizon)
  r.drawBackground(theme, cam.x, cam.y, time, pulse);

  // silhouettes — pushed to the solid batch, flushed by the caller
  drawTowerLayer(r, cam, theme, 0.25, 0.9, 0.4, 0);
  drawTowerLayer(r, cam, theme, 0.5, 1.25, 0.65, 500);
}

export function drawGround(r, cam, theme, time, pulse, levelLength) {
  const viewW = r.viewW;
  const x0 = cam.x - 1, x1 = cam.x + viewW + 1;

  // slab below the ground line
  r.quad(x0, cam.y - 2, viewW + 2, 0 - (cam.y - 2), theme.ground, 1);

  // glowing top line, breathing with the music
  r.glow((x0 + x1) / 2, 0, viewW * 0.6, theme.accent, 0.06 + pulse * 0.05);
  r.quad(x0, -0.08, viewW + 2, 0.1, theme.accent, 0.9);

  // beat-locked chevron markers sliding along the floor
  const spacing = 4;
  const firstMark = Math.floor(x0 / spacing) * spacing;
  for (let mx = firstMark; mx < x1; mx += spacing) {
    const twinkle = 0.12 + 0.18 * pulse;
    r.quad(mx, -0.55, 0.14, 0.4, theme.accent, twinkle);
  }

  // finish line: bright beam + checker column
  if (levelLength > 0 && levelLength < x1 + 4) {
    const fx = levelLength;
    r.glow(fx, CONFIG.VIEW_H / 2 + cam.y, 4, [1, 1, 1], 0.4 + pulse * 0.2);
    r.quad(fx - 0.08, cam.y - 1, 0.16, CONFIG.VIEW_H + 3, [1, 1, 1], 0.85);
    for (let i = 0; i < 22; i++) {
      const cy = cam.y - 1 + i * 0.6;
      const even = i % 2 === 0;
      r.quad(fx + 0.1, cy, 0.5, 0.6, even ? [1, 1, 1] : theme.accent2, even ? 0.8 : 0.55);
    }
  }
}
