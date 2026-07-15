/**
 * config.js — central tuning constants for NEOVOLT.
 *
 * All gameplay distances are measured in world "blocks" (the player cube is
 * exactly 1x1 blocks, like classic rhythm platformers). Speeds are blocks/sec.
 * Levels place obstacles on a 4-block beat grid, so `speed = bpm / 15`
 * keeps the action locked to the music.
 */
export const CONFIG = {
  /* ---- physics ---- */
  PHYS: {
    STEP: 1 / 240,          // fixed physics timestep (s) — identical feel at any fps
    MAX_FRAME: 0.25,        // clamp for tab-switch spikes (s)
    GRAVITY: 94,            // blocks/s^2
    JUMP_V: 20.8,           // initial jump velocity (blocks/s) → apex ≈ 2.3 blocks
    PAD_V: 27.5,            // yellow jump-pad launch velocity → apex ≈ 4 blocks
    RING_V: 20.8,           // yellow jump-ring velocity (same as a normal jump)
    MAX_FALL: 34,           // terminal velocity (blocks/s)
    SNAP_TOL: 0.5,          // max penetration that still counts as a clean landing
    ROT_SPEED: 420,         // airborne spin (deg/s)
  },

  /* ---- ship gamemode ---- */
  SHIP: {
    ACC: 45,                // vertical acceleration, both thrust and fall (blocks/s^2)
    MAX_V: 13,              // vertical speed cap (blocks/s)
    TILT: 2.8,              // degrees of visual tilt per unit of vy
    TILT_MAX: 42,           // tilt clamp (deg)
    ENTER_V_CAP: 8,         // |vy| cap when passing through a mode portal
  },

  /* ---- player ---- */
  PLAYER: {
    SIZE: 1,                // cube edge length (blocks)
    MINI_SIZE: 0.6,         // size after a mini portal
    SPAWN_X: -14,           // run-up before the level content starts
    HITBOX_SHRINK: 0.12,    // hazard checks use a slightly smaller box (fairness)
  },

  /* ---- camera / view ---- */
  VIEW_H: 10.5,             // vertical world units visible on screen
  CAM_PLAYER_X: 1 / 3,      // player sits one third from the left edge
  CAM_Y_LERP: 6,            // vertical follow smoothing (higher = snappier)
  CAM_Y_MIN: -1.6,          // camera floor (keeps ground line comfortably low)

  /* ---- gameplay flow ---- */
  DEATH_FREEZE: 0.08,       // gameplay freeze on impact (s)
  DEATH_RESTART: 1.0,       // delay before auto-restart (s)
  SHAKE_TIME: 0.45,         // camera shake duration on death (s)
  SHAKE_MAG: 0.45,          // camera shake magnitude (blocks)
  VICTORY_DELAY: 0.9,       // pause before the victory screen (s)

  /* ---- object hitboxes (all centered on the object's cell) ---- */
  HITBOX: {
    SPIKE_W: 0.38, SPIKE_H: 0.6,   // forgiving inner box, GD-style
    SAW_R: 0.82,                    // fraction of the saw's visual radius
    COIN_R: 0.75,                   // pickup radius
    PORTAL_W: 1.1, PORTAL_H: 3.0,
    PAD_W: 0.9, PAD_H: 0.4,
    RING_R: 1.0,
  },

  /* ---- speed portal multipliers ---- */
  SPEEDS: { slow: 0.81, normal: 1.0, fast: 1.27 },

  LEVEL_LIST: ['level1', 'level2', 'level3', 'level4', 'level5'],   // unlock order
  SAVE_KEY: 'neovolt.save.v1',
};
