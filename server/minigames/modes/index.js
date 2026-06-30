// modes/index.js — the registry of every selectable mini-game.
//
// The hub UI is built from MODES, and the GameManager instantiates from it.
// Adding a mode = implement a MiniGame subclass + register it here. Nothing
// else in the framework needs to change.
//
// STATUS:
//   ✅ TargetRush      — fully implemented reference mode
//   🚧 the other nine  — scaffolded with final meta + the hooks each needs.
//      Each `onStart/onUpdate/onPlayerHit/checkWin` is stubbed with the exact
//      rules to fill in, so they slot straight into the framework.

import { MiniGame }   from '../MiniGame.js';
import { TargetRush } from './TargetRush.js';
import { GUN_GAME_LADDER } from '../weapons.js';

/* ───────────────────────── Scaffolded modes ─────────────────────────────────
 * These compile and run (they sit in LOBBY/COUNTDOWN fine); the TODO marks the
 * mode-specific rules still to implement against the framework hooks.            */

class BowSpleef extends MiniGame {
  static meta = { id: 'bow_spleef', name: 'Bow Spleef', minPlayers: 2, maxPlayers: 8, teams: false, durationSec: 0,
    description: 'Schieße zerbrechliche Wollblöcke unter Gegnern weg. Wer fällt, fliegt raus.' };
  onStart() { /* TODO: build a breakable-block floor grid (destructible tiles) */ }
  onPlayerShoot(id, shot) { /* TODO: raycast arrow → break the tile it hits */ }
  onUpdate(dt) { /* TODO: eliminate players who fell below the floor */ }
  checkWin() { const a = this.alivePlayers(); return a.length <= 1 ? (a[0] && { type: 'player', id: a[0].id, name: a[0].name }) : null; }
}

class TntTag extends MiniGame {
  static meta = { id: 'tnt_tag', name: 'TNT Tag', minPlayers: 3, maxPlayers: 10, teams: false, durationSec: 30,
    description: 'Der Markierte muss die Bombe per Pfeiltreffer weitergeben, bevor der Timer abläuft.' };
  onStart() { /* TODO: pick a random "it"; start the fuse timer */ }
  onPlayerHit(shooter, target) { /* TODO: if shooter is "it", pass the bomb to target */ }
  onUpdate(dt) { /* TODO: on fuse expiry, eliminate the current "it", reset fuse */ }
  checkWin() { const a = this.alivePlayers(); return a.length <= 1 ? (a[0] && { type: 'player', id: a[0].id, name: a[0].name }) : null; }
}

class GunGame extends MiniGame {
  static meta = { id: 'gun_game', name: 'Gun Game', minPlayers: 2, maxPlayers: 12, teams: false, durationSec: 0,
    description: 'Jeder Kill schaltet die nächste Waffenstufe frei. Wer die Leiter zuerst durchläuft, gewinnt.' };
  ladder = GUN_GAME_LADDER;
  onStart() { for (const p of this.players.values()) p._level = 0; }
  onPlayerHit(shooter) { /* TODO: on kill, advance shooter._level; win at ladder end */ }
  checkWin() { for (const p of this.players.values()) if (p._level >= this.ladder.length) return { type: 'player', id: p.id, name: p.name }; return null; }
}

class OneInTheChamber extends MiniGame {
  static meta = { id: 'one_chamber', name: 'One in the Chamber', minPlayers: 2, maxPlayers: 10, teams: false, durationSec: 0,
    description: 'Ein Pfeil, ein Schwert — ein Treffer tötet. Treffer gibt den Pfeil zurück. Letzter gewinnt.' };
  onStart() { for (const p of this.players.values()) p._arrows = 1; }
  onPlayerHit(shooter, target) { /* TODO: instant kill; refund shooter arrow; eliminate target */ }
  checkWin() { const a = this.alivePlayers(); return a.length <= 1 ? (a[0] && { type: 'player', id: a[0].id, name: a[0].name }) : null; }
}

class SniperDuel extends MiniGame {
  static meta = { id: 'sniper_duel', name: 'Sniper Duell', minPlayers: 2, maxPlayers: 8, teams: false, durationSec: 180,
    description: 'Offenes Gelände mit Deckung, nur One-Hit-Bögen. Zielgenauigkeit entscheidet.' };
  onStart() { /* TODO: give everyone power_bow; spawn across the open map */ }
  onPlayerHit(shooter, target) { /* TODO: one-shot kill; +1 score; respawn target */ }
  checkWin() { const l = this.scoreboard.leader(); return l && l.score >= 10 ? { type: 'player', id: l.id, name: l.name } : null; }
}

class LastManStanding extends MiniGame {
  static meta = { id: 'last_man', name: 'Last Man Standing', minPlayers: 2, maxPlayers: 12, teams: false, durationSec: 0,
    description: 'Free-for-all mit zufälligen Waffen-Drops. Jeder gegen jeden bis einer übrig ist.' };
  onStart() { /* TODO: scatter random weapon pickups; no respawns */ }
  onPlayerHit(shooter, target) { /* TODO: damage; eliminate on death */ }
  checkWin() { const a = this.alivePlayers(); return a.length <= 1 ? (a[0] && { type: 'player', id: a[0].id, name: a[0].name }) : null; }
}

class CaptureTheFlag extends MiniGame {
  static meta = { id: 'ctf', name: 'Capture the Flag', minPlayers: 4, maxPlayers: 12, teams: true, durationSec: 300,
    description: 'Zwei Teams: verteidige deine Flagge, stiehl die gegnerische. Fernkampf entscheidet.' };
  onStart() { /* TODO: create two Teams + flags at each base; assign balanced teams */ }
  onUpdate(dt) { /* TODO: flag carry/capture/return logic, team scoring */ }
  checkWin() { for (const t of this.teams.values()) if (t.score >= 3) return { type: 'team', id: t.id, name: t.name }; return null; }
}

class Payload extends MiniGame {
  static meta = { id: 'payload', name: 'Payload', minPlayers: 4, maxPlayers: 12, teams: true, durationSec: 240,
    description: 'Ein Team eskortiert die Lore über Kontrollpunkte, das andere blockt ab.' };
  onStart() { /* TODO: spawn the cart on a path; attackers/defenders teams */ }
  onUpdate(dt) { /* TODO: move cart while attackers nearby & no defenders contest */ }
  checkWin() { /* TODO: attackers win at final checkpoint, else defenders on timeout */ return null; }
}

class ZombieSurvival extends MiniGame {
  static meta = { id: 'zombie_survival', name: 'Zombie Survival', minPlayers: 1, maxPlayers: 6, teams: false, durationSec: 0,
    description: 'Überlebe Wellen von Gegnern, kaufe Upgrades. So viele Wellen wie möglich.' };
  onStart() { this._wave = 0; /* TODO: spawn AI mobs per wave; shop between waves */ }
  onUpdate(dt) { /* TODO: wave manager; advance when all mobs dead */ }
  checkWin() { const a = this.alivePlayers(); return a.length === 0 ? { type: 'coop_end', wave: this._wave } : null; }
}

// ── The registry (id → class). Order = display order in the hub. ──────────────
export const MODES = {
  [TargetRush.meta.id]:      TargetRush,
  [BowSpleef.meta.id]:       BowSpleef,
  [TntTag.meta.id]:          TntTag,
  [GunGame.meta.id]:         GunGame,
  [OneInTheChamber.meta.id]: OneInTheChamber,
  [SniperDuel.meta.id]:      SniperDuel,
  [LastManStanding.meta.id]: LastManStanding,
  [CaptureTheFlag.meta.id]:  CaptureTheFlag,
  [Payload.meta.id]:         Payload,
  [ZombieSurvival.meta.id]:  ZombieSurvival,
};
