import {
  TICK_MS, RESPAWN_TIME,
  PLAYER_HEIGHT, PLAYER_RADIUS,
  MAX_MSG_PER_SECOND,
  WEAPONS, WEAPON_KEYS,
} from '../shared/constants.js';
import { ServerPlayer } from './Player.js';

// Ray–AABB slab test. Returns t≥0 on hit (max range 120 u), else null.
function rayAABB(ox, oy, oz, dx, dy, dz, mnX, mxX, mnY, mxY, mnZ, mxZ) {
  const eps = 1e-9;
  const ix = Math.abs(dx) > eps ? 1/dx : (dx >= 0 ? Infinity : -Infinity);
  const iy = Math.abs(dy) > eps ? 1/dy : (dy >= 0 ? Infinity : -Infinity);
  const iz = Math.abs(dz) > eps ? 1/dz : (dz >= 0 ? Infinity : -Infinity);

  const tx1 = (mnX-ox)*ix, tx2 = (mxX-ox)*ix;
  const ty1 = (mnY-oy)*iy, ty2 = (mxY-oy)*iy;
  const tz1 = (mnZ-oz)*iz, tz2 = (mxZ-oz)*iz;

  const tmin = Math.max(Math.min(tx1,tx2), Math.min(ty1,ty2), Math.min(tz1,tz2));
  const tmax = Math.min(Math.max(tx1,tx2), Math.max(ty1,ty2), Math.max(tz1,tz2));

  if (tmax < 0 || tmin > tmax || tmin > 120) return null;
  return tmin >= 0 ? tmin : tmax;
}

export class Room {
  constructor(id) {
    this.id      = id;
    this.players = new Map(); // id → { ws, player, lastInput, lastShot, rateWin, rateCnt }
    this.tick    = 0;
    this.lastMs  = Date.now();
    this._iv     = setInterval(() => this._tick(), TICK_MS);
  }

  destroy() { clearInterval(this._iv); }

  // ── Connection management ─────────────────────────────────────────────────

  addPlayer(ws, id, name) {
    const player = new ServerPlayer(id, name);
    this.players.set(id, { ws, player, lastInput: {}, lastShot: 0, rateWin: Date.now(), rateCnt: 0 });
    this._send(ws, { type: 'init', id, snapshot: this._snapshot() });
    this.broadcast({ type: 'playerJoin', id, name });
    console.log(`[+] ${name} (${id}) — ${this.players.size} players`);
  }

  removePlayer(id) {
    const e = this.players.get(id);
    if (!e) return;
    this.players.delete(id);
    this.broadcast({ type: 'playerLeave', id });
    console.log(`[-] ${e.player.name} (${id}) — ${this.players.size} players`);
  }

  // ── Message dispatch (called from server/index.js) ────────────────────────

  handleMessage(id, msg) {
    const e = this.players.get(id);
    if (!e) return;

    // Rate-limit per connection
    const now = Date.now();
    if (now - e.rateWin > 1000) { e.rateWin = now; e.rateCnt = 0; }
    if (++e.rateCnt > MAX_MSG_PER_SECOND) return;

    if (msg.type === 'input')  this._applyInput(e, msg);
    if (msg.type === 'shoot')  this._shoot(id, e, msg);
    if (msg.type === 'reload') this._reload(e);
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _applyInput(e, msg) {
    const i = msg.input || {};
    const wid = WEAPON_KEYS.includes(i.weapon) ? i.weapon : undefined;
    e.lastInput = {
      forward: !!i.forward,
      back:    !!i.back,
      left:    !!i.left,
      right:   !!i.right,
      jump:    !!i.jump,
      sprint:  !!i.sprint,
      ads:     !!i.ads,
      weapon:  wid,
      yaw:   typeof i.yaw   === 'number' && isFinite(i.yaw)   ? i.yaw   : 0,
      pitch: typeof i.pitch === 'number' && isFinite(i.pitch)
        ? Math.max(-Math.PI/2, Math.min(Math.PI/2, i.pitch)) : 0,
    };
  }

  _reload(e) {
    const p = e.player;
    const w = WEAPONS[p.currentWeapon];
    if (!p.dead && !p.reloading && p.ammo[p.currentWeapon] < w.ammo) {
      p.reloading   = true;
      p.reloadTimer = w.reloadTime;
    }
  }

  // ── Authoritative hitscan shoot ───────────────────────────────────────────

  _shoot(id, e, msg) {
    const { player } = e;
    if (player.dead || player.reloading) return;

    const weapId = WEAPON_KEYS.includes(msg.weapon) ? msg.weapon : player.currentWeapon;
    const weap   = WEAPONS[weapId];
    if (!weap) return;

    if (player.ammo[weapId] <= 0) return;

    const now = Date.now();
    if (now - e.lastShot < weap.fireRate) return;
    e.lastShot = now;

    player.currentWeapon = weapId;
    player.ammo[weapId]--;

    const eye   = player.eyePos();
    const yaw   = typeof msg.yaw   === 'number' ? msg.yaw   : player.yaw;
    const pitch = typeof msg.pitch === 'number'
      ? Math.max(-Math.PI/2, Math.min(Math.PI/2, msg.pitch)) : player.pitch;

    // Fire all pellets (shotgun = multiple, others = 1)
    for (let p = 0; p < weap.pellets; p++) {
      const spread = weap.spread;
      const sy = (Math.random() - 0.5) * spread;
      const sp = (Math.random() - 0.5) * spread;
      const eff_yaw   = yaw   + sy;
      const eff_pitch = pitch + sp;

      const dirX = -Math.sin(eff_yaw) * Math.cos(eff_pitch);
      const dirY =  Math.sin(eff_pitch);
      const dirZ = -Math.cos(eff_yaw) * Math.cos(eff_pitch);

      let hitEntry = null, hitDist = Infinity;

      for (const [oid, other] of this.players) {
        if (oid === id || other.player.dead) continue;
        const op = other.player;
        const t = rayAABB(
          eye.x, eye.y, eye.z, dirX, dirY, dirZ,
          op.x - PLAYER_RADIUS, op.x + PLAYER_RADIUS,
          op.y,                 op.y + PLAYER_HEIGHT,
          op.z - PLAYER_RADIUS, op.z + PLAYER_RADIUS,
        );
        if (t !== null && t < hitDist) { hitDist = t; hitEntry = other; }
      }

      if (hitEntry) {
        const target = hitEntry.player;
        target.health -= weap.damage;
        const kill = target.health <= 0;
        if (kill) {
          target.dead         = true;
          target.respawnTimer = RESPAWN_TIME;
          target.deaths++;
          player.kills++;
        }
        this.broadcast({
          type:        'hit',
          shooterId:   id,
          shooterName: player.name,
          targetId:    target.id,
          targetName:  target.name,
          damage:      weap.damage,
          kill,
          targetHealth: Math.max(0, target.health),
        });
        if (kill) break; // target already dead, no more pellets needed
      }
    }

    // Auto-reload when empty
    if (player.ammo[weapId] <= 0 && !player.reloading) {
      player.reloading   = true;
      player.reloadTimer = weap.reloadTime;
    }
  }

  // ── Game tick ─────────────────────────────────────────────────────────────

  _tick() {
    const now = Date.now();
    const dt  = Math.min((now - this.lastMs) / 1000, 0.1);
    this.lastMs = now;
    this.tick++;
    for (const [, e] of this.players) e.player.update(dt, e.lastInput);
    this._broadcastSnapshot();
  }

  _snapshot() {
    const players = [];
    for (const [, { player }] of this.players) players.push(player.toSnapshot());
    return { tick: this.tick, players };
  }

  _broadcastSnapshot() {
    const data = JSON.stringify({ type: 'snapshot', ...this._snapshot() });
    for (const [, { ws }] of this.players) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [, { ws }] of this.players) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  _send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
}
