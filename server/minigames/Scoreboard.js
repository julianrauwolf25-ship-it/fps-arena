// Scoreboard.js — per-player score tracking with ranking + winner detection.
//
// Generic enough for every mode: "score" can mean kills, hits, captures,
// waves survived, etc. Modes decide what they add points for.

export class Scoreboard {
  constructor() {
    this._scores = new Map(); // playerId → number
    this._meta   = new Map(); // playerId → { name } for display
  }

  register(playerId, name) {
    if (!this._scores.has(playerId)) this._scores.set(playerId, 0);
    this._meta.set(playerId, { name });
  }

  remove(playerId) { this._scores.delete(playerId); this._meta.delete(playerId); }

  add(playerId, n = 1) {
    this._scores.set(playerId, (this._scores.get(playerId) ?? 0) + n);
  }

  set(playerId, n)  { this._scores.set(playerId, n); }
  get(playerId)     { return this._scores.get(playerId) ?? 0; }
  reset()           { for (const id of this._scores.keys()) this._scores.set(id, 0); }

  // Players sorted best-first.
  ranking() {
    return [...this._scores.entries()]
      .map(([id, score]) => ({ id, name: this._meta.get(id)?.name ?? '?', score }))
      .sort((a, b) => b.score - a.score);
  }

  // The single leader (or null on an empty/tied-at-zero board).
  leader() {
    const r = this.ranking();
    return r.length && r[0].score > 0 ? r[0] : null;
  }

  toJSON() { return this.ranking(); }
}
