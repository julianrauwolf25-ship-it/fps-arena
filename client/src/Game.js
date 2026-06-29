// Game.js — Three.js scene, render loop, map geometry
import * as THREE    from 'three';
import { MAP_BOXES, ARENA_HALF } from '../../shared/constants.js';
import { RemotePlayer } from './RemotePlayer.js';

const FOV = 90;

export class Game {
  constructor(canvas) {
    this.canvas   = canvas;
    this.remotePlayers = new Map(); // id → RemotePlayer

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._buildMap();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x87ceeb); // sky blue
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 80);

    // Ambient + directional light
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
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
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
    // YXZ order: yaw around Y first, then pitch around X → standard FPS
    this.camera.rotation.order = 'YXZ';
  }

  _buildMap() {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x5a7a4a });
    const floor    = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x    = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Arena boundary walls (invisible ceiling, visible walls)
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x8b6f47 });
    const wallH   = 6;
    const wallDefs = [
      // N/S walls
      { w: ARENA_HALF * 2 + 1, h: wallH, d: 1, x: 0, y: wallH / 2, z:  ARENA_HALF },
      { w: ARENA_HALF * 2 + 1, h: wallH, d: 1, x: 0, y: wallH / 2, z: -ARENA_HALF },
      // E/W walls
      { w: 1, h: wallH, d: ARENA_HALF * 2 + 1, x:  ARENA_HALF, y: wallH / 2, z: 0 },
      { w: 1, h: wallH, d: ARENA_HALF * 2 + 1, x: -ARENA_HALF, y: wallH / 2, z: 0 },
    ];
    for (const d of wallDefs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), wallMat);
      m.position.set(d.x, d.y, d.z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }

    // Cover boxes (from shared constants)
    const boxMat = new THREE.MeshLambertMaterial({ color: 0x7a6a5a });
    for (const b of MAP_BOXES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boxMat.clone());
      m.position.set(b.x, b.y, b.z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Remote player management ─────────────────────────────────────────────────

  addRemotePlayer(id, name) {
    if (this.remotePlayers.has(id)) return;
    const rp = new RemotePlayer(id, name, this.scene);
    this.remotePlayers.set(id, rp);
  }

  removeRemotePlayer(id) {
    const rp = this.remotePlayers.get(id);
    if (rp) { rp.destroy(this.scene); this.remotePlayers.delete(id); }
  }

  processSnapshot(snap, myId, localPlayer) {
    for (const ps of snap.players) {
      if (ps.id === myId) {
        localPlayer.reconcile(ps);
        continue;
      }
      if (!this.remotePlayers.has(ps.id)) {
        this.addRemotePlayer(ps.id, ps.name);
      }
      this.remotePlayers.get(ps.id)?.addSnapshot(ps, Date.now());
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  render(localPlayer) {
    // Place camera at eye position with local player look angles
    const eye = localPlayer.eyePosition();
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.y = -localPlayer.yaw;   // negate: CCW yaw → camera right
    this.camera.rotation.x =  localPlayer.pitch;

    // Update remote players (interpolation + name labels)
    for (const [, rp] of this.remotePlayers) {
      rp.update(this.camera, this.renderer);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
