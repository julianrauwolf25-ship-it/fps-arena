import * as THREE from 'three';
import { MAP_BOXES, ARENA_HALF, WEAPONS, WEAPON_KEYS } from '../../shared/constants.js';
import { RemotePlayer } from './RemotePlayer.js';

const FOV_HIP = 90;

// ── Procedural texture helpers ────────────────────────────────────────────────

function canvasTex(draw, size = 512) {
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grassTex() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = '#4e6e3a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = (Math.random() - 0.5) * 28;
      ctx.fillStyle = `rgb(${clamp(60+v,0,255)},${clamp(110+v,0,255)},${clamp(50+v,0,255)})`;
      ctx.fillRect(x, y, Math.random() < 0.3 ? 2 : 1, Math.random() < 0.2 ? 3 : 1);
    }
  });
}

function concreteTex(base = [130, 118, 105]) {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = (Math.random() - 0.5) * 22;
      ctx.fillStyle = `rgb(${clamp(base[0]+v,0,255)},${clamp(base[1]+v,0,255)},${clamp(base[2]+v,0,255)})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // Panel lines every 64px
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (let x = 0; x <= s; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    for (let y = 0; y <= s; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  });
}

function metalTex() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = '#5a6070'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = (Math.random() - 0.5) * 18;
      ctx.fillStyle = `rgb(${clamp(90+v,0,255)},${clamp(96+v,0,255)},${clamp(112+v,0,255)})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // Horizontal scratch lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i < 30; i++) {
      const y = Math.random() * s;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
    }
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Main class ────────────────────────────────────────────────────────────────

export class Game {
  constructor(canvas) {
    this.canvas        = canvas;
    this.remotePlayers = new Map();
    this._adsLerp      = 0;
    this._muzzleTimer  = 0;

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._buildMap();
    this._buildViewmodel();
    this._buildMuzzleFlash();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // ── Renderer ───────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.autoClear         = false;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x7ab3d4);
  }

  // ── Scene & lighting ───────────────────────────────────────────────────────

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x8bb8d0, 0.018);
    this.scene.background = new THREE.Color(0x7ab3d4);

    // Hemisphere: sky-blue above, earth-green below
    this.scene.add(new THREE.HemisphereLight(0x9ac8ef, 0x4a6830, 0.55));

    // Main sun with soft shadows
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.6);
    sun.position.set(14, 40, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 120;
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -55;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  55;
    sun.shadow.bias          = -0.0003;
    this.scene.add(sun);

    // Bounce fill from opposite direction
    const fill = new THREE.DirectionalLight(0xadd8f0, 0.35);
    fill.position.set(-10, 8, -12);
    this.scene.add(fill);

    // Warm point lights at map quadrants
    const ptCfg = [
      { pos: [ 18, 2.5,  18], color: 0xff9955, intensity: 12, dist: 14 },
      { pos: [-18, 2.5,  18], color: 0xff9955, intensity: 12, dist: 14 },
      { pos: [ 18, 2.5, -18], color: 0x55aaff, intensity: 10, dist: 14 },
      { pos: [-18, 2.5, -18], color: 0x55aaff, intensity: 10, dist: 14 },
      { pos: [  0, 3,    0 ], color: 0xffd080, intensity: 18, dist: 16 },
    ];
    for (const { pos, color, intensity, dist } of ptCfg) {
      const pl = new THREE.PointLight(color, intensity, dist, 2);
      pl.position.set(...pos);
      this.scene.add(pl);
    }
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(FOV_HIP, 1, 0.05, 300);
    this.camera.rotation.order = 'YXZ';
  }

  // ── Map ─────────────────────────────────────────────────────────────────────

  _buildMap() {
    const gt  = grassTex();    gt.repeat.set(14, 14);
    const ct  = concreteTex(); ct.repeat.set(4, 4);
    const wt  = concreteTex([100, 92, 84]); wt.repeat.set(3, 2);
    const mt  = metalTex();    mt.repeat.set(3, 3);

    const stdMat = (map, rough = 0.85, metal = 0) =>
      new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal });

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      stdMat(gt, 0.92, 0),
    );
    floor.rotation.x  = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Arena walls — tall concrete
    const wallH  = 8;
    const half   = ARENA_HALF;
    const wallMat = stdMat(wt, 0.88);
    for (const d of [
      { w: half*2+0.5, h: wallH, d: 0.5,  x: 0,    y: wallH/2, z:  half },
      { w: half*2+0.5, h: wallH, d: 0.5,  x: 0,    y: wallH/2, z: -half },
      { w: 0.5, h: wallH, d: half*2,       x:  half, y: wallH/2, z: 0    },
      { w: 0.5, h: wallH, d: half*2,       x: -half, y: wallH/2, z: 0    },
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), wallMat);
      m.position.set(d.x, d.y, d.z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }

    // Cover boxes — alternate concrete / metal based on size
    for (const b of MAP_BOXES) {
      const isLarge = b.w > 4 || b.d > 4;
      const mat     = isLarge ? stdMat(ct, 0.85) : stdMat(mt, 0.55, 0.35);
      const mesh    = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Decorative pillars at map centre for visual interest
    const pillarMat = stdMat(concreteTex([90, 82, 74]), 0.8);
    for (const [x, z] of [[0, 0]]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4, 8), pillarMat);
      pillar.position.set(x, 2, z);
      pillar.castShadow = pillar.receiveShadow = true;
      this.scene.add(pillar);
    }

    // Ground markings (lines / decals via thin planes)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.18, transparent: true });
    for (const z of [-10, 0, 10]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, 0.12), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.01, z);
      this.scene.add(line);
    }
  }

  // ── Viewmodel ──────────────────────────────────────────────────────────────

  _buildViewmodel() {
    this.vmScene  = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmCamera.rotation.order = 'YXZ';

    this.vmScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const vmSun = new THREE.DirectionalLight(0xfff4d6, 1.2);
    vmSun.position.set(1, 2, 0.5);
    this.vmScene.add(vmSun);

    this._weaponGroups = {};
    for (const id of WEAPON_KEYS) {
      const g = this._makeWeaponMesh(id);
      g.position.set(0.28, -0.22, -0.45);
      g.visible = false;
      this.vmScene.add(g);
      this._weaponGroups[id] = g;
    }

    this._kickZ       = 0;
    this._swayX       = 0;
    this._swayY       = 0;
    this._prevMouseDX = 0;
    this._prevMouseDY = 0;

    // Track mouse for weapon sway
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this._prevMouseDX = e.movementX;
      this._prevMouseDY = e.movementY;
    });

    this.setWeapon('pistol');
  }

  _makeWeaponMesh(id) {
    const w      = WEAPONS[id];
    const grp    = new THREE.Group();
    const body   = new THREE.MeshStandardMaterial({ color: w.bodyColor, roughness: 0.55, metalness: 0.6 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x222233,    roughness: 0.4,  metalness: 0.8 });
    const grip_m = new THREE.MeshStandardMaterial({ color: 0x1a1a22,    roughness: 0.9,  metalness: 0.1 });

    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      grp.add(m);
    };

    // Body
    add(new THREE.BoxGeometry(0.082, 0.095, 0.22), body, 0, 0, 0);
    // Barrel
    add(new THREE.BoxGeometry(0.022, 0.022, w.barrelLen), dark, 0, 0.028, -(w.barrelLen / 2) - 0.11);
    // Grip
    add(new THREE.BoxGeometry(0.058, 0.11, 0.065), grip_m, 0, -0.09, 0.065, 0.18);
    // Trigger guard
    add(new THREE.TorusGeometry(0.022, 0.006, 6, 8, Math.PI), dark, 0, -0.032, -0.01, Math.PI / 2);

    if (id === 'rifle') {
      // Stock
      add(new THREE.BoxGeometry(0.07, 0.055, 0.14), body, 0, 0.02, 0.18);
      // Mag
      add(new THREE.BoxGeometry(0.04, 0.1, 0.06), dark, 0, -0.07, 0.01);
      // Rail
      add(new THREE.BoxGeometry(0.085, 0.01, 0.18), dark, 0, 0.056, -0.04);
    }

    if (id === 'shotgun') {
      // Pump
      add(new THREE.BoxGeometry(0.068, 0.038, 0.12), grip_m, 0, -0.006, -(w.barrelLen * 0.4) - 0.05);
      // Wide barrel shroud
      add(new THREE.BoxGeometry(0.038, 0.038, w.barrelLen * 0.8), body, 0, 0.02, -(w.barrelLen * 0.4) - 0.08);
    }

    if (id === 'sniper') {
      // Long scope body
      const scopeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10);
      const scope    = new THREE.Mesh(scopeGeo, dark);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(0, 0.07, -0.08);
      grp.add(scope);
      // Scope lens
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshStandardMaterial({ color: 0x224488, roughness: 0.1, metalness: 0.9, emissive: 0x001133 }));
      lens.rotation.y = Math.PI / 2;
      lens.position.set(0.023, 0.07, -0.18);
      grp.add(lens);
      // Bipod legs
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.006, 0.08, 0.006), dark, sx * 0.028, -0.07, -(w.barrelLen * 0.5) - 0.04);
      }
    }

    return grp;
  }

  // ── Muzzle flash ───────────────────────────────────────────────────────────

  _buildMuzzleFlash() {
    // Viewmodel-space point light + cross sprite
    this._muzzleLight = new THREE.PointLight(0xff9944, 0, 5, 2);
    this._muzzleLight.position.set(0, 0.028, -0.7);
    this.vmScene.add(this._muzzleLight);

    // World-space muzzle light (illuminates nearby geometry briefly)
    this._worldMuzzleLight = new THREE.PointLight(0xff8833, 0, 8, 2);
    this.scene.add(this._worldMuzzleLight);

    // Soft radial muzzle flash — a glow texture with additive blending so it
    // reads as light, not a hard white rectangle.
    const flashTex = canvasTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
      g.addColorStop(0.0, 'rgba(255,255,240,1)');
      g.addColorStop(0.25, 'rgba(255,220,130,0.9)');
      g.addColorStop(0.55, 'rgba(255,150,40,0.35)');
      g.addColorStop(1.0, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, 128);

    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex, transparent: true, opacity: 0, depthTest: false,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this._muzzleSprite = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    this._muzzleSprite.position.set(0, 0.028, -0.72);
    this._muzzleSprite.renderOrder = 999;
    this.vmScene.add(this._muzzleSprite);
  }

  triggerKick(weaponId) {
    const w     = WEAPONS[weaponId] ?? WEAPONS.pistol;
    this._kickZ = 0.07;
    this._muzzleTimer = 60; // ms to show flash (short & snappy)

    this._muzzleLight.intensity       = 16;
    this._worldMuzzleLight.intensity  = 10;

    // Randomise the flash so repeated shots don't look mechanical
    const scale = 0.7 + Math.random() * 0.6;
    this._muzzleSprite.scale.set(scale, scale, scale);
    this._muzzleSprite.rotation.z      = Math.random() * Math.PI * 2;
    this._muzzleSprite.material.opacity = 1;

    // Recoil bump on pitch/yaw is handled by main.js via localPlayer
  }

  setWeapon(id) {
    this._currentWeaponId = id;
    for (const [k, g] of Object.entries(this._weaponGroups)) g.visible = k === id;
  }

  // ── Remote players ─────────────────────────────────────────────────────────

  addRemotePlayer(id, name) {
    if (!this.remotePlayers.has(id))
      this.remotePlayers.set(id, new RemotePlayer(id, name, this.scene));
  }

  removeRemotePlayer(id) {
    const rp = this.remotePlayers.get(id);
    if (rp) { rp.destroy(this.scene); this.remotePlayers.delete(id); }
  }

  processSnapshot(snap, myId, localPlayer) {
    for (const ps of snap.players) {
      if (ps.id === myId) { localPlayer.reconcile(ps); continue; }
      if (!this.remotePlayers.has(ps.id)) this.addRemotePlayer(ps.id, ps.name);
      this.remotePlayers.get(ps.id)?.addSnapshot(ps, Date.now());
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render(localPlayer, dt) {
    const nowMs  = performance.now();
    const weap   = WEAPONS[localPlayer.currentWeapon];

    // ADS smooth lerp
    this._adsLerp += ((localPlayer.ads ? 1 : 0) - this._adsLerp) * Math.min(1, dt * 14);
    this.camera.fov = FOV_HIP + (weap.adsFov - FOV_HIP) * this._adsLerp;
    this.camera.updateProjectionMatrix();

    // Camera placement
    const eye = localPlayer.eyePosition();
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.y = localPlayer.yaw;
    this.camera.rotation.x = localPlayer.pitch;
    this.camera.rotation.z = -localPlayer.bobRoll; // subtle lean

    // Update remote players
    for (const [, rp] of this.remotePlayers) rp.update(this.camera, this.renderer);

    // ── Pass 1: world ────────────────────────────────────────────────────
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // ── Muzzle flash decay ────────────────────────────────────────────────
    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= dt * 1000;
      const t = Math.max(0, this._muzzleTimer / 60);
      this._muzzleLight.intensity        = 16 * t;
      this._worldMuzzleLight.intensity   = 10 * t;
      this._muzzleSprite.material.opacity = t;
    } else {
      this._muzzleLight.intensity        = 0;
      this._worldMuzzleLight.intensity   = 0;
      this._muzzleSprite.material.opacity = 0;
    }

    // Place world muzzle light at camera (rough approximation)
    this._worldMuzzleLight.position.copy(this.camera.position);

    // ── Weapon position: ADS sway + kick + mouse sway ────────────────────
    this._kickZ  *= Math.pow(0.18, dt);   // fast spring back
    this._swayX += (this._prevMouseDX * -0.0004 - this._swayX) * Math.min(1, dt * 8);
    this._swayY += (this._prevMouseDY * -0.0003 - this._swayY) * Math.min(1, dt * 8);
    this._prevMouseDX = 0;
    this._prevMouseDY = 0;

    // Hide viewmodel if sniper + fully ADS → handled externally (HUD scope overlay)
    const hideVM = localPlayer.currentWeapon === 'sniper' && this._adsLerp > 0.85;
    const wgrp   = this._weaponGroups[this._currentWeaponId];
    if (wgrp) {
      const adsX  = 0.28 * (1 - this._adsLerp * 0.92);
      const adsY  = -0.22 + this._adsLerp * 0.04;
      wgrp.position.set(adsX + this._swayX, adsY + this._swayY, -0.45 + this._kickZ);
      wgrp.visible = !hideVM;
    }

    // vmCamera matches only the pitch (gun hangs from camera)
    this.vmCamera.rotation.x = 0;
    this.vmCamera.rotation.y = 0;
    this.vmCamera.aspect     = this.camera.aspect;
    this.vmCamera.updateProjectionMatrix();

    // ── Pass 2: viewmodel (on top of world, clear only depth) ────────────
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect   = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }
}
