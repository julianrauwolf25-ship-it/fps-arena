import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_ADS_MULT, PLAYER_JUMP, GRAVITY,
  PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_EYE_OFFSET,
  MAX_HEALTH, RESPAWN_TIME,
  SPAWN_POINTS, ARENA_HALF,
  WEAPONS, WEAPON_KEYS,
} from '../shared/constants.js';

export class ServerPlayer {
  constructor(id, name) {
    this.id     = id;
    this.name   = name;
    this.health = MAX_HEALTH;
    this.kills  = 0;
    this.deaths = 0;

    // Per-weapon ammo
    this.ammo = {};
    for (const k of WEAPON_KEYS) this.ammo[k] = WEAPONS[k].ammo;

    this.currentWeapon = 'pistol';
    this.reloading     = false;
    this.reloadTimer   = 0;
    this.dead          = false;
    this.respawnTimer  = 0;

    // Physics (y = feet)
    this.x  = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw      = 0;
    this.pitch    = 0;
    this.ads      = false;
    this.onGround = false;

    this.spawn();
  }

  spawn() {
    const sp = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    this.x  = sp.x + (Math.random() - 0.5) * 2;
    this.y  = sp.y;
    this.z  = sp.z + (Math.random() - 0.5) * 2;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.health    = MAX_HEALTH;
    this.dead      = false;
    this.reloading = false;
    // Refill ammo on respawn
    for (const k of WEAPON_KEYS) this.ammo[k] = WEAPONS[k].ammo;
  }

  update(dt, input) {
    if (this.dead) {
      this.respawnTimer -= dt * 1000;
      if (this.respawnTimer <= 0) this.spawn();
      return;
    }

    if (this.reloading) {
      this.reloadTimer -= dt * 1000;
      if (this.reloadTimer <= 0) {
        this.ammo[this.currentWeapon] = WEAPONS[this.currentWeapon].ammo;
        this.reloading = false;
      }
    }

    const ads   = !!input.ads;
    const base  = input.sprint ? PLAYER_SPRINT : PLAYER_SPEED;
    const speed = ads ? base * PLAYER_ADS_MULT : base;

    const yaw = input.yaw ?? 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    let mx = 0, mz = 0;
    if (input.forward) { mx -= sin; mz -= cos; }
    if (input.back)    { mx += sin; mz += cos; }
    if (input.left)    { mx -= cos; mz += sin; }
    if (input.right)   { mx += cos; mz -= sin; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx = (mx / len) * speed; mz = (mz / len) * speed; }

    this.vx = mx;
    this.vz = mz;

    if (input.jump && this.onGround) {
      this.vy       = PLAYER_JUMP;
      this.onGround = false;
    }

    this.vy += GRAVITY * dt;
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.z  += this.vz * dt;

    if (this.y <= 1) { this.y = 1; this.vy = 0; this.onGround = true; }
    else              { this.onGround = false; }

    this.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.x));
    this.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.z));

    this.yaw   = yaw;
    this.pitch = typeof input.pitch === 'number' ? input.pitch : 0;
    this.ads   = ads;

    // Weapon switch
    const wid = input.weapon;
    if (wid && WEAPONS[wid] && !this.reloading) this.currentWeapon = wid;
  }

  eyePos() { return { x: this.x, y: this.y + PLAYER_EYE_OFFSET, z: this.z }; }

  toSnapshot() {
    return {
      id:            this.id,
      name:          this.name,
      x:             this.x,
      y:             this.y,
      z:             this.z,
      yaw:           this.yaw,
      pitch:         this.pitch,
      health:        this.health,
      dead:          this.dead,
      kills:         this.kills,
      deaths:        this.deaths,
      ammo:          this.ammo[this.currentWeapon],
      reloading:     this.reloading,
      currentWeapon: this.currentWeapon,
      ads:           this.ads,
    };
  }
}
