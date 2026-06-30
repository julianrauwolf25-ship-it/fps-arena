import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_ADS_MULT, PLAYER_JUMP, GRAVITY,
  PLAYER_EYE_OFFSET, WORLD_BOUNDS, WEAPONS, WEAPON_KEYS,
} from '../../shared/constants.js';
import { moveAndCollide } from '../../shared/collision.js';
import { applyParkour }   from '../../shared/parkour.js';

const MOUSE_SENS    = 0.0018;
const RECONCILE_DST = 5.0;  // beyond this, snap instantly (respawn/teleport)

export class LocalPlayer {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround  = false;
    this.yaw       = 0;
    this.pitch     = 0;
    this.ads       = false;

    // Previous physics-step position, for render interpolation (smooth motion
    // while physics runs at a fixed timestep). Kept in sync on teleports.
    this._prevX = 0; this._prevY = 0; this._prevZ = 0;

    // Head-bob + landing-squish (client-only, cosmetic)
    this._bobPhase   = 0;   // oscillator phase
    this._bobAmt     = 0;   // current bob magnitude
    this._squish     = 0;   // camera dip on landing
    this._prevVy     = 0;
    this._prevGround = false;

    // Weapon
    this.currentWeapon = 'pistol';
    this.ammo          = WEAPONS.pistol.ammo;
    this.reloading     = false;

    // State
    this.health = 100;
    this.dead   = false;
    this.kills  = 0;
    this.deaths = 0;

    // Parkour
    this.parkourCP = null;

    // Callbacks wired by main.js
    this.onWeaponSwitch = null;
    this.onReload       = null;
    this.onCheckpoint   = null;

    this.keys = { forward: false, back: false, left: false, right: false, jump: false, sprint: false };
    this._inputSeq = 0;
    this._history  = [];

    this._setupInputs();
  }

  _setupInputs() {
    const keyMap = {
      KeyW: 'forward', ArrowUp:    'forward',
      KeyS: 'back',    ArrowDown:  'back',
      KeyA: 'left',    ArrowLeft:  'left',
      KeyD: 'right',   ArrowRight: 'right',
      Space:      'jump',
      ShiftLeft:  'sprint',
      ShiftRight: 'sprint',
    };

    window.addEventListener('keydown', (e) => {
      if (this.dead) return;
      if (keyMap[e.code]) { this.keys[keyMap[e.code]] = true; e.preventDefault(); }
      if (e.code === 'Digit1') this._switchWeapon('pistol');
      if (e.code === 'Digit2') this._switchWeapon('rifle');
      if (e.code === 'Digit3') this._switchWeapon('shotgun');
      if (e.code === 'Digit4') this._switchWeapon('sniper');
      if (e.code === 'KeyR' && !this.reloading && this.ammo < WEAPONS[this.currentWeapon].ammo) {
        this.reloading = true;
        this.onReload?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (keyMap[e.code]) this.keys[keyMap[e.code]] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.yaw   -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      this.pitch  = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this.pitch));
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 2 && document.pointerLockElement) { this.ads = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup',   (e) => { if (e.button === 2) this.ads = false; });
    window.addEventListener('contextmenu', (e) => { if (document.pointerLockElement) e.preventDefault(); });
  }

  _switchWeapon(id) {
    if (this.reloading || this.currentWeapon === id) return;
    this.currentWeapon = id;
    this.onWeaponSwitch?.(id);
  }

  update(dt) {
    if (this.dead) return;

    const base  = this.keys.sprint ? PLAYER_SPRINT : PLAYER_SPEED;
    const speed = this.ads ? base * PLAYER_ADS_MULT : base;
    const cos   = Math.cos(this.yaw);
    const sin   = Math.sin(this.yaw);

    let mx = 0, mz = 0;
    if (this.keys.forward) { mx -= sin; mz -= cos; }
    if (this.keys.back)    { mx += sin; mz += cos; }
    if (this.keys.left)    { mx -= cos; mz += sin; }
    if (this.keys.right)   { mx += cos; mz -= sin; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx = (mx / len) * speed; mz = (mz / len) * speed; }

    this.vx = mx; this.vz = mz;

    if (this.keys.jump && this.onGround) { this.vy = PLAYER_JUMP; this.onGround = false; }
    this.vy += GRAVITY * dt;

    this._prevVy     = this.vy;
    this._prevGround = this.onGround;

    // Collide with map geometry (shared logic)
    const c = moveAndCollide(this.x, this.y, this.z, this.vx, this.vy, this.vz, dt, this.onGround);
    this.x = c.px; this.y = c.py; this.z = c.pz;
    this.vx = c.vx; this.vy = c.vy; this.vz = c.vz;
    this.onGround = c.onGround;

    this.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, this.x));
    this.z = Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, this.z));

    // ── Parkour: checkpoint capture + void respawn (predicted locally) ──────
    const pk = applyParkour(this, this.parkourCP);
    this.x = pk.x; this.y = pk.y; this.z = pk.z;
    this.vx = pk.vx; this.vy = pk.vy; this.vz = pk.vz;
    this.parkourCP = pk.cp;
    if (pk.newCheckpoint) this.onCheckpoint?.();
    // A void-respawn is a teleport — kill interpolation so the camera doesn't
    // slingshot across the gap for one frame.
    if (pk.respawned) { this._prevX = this.x; this._prevY = this.y; this._prevZ = this.z; }

    // ── Head bob ──────────────────────────────────────────────────────────
    const moving = this.onGround && (mx !== 0 || mz !== 0);
    const bobSpeed = this.keys.sprint ? 11 : 7.5;
    if (moving) {
      this._bobPhase += dt * bobSpeed;
      this._bobAmt    = Math.min(this._bobAmt + dt * 6, 1);
    } else {
      this._bobAmt = Math.max(0, this._bobAmt - dt * 8);
    }

    // ── Landing squish ─────────────────────────────────────────────────────
    const justLanded = !this._prevGround && this.onGround;
    if (justLanded) {
      const impact = Math.abs(this._prevVy);
      this._squish = Math.min(0.18, impact * 0.007);
    }
    this._squish *= Math.pow(0.04, dt); // quick spring recovery

    this._inputSeq++;
    this._history.push({ seq: this._inputSeq, x: this.x, y: this.y, z: this.z });
    if (this._history.length > 120) this._history.shift();
  }

  reconcile(s) {
    if (!s) return;
    this.health    = s.health;
    this.ammo      = s.ammo;
    this.reloading = s.reloading;
    this.dead      = s.dead;
    this.kills     = s.kills;
    this.deaths    = s.deaths;

    // Smooth reconciliation: instead of a hard snap (which causes visible
    // stutter/rubber-banding), gently converge toward the authoritative
    // position. Small client/server drift is corrected over a few snapshots;
    // only a large divergence (respawn / teleport) snaps instantly.
    const dx = s.x - this.x, dy = s.y - this.y, dz = s.z - this.z;
    const d2 = dx*dx + dy*dy + dz*dz;
    if (d2 > RECONCILE_DST ** 2) {
      // Big jump → snap (e.g. respawn). Sync interpolation to avoid a slingshot.
      this.x = s.x; this.y = s.y; this.z = s.z; this.vy = s.vy ?? this.vy;
      this._prevX = this.x; this._prevY = this.y; this._prevZ = this.z;
    } else {
      // Deadzone: ignore sub-centimetre drift so the view never micro-jitters.
      const DEAD = 0.04;
      if (Math.abs(dx) > DEAD) this.x += dx * 0.2;
      if (Math.abs(dz) > DEAD) this.z += dz * 0.2;
      // VERTICAL: only correct while grounded. Mid-air, the server (20 Hz) and
      // client (fixed step) integrate the jump arc slightly differently, so Y
      // briefly diverges; correcting it every snapshot yanks the camera. On the
      // ground both clamp to the same floor/box height, so they re-sync cleanly.
      if (this.onGround && Math.abs(dy) > DEAD) this.y += dy * 0.2;
    }
  }

  // Snapshot current position before a fixed physics step (for interpolation).
  savePrev() {
    this._prevX = this.x; this._prevY = this.y; this._prevZ = this.z;
  }

  currentInput() {
    return {
      forward: this.keys.forward, back:   this.keys.back,
      left:    this.keys.left,    right:  this.keys.right,
      jump:    this.keys.jump,    sprint: this.keys.sprint,
      ads:     this.ads,
      weapon:  this.currentWeapon,
      yaw:     this.yaw,
      pitch:   this.pitch,
    };
  }

  // Eye position, interpolated between the previous and current physics step by
  // `alpha` (0..1) for buttery-smooth motion regardless of framerate. No walking
  // head-bob; only the brief landing-squish dip remains.
  eyePosition(alpha = 1) {
    const ix = this._prevX + (this.x - this._prevX) * alpha;
    const iy = this._prevY + (this.y - this._prevY) * alpha;
    const iz = this._prevZ + (this.z - this._prevZ) * alpha;
    return {
      x: ix,
      y: iy + PLAYER_EYE_OFFSET - this._squish,
      z: iz,
    };
  }

  // Camera lean disabled along with the head-bob.
  get bobRoll() { return 0; }

  get seq() { return this._inputSeq; }
}
