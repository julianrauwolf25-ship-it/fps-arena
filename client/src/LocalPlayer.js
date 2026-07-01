import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_ADS_MULT, PLAYER_JUMP, GRAVITY,
  PLAYER_EYE_OFFSET, WORLD_BOUNDS, WEAPONS, WEAPON_KEYS,
} from '../../shared/constants.js';
import { moveAndCollide }   from '../../shared/collision.js';
import { applyParkour }     from '../../shared/parkour.js';
import { jumpPadVelocity }  from '../../shared/minigames.js';

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

    // Visual error offset for SMOOTH server reconciliation. A correction is
    // applied to the prediction but visually cancelled here, then decayed to
    // zero over a fraction of a second — so corrections resolve as a smooth
    // glide instead of a per-snapshot pop (the cause of tight-curve jitter).
    this._errX = 0; this._errY = 0; this._errZ = 0;

    // Weapon
    this.currentWeapon = 'pistol';
    this.ammo          = WEAPONS.pistol.ammo;
    this.reloading     = false;
    this.weaponLock    = null;   // set by a mini-game → blocks weapon switching
    this.buildMode     = false;  // true while inside a running Build Battle round

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
      if (e.button === 2 && document.pointerLockElement && !this.buildMode) { this.ads = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup',   (e) => { if (e.button === 2) this.ads = false; });
    window.addEventListener('contextmenu', (e) => { if (document.pointerLockElement) e.preventDefault(); });
  }

  _switchWeapon(id) {
    if (this.weaponLock || this.buildMode) return;   // mini-game forces the weapon / mode
    if (this.reloading || this.currentWeapon === id) return;
    this.currentWeapon = id;
    this.onWeaponSwitch?.(id);
  }

  // Called by the mini-game framework (mg_weapon_lock message).
  setWeaponLock(weaponId) {
    this.weaponLock = weaponId;
    if (weaponId) { this.currentWeapon = weaponId; this.onWeaponSwitch?.(weaponId); }
  }

  // Called by MiniGames.js when entering/leaving a running Build Battle round.
  setBuildMode(active) {
    this.buildMode = active;
    if (active) this.ads = false;
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
    // A void-respawn is a teleport — clear the error offset so the camera
    // doesn't glide across the gap.
    if (pk.respawned) { this._errX = 0; this._errY = 0; this._errZ = 0; }

    // Minigame bounce pads
    const padVy = jumpPadVelocity(this);
    if (padVy !== this.vy) { this.vy = padVy; this.onGround = false; }

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

    const dx = s.x - this.x, dy = s.y - this.y, dz = s.z - this.z;
    const d2 = dx*dx + dy*dy + dz*dz;

    if (d2 > RECONCILE_DST ** 2) {
      // Big divergence → snap instantly (respawn / teleport). Reset smoothing.
      this.x = s.x; this.y = s.y; this.z = s.z; this.vy = s.vy ?? this.vy;
      this._errX = 0; this._errY = 0; this._errZ = 0;
      return;
    }

    // Smooth correction: move the prediction toward the server, but record the
    // same amount as a *visual* error offset. The rendered position is
    // (prediction + offset), so it's unchanged at the instant of correction;
    // the offset then decays to zero in eyePosition() over ~120 ms, so the
    // camera glides to the corrected spot with no pop — even when corrections
    // arrive every snapshot in tight corners.
    const correct = (axis, d, allow) => {
      if (!allow || Math.abs(d) < 0.02) return;
      const c = d * 0.5;
      this[axis]                         += c;
      this['_err' + axis.toUpperCase()]  -= c;
    };
    correct('x', dx, true);
    correct('z', dz, true);
    // Vertical only while grounded (mid-air jump arcs diverge harmlessly).
    correct('y', dy, this.onGround);
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

  // Eye position: the live predicted position plus the decaying reconciliation
  // error offset (server-correction smoothness). `frameDt` decays the offset.
  // Physics runs at the render rate, so the camera tracks it 1:1 — no
  // interpolation, no physics/display rate-mismatch beat.
  eyePosition(frameDt = 0) {
    const decay = Math.exp(-frameDt / 0.12); // ~120 ms time constant
    this._errX *= decay; this._errY *= decay; this._errZ *= decay;
    return {
      x: this.x + this._errX,
      y: this.y + this._errY + PLAYER_EYE_OFFSET,
      z: this.z + this._errZ,
    };
  }

  // Camera lean disabled along with the head-bob.
  get bobRoll() { return 0; }

  get seq() { return this._inputSeq; }
}
