/**
 * camera.js — side-scrolling camera.
 *
 * Rules (per design spec):
 *  - x scrolls with the player and NEVER moves backwards;
 *  - the player sits one third from the left edge;
 *  - y follows the player smoothly with a floor so the ground line stays put;
 *  - supports a decaying shake offset for deaths.
 */
import { CONFIG } from './config.js';
import { damp, clamp, hash01 } from './utils.js';

export class Camera {
  constructor(renderer) {
    this.renderer = renderer;
    this.reset(0);
  }

  reset(playerX) {
    this.x = playerX - this.renderer.viewW * CONFIG.CAM_PLAYER_X;
    this.y = CONFIG.CAM_Y_MIN;
    this.shakeT = 0;
    this.shakeSeed = 0;
    this.ox = 0; this.oy = 0;   // shake offsets applied at render time
  }

  shake() {
    this.shakeT = CONFIG.SHAKE_TIME;
    this.shakeSeed = Math.random() * 1000;
  }

  /**
   * `maxX` clamps the camera's LEFT edge so its right edge stops exactly at
   * the level's end wall (Geometry Dash behaviour): the view halts while the
   * player keeps travelling the last stretch to the wall.
   */
  update(player, dt, shakeEnabled, maxX = Infinity) {
    // horizontal: hard-locked to the player, monotonic (never backwards)
    const targetX = Math.min(player.x - this.renderer.viewW * CONFIG.CAM_PLAYER_X, maxX);
    if (targetX > this.x) this.x = targetX;

    // vertical: smooth follow, clamped so we don't dive below the ground
    const targetY = clamp(player.y + player.size / 2 - CONFIG.VIEW_H * 0.42,
                          CONFIG.CAM_Y_MIN, 40);
    this.y = damp(this.y, targetY, CONFIG.CAM_Y_LERP, dt);

    // shake decay
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / CONFIG.SHAKE_TIME);
      const mag = CONFIG.SHAKE_MAG * k * k * (shakeEnabled ? 1 : 0);
      const t = (CONFIG.SHAKE_TIME - this.shakeT) * 40;
      this.ox = (hash01(this.shakeSeed + Math.floor(t)) * 2 - 1) * mag;
      this.oy = (hash01(this.shakeSeed + Math.floor(t) + 57) * 2 - 1) * mag;
    } else {
      this.ox = 0; this.oy = 0;
    }
  }

  /** Position handed to the renderer (includes shake). */
  get renderPos() { return { x: this.x + this.ox, y: this.y + this.oy }; }
}
