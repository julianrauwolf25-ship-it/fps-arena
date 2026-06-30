// Shared AABB collision — imported by both server (Node) and client (Vite).
// Resolves player cylinder (approximated as AABB) against static MAP_BOXES.

import { MAP_BOXES, PLAYER_RADIUS, PLAYER_HEIGHT, ARENA_HALF, MINIGAME_FLOOR } from './constants.js';

const PR = PLAYER_RADIUS;
const PH = PLAYER_HEIGHT;

// The solid ground plane (y=0) exists inside the arena footprint AND the
// minigame plaza (west of the arena). Outside those — the parkour zone east of
// the arena — there is no floor: you fall into the void and respawn at a
// checkpoint. Players stand on parkour blocks via box collision, not this plane.
function onArenaFloor(px, pz) {
  if (px <= ARENA_HALF && px >= -ARENA_HALF && pz <= ARENA_HALF && pz >= -ARENA_HALF) return true;
  const m = MINIGAME_FLOOR;
  return px >= m.minX && px <= m.maxX && pz >= m.minZ && pz <= m.maxZ;
}

/**
 * Move player by (dx, dy, dz), then resolve penetration with every map box.
 * Returns the corrected position and vertical velocity.
 * @param {number} px  player x (feet centre)
 * @param {number} py  player y (feet bottom)
 * @param {number} pz  player z (feet centre)
 * @param {number} vx  horizontal velocity x
 * @param {number} vy  vertical velocity
 * @param {number} vz  horizontal velocity z
 * @param {number} dt  delta time seconds
 * @param {boolean} onGround
 * @returns {{ px, py, pz, vx, vy, vz, onGround }}
 */
export function moveAndCollide(px, py, pz, vx, vy, vz, dt, onGround) {
  // Integrate
  px += vx * dt;
  py += vy * dt;
  pz += vz * dt;

  // Floor (arena only)
  if (py <= 0 && onArenaFloor(px, pz)) { py = 0; if (vy < 0) vy = 0; onGround = true; }

  // Run 3 resolution passes for stability with multi-box corners
  for (let pass = 0; pass < 3; pass++) {
    for (const b of MAP_BOXES) {
      const hw = b.w * 0.5, hh = b.h * 0.5, hd = b.d * 0.5;

      // Compute overlap on each axis (positive = penetrating)
      const ox = Math.min(px + PR - (b.x - hw), (b.x + hw) - (px - PR));
      const oy = Math.min(py + PH - (b.y - hh), (b.y + hh) - py);
      const oz = Math.min(pz + PR - (b.z - hd), (b.z + hd) - (pz - PR));

      if (ox <= 0 || oy <= 0 || oz <= 0) continue; // no penetration

      // Resolve along the axis with smallest overlap (minimum separating vector)
      if (oy < ox && oy < oz) {
        // Vertical
        const playerMidY = py + PH * 0.5;
        if (playerMidY > b.y) {
          // Player above box → land on top
          py = b.y + hh;
          if (vy < 0) { vy = 0; onGround = true; }
        } else {
          // Player below box → hit ceiling
          py = b.y - hh - PH;
          if (vy > 0) vy = 0;
        }
      } else if (ox < oz) {
        // X-axis push
        if (px < b.x) px = b.x - hw - PR;
        else           px = b.x + hw + PR;
        vx = 0;
      } else {
        // Z-axis push
        if (pz < b.z) pz = b.z - hd - PR;
        else           pz = b.z + hd + PR;
        vz = 0;
      }
    }
  }

  // Re-check floor after box resolution (arena only)
  if (py <= 0 && onArenaFloor(px, pz)) { py = 0; if (vy < 0) vy = 0; onGround = true; }

  return { px, py, pz, vx, vy, vz, onGround };
}
