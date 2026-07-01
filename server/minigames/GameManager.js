// GameManager.js — owns all mini-game instances and routes players between the
// hub and the games. This is the single integration point with the rest of the
// server: it talks to the world through a small `host` adapter so the framework
// stays decoupled from the netcode.
//
//   host = {
//     broadcastTo(ids, msg),     // send a JSON message to a set of player ids
//     getPlayer(id),             // → the server's player object
//     teleport(player, pos),     // move a player (used for spawns)
//     sendToHub(player),         // put a player back in the lobby/hub world
//   }
//
// Flow:
//   player picks a mode at a hub sign  →  joinQueue(playerId, modeId)
//   GameManager finds/creates that mode's instance (its LOBBY)
//   instance auto-starts countdown when minPlayers reached
//   GameManager.update(dt) ticks every active instance each server tick
//   instance ends → returnToHub() clears it and frees the players

import { MODES } from './modes/index.js';

export class GameManager {
  constructor(host) {
    this.host    = host;
    this.modes   = MODES;                 // id → mode class
    this.games   = new Map();             // modeId → live MiniGame instance
    this.playerGame = new Map();          // playerId → modeId (where a player is)
  }

  // ── Registry ─────────────────────────────────────────────────────────────────

  /** Catalogue for the hub UI: every selectable mode + its metadata. */
  catalogue() {
    return Object.values(this.modes).map(M => ({
      id:          M.meta.id,
      name:        M.meta.name,
      description: M.meta.description,
      minPlayers:  M.meta.minPlayers,
      maxPlayers:  M.meta.maxPlayers,
      teams:       M.meta.teams,
      implemented: !!M.meta.implemented,
      players:     this.games.get(M.meta.id)?.players.size ?? 0,
      phase:       this.games.get(M.meta.id)?.phase ?? 'lobby',
    }));
  }

  // ── Join / leave ─────────────────────────────────────────────────────────────

  joinQueue(playerId, modeId) {
    const ModeClass = this.modes[modeId];
    const player    = this.host.getPlayer(playerId);
    if (!ModeClass || !player) return;

    // Scaffolded modes can't be played yet — tell the client so it can show a
    // "coming soon" notice instead of trapping the player in an empty lobby.
    if (!ModeClass.meta.implemented) {
      this.host.broadcastTo([playerId], { type: 'mg_notice', text: `${ModeClass.meta.name} folgt bald!` });
      return;
    }

    // Already in a game? Pull them out of it first.
    this.leaveGame(playerId);

    // Reuse the open instance for this mode or spin up a fresh one.
    let game = this.games.get(modeId);
    if (!game) { game = new ModeClass(this); this.games.set(modeId, game); }
    if (game.players.size >= game.meta.maxPlayers) return; // full

    this.playerGame.set(playerId, modeId);
    game.addPlayer(player);
  }

  leaveGame(playerId) {
    const modeId = this.playerGame.get(playerId);
    if (!modeId) return;
    this.playerGame.delete(playerId);
    this.games.get(modeId)?.removePlayer(playerId);
    this.host.sendToHub(this.host.getPlayer(playerId));
  }

  /** Is this player currently inside a mini-game (not the hub)? */
  inGame(playerId) { return this.playerGame.has(playerId); }
  gameOf(playerId) { return this.games.get(this.playerGame.get(playerId)); }

  // ── Per-tick driver ──────────────────────────────────────────────────────────

  update(dt) {
    for (const game of this.games.values()) game.update(dt);
  }

  // Forward gameplay events from the server into the player's active mode.
  onShoot(playerId, shot) { this.gameOf(playerId)?.onPlayerShoot?.(playerId, shot); }

  /** A player hit/killed another. Routed only if both are in the SAME game. */
  onCombat(shooterId, targetId, weapon, kill, headshot) {
    const g = this.gameOf(shooterId);
    if (g && g === this.gameOf(targetId) && g.phase === 'running') {
      g.onCombat?.(shooterId, targetId, weapon, kill, headshot);
    }
  }

  /** Generic mode-specific action (e.g. Build Battle place/remove). */
  onAction(playerId, action) { this.gameOf(playerId)?.onPlayerAction?.(playerId, action); }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  /** Called by an instance after its ENDING phase: free players + drop it. */
  returnToHub(game) {
    for (const id of game.players.keys()) {
      this.playerGame.delete(id);
      this.host.sendToHub(this.host.getPlayer(id));
    }
    this.games.delete(game.meta.id);
  }

  broadcastTo(ids, msg) { this.host.broadcastTo([...ids], msg); }
}
