// Team.js — a coloured team with members and a shared score.
// Used by team modes (Capture the Flag, Payload); FFA modes simply don't use it.

export class Team {
  /**
   * @param {string} id      machine id, e.g. 'red'
   * @param {string} name    display name, e.g. 'Rote Mannschaft'
   * @param {number} color   hex colour for HUD/labels
   * @param {object} spawn   { x, y, z } team spawn point
   */
  constructor(id, name, color, spawn) {
    this.id      = id;
    this.name    = name;
    this.color   = color;
    this.spawn   = spawn;
    this.members = new Set(); // player ids
    this.score   = 0;
  }

  add(playerId)    { this.members.add(playerId); }
  remove(playerId) { this.members.delete(playerId); }
  has(playerId)    { return this.members.has(playerId); }
  get size()       { return this.members.size; }

  addScore(n = 1)  { this.score += n; }
  reset()          { this.score = 0; this.members.clear(); }

  toJSON() {
    return { id: this.id, name: this.name, color: this.color, score: this.score, size: this.size };
  }
}

// Balanced auto-assignment: drop the next player onto the smaller team.
export function pickSmallerTeam(teams) {
  return [...teams].sort((a, b) => a.size - b.size)[0];
}
