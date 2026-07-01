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

// ── Tunables ──────────────────────────────────────────────────────────────────

export const GRID                 = 4;    // cell size: pieces are GRID×GRID footprint, GRID tall
export const WALL_THICKNESS       = 1;    // wall depth along its thin axis
export const RAMP_STEPS           = 16;   // stair-step count approximating a smooth ramp
export const MAX_PIECES_PER_PLAYER = 20;
export const BUILD_REACH          = 10;   // max placement/removal distance (metres)

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

// ── Geometry (used by both the physics collider and, for walls, the client mesh) ─

/** Wall AABB — a single box, oriented by `orient`. */
export function wallBox(piece) {
  const w = piece.orient === 'x' ? GRID : WALL_THICKNESS;
  const d = piece.orient === 'x' ? WALL_THICKNESS : GRID;
  return { x: piece.gx, y: piece.gy + GRID / 2, z: piece.gz, w, h: GRID, d };
}

/**
 * Ramp collision — approximated as a staircase of thin boxes (a standard trick
 * for AABB-only physics engines: each step is short enough that the vertical
 * overlap resolution in moveAndCollide reads it as "ground", so walking up
 * feels like a smooth ramp). Purely a collision aid; the client renders a
 * single smooth wedge mesh on top of it.
 */
export function rampStepBoxes(piece) {
  const { gx, gy, gz, dir } = piece;
  const axis = (dir === 0 || dir === 2) ? 'z' : 'x';
  const sign = (dir === 0 || dir === 1) ? 1 : -1;
  const stepSize = GRID / RAMP_STEPS;
  const boxes = [];

  for (let i = 0; i < RAMP_STEPS; i++) {
    const height = (i + 1) * stepSize;
    if (axis === 'z') {
      const lowEdge = gz - sign * (GRID / 2);
      const centreZ = lowEdge + sign * ((i + 0.5) * stepSize);
      boxes.push({ x: gx, y: gy + height / 2, z: centreZ, w: GRID, h: height, d: stepSize });
    } else {
      const lowEdge = gx - sign * (GRID / 2);
      const centreX = lowEdge + sign * ((i + 0.5) * stepSize);
      boxes.push({ x: centreX, y: gy + height / 2, z: gz, w: stepSize, h: height, d: GRID });
    }
  }
  return boxes;
}

export function pieceBoxes(piece) {
  return piece.type === 'ramp' ? rampStepBoxes(piece) : [wallBox(piece)];
}

/** All collidable boxes from every currently-registered piece (both sides call this). */
export function getPieceBoxes() {
  const out = [];
  for (const piece of pieces.values()) out.push(...pieceBoxes(piece));
  return out;
}

// World-space unit vector for each ramp `dir` (0=+z,1=+x,2=-z,3=-x).
export const RAMP_DIR_VECTOR = [
  { x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 },
];

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
