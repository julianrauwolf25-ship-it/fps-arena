// GameTimer.js — a simple count-down / count-up timer driven by the server tick.
//
// Modes use it for round duration, countdowns, tag-bomb fuses, wave breaks, etc.
// It is *tick-driven* (you call update(dt) each server tick) so it stays in
// lockstep with the authoritative simulation — no wall-clock drift.

export class GameTimer {
  /**
   * @param {number}   seconds   starting value
   * @param {function} onExpire  called once when a counting-down timer hits 0
   */
  constructor(seconds = 0, onExpire = null) {
    this.remaining = seconds;
    this.onExpire  = onExpire;
    this.running   = false;
    this._fired    = false;
  }

  start(seconds = this.remaining) {
    this.remaining = seconds;
    this.running   = true;
    this._fired    = false;
    return this;
  }

  stop()  { this.running = false; }
  reset() { this.running = false; this.remaining = 0; this._fired = false; }

  // dt in seconds, called every tick by the owning mode.
  update(dt) {
    if (!this.running) return;
    this.remaining -= dt;
    if (this.remaining <= 0 && !this._fired) {
      this.remaining = 0;
      this.running   = false;
      this._fired    = true;
      this.onExpire?.();
    }
  }

  // Whole seconds remaining (for HUD display).
  get seconds() { return Math.max(0, Math.ceil(this.remaining)); }
}
