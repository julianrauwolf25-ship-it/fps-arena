import * as THREE from 'three';
import { MAP_BOXES, ARENA_HALF, WEAPONS, WEAPON_KEYS } from '../../shared/constants.js';
import { RemotePlayer } from './RemotePlayer.js';

const FOV_DEFAULT = 90;

export class Game {
  constructor(canvas) {
    this.canvas        = canvas;
    this.remotePlayers = new Map();
    this._adsLerp      = 0; // 0 = hip, 1 = ADS (smooth transition)

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._buildMap();
    this._buildViewmodel();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // ── Renderer ──────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x87ceeb);
    this.renderer.autoClear = false; // we clear manually to do two-pass rendering
  }

  // ── Main scene ────────────────────────────────────────────────────────────

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 80);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(10, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far  = 120;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -50;
    sun.shadow.camera.right = sun.shadow.camera.top   =  50;
    this.scene.add(sun);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(FOV_DEFAULT, 1, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
  }

  // ── Map ───────────────────────────────────────────────────────────────────

  _buildMap() {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x5a7a4a });
    const floor    = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Arena walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x8b6f47 });
    const wallH   = 6;
    const half    = ARENA_HALF;
    for (const d of [
      { w: half*2+1, h: wallH, d: 1,      x: 0,    y: wallH/2, z:  half },
      { w: half*2+1, h: wallH, d: 1,      x: 0,    y: wallH/2, z: -half },
      { w: 1,        h: wallH, d: half*2, x:  half, y: wallH/2, z: 0    },
      { w: 1,        h: wallH, d: half*2, x: -half, y: wallH/2, z: 0    },
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), wallMat);
      m.position.set(d.x, d.y, d.z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }

    // Cover boxes
    const boxMat = new THREE.MeshLambertMaterial({ color: 0x7a6a5a });
    for (const b of MAP_BOXES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boxMat.clone());
      m.position.set(b.x, b.y, b.z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // ── Viewmodel (weapon in hand) ────────────────────────────────────────────
  // Rendered in a separate scene so it never clips through world geometry.

  _buildViewmodel() {
    this.vmScene  = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmCamera.rotation.order = 'YXZ';

    this.vmScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const vmSun = new THREE.DirectionalLight(0xffffff, 0.8);
    vmSun.position.set(1, 2, 1);
    this.vmScene.add(vmSun);

    this._weaponGroups = {};
    for (const id of WEAPON_KEYS) {
      const g = this._makeWeaponMesh(id);
      // Rest position: right/down/forward in view space
      g.position.set(0.28, -0.22, -0.45);
      g.visible = false;
      this.vmScene.add(g);
      this._weaponGroups[id] = g;
    }

    // Kick state for shoot animation
    this._kickZ = 0;

    this.setWeapon('pistol');
  }

  _makeWeaponMesh(id) {
    const w   = WEAPONS[id];
    const grp = new THREE.Group();

    const bodyMat   = new THREE.MeshLambertMaterial({ color: w.bodyColor });
    const metalMat  = new THREE.MeshLambertMaterial({ color: 0x333344 });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.22), bodyMat);
    body.position.z = 0;
    grp.add(body);

    // Barrel
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, w.barrelLen), metalMat);
    barrel.position.set(0, 0.025, -(w.barrelLen / 2) - 0.11);
    grp.add(barrel);

    // Grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), bodyMat);
    grip.position.set(0, -0.09, 0.06);
    grip.rotation.x = 0.15;
    grp.add(grip);

    // Scope for sniper
    if (id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 8), metalMat);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(0, 0.065, -0.08);
      grp.add(scope);
    }

    // Drum/mag for shotgun
    if (id === 'shotgun') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.14), metalMat);
      mag.position.set(0, -0.04, -0.04);
      grp.add(mag);
    }

    return grp;
  }

  setWeapon(id) {
    this._currentWeaponId = id;
    for (const [k, g] of Object.entries(this._weaponGroups)) {
      g.visible = k === id;
    }
  }

  triggerKick() {
    this._kickZ = 0.06; // kick backward in view space
  }

  // ── Remote players ────────────────────────────────────────────────────────

  addRemotePlayer(id, name) {
    if (this.remotePlayers.has(id)) return;
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

  // ── Render (called every animation frame) ─────────────────────────────────

  render(localPlayer, dt) {
    const ads     = localPlayer.ads;
    const weapDef = WEAPONS[localPlayer.currentWeapon];

    // Smooth ADS transition
    const target = ads ? 1 : 0;
    this._adsLerp += (target - this._adsLerp) * Math.min(1, (dt ?? 0.016) * 12);

    // FOV interpolation: hip → ADS
    const fovHip = FOV_DEFAULT;
    const fovAds = weapDef.adsFov;
    this.camera.fov = fovHip + (fovAds - fovHip) * this._adsLerp;
    this.camera.updateProjectionMatrix();

    // Main camera = player eye
    const eye = localPlayer.eyePosition();
    this.camera.position.set(eye.x, eye.y, eye.z);
    // BUG FIX: yaw is NOT negated — camera.rotation.y = yaw gives correct forward direction
    this.camera.rotation.y = localPlayer.yaw;
    this.camera.rotation.x = localPlayer.pitch;

    // Update remote players
    for (const [, rp] of this.remotePlayers) rp.update(this.camera, this.renderer);

    // ── Pass 1: main world ──────────────────────────────────────────────────
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // ── Pass 2: viewmodel (drawn on top, clears only depth) ─────────────────
    // Weapon kick animation (spring back to rest)
    this._kickZ *= 0.75;
    const wgrp = this._weaponGroups[this._currentWeaponId];
    if (wgrp) {
      // Weapon sways toward center during ADS
      const adsX = 0.28 * (1 - this._adsLerp * 0.85);
      wgrp.position.set(adsX, -0.22 + this._adsLerp * 0.05, -0.45 + this._kickZ);
    }

    // vmCamera matches main camera rotation but fixed position at origin
    this.vmCamera.rotation.y = 0;
    this.vmCamera.rotation.x = 0;
    this.vmCamera.aspect     = this.camera.aspect;
    this.vmCamera.updateProjectionMatrix();

    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }
}
