// TargetRush.js — REFERENCE MODE.
//
// Targets pop up around the arena; hit as many as you can before the timer runs
// out. Most hits wins. This is the simplest mode and exists to demonstrate the
// full framework contract end-to-end: spawn entities, score on hits via the
// onPlayerShoot hook, broadcast custom state, and clean up in onReset().
//
// Use it as the template when implementing the other modes.

import { MiniGame } from '../MiniGame.js';

const TARGET_R   = 0.8;   // hit radius
const MAX_TARGETS = 8;
const TARGET_TTL  = 4.5;  // seconds a target stays before relocating

export class TargetRush extends MiniGame {
  static meta = {
    id:          'target_rush',
    name:        'Target Rush',
    description: 'Triff in 60 Sekunden so viele Zielscheiben wie möglich.',
    minPlayers:  1,
    maxPlayers:  8,
    teams:       false,
    durationSec: 60,
    implemented: true,   // playable now; scaffolded modes are not yet
  };

  onStart() {
    this._targets = [];
    this._nextId  = 1;
    for (let i = 0; i < MAX_TARGETS; i++) this._spawnTarget();
    this._broadcastTargets();
  }

  onUpdate(dt) {
    // Age targets out and relocate them so the field keeps changing.
    let changed = false;
    for (const t of this._targets) {
      t.ttl -= dt;
      if (t.ttl <= 0) { this._relocate(t); changed = true; }
    }
    if (changed) this._broadcastTargets();
  }

  // The server forwards every shot here: { origin:{x,y,z}, dir:{x,y,z} }.
  onPlayerShoot(playerId, shot) {
    if (this.phase !== 'running') return;
    const hit = this._raycastTargets(shot.origin, shot.dir);
    if (!hit) return;
    this.scoreboard.add(playerId, 1);
    this._relocate(hit);
    this.broadcast({ type: 'mg_event', event: 'target_hit', by: playerId, target: hit.id });
    this._broadcastTargets();
  }

  // No special win condition — highest score when the timer ends (handled by
  // the base class default). Returning null keeps the round running.
  checkWin() { return null; }

  onReset() {
    this._targets = [];
    this.broadcast({ type: 'mg_targets', targets: [] });
  }

  // ── internals ────────────────────────────────────────────────────────────────

  _spawnTarget() {
    const t = { id: this._nextId++, x: 0, y: 0, z: 0, r: TARGET_R, ttl: TARGET_TTL };
    this._relocate(t);
    this._targets.push(t);
    return t;
  }

  _relocate(t) {
    // Random point in the mini-games plaza (where players join from), at
    // chest-to-head height, so you can play right where you queued up.
    t.x   = -32 - Math.random() * 56;   // x ∈ [-88, -32]
    t.y   = 1.4 + Math.random() * 2.4;
    t.z   = (Math.random() - 0.5) * 40;
    t.ttl = TARGET_TTL;
  }

  // Ray vs sphere for each target; returns the nearest hit target or null.
  _raycastTargets(o, d) {
    let best = null, bestT = Infinity;
    for (const t of this._targets) {
      const ox = o.x - t.x, oy = o.y - t.y, oz = o.z - t.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - t.r * t.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const tt = -b - Math.sqrt(disc);
      if (tt >= 0 && tt < bestT) { bestT = tt; best = t; }
    }
    return best;
  }

  _broadcastTargets() {
    this.broadcast({
      type: 'mg_targets',
      targets: this._targets.map(t => ({ id: t.id, x: t.x, y: t.y, z: t.z, r: t.r })),
    });
  }
}
