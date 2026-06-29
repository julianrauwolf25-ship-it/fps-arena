import {
  TICK_MS, BULLET_DAMAGE, FIRE_RATE, RELOAD_TIME,
  MAX_AMMO, RESPAWN_TIME, PLAYER_HEIGHT, PLAYER_RADIUS,
  MAX_MSG_PER_SECOND,
} from '../shared/constants.js';
import { ServerPlayer } from './Player.js';

// Slab ray–AABB intersection. Returns t≥0 on hit, null otherwise. Max range 120 units.
function rayAABB(ox, oy, oz, dx, dy, dz, minX, maxX, minY, maxY, minZ, maxZ) {
  const eps  = 1e-9;
  const ix   = Math.abs(dx) > eps ? 1 / dx : (dx >= 0 ? Infinity : -Infinity);
  const iy   = Math.abs(dy) > eps ? 1 / dy : (dy >= 0 ? Infinity : -Infinity);
  const iz   = Math.abs(dz) > eps ? 1 / dz : (dz >= 0 ? Infinity : -Infinity);

  const tx1  = (minX - ox) * ix, tx2 = (maxX - ox) * ix;
  const ty1  = (minY - oy) * iy, ty2 = (maxY - oy) * iy;
  const tz1  = (minZ - oz) * iz, tz2 = (maxZ - oz) * iz;

  const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
  const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));

  if (tmax < 0 || tmin > tmax || tmin > 120) return null;
  return tmin >= 0 ? tmin : tmax;
}

export class Room {
  constructor(id) {
    this.id      = id;
    // id → { ws, player, lastInput, lastShot, rateWindow, rateCount }
    this.players = new Map();
    this.tick    = 0;
    this.lastMs  = Date.now();

    // Server game-loop — authoritative tick
    this._interval = setInterval(() => this._tick(), TICK_MS);
  }

  destroy() {
    clearInterval(this._interval);
  }

  // ── Connection management ─────────────────────────────────────────────────

  addPlayer(ws, id, name) {
    const player = new ServerPlayer(id, name);
    this.players.set(id, {
      ws,
      player,
      lastInput:   {},
      lastShot:    0,
      rateWindow:  Date.now(),
      rateCount:   0,
    });

    // Tell the new player their own id + full current snapshot
    this._send(ws, { type: 'init', id, snapshot: this._buildSnapshot() });

    // Tell everyone else about the new arrival
    this.broadcast({ type: 'playerJoin', id, name });
    console.log(`[Room] ${name} (${id}) joined — total ${this.players.size}`);
  }

  removePlayer(id) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.players.delete(id);
    this.broadcast({ type: 'playerLeave', id });
    console.log(`[Room] ${entry.player.name} (${id}) left — total ${this.players.size}`);
  }

  // ── Incoming message handler (called by server/index.js) ─────────────────

  handleMessage(id, msg) {
    const entry = this.players.get(id);
    if (!entry) return;

    // Per-connection rate limiting
    const now = Date.now();
    if (now - entry.rateWindow > 1000) { entry.rateWindow = now; entry.rateCount = 0; }
    entry.rateCount++;
    if (entry.rateCount > MAX_MSG_PER_SECOND) return; // silently drop

    if (msg.type === 'input')  this._handleInput(entry, msg);
    if (msg.type === 'shoot')  this._handleShoot(id, entry, msg);
    if (msg.type === 'reload') this._handleReload(entry);
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _handleInput(entry, msg) {
    const i = msg.input || {};
    // Whitelist & sanitise every field — never trust raw client data
    entry.lastInput = {
      forward: !!i.forward,
      back:    !!i.back,
      left:    !!i.left,
      right:   !!i.right,
      jump:    !!i.jump,
      sprint:  !!i.sprint,
      yaw:   typeof i.yaw   === 'number' && isFinite(i.yaw)   ? i.yaw   : 0,
      pitch: typeof i.pitch === 'number' && isFinite(i.pitch)
        ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, i.pitch)) : 0,
    };
  }

  _handleReload(entry) {
    const { player } = entry;
    if (!player.dead && !player.reloading && player.ammo < MAX_AMMO) {
      player.reloading   = true;
      player.reloadTimer = RELOAD_TIME;
    }
  }

  // ── Shooting (server-authoritative hitscan) ───────────────────────────────

  _handleShoot(id, entry, msg) {
    const { player } = entry;
    if (player.dead || player.reloading || player.ammo <= 0) return;

    const now = Date.now();
    if (now - entry.lastShot < FIRE_RATE) return;   // enforce fire rate
    entry.lastShot = now;

    player.ammo--;

    // Ray origin = shooter eye, direction from look angles
    const eye  = player.eyePos();
    const yaw  = typeof msg.yaw   === 'number' ? msg.yaw   : player.yaw;
    const pit  = typeof msg.pitch === 'number'
      ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch)) : player.pitch;

    const dirX = -Math.sin(yaw) * Math.cos(pit);
    const dirY =  Math.sin(pit);
    const dirZ = -Math.cos(yaw) * Math.cos(pit);

    let hitEntry = null;
    let hitDist  = Infinity;

    for (const [otherId, other] of this.players) {
      if (otherId === id || other.player.dead) continue;
      const p = other.player;

      const t = rayAABB(
        eye.x, eye.y, eye.z,
        dirX,  dirY,  dirZ,
        p.x - PLAYER_RADIUS, p.x + PLAYER_RADIUS,
        p.y,                 p.y + PLAYER_HEIGHT,
        p.z - PLAYER_RADIUS, p.z + PLAYER_RADIUS,
      );

      if (t !== null && t < hitDist) { hitDist = t; hitEntry = other; }
    }

    if (hitEntry) {
      const target = hitEntry.player;
      target.health -= BULLET_DAMAGE;
      const kill = target.health <= 0;

      if (kill) {
        target.dead         = true;
        target.respawnTimer = RESPAWN_TIME;
        target.deaths++;
        player.kills++;
      }

      // Broadcast hit event so clients can show hit-marker / kill-feed
      this.broadcast({
        type:         'hit',
        shooterId:    id,
        shooterName:  player.name,
        targetId:     target.id,
        targetName:   target.name,
        damage:       BULLET_DAMAGE,
        kill,
        targetHealth: Math.max(0, target.health),
      });
    }

    // Auto-reload on empty
    if (player.ammo <= 0 && !player.reloading) {
      player.reloading   = true;
      player.reloadTimer = RELOAD_TIME;
    }
  }

  // ── Server game-loop tick ─────────────────────────────────────────────────

  _tick() {
    const now = Date.now();
    const dt  = Math.min((now - this.lastMs) / 1000, 0.1); // cap at 100 ms
    this.lastMs = now;
    this.tick++;

    for (const [, entry] of this.players) {
      entry.player.update(dt, entry.lastInput);
    }

    this._broadcastSnapshot();
  }

  _buildSnapshot() {
    const players = [];
    for (const [, { player }] of this.players) players.push(player.toSnapshot());
    return { tick: this.tick, players };
  }

  // Snapshot broadcast happens every tick (~20 Hz)
  _broadcastSnapshot() {
    const data = JSON.stringify({ type: 'snapshot', ...this._buildSnapshot() });
    for (const [, { ws }] of this.players) {
      if (ws.readyState === 1 /* OPEN */) ws.send(data);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [, { ws }] of this.players) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  _send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}
