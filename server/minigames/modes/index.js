// modes/index.js — the registry of every selectable mini-game.
//
// Implemented & playable: TargetRush + the FFA combat modes below.
// The four geometry/AI-heavy modes (Bow Spleef, CTF, Payload, Zombie) remain
// scaffolded (implemented:false → "coming soon") until their custom world/AI
// systems are built.
//
// Combat modes plug into the shared combat routing:
//   onCombat(shooterId, targetId, weapon, kill, headshot)  — a hit/kill occurred
// and use the framework helpers setupCombat(), lockWeapon(All), eliminate().

import { MiniGame }   from '../MiniGame.js';
import { TargetRush } from './TargetRush.js';

const LADDER = ['pistol', 'rifle', 'shotgun', 'sniper']; // Gun Game progression

/* ─────────────────────────── Last Man Standing ──────────────────────────── */
class LastManStanding extends MiniGame {
  static meta = { id: 'last_man', name: 'Last Man Standing', minPlayers: 2, maxPlayers: 8,
    teams: false, durationSec: 180, implemented: true,
    description: 'FFA – kein Respawn, letzter Überlebender gewinnt.' };

  onStart() { this.setupCombat(); }

  onCombat(sid, tid, weapon, kill) {
    if (!kill) return;
    this.scoreboard.add(sid, 1);
    this.eliminate(tid);
  }

  checkWin() {
    const a = this.alivePlayers();
    if (this.players.size >= 2 && a.length <= 1)
      return a[0] ? { type: 'player', id: a[0].id, name: a[0].name } : { type: 'draw' };
    return null;
  }
}

/* ─────────────────────────────── Gun Game ───────────────────────────────── */
class GunGame extends MiniGame {
  static meta = { id: 'gun_game', name: 'Gun Game', minPlayers: 2, maxPlayers: 8,
    teams: false, durationSec: 300, implemented: true,
    description: 'Jeder Kill schaltet die nächste Waffe frei. Letzte Waffe = Sieg.' };

  onStart() {
    this.setupCombat();
    this._level = new Map();
    for (const id of this.players.keys()) {
      this._level.set(id, 0);
      this.lockWeapon(id, LADDER[0]);
      this.scoreboard.set(id, 1);            // shown as stage number
    }
  }

  onCombat(sid, tid, weapon, kill) {
    if (!kill) return;
    const lvl = (this._level.get(sid) ?? 0) + 1;
    const p   = this.players.get(sid);
    if (lvl >= LADDER.length) { this.end({ type: 'player', id: sid, name: p?.name }); return; }
    this._level.set(sid, lvl);
    this.lockWeapon(sid, LADDER[lvl]);
    this.scoreboard.set(sid, lvl + 1);
    this.send(sid, { type: 'mg_event', event: 'levelup', level: lvl + 1, total: LADDER.length });
  }
}

/* ───────────────────────────── Sniper Duel ──────────────────────────────── */
class SniperDuel extends MiniGame {
  static meta = { id: 'sniper_duel', name: 'Sniper Duell', minPlayers: 2, maxPlayers: 8,
    teams: false, durationSec: 240, implemented: true,
    description: 'Nur One-Hit-Sniper. Erster mit 10 Kills gewinnt.' };

  onStart() { this.setupCombat(); this.lockWeaponAll('sniper'); this._target = 10; }

  onCombat(sid, tid, weapon, kill) {
    if (!kill) return;
    this.scoreboard.add(sid, 1);
    const p = this.players.get(sid);
    if (this.scoreboard.get(sid) >= this._target) this.end({ type: 'player', id: sid, name: p?.name });
  }
}

/* ────────────────────────── One in the Chamber ──────────────────────────── */
class OneInTheChamber extends MiniGame {
  static meta = { id: 'one_chamber', name: 'One in the Chamber', minPlayers: 2, maxPlayers: 8,
    teams: false, durationSec: 240, implemented: true,
    description: 'Sniper mit genau 1 Schuss – Treffer gibt Munition zurück.' };

  onStart() {
    this.setupCombat();
    this.lockWeaponAll('sniper');
    this._target = 15;
    for (const p of this.players.values()) p.ammo.sniper = 1;
  }

  // Keep everyone at exactly one round in the chamber.
  onUpdate() { for (const p of this.alivePlayers()) if (p.ammo.sniper > 1) p.ammo.sniper = 1; }

  onCombat(sid, tid, weapon, kill) {
    if (!kill) return;
    this.scoreboard.add(sid, 1);
    const p = this.players.get(sid);
    if (p) p.ammo.sniper = 1;               // refund the shot on a hit
    if (this.scoreboard.get(sid) >= this._target) this.end({ type: 'player', id: sid, name: p?.name });
  }
}

/* ────────────────────────────── TNT Tag ─────────────────────────────────── */
class TntTag extends MiniGame {
  static meta = { id: 'tnt_tag', name: 'TNT Tag', minPlayers: 3, maxPlayers: 8,
    teams: false, durationSec: 0, implemented: true,
    description: 'Gib die Bombe per Treffer weiter, bevor der Timer sie zündet!' };

  onStart() {
    this.setupCombat();
    this.lockWeaponAll('pistol');
    this._roundSec  = 25;
    this._cooldown  = 1500;
    this._timer     = this._roundSec;
    this._lastPass  = 0;
    this._setTagged(this._randomAlive());
  }

  onUpdate(dt) {
    this._timer -= dt;
    if (this._timer <= 0) this._explode();
  }

  onCombat(sid, tid) {
    // Hits never kill in TNT Tag — heal the victim back to full.
    const target = this.players.get(tid);
    if (target) { target.health = 100; target.dead = false; }
    if (sid !== this._tagged) return;
    if (Date.now() - this._lastPass < this._cooldown) return;
    if (!target || target.eliminated) return;
    this._setTagged(tid);
  }

  _setTagged(id) {
    this._tagged   = id;
    this._lastPass = Date.now();
    const p = this.players.get(id);
    this.broadcast({ type: 'mg_event', event: 'tagged', id, name: p?.name });
  }

  _explode() {
    if (this._tagged) this.eliminate(this._tagged);
    if (this.phase === 'running') { this._setTagged(this._randomAlive()); this._timer = this._roundSec; }
  }

  _randomAlive() {
    const a = this.alivePlayers();
    return a.length ? a[(Math.random() * a.length) | 0].id : null;
  }

  checkWin() {
    const a = this.alivePlayers();
    if (this.players.size >= 2 && a.length <= 1)
      return a[0] ? { type: 'player', id: a[0].id, name: a[0].name } : { type: 'draw' };
    return null;
  }
}

/* ───────────────────── Scaffolded (coming soon) modes ────────────────────── */
class BowSpleef extends MiniGame {
  static meta = { id: 'bow_spleef', name: 'Bow Spleef', minPlayers: 2, maxPlayers: 8, teams: false, durationSec: 0,
    implemented: false, description: 'Zerbrechliche Plattform wegschießen. (bald)' };
}
class CaptureTheFlag extends MiniGame {
  static meta = { id: 'ctf', name: 'Capture the Flag', minPlayers: 4, maxPlayers: 12, teams: true, durationSec: 300,
    implemented: false, description: 'Zwei Teams, Flaggen. (bald)' };
}
class Payload extends MiniGame {
  static meta = { id: 'payload', name: 'Payload', minPlayers: 4, maxPlayers: 12, teams: true, durationSec: 240,
    implemented: false, description: 'Lore eskortieren. (bald)' };
}
class ZombieSurvival extends MiniGame {
  static meta = { id: 'zombie_survival', name: 'Zombie Survival', minPlayers: 1, maxPlayers: 6, teams: false, durationSec: 0,
    implemented: false, description: 'Mob-Wellen überstehen. (bald)' };
}

// ── Registry (id → class). Order = display order in the hub. ──────────────────
export const MODES = {
  [TargetRush.meta.id]:      TargetRush,
  [LastManStanding.meta.id]: LastManStanding,
  [GunGame.meta.id]:         GunGame,
  [SniperDuel.meta.id]:      SniperDuel,
  [OneInTheChamber.meta.id]: OneInTheChamber,
  [TntTag.meta.id]:          TntTag,
  [BowSpleef.meta.id]:       BowSpleef,
  [CaptureTheFlag.meta.id]:  CaptureTheFlag,
  [Payload.meta.id]:         Payload,
  [ZombieSurvival.meta.id]:  ZombieSurvival,
};
