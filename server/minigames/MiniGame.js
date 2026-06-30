// MiniGame.js — abstract base class every mode extends.
//
// It owns the SHARED machinery so individual modes only implement their unique
// rules. The lifecycle (LOBBY→COUNTDOWN→RUNNING→ENDING→RESET) is handled here;
// modes plug in via the documented hooks below.
//
// A mode subclass typically overrides:
//   static meta            – id, name, description, player counts, teams?
//   onStart()              – set up the arena, hand out weapons, spawn players
//   onUpdate(dt)           – per-tick rules (the core of the mode)
//   onPlayerHit(a, b, w)   – what a hit means in this mode
//   checkWin()             – return a winner descriptor, or null to keep going
//   onReset()              – tear down anything onStart() created
//
// Everything else (countdown, timer, scoreboard broadcast, player join/leave,
// auto-reset) is free.

import { Phase }      from './GamePhase.js';
import { GameTimer }  from './GameTimer.js';
import { Scoreboard } from './Scoreboard.js';

const COUNTDOWN_SECONDS = 5;
const ENDING_SECONDS    = 6;

export class MiniGame {
  // Subclasses override this. Defaults are sensible for a small FFA mode.
  static meta = {
    id:          'base',
    name:        'Base Game',
    description: '',
    minPlayers:  2,
    maxPlayers:  8,
    teams:       false,   // true → mode uses Team objects
    durationSec: 120,     // round length (0 = until win condition only)
  };

  /**
   * @param {GameManager} manager  back-reference for broadcasting & lifecycle
   */
  constructor(manager) {
    this.manager = manager;
    this.meta    = this.constructor.meta;

    this.phase      = Phase.LOBBY;
    this.players    = new Map();           // id → player handle (from the server)
    this.teams      = new Map();           // id → Team (team modes only)
    this.scoreboard = new Scoreboard();

    // Countdown / round timers (tick-driven, set up in transitions)
    this.countdown = new GameTimer(0, () => this._beginRound());
    this.roundTimer = new GameTimer(0, () => this._onTimeUp());

    this._endTimer = 0; // seconds left in the ENDING phase before RESET
  }

  // ── Player flow ─────────────────────────────────────────────────────────────

  addPlayer(player) {
    this.players.set(player.id, player);
    this.scoreboard.register(player.id, player.name);
    this.onPlayerJoin?.(player);
    // Enough players waiting → kick off the countdown.
    if (this.phase === Phase.LOBBY && this.players.size >= this.meta.minPlayers) {
      this._startCountdown();
    }
    this._broadcastState();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.scoreboard.remove(id);
    for (const t of this.teams.values()) t.remove(id);
    this.onPlayerLeave?.(p);
    // Dropped below the minimum mid-game → abort back to lobby.
    if (this.phase === Phase.RUNNING && this.players.size < this.meta.minPlayers) {
      this._abort('Zu wenige Spieler');
    }
    this._broadcastState();
  }

  // ── Lifecycle transitions ────────────────────────────────────────────────────

  _startCountdown() {
    this.phase = Phase.COUNTDOWN;
    this.countdown.start(COUNTDOWN_SECONDS);
    this.onCountdown?.();
    this._broadcastState();
  }

  _beginRound() {
    this.phase = Phase.RUNNING;
    this.scoreboard.reset();
    for (const t of this.teams.values()) t.score = 0;
    if (this.meta.durationSec > 0) this.roundTimer.start(this.meta.durationSec);
    this.onStart?.();
    this._broadcastState();
  }

  _onTimeUp() {
    // Time ran out → whoever is ahead wins (mode may override checkWin()).
    const winner = this.checkWin?.() ?? this._defaultWinnerByScore();
    this.end(winner ?? { type: 'draw' });
  }

  /** End the round and show results, then auto-reset. */
  end(winner) {
    if (this.phase === Phase.ENDING || this.phase === Phase.RESET) return;
    this.phase    = Phase.ENDING;
    this.winner   = winner;
    this._endTimer = ENDING_SECONDS;
    this.roundTimer.stop();
    this.onEnd?.(winner);
    this._broadcastState();
  }

  _abort(reason) {
    this.phase   = Phase.LOBBY;
    this.winner  = null;
    this.onReset?.();
    this._broadcastState({ notice: reason });
  }

  // ── Tick — called every server tick by the GameManager ───────────────────────

  update(dt) {
    switch (this.phase) {
      case Phase.COUNTDOWN:
        this.countdown.update(dt);
        break;

      case Phase.RUNNING:
        this.roundTimer.update(dt);
        this.onUpdate?.(dt);
        // Continuous win check (last-man-standing, score cap, etc.)
        const w = this.checkWin?.();
        if (w) this.end(w);
        break;

      case Phase.ENDING:
        this._endTimer -= dt;
        if (this._endTimer <= 0) this._reset();
        break;
    }
    // Push a lightweight state snapshot ~4×/sec for HUD timers.
    this._stateAccum = (this._stateAccum ?? 0) + dt;
    if (this._stateAccum >= 0.25) { this._stateAccum = 0; this._broadcastState(); }
  }

  _reset() {
    this.phase = Phase.RESET;
    this.onReset?.();             // mode restores its arena
    this.scoreboard.reset();
    this.winner = null;
    // Send everyone back to the hub and clear the instance.
    this.manager.returnToHub(this);
  }

  // ── Helpers available to modes ───────────────────────────────────────────────

  broadcast(msg) { this.manager.broadcastTo(this.players.keys(), msg); }

  alivePlayers() { return [...this.players.values()].filter(p => !p._eliminated); }

  eliminate(id) {
    const p = this.players.get(id);
    if (p) p._eliminated = true;
  }

  _defaultWinnerByScore() {
    const leader = this.scoreboard.leader();
    return leader ? { type: 'player', id: leader.id, name: leader.name, score: leader.score } : null;
  }

  // Network state for the client HUD (phase, timer, scores, winner).
  _broadcastState(extra = {}) {
    this.broadcast({
      type:      'mg_state',
      mode:      this.meta.id,
      name:      this.meta.name,
      phase:     this.phase,
      countdown: this.countdown.seconds,
      timeLeft:  this.roundTimer.seconds,
      scores:    this.scoreboard.toJSON(),
      teams:     this.meta.teams ? [...this.teams.values()].map(t => t.toJSON()) : null,
      winner:    this.winner ?? null,
      ...extra,
    });
  }
}
