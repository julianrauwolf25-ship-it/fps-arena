// LocalPlayer.js — client-side prediction + reconciliation
// The client simulates its own movement immediately so controls feel instant.
// When a server snapshot arrives, we reconcile if the discrepancy is large.

import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_JUMP, GRAVITY,
  PLAYER_EYE_OFFSET, ARENA_HALF, MAX_AMMO, RELOAD_TIME,
} from '../../shared/constants.js';

const MOUSE_SENS    = 0.0018;
const RECONCILE_DST = 2.0; // metres — snap to server if further than this

export class LocalPlayer {
  constructor() {
    // Physics (y = feet)
    this.x  = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround = false;

    // Look angles
    this.yaw   = 0;
    this.pitch = 0;

    // State
    this.health    = 100;
    this.ammo      = MAX_AMMO;
    this.reloading = false;
    this.dead      = false;
    this.kills     = 0;
    this.deaths    = 0;

    // Input state read by Game.js
    this.keys = { forward: false, back: false, left: false, right: false, jump: false, sprint: false };

    this._inputSeq  = 0;
    this._history   = []; // { seq, x, y, z } for reconciliation

    this._registerInputHandlers();
  }

  _registerInputHandlers() {
    const map = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back',    ArrowDown: 'back',
      KeyA: 'left',    ArrowLeft: 'left',
      KeyD: 'right',   ArrowRight: 'right',
      Space: 'jump',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
    };

    window.addEventListener('keydown', (e) => {
      if (map[e.code]) { this.keys[map[e.code]] = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.code]) this.keys[map[e.code]] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.yaw   -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      this.pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });
  }

  // Called each animation frame with real dt
  update(dt) {
    if (this.dead) return;

    const speed = this.keys.sprint ? PLAYER_SPRINT : PLAYER_SPEED;
    const cos   = Math.cos(this.yaw);
    const sin   = Math.sin(this.yaw);

    let mx = 0, mz = 0;
    if (this.keys.forward) { mx -= sin; mz -= cos; }
    if (this.keys.back)    { mx += sin; mz += cos; }
    if (this.keys.left)    { mx -= cos; mz += sin; }
    if (this.keys.right)   { mx += cos; mz -= sin; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx = (mx / len) * speed; mz = (mz / len) * speed; }

    this.vx = mx;
    this.vz = mz;

    if (this.keys.jump && this.onGround) {
      this.vy       = PLAYER_JUMP;
      this.onGround = false;
    }

    this.vy += GRAVITY * dt;
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.z  += this.vz * dt;

    if (this.y <= 1) { this.y = 1; this.vy = 0; this.onGround = true; }
    else              { this.onGround = false; }

    this.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.x));
    this.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.z));

    // Store for reconciliation
    this._inputSeq++;
    this._history.push({ seq: this._inputSeq, x: this.x, y: this.y, z: this.z });
    if (this._history.length > 120) this._history.shift();
  }

  // Called when a server snapshot arrives for *our own* player entry
  reconcile(serverState) {
    if (!serverState) return;

    // Update authoritative non-physics state
    this.health    = serverState.health;
    this.ammo      = serverState.ammo;
    this.reloading = serverState.reloading;
    this.dead      = serverState.dead;
    this.kills     = serverState.kills;
    this.deaths    = serverState.deaths;

    // Position reconciliation: only snap if we're far off
    const dx  = serverState.x - this.x;
    const dy  = serverState.y - this.y;
    const dz  = serverState.z - this.z;
    const dst = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dst > RECONCILE_DST) {
      this.x = serverState.x;
      this.y = serverState.y;
      this.z = serverState.z;
    }
  }

  // Returns the current input snapshot to send to server
  currentInput() {
    return {
      forward: this.keys.forward,
      back:    this.keys.back,
      left:    this.keys.left,
      right:   this.keys.right,
      jump:    this.keys.jump,
      sprint:  this.keys.sprint,
      yaw:     this.yaw,
      pitch:   this.pitch,
    };
  }

  // Eye-level position for camera placement
  eyePosition() {
    return { x: this.x, y: this.y + PLAYER_EYE_OFFSET, z: this.z };
  }

  get seq() { return this._inputSeq; }
}
