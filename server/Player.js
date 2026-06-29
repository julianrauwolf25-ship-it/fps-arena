import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_JUMP, GRAVITY,
  PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_EYE_OFFSET,
  MAX_HEALTH, MAX_AMMO, RELOAD_TIME, RESPAWN_TIME,
  SPAWN_POINTS, ARENA_HALF,
} from '../shared/constants.js';

export class ServerPlayer {
  constructor(id, name) {
    this.id     = id;
    this.name   = name;
    this.health = MAX_HEALTH;
    this.kills  = 0;
    this.deaths = 0;
    this.ammo   = MAX_AMMO;

    this.reloading    = false;
    this.reloadTimer  = 0;
    this.dead         = false;
    this.respawnTimer = 0;

    // physics state (y = feet position)
    this.x  = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw   = 0;
    this.pitch = 0;
    this.onGround = false;

    this.spawn();
  }

  spawn() {
    const sp = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    this.x  = sp.x + (Math.random() - 0.5) * 2;
    this.y  = sp.y;
    this.z  = sp.z + (Math.random() - 0.5) * 2;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.health   = MAX_HEALTH;
    this.dead     = false;
    this.ammo     = MAX_AMMO;
    this.reloading = false;
  }

  // dt in seconds, input object validated by Room before arriving here
  update(dt, input) {
    if (this.dead) {
      this.respawnTimer -= dt * 1000;
      if (this.respawnTimer <= 0) this.spawn();
      return;
    }

    // reload countdown
    if (this.reloading) {
      this.reloadTimer -= dt * 1000;
      if (this.reloadTimer <= 0) {
        this.ammo     = MAX_AMMO;
        this.reloading = false;
      }
    }

    // horizontal movement
    const speed = input.sprint ? PLAYER_SPRINT : PLAYER_SPEED;
    const cos   = Math.cos(input.yaw ?? 0);
    const sin   = Math.sin(input.yaw ?? 0);

    let mx = 0, mz = 0;
    if (input.forward) { mx -= sin; mz -= cos; }
    if (input.back)    { mx += sin; mz += cos; }
    if (input.left)    { mx -= cos; mz += sin; }
    if (input.right)   { mx += cos; mz -= sin; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx = (mx / len) * speed; mz = (mz / len) * speed; }

    this.vx = mx;
    this.vz = mz;

    // jump
    if (input.jump && this.onGround) {
      this.vy       = PLAYER_JUMP;
      this.onGround = false;
    }

    // gravity
    this.vy += GRAVITY * dt;

    // integrate
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    // floor collision
    if (this.y <= 1) {
      this.y        = 1;
      this.vy       = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // arena bounds (clamp)
    this.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.x));
    this.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.z));

    this.yaw   = input.yaw   ?? 0;
    this.pitch = input.pitch ?? 0;
  }

  // eye-level world position for raycasting
  eyePos() {
    return { x: this.x, y: this.y + PLAYER_EYE_OFFSET, z: this.z };
  }

  toSnapshot() {
    return {
      id:     this.id,
      name:   this.name,
      x:      this.x,
      y:      this.y,
      z:      this.z,
      yaw:    this.yaw,
      pitch:  this.pitch,
      health: this.health,
      dead:   this.dead,
      kills:  this.kills,
      deaths: this.deaths,
      ammo:   this.ammo,
      reloading: this.reloading,
    };
  }
}
