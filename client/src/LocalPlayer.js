import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_ADS_MULT, PLAYER_JUMP, GRAVITY,
  PLAYER_EYE_OFFSET, ARENA_HALF,
  WEAPONS, WEAPON_KEYS,
} from '../../shared/constants.js';

const MOUSE_SENS    = 0.0018;
const RECONCILE_DST = 2.0;

export class LocalPlayer {
  constructor() {
    // Physics (y = feet)
    this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround = false;

    // Look
    this.yaw   = 0;
    this.pitch = 0;
    this.ads   = false;   // aim-down-sights (right mouse button held)

    // Weapon
    this.currentWeapon = 'pistol';
    this.ammo          = WEAPONS.pistol.ammo;
    this.reloading     = false;

    // Health / game state
    this.health  = 100;
    this.dead    = false;
    this.kills   = 0;
    this.deaths  = 0;

    // Callbacks set by main.js
    this.onWeaponSwitch = null; // (weaponId) => void
    this.onShoot        = null; // () => void — trigger shoot via network

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

      // Weapon slots 1-4
      if (e.code === 'Digit1') this._switchWeapon('pistol');
      if (e.code === 'Digit2') this._switchWeapon('rifle');
      if (e.code === 'Digit3') this._switchWeapon('shotgun');
      if (e.code === 'Digit4') this._switchWeapon('sniper');

      // Reload
      if (e.code === 'KeyR' && !this.reloading && this.ammo < WEAPONS[this.currentWeapon].ammo) {
        this.reloading = true; // optimistic; server confirms
        this.onReload?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (keyMap[e.code]) this.keys[keyMap[e.code]] = false;
    });

    // Mouse look — only when pointer is locked
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.yaw   -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      this.pitch  = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, this.pitch));
    });

    // Right-click = ADS (contextmenu suppressed by canvas listener in main.js)
    window.addEventListener('mousedown', (e) => {
      if (e.button === 2 && document.pointerLockElement) {
        this.ads = true;
        e.preventDefault();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.ads = false;
    });
    // Prevent browser context menu from appearing in-game
    window.addEventListener('contextmenu', (e) => {
      if (document.pointerLockElement) e.preventDefault();
    });
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

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);

    let mx = 0, mz = 0;
    if (this.keys.forward) { mx -= sin; mz -= cos; }
    if (this.keys.back)    { mx += sin; mz += cos; }
    if (this.keys.left)    { mx -= cos; mz += sin; }
    if (this.keys.right)   { mx += cos; mz -= sin; }

    const len = Math.sqrt(mx*mx + mz*mz);
    if (len > 0) { mx = (mx/len)*speed; mz = (mz/len)*speed; }

    this.vx = mx; this.vz = mz;

    if (this.keys.jump && this.onGround) { this.vy = PLAYER_JUMP; this.onGround = false; }
    this.vy += GRAVITY * dt;
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.z  += this.vz * dt;

    if (this.y <= 1) { this.y = 1; this.vy = 0; this.onGround = true; }
    else              { this.onGround = false; }

    this.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.x));
    this.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.z));

    this._inputSeq++;
    this._history.push({ seq: this._inputSeq, x: this.x, y: this.y, z: this.z });
    if (this._history.length > 120) this._history.shift();
  }

  reconcile(s) {
    if (!s) return;
    this.health        = s.health;
    this.ammo          = s.ammo;
    this.reloading     = s.reloading;
    this.dead          = s.dead;
    this.kills         = s.kills;
    this.deaths        = s.deaths;
    // Don't overwrite currentWeapon from server — client is authoritative on weapon choice

    const dx = s.x - this.x, dy = s.y - this.y, dz = s.z - this.z;
    if (Math.sqrt(dx*dx + dy*dy + dz*dz) > RECONCILE_DST) {
      this.x = s.x; this.y = s.y; this.z = s.z;
    }
  }

  currentInput() {
    return {
      forward: this.keys.forward,
      back:    this.keys.back,
      left:    this.keys.left,
      right:   this.keys.right,
      jump:    this.keys.jump,
      sprint:  this.keys.sprint,
      ads:     this.ads,
      weapon:  this.currentWeapon,
      yaw:     this.yaw,
      pitch:   this.pitch,
    };
  }

  eyePosition() { return { x: this.x, y: this.y + PLAYER_EYE_OFFSET, z: this.z }; }
  get seq()     { return this._inputSeq; }
}
