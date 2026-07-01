// build.js — shared building system for the "Build Battle" mini-game
// (Fortnite-style wall + ramp placement). Imported identically by the server
// (authoritative placement) and the client (local physics prediction + visuals),
// exactly like shared/constants.js's MAP_BOXES.
//
// IMPORTANT: each JS runtime (the Node server, and each browser tab) holds its
// OWN copy of the `pieces` Map below — there is no shared memory. The server is
// authoritative: whenever it changes the piece list it broadcasts the full list
// (see BuildBattle.js), and the client mirrors it into ITS OWN copy of this
// module via registerPiece/clearPieces so that shared/collision.js — which both
// sides call independently — resolves movement against the same geometry.
//
// Ramps are walkable via an ANALYTIC slope (see rampWalkHeight/applyRampWalk),
// not stacked stair-boxes: with the player's collision radius (0.4) larger than
// a workably-thin stair tread, a staircase approximation caused jittery/blocked
// climbing. A true sloped "floor height" function is exact and jitter-free, and
// is exactly what "die Rampe hochlaufen können" needs.

// ── Tunables ──────────────────────────────────────────────────────────────────

export const GRID                  = 4;    // cell size: pieces are GRID×GRID footprint, GRID tall
export const WALL_THICKNESS        = 1;    // wall depth along its thin axis
export const MAX_PIECES_PER_PLAYER = 20;
export const BUILD_REACH           = 12;   // max distance for raycast-snapped placement/removal
export const FORWARD_DISTANCE      = GRID; // fallback placement distance when aiming at open air

// A dedicated flat zone in the minigame plaza, well clear of the shooting range,
// bounce pads, and the hub's mode-selection signs (see MiniGames.js ROW_X/ROW_Z).
export const BUILD_ARENA = { minX: -90, maxX: -30, minZ: -33, maxZ: -18 };

export const BUILD_SPAWNS = [
  { x: -85, y: 1, z: -26 },
  { x: -70, y: 1, z: -26 },
  { x: -55, y: 1, z: -26 },
  { x: -40, y: 1, z: -26 },
];

// ── Dynamic piece registry ────────────────────────────────────────────────────
// A piece: { id, ownerId, type: 'wall'|'ramp', gx, gy, gz, orient, dir }
//   gx/gy/gz  — world position, already snapped to GRID (piece "cell" origin)
//   orient    — wall only: 'x' (spans along X, thin in Z) or 'z' (spans along Z, thin in X)
//   dir       — ramp only: 0=+z, 1=+x, 2=-z, 3=-x ascend direction

export const pieces = new Map();          // id → piece
const occupied = new Map();               // "gx|gy|gz" → piece id (one piece per cell)

export function cellKey(gx, gy, gz) { return `${gx}|${gy}|${gz}`; }

export function isCellOccupied(gx, gy, gz) { return occupied.has(cellKey(gx, gy, gz)); }

export function registerPiece(piece) {
  pieces.set(piece.id, piece);
  occupied.set(cellKey(piece.gx, piece.gy, piece.gz), piece.id);
}

export function removePieceById(id) {
  const piece = pieces.get(id);
  if (!piece) return null;
  pieces.delete(id);
  occupied.delete(cellKey(piece.gx, piece.gy, piece.gz));
  return piece;
}

export function clearPieces() {
  pieces.clear();
  occupied.clear();
}

export function getPiecesArray() { return [...pieces.values()]; }

// ── Wall geometry (real AABB collision + client mesh) ────────────────────────

/** Wall AABB — a single box, oriented by `orient`. */
export function wallBox(piece) {
  const w = piece.orient === 'x' ? GRID : WALL_THICKNESS;
  const d = piece.orient === 'x' ? WALL_THICKNESS : GRID;
  return { x: piece.gx, y: piece.gy + GRID / 2, z: piece.gz, w, h: GRID, d };
}

/** All collidable boxes from every registered WALL (movement collision). Ramps
 *  are excluded here — they're walked via applyRampWalk's analytic slope instead. */
export function getPieceBoxes() {
  const out = [];
  for (const piece of pieces.values()) if (piece.type === 'wall') out.push(wallBox(piece));
  return out;
}

/** A full GRID³ bounding box for a piece — used only for aim-raycasting
 *  (placement/removal targeting), never for movement collision. */
export function pieceAimBox(piece) {
  return piece.type === 'wall'
    ? wallBox(piece)
    : { x: piece.gx, y: piece.gy + GRID / 2, z: piece.gz, w: GRID, h: GRID, d: GRID };
}

// ── Ramp geometry: analytic slope, walked exactly like the floor ─────────────
// World-space unit vector for each ramp `dir` (0=+z,1=+x,2=-z,3=-x) = the
// direction height INCREASES toward.
export const RAMP_DIR_VECTOR = [
  { x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 },
];

/**
 * If (x, z) is inside this ramp's footprint, return the walkable surface
 * height there (linear 0..GRID along the ascend axis); otherwise null.
 */
function rampHeightInPiece(piece, x, z) {
  const half = GRID / 2;
  if (x < piece.gx - half || x > piece.gx + half || z < piece.gz - half || z > piece.gz + half) return null;
  const v = RAMP_DIR_VECTOR[piece.dir];
  // Position along the ascend axis, 0 at the low edge, 1 at the high edge.
  const t = v.x !== 0
    ? ((x - (piece.gx - v.x * half)) / (v.x * GRID))
    : ((z - (piece.gz - v.z * half)) / (v.z * GRID));
  const clamped = Math.max(0, Math.min(1, t));
  return piece.gy + clamped * GRID;
}

/** Highest ramp surface at (x, z) across all registered ramps, or null. */
export function rampWalkHeight(x, z) {
  let best = null;
  for (const piece of pieces.values()) {
    if (piece.type !== 'ramp') continue;
    const h = rampHeightInPiece(piece, x, z);
    if (h !== null && (best === null || h > best)) best = h;
  }
  return best;
}

/**
 * Apply ramp walking to a physics state, exactly like the flat-floor clamp in
 * shared/collision.js: if the analytic ramp surface at (x,z) is at or above
 * the player's current feet height, stand on it (grounded, vy stops falling).
 * Call this AFTER moveAndCollide each tick (same pattern as jumpPadVelocity).
 * Returns the adjusted { y, vy, onGround }, or null if no ramp is underfoot.
 */
export function applyRampWalk(x, y, z, vy, onGround) {
  const h = rampWalkHeight(x, z);
  if (h === null) return null;
  if (y <= h) return { y: h, vy: vy < 0 ? 0 : vy, onGround: true };
  return null; // above the ramp surface (e.g. jumping over it) — leave physics alone
}

// ── Placement helpers ─────────────────────────────────────────────────────────

/** Snap a raw hit point to the piece grid (world coords, GRID-aligned). */
export function snapToGrid(x, y, z) {
  return {
    gx: Math.round(x / GRID) * GRID,
    gy: Math.max(0, Math.round(y / GRID) * GRID),
    gz: Math.round(z / GRID) * GRID,
  };
}

export function inBuildArena(gx, gz) {
  return gx >= BUILD_ARENA.minX && gx <= BUILD_ARENA.maxX
      && gz >= BUILD_ARENA.minZ && gz <= BUILD_ARENA.maxZ;
}

/** Wall orientation / ramp direction from a flattened aim vector (fx, fz). */
export function orientFromAim(fx, fz) {
  return Math.abs(fx) > Math.abs(fz) ? 'z' : 'x';   // wall spans perpendicular to the aim
}
export function rampDirFromAim(fx, fz) {
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
  return fz > 0 ? 0 : 2;
}
