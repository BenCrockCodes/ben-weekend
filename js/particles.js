/**
 * particles.js — pooled particle system rendered as additive glow sprites.
 *
 * Handles: death explosions, the player trail, coin sparkles, pad/ring
 * bursts and ambient portal shimmer. Everything shares one fixed pool so
 * the allocator never runs during gameplay.
 */
import { hash01, TAU } from './utils.js';

const POOL_SIZE = 512;

export class ParticleSystem {
  constructor() {
    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
                       size: 0.2, color: [1, 1, 1], grav: 0, drag: 1, shrink: true });
    }
    this.cursor = 0;
  }

  _spawn(props) {
    // ring-buffer allocation: oldest particle gets recycled under pressure
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    Object.assign(p, { alive: true, grav: 0, drag: 1, shrink: true }, props, { life: props.maxLife });
    return p;
  }

  clear() { for (const p of this.pool) p.alive = false; }

  /** Death explosion — a shower of shards in the player's colors. */
  explosion(x, y, color, count = 36) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + hash01(i) * 0.6;
      const speed = 6 + hash01(i * 3.7) * 14;
      this._spawn({
        x, y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        maxLife: 0.5 + hash01(i * 1.3) * 0.5,
        size: 0.25 + hash01(i * 2.1) * 0.35,
        color, grav: 28, drag: 0.92,
      });
    }
    // bright core flash
    this._spawn({ x, y, vx: 0, vy: 0, maxLife: 0.22, size: 2.6, color: [1, 1, 1], drag: 1 });
  }

  /** Small streak behind the moving cube. */
  trail(x, y, color) {
    this._spawn({
      x: x + (hash01(this.cursor) - 0.5) * 0.15,
      y: y + (hash01(this.cursor * 7) - 0.5) * 0.15,
      vx: -2 - hash01(this.cursor * 3) * 2, vy: (hash01(this.cursor * 5) - 0.5) * 1.5,
      maxLife: 0.35, size: 0.32, color, drag: 0.9,
    });
  }

  /** Sparkle burst for coins / rings / pads. */
  burst(x, y, color, count = 14, speed = 7) {
    for (let i = 0; i < count; i++) {
      const a = hash01(i * 9.2 + this.cursor) * TAU;
      const v = speed * (0.4 + hash01(i * 4.4) * 0.8);
      this._spawn({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        maxLife: 0.4 + hash01(i) * 0.3, size: 0.2 + hash01(i * 6) * 0.18,
        color, drag: 0.9, grav: 4,
      });
    }
  }

  /** Gentle upward shimmer used by portals. */
  shimmer(x, y, color) {
    this._spawn({
      x: x + (hash01(this.cursor * 11) - 0.5) * 1.2, y,
      vx: 0, vy: 1.5 + hash01(this.cursor * 5) * 2,
      maxLife: 0.8, size: 0.18, color, drag: 1,
    });
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vy -= p.grav * dt;
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render(renderer) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;                    // 1 → 0
      const size = p.shrink ? p.size * (0.3 + 0.7 * t) : p.size;
      renderer.glow(p.x, p.y, size * 2.2, p.color, t * 0.9);
    }
  }
}
