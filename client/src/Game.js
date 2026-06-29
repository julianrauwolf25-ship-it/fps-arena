import * as THREE from 'three';
import { MAP_BOXES, ARENA_HALF, VOID_Y, WEAPONS, WEAPON_KEYS } from '../../shared/constants.js';
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

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._buildMap();
    this._buildViewmodel();
    this._buildImpactPool();

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

    // Meshes that bullets can hit (used for impact-decal raycasting)
    this._collidables = [floor];

    // Dark "abyss" plane far below the parkour zone (purely visual depth cue)
    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 90),
      new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 1 }),
    );
    voidPlane.rotation.x = -Math.PI / 2;
    voidPlane.position.set(45, VOID_Y - 2, 0);
    this.scene.add(voidPlane);

    // Materials reused for parkour platforms (cached so we don't rebuild per box)
    const easyMat = new THREE.MeshStandardMaterial({ color: 0x33aa66, emissive: 0x0e3320, emissiveIntensity: 0.4, roughness: 0.6 });
    const hardMat = new THREE.MeshStandardMaterial({ color: 0xcc4a2a, emissive: 0x331005, emissiveIntensity: 0.4, roughness: 0.6 });
    const cpMat   = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x664400, emissiveIntensity: 0.9, roughness: 0.4 });
    const wallMat = stdMat(wt, 0.88);

    // Build every collidable box, choosing a look from its `kind`
    for (const b of MAP_BOXES) {
      let mat;
      switch (b.kind) {
        case 'wall':         mat = wallMat; break;
        case 'checkpoint':   mat = cpMat;   break;
        case 'parkour':      mat = b.z < 0 ? hardMat : easyMat; break;
        case 'parkourStart': mat = stdMat(ct, 0.85); break;
        default: {           // cover
          const isLarge = b.w > 4 || b.d > 4;
          mat = isLarge ? stdMat(ct, 0.85) : stdMat(mt, 0.55, 0.35);
        }
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this._collidables.push(mesh);
    }

    // Decorative pillar at arena centre
    const pillarMat = stdMat(concreteTex([90, 82, 74]), 0.8);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4, 8), pillarMat);
    pillar.position.set(0, 2, 0);
    pillar.castShadow = pillar.receiveShadow = true;
    this.scene.add(pillar);
    this._collidables.push(pillar);

    // Course beacons just outside the portal: red glow = hard (left/−z),
    // green glow = easy (right/+z). Tall thin emissive markers + a light.
    const beacon = (z, color) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 7, 0.4),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 }),
      );
      m.position.set(29.5, 3.5, z);
      this.scene.add(m);
      const pl = new THREE.PointLight(color, 8, 16, 2);
      pl.position.set(29.5, 4, z);
      this.scene.add(pl);
    };
    beacon(-4, 0xff4422);  // hard course side
    beacon( 4, 0x33dd66);  // easy course side

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

  // ── Bullet impact decals ─────────────────────────────────────────────────
  // No muzzle flash, no recoil animation — the only shooting feedback is a
  // bullet hole where the round actually strikes world geometry.

  _buildImpactPool() {
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 200;

    // Dark "bullet hole" texture: black centre, faint cracked ring, soft edge.
    const holeTex = canvasTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
      g.addColorStop(0.0, 'rgba(10,8,6,0.95)');
      g.addColorStop(0.45, 'rgba(20,16,12,0.85)');
      g.addColorStop(0.7, 'rgba(40,34,28,0.35)');
      g.addColorStop(1.0, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      // A few light cracks radiating out
      ctx.strokeStyle = 'rgba(120,110,100,0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = s * (0.15 + Math.random() * 0.25);
        ctx.beginPath();
        ctx.moveTo(s/2, s/2);
        ctx.lineTo(s/2 + Math.cos(a) * r, s/2 + Math.sin(a) * r);
        ctx.stroke();
      }
    }, 128);

    // Pool of reusable decal quads (round-robin so we never grow unbounded)
    this._impactPool = [];
    this._impactIdx  = 0;
    const POOL = 40;
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: holeTex, transparent: true, opacity: 0,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), mat);
      m.visible    = false;
      m._born      = 0;     // timestamp when last spawned (for fade)
      this.scene.add(m);
      this._impactPool.push(m);
    }
  }

  // Called once per shot from main.js. Raycasts each pellet against the world
  // and drops a bullet hole at the first surface it hits.
  spawnImpacts(eye, yaw, pitch, weaponId) {
    const weap    = WEAPONS[weaponId] ?? WEAPONS.pistol;
    // Cap visible holes per shot (shotgun has many pellets)
    const pellets = Math.min(weap.pellets, 6);

    for (let p = 0; p < pellets; p++) {
      const sy = (Math.random() - 0.5) * weap.spread;
      const sp = (Math.random() - 0.5) * weap.spread;
      const ey = yaw + sy, ep = pitch + sp;

      const dir = new THREE.Vector3(
        -Math.sin(ey) * Math.cos(ep),
         Math.sin(ep),
        -Math.cos(ey) * Math.cos(ep),
      ).normalize();

      this._raycaster.set(new THREE.Vector3(eye.x, eye.y, eye.z), dir);
      const hits = this._raycaster.intersectObjects(this._collidables, false);
      if (!hits.length) continue;

      const hit = hits[0];
      const m   = this._impactPool[this._impactIdx];
      this._impactIdx = (this._impactIdx + 1) % this._impactPool.length;

      // Place slightly off the surface, oriented to the surface normal
      const n = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : dir.clone().negate();
      m.position.copy(hit.point).addScaledVector(n, 0.012);
      m.lookAt(hit.point.clone().add(n));
      m.rotation.z = Math.random() * Math.PI * 2;
      const sc = 0.7 + Math.random() * 0.6;
      m.scale.set(sc, sc, sc);

      m.visible           = true;
      m.material.opacity  = 0.95;
      m._born             = performance.now();
    }
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

    // ── Bullet-hole fade ─────────────────────────────────────────────────
    // Holes stay solid for a few seconds, then fade out and hide.
    const HOLD = 5000, FADE = 2500;
    for (const m of this._impactPool) {
      if (!m.visible) continue;
      const age = nowMs - m._born;
      if (age > HOLD + FADE) { m.visible = false; m.material.opacity = 0; }
      else if (age > HOLD)   { m.material.opacity = 0.95 * (1 - (age - HOLD) / FADE); }
    }

    // ── Weapon position: ADS sway + mouse sway (no recoil animation) ─────
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
      wgrp.position.set(adsX + this._swayX, adsY + this._swayY, -0.45);
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
