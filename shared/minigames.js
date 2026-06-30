// Shared minigame logic — runs on server (authoritative) and client (predicted).

import { JUMP_PADS } from './constants.js';

/**
 * If the (grounded) player is standing on a bounce pad, return the launch
 * velocity; otherwise return the player's current vy unchanged.
 * @param {{x,y,z,vy,onGround}} s
 * @returns {number} new vy
 */
export function jumpPadVelocity(s) {
  if (!s.onGround) return s.vy;
  for (const p of JUMP_PADS) {
    const dx = s.x - p.x, dz = s.z - p.z;
    if (dx*dx + dz*dz < p.r * p.r && s.y < p.top + 0.6) {
      return p.power;
    }
  }
  return s.vy;
}
