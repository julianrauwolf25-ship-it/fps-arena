// Shared parkour logic — runs identically on server (authoritative) and client
// (prediction) so both agree on checkpoints and void-respawns.

import { CHECKPOINTS, PARKOUR_START, VOID_Y, ARENA_HALF } from './constants.js';

const CP_RADIUS2 = 2.25; // 1.5 m horizontal capture radius (squared)

/**
 * @param {{x,y,z,vx,vy,vz}} s  current physics state
 * @param {object|null} cp      the player's current checkpoint (or null)
 * @returns {{ x,y,z,vx,vy,vz, cp, newCheckpoint, respawned }}
 */
export function applyParkour(s, cp) {
  let { x, y, z, vx, vy, vz } = s;
  let newCheckpoint = false;
  let respawned     = false;

  if (x > ARENA_HALF) {
    // In the parkour zone — check for checkpoint capture
    for (const c of CHECKPOINTS) {
      const dx = x - c.x, dz = z - c.z;
      if (dx*dx + dz*dz < CP_RADIUS2 && Math.abs(y - c.y) < 2.5) {
        if (cp !== c) { cp = c; newCheckpoint = true; }
      }
    }
    // Fell into the void → respawn at last checkpoint (or the start)
    if (y < VOID_Y) {
      const t = cp || PARKOUR_START;
      x = t.x; y = t.y + 0.2; z = t.z;
      vx = 0; vy = 0; vz = 0;
      respawned = true;
    }
  } else {
    // Back in the arena → forget parkour progress so a fresh run starts clean
    cp = null;
  }

  return { x, y, z, vx, vy, vz, cp, newCheckpoint, respawned };
}
