// weapons.js — the shared weapon framework for all mini-games.
//
// Minecraft concepts mapped to our engine:
//   • Bows / Crossbow / Trident → `projectile` weapons (an arc-travelling arrow
//     the server simulates and tests for hits each tick).
//   • Guns (Gun Game) → `hitscan` weapons (instant ray, like the base game).
//   • Sword (One in the Chamber) → `melee` (short-range instant hit).
//
// A mode picks which weapons exist and which one(s) a player holds. The base
// game's own pistol/rifle/shotgun/sniper still live in shared/constants.js;
// these are the *mini-game* arsenal so modes stay self-contained.

export const WEAPON_KIND = Object.freeze({
  HITSCAN:    'hitscan',
  PROJECTILE: 'projectile',
  MELEE:      'melee',
});

export const ARSENAL = {
  // ── Bows ──────────────────────────────────────────────────────────────────
  bow: {
    name: 'Bogen', kind: WEAPON_KIND.PROJECTILE,
    damage: 100, oneShot: true,        // full-charge body shot kills (One-Hit modes)
    drawTime: 600,                     // ms to full charge
    speed: 60, gravity: -16,           // arrow ballistics (units/s, units/s²)
    ammo: Infinity, reload: 0,
  },
  fast_bow: {
    name: 'Schnellbogen', kind: WEAPON_KIND.PROJECTILE,
    damage: 45, oneShot: false,
    drawTime: 180, speed: 55, gravity: -16,
    ammo: Infinity, reload: 0,
  },
  power_bow: {
    name: 'Schwerbogen', kind: WEAPON_KIND.PROJECTILE,
    damage: 100, oneShot: true,
    drawTime: 1000, speed: 80, gravity: -10,
    ammo: Infinity, reload: 0,
  },
  // ── Crossbow ────────────────────────────────────────────────────────────────
  crossbow: {
    name: 'Armbrust', kind: WEAPON_KIND.PROJECTILE,
    damage: 70, oneShot: false,
    drawTime: 0, loadTime: 900,        // load once, then instant release
    speed: 95, gravity: -8,
    ammo: 1, reload: 900,
  },
  // ── Trident (thrown, fast & flat) ────────────────────────────────────────────
  trident: {
    name: 'Dreizack', kind: WEAPON_KIND.PROJECTILE,
    damage: 100, oneShot: true,
    drawTime: 250, speed: 70, gravity: -14,
    ammo: Infinity, reload: 0, returns: true,   // loyalty-style return to owner
  },
  // ── Melee ─────────────────────────────────────────────────────────────────
  sword: {
    name: 'Schwert', kind: WEAPON_KIND.MELEE,
    damage: 100, oneShot: true, range: 3.2, fireRate: 400,
  },
  // ── Hitscan guns reused for Gun Game (progression order, weakest → strongest) ─
  gg_pistol: { name: 'Pistole',  kind: WEAPON_KIND.HITSCAN, damage: 34, fireRate: 350, ammo: 12 },
  gg_smg:    { name: 'MP',       kind: WEAPON_KIND.HITSCAN, damage: 20, fireRate: 90,  ammo: 30, auto: true },
  gg_rifle:  { name: 'Gewehr',   kind: WEAPON_KIND.HITSCAN, damage: 26, fireRate: 110, ammo: 30, auto: true },
  gg_shotgun:{ name: 'Schrot',   kind: WEAPON_KIND.HITSCAN, damage: 12, fireRate: 800, ammo: 8, pellets: 10 },
  gg_sniper: { name: 'Scharfsch.',kind: WEAPON_KIND.HITSCAN, damage: 100, fireRate: 1500, ammo: 5 },
};

// Default Gun-Game progression ladder.
export const GUN_GAME_LADDER = ['gg_pistol', 'gg_smg', 'gg_rifle', 'gg_shotgun', 'gg_sniper'];

export function getWeapon(id) { return ARSENAL[id] ?? null; }
