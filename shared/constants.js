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
    bodyColor:  0x4a7c3f,
    barrelLen:  0.45,
    adsFov:     65,
  },
  shotgun: {
    name:       'Shotgun',
    damage:     18,     // per pellet
    ammo:       8,
    fireRate:   900,
    reloadTime: 2500,
    spread:     0.12,
    pellets:    7,
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
    bodyColor:  0x2d4a6b,
    barrelLen:  0.7,
    adsFov:     30,
  },
};
export const WEAPON_KEYS = ['pistol', 'rifle', 'shotgun', 'sniper'];

// Map boxes { x, y, z = centre, w, h, d = full size }
export const MAP_BOXES = [
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
];
