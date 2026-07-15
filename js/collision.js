/**
 * collision.js — geometric collision predicates for the physics step.
 *
 * The philosophy (borrowed from classic rhythm platformers):
 *  - solid blocks are generous to LAND on (snap tolerance) but lethal
 *    from the side;
 *  - hazards use hitboxes noticeably smaller than their artwork, so every
 *    death feels earned.
 */
import { CONFIG } from './config.js';
import { aabb, circleBox } from './utils.js';

const SHRINK = CONFIG.PLAYER.HITBOX_SHRINK;

/** Full-size player box — used for landings, pads, portals. */
export function playerBox(player) {
  return { x: player.x, y: player.y, w: player.size, h: player.size };
}

/** Shrunk player box — used for lethal checks (fairness margin). */
export function playerHurtBox(player) {
  const s = player.size * SHRINK;
  return { x: player.x + s, y: player.y + s,
           w: player.size - s * 2, h: player.size - s * 2 };
}

/**
 * Try to resolve the player against one solid block.
 * Returns 'land' (position was snapped), 'die', or null (no contact).
 * `dir` is the gravity direction: 1 = normal (floor is down).
 */
export function resolveSolid(player, solid, dir) {
  const pb = playerBox(player);
  if (!aabb(pb, solid)) return null;

  if (dir === 1 && player.vy <= 0) {
    // falling onto the block top?
    const pen = (solid.y + solid.h) - player.y;
    if (pen >= 0 && pen <= CONFIG.PHYS.SNAP_TOL) {
      player.y = solid.y + solid.h;
      return 'land';
    }
  } else if (dir === -1 && player.vy >= 0) {
    // gravity flipped: "falling" up onto the block underside?
    const pen = (player.y + player.size) - solid.y;
    if (pen >= 0 && pen <= CONFIG.PHYS.SNAP_TOL) {
      player.y = solid.y - player.size;
      return 'land';
    }
  }

  // Not a clean landing — only lethal if the *shrunk* box still overlaps
  // (stops pixel-perfect corner clips from feeling unfair).
  return aabb(playerHurtBox(player), solid) ? 'die' : null;
}

/**
 * One-way platform: only supports the player from the gravity side.
 * Returns 'land' or null. Needs the player's y before this substep so a
 * platform can't "catch" a player who was already inside it.
 */
export function resolvePlatform(player, plat, dir, prevY) {
  const pb = playerBox(player);
  if (!aabb(pb, plat)) return null;

  if (dir === 1 && player.vy <= 0 && prevY >= plat.y + plat.h - 0.02) {
    player.y = plat.y + plat.h;
    return 'land';
  }
  if (dir === -1 && player.vy >= 0 && prevY + player.size <= plat.y + 0.02) {
    player.y = plat.y - player.size;
    return 'land';
  }
  return null;   // passing through from below/side is fine
}

/**
 * Ship vs solid block: unlike the cube, the ship SLIDES along both block
 * tops (moving down) and block undersides (moving up) regardless of gravity
 * direction — only side clips are lethal. Returns 'floor', 'ceil', 'die'
 * or null.
 */
export function resolveSolidShip(player, solid) {
  const pb = playerBox(player);
  if (!aabb(pb, solid)) return null;

  if (player.vy <= 0) {
    const pen = (solid.y + solid.h) - player.y;
    if (pen >= 0 && pen <= CONFIG.PHYS.SNAP_TOL) {
      player.y = solid.y + solid.h;
      return 'floor';
    }
  }
  if (player.vy >= 0) {
    const pen = (player.y + player.size) - solid.y;
    if (pen >= 0 && pen <= CONFIG.PHYS.SNAP_TOL) {
      player.y = solid.y - player.size;
      return 'ceil';
    }
  }
  return aabb(playerHurtBox(player), solid) ? 'die' : null;
}

/** Does the player touch this hazard (spike box or saw circle)? */
export function hitsHazard(player, hz) {
  const hb = playerHurtBox(player);
  if (hz.type === 'saw') return circleBox(hz.cx, hz.cy, hz.hitR, hb);
  return aabb(hb, hz.box);
}

export { aabb, circleBox };
