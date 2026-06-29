// Shared between server and client — both import this file.

export const TICK_RATE    = 20;              // server ticks per second
export const TICK_MS      = 1000 / TICK_RATE;

// Player physics
export const PLAYER_SPEED      = 8;         // m/s walk
export const PLAYER_SPRINT     = 13;        // m/s sprint
export const PLAYER_JUMP       = 9;         // initial vertical velocity
export const GRAVITY           = -22;       // m/s²
export const PLAYER_HEIGHT     = 1.8;       // collision box height
export const PLAYER_RADIUS     = 0.4;       // collision box half-width
export const PLAYER_EYE_OFFSET = 1.6;       // eye height above feet

// Combat
export const MAX_HEALTH   = 100;
export const BULLET_DAMAGE = 25;
export const MAX_AMMO     = 30;
export const RELOAD_TIME  = 2000;           // ms
export const FIRE_RATE    = 150;            // ms between shots
export const RESPAWN_TIME = 3000;           // ms dead before respawn

// Rate limiting
export const MAX_MSG_PER_SECOND = 120;

// Arena
export const ARENA_HALF = 28;

// Spawn points (x, y=feet, z)
export const SPAWN_POINTS = [
  { x:  0, y: 1, z:  22 },
  { x:  0, y: 1, z: -22 },
  { x:  22, y: 1, z:  0 },
  { x: -22, y: 1, z:  0 },
  { x:  14, y: 1, z:  14 },
  { x: -14, y: 1, z: -14 },
  { x:  14, y: 1, z: -14 },
  { x: -14, y: 1, z:  14 },
];

// Static map boxes { x, y, z = center, w, h, d = full size }
export const MAP_BOXES = [
  // centre cover
  { x:  0,  y: 0.75, z:  0,  w: 3,  h: 1.5, d: 3 },
  // mid corridors
  { x:  8,  y: 0.5,  z:  0,  w: 2,  h: 1,   d: 8 },
  { x: -8,  y: 0.5,  z:  0,  w: 2,  h: 1,   d: 8 },
  { x:  0,  y: 0.5,  z:  8,  w: 8,  h: 1,   d: 2 },
  { x:  0,  y: 0.5,  z: -8,  w: 8,  h: 1,   d: 2 },
  // corner pillars
  { x:  5,  y: 1,    z:  5,  w: 2,  h: 2,   d: 2 },
  { x: -5,  y: 1,    z:  5,  w: 2,  h: 2,   d: 2 },
  { x:  5,  y: 1,    z: -5,  w: 2,  h: 2,   d: 2 },
  { x: -5,  y: 1,    z: -5,  w: 2,  h: 2,   d: 2 },
  // outer cover
  { x:  16, y: 0.5,  z:  8,  w: 3,  h: 1,   d: 3 },
  { x: -16, y: 0.5,  z:  8,  w: 3,  h: 1,   d: 3 },
  { x:  16, y: 0.5,  z: -8,  w: 3,  h: 1,   d: 3 },
  { x: -16, y: 0.5,  z: -8,  w: 3,  h: 1,   d: 3 },
  { x:  8,  y: 0.5,  z:  16, w: 3,  h: 1,   d: 3 },
  { x: -8,  y: 0.5,  z:  16, w: 3,  h: 1,   d: 3 },
  { x:  8,  y: 0.5,  z: -16, w: 3,  h: 1,   d: 3 },
  { x: -8,  y: 0.5,  z: -16, w: 3,  h: 1,   d: 3 },
];
