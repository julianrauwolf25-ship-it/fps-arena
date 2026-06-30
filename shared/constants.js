// Shared between server and client.

export const TICK_RATE    = 20;
export const TICK_MS      = 1000 / TICK_RATE;

// Player physics
export const PLAYER_SPEED      = 8;
export const PLAYER_SPRINT     = 13;
export const PLAYER_ADS_MULT   = 0.55;      // speed multiplier while aiming
export const PLAYER_JUMP       = 9;
export const GRAVITY           = -22;
export const PLAYER_HEIGHT     = 1.8;
export const PLAYER_RADIUS     = 0.4;
export const PLAYER_EYE_OFFSET = 1.6;

// Health / respawn
export const MAX_HEALTH   = 100;
export const RESPAWN_TIME = 3000;

// Rate limiting
export const MAX_MSG_PER_SECOND = 150;

// Arena
export const ARENA_HALF = 28;

// Spawn points
export const SPAWN_POINTS = [
  { x:  0,  y: 1, z:  22 },
  { x:  0,  y: 1, z: -22 },
  { x:  22, y: 1, z:   0 },
  { x: -22, y: 1, z:   0 },
  { x:  14, y: 1, z:  14 },
  { x: -14, y: 1, z: -14 },
  { x:  14, y: 1, z: -14 },
  { x: -14, y: 1, z:  14 },
];

// Weapon definitions — same object used server & client
export const WEAPONS = {
  pistol: {
    name:       'Pistol',
    damage:     35,
    ammo:       12,
    fireRate:   350,    // ms between shots
    reloadTime: 1200,
    spread:     0.025,
    pellets:    1,
    auto:       false,  // semi-auto: one shot per click
    bodyColor:  0x888899,
    barrelLen:  0.25,
    adsFov:     70,
  },
  rifle: {
    name:       'Assault Rifle',
    damage:     22,
    ammo:       30,
    fireRate:   90,
    reloadTime: 1800,
    spread:     0.008,
    pellets:    1,
    auto:       true,   // full-auto: hold to keep firing
    bodyColor:  0x4a7c3f,
    barrelLen:  0.45,
    adsFov:     65,
  },
  shotgun: {
    name:       'Shotgun',
    damage:     12,     // per pellet (before distance falloff)
    ammo:       8,
    fireRate:   800,
    reloadTime: 2500,
    spread:     0.11,
    pellets:    10,     // many pellets per shot
    auto:       false,
    // Distance damage falloff: brutal up close, weak far away
    falloff:    { near: 6, far: 24, nearMult: 1.7, farMult: 0.3 },
    bodyColor:  0x8b5e3c,
    barrelLen:  0.35,
    adsFov:     75,
  },
  sniper: {
    name:       'Sniper Rifle',
    damage:     95,
    ammo:       5,
    fireRate:   1800,
    reloadTime: 3000,
    spread:     0.001,
    pellets:    1,
    auto:       false,
    bodyColor:  0x2d4a6b,
    barrelLen:  0.7,
    adsFov:     30,
  },
};
export const WEAPON_KEYS = ['pistol', 'rifle', 'shotgun', 'sniper'];

// ── World bounds (loose safety net; real containment is the wall boxes) ───────
// Expanded eastward (+x) to include the parkour zone beyond the arena's east wall.
export const WORLD_BOUNDS = { minX: -98, maxX: 120, minZ: -29, maxZ: 29 };

// Fall below this Y in the parkour zone → respawn at the last checkpoint.
export const VOID_Y = -8;

// Minigame plaza: a grounded zone WEST of the arena (through the west-wall gate).
// Has a solid floor (unlike the parkour void) so jump pads & a shooting range fit.
export const MINIGAME_FLOOR = { minX: -97, maxX: -ARENA_HALF, minZ: -33, maxZ: 33 };

// Bounce pads { x, z, top, r (radius), power (launch velocity) }
export const JUMP_PADS = [
  { x: -44, z:  0,  top: 0, r: 1.7, power: 15 },
  { x: -54, z:  7,  top: 0, r: 1.7, power: 18 },
  { x: -54, z: -7,  top: 0, r: 1.7, power: 18 },
  { x: -66, z:  0,  top: 0, r: 1.7, power: 22 },
];

// ── Arena cover boxes { x, y, z = centre, w, h, d = full size, kind } ─────────
const ARENA_COVER = [
  { x:  0,  y: 0.75, z:  0,  w: 3,  h: 1.5, d: 3 },
  { x:  8,  y: 0.5,  z:  0,  w: 2,  h: 1,   d: 8 },
  { x: -8,  y: 0.5,  z:  0,  w: 2,  h: 1,   d: 8 },
  { x:  0,  y: 0.5,  z:  8,  w: 8,  h: 1,   d: 2 },
  { x:  0,  y: 0.5,  z: -8,  w: 8,  h: 1,   d: 2 },
  { x:  5,  y: 1,    z:  5,  w: 2,  h: 2,   d: 2 },
  { x: -5,  y: 1,    z:  5,  w: 2,  h: 2,   d: 2 },
  { x:  5,  y: 1,    z: -5,  w: 2,  h: 2,   d: 2 },
  { x: -5,  y: 1,    z: -5,  w: 2,  h: 2,   d: 2 },
  { x:  16, y: 0.5,  z:  8,  w: 3,  h: 1,   d: 3 },
  { x: -16, y: 0.5,  z:  8,  w: 3,  h: 1,   d: 3 },
  { x:  16, y: 0.5,  z: -8,  w: 3,  h: 1,   d: 3 },
  { x: -16, y: 0.5,  z: -8,  w: 3,  h: 1,   d: 3 },
  { x:  8,  y: 0.5,  z:  16, w: 3,  h: 1,   d: 3 },
  { x: -8,  y: 0.5,  z:  16, w: 3,  h: 1,   d: 3 },
  { x:  8,  y: 0.5,  z: -16, w: 3,  h: 1,   d: 3 },
  { x: -8,  y: 0.5,  z: -16, w: 3,  h: 1,   d: 3 },
].map(b => ({ ...b, kind: 'cover' }));

// ── Arena walls (collidable). East wall has a GAP at z ∈ [-3, 3] = the portal ─
const WALL_H = 8, WT = 1.0;  // wall height & thickness (thick enough to avoid tunneling)
const ARENA_WALLS = [
  { x: 0,           y: WALL_H/2, z: -ARENA_HALF, w: ARENA_HALF*2 + 1, h: WALL_H, d: WT },              // north
  { x: 0,           y: WALL_H/2, z:  ARENA_HALF, w: ARENA_HALF*2 + 1, h: WALL_H, d: WT },              // south
  { x:  ARENA_HALF, y: WALL_H/2, z: -15.5,       w: WT, h: WALL_H, d: 25 },                            // east (north of gap) → PARKOUR
  { x:  ARENA_HALF, y: WALL_H/2, z:  15.5,       w: WT, h: WALL_H, d: 25 },                            // east (south of gap)
  { x: -ARENA_HALF, y: WALL_H/2, z: -15.5,       w: WT, h: WALL_H, d: 25 },                            // west (north of gap) → MINI GAMES
  { x: -ARENA_HALF, y: WALL_H/2, z:  15.5,       w: WT, h: WALL_H, d: 25 },                            // west (south of gap)
].map(b => ({ ...b, kind: 'wall' }));

// ── Minigame props (shooting-range targets — collidable so bullets leave holes) ─
const MINI_TARGETS = [
  { x: -86, y: 2.2, z: -8, w: 0.4, h: 2.4, d: 2.4, kind: 'target' },
  { x: -86, y: 3.0, z: -3, w: 0.4, h: 2.0, d: 2.0, kind: 'target' },
  { x: -86, y: 2.4, z:  2, w: 0.4, h: 2.4, d: 2.4, kind: 'target' },
  { x: -86, y: 3.2, z:  7, w: 0.4, h: 1.8, d: 1.8, kind: 'target' },
  { x: -90, y: 1.8, z:  0, w: 0.4, h: 1.6, d: 1.6, kind: 'target' },
];

// ── Parkour zone (east of the arena, beyond the portal gap) ───────────────────
// Helper: a chunky block whose TOP surface sits at `top`. cp=true → checkpoint.
function P(x, top, z, w, d, cp = false) {
  const h = 2;
  return { x, y: top - h / 2, z, w, h, d, top, cp, kind: cp ? 'checkpoint' : 'parkour' };
}

// Default respawn = the start platform just outside the portal.
export const PARKOUR_START = { x: 32, y: 0, z: 0 };
const PARKOUR_START_BOX = { x: 32, y: -1, z: 0, w: 8, h: 2, d: 10, top: 0, kind: 'parkourStart' };

// Right side (+z) = EASIER course: small gaps, gentle height changes, but longer now.
const PARKOUR_EASY = [
  P(38,    0.8,  3,   2.6, 2.6, true),
  P(41.5,  1.3,  5.5, 2.3, 2.3),
  P(45,    1.0,  7.5, 2.3, 2.3),
  P(48.5,  1.7,  8,   2.3, 2.3, true),
  P(52,    1.3,  7,   2.1, 2.1),
  P(55.5,  2.1,  5.5, 2.1, 2.1),
  P(59,    1.7,  3.5, 2.2, 2.2, true),
  P(62.5,  2.3,  2.5, 2.1, 2.1),
  P(66,    1.6,  3.5, 2.1, 2.1),
  P(69.5,  2.2,  5.5, 2.1, 2.1, true),
  P(73,    1.5,  7,   2.2, 2.2),
  P(76.5,  2.0,  8,   2.0, 2.0),
  P(80,    1.4,  6.5, 2.1, 2.1, true),
  P(83.5,  1.0,  8,   3.5, 3.5, true),  // finish
];

// Left side (-z) = HARDER course: long, with tight pads, beams, sprint gaps and big height swings.
const PARKOUR_HARD = [
  P(38,    1.3, -3,   1.6, 1.6, true),
  P(42,    2.2, -5.5, 1.3, 1.3),
  P(46,    1.5, -7.5, 1.2, 1.2),
  P(50,    2.8, -8,   1.2, 1.2, true),
  P(54.5,  1.9, -6.5, 1.1, 1.1),
  P(59,    3.2, -4.5, 1.1, 1.1),
  P(63.5,  2.1, -3,   1.2, 1.2, true),
  P(71,    2.6, -3,   5,   0.9),          // balance beam along X
  P(76,    3.6, -5,   1.0, 1.0),          // small high pad
  P(80,    2.4, -7,   1.0, 1.0, true),
  P(84.5,  3.8, -6,   1.0, 1.0),          // sprint gap + climb
  P(89,    2.6, -3.5, 1.0, 1.0),
  P(93.5,  3.0, -2,   4.5, 0.85),         // second balance beam
  P(98,    4.0, -3.5, 1.0, 1.0, true),
  P(102.5, 2.8, -5.5, 1.0, 1.0),
  P(107,   2.0, -7,   3.5, 3.5, true),    // finish
];

// Checkpoint respawn points (feet stand on the platform top).
export const CHECKPOINTS = [...PARKOUR_EASY, ...PARKOUR_HARD]
  .filter(p => p.cp)
  .map(p => ({ x: p.x, y: p.top, z: p.z }));

// All collidable boxes the world is made of.
export const MAP_BOXES = [
  ...ARENA_COVER,
  ...ARENA_WALLS,
  PARKOUR_START_BOX,
  ...PARKOUR_EASY,
  ...PARKOUR_HARD,
  ...MINI_TARGETS,
];
