// RemotePlayer.js — interpolated remote player rendering
// We keep a small ring-buffer of snapshots and render a moment in the past
// (INTERP_DELAY_MS behind the latest received tick), interpolating between
// two frames for smooth motion regardless of server tick rate.

import * as THREE from 'three';

const INTERP_DELAY_MS = 100; // render this many ms behind latest received
const BUFFER_LIMIT    = 20;  // max snapshots kept per remote player

export class RemotePlayer {
  constructor(id, name, scene) {
    this.id   = id;
    this.name = name;

    // Snapshot ring-buffer: [{ time, x, y, z, yaw, pitch, dead }]
    this._buf = [];

    // Three.js group (body + head)
    this._group = this._buildMesh();
    scene.add(this._group);

    // DOM name label
    this._label = document.createElement('div');
    this._label.className = 'name-label';
    this._label.textContent = name;
    document.body.appendChild(this._label);

    this._dead = false;
  }

  // Called whenever a snapshot entry for this player arrives
  addSnapshot(snap, serverTime) {
    // serverTime is Date.now() at receipt — used for timing
    this._buf.push({
      time:  serverTime,
      x:     snap.x,
      y:     snap.y,
      z:     snap.z,
      yaw:   snap.yaw,
      pitch: snap.pitch,
      dead:  snap.dead,
    });
    if (this._buf.length > BUFFER_LIMIT) this._buf.shift();
  }

  // Called each render frame; camera needed for name-label projection
  update(camera, renderer) {
    if (this._buf.length < 2) return;

    const renderTime = Date.now() - INTERP_DELAY_MS;

    // Find the two buffer entries that straddle renderTime
    let i = this._buf.length - 1;
    while (i > 0 && this._buf[i].time > renderTime) i--;

    const a = this._buf[i];
    const b = this._buf[Math.min(i + 1, this._buf.length - 1)];

    let t = 0;
    const span = b.time - a.time;
    if (span > 0) t = Math.max(0, Math.min(1, (renderTime - a.time) / span));

    const x   = a.x   + (b.x   - a.x)   * t;
    const y   = a.y   + (b.y   - a.y)   * t;   // feet
    const z   = a.z   + (b.z   - a.z)   * t;
    const yaw = a.yaw + _angleDiff(b.yaw, a.yaw) * t;

    this._dead = b.dead;
    this._group.visible = !this._dead;
    this._group.position.set(x, y, z);
    this._group.rotation.y = -yaw;

    // Update name label screen position
    this._updateLabel(x, y + 2.2, z, camera, renderer);
  }

  _updateLabel(wx, wy, wz, camera, renderer) {
    if (this._dead) { this._label.style.display = 'none'; return; }

    const vec = new THREE.Vector3(wx, wy, wz).project(camera);
    if (vec.z >= 1) { this._label.style.display = 'none'; return; } // behind camera

    const cw = renderer.domElement.clientWidth;
    const ch = renderer.domElement.clientHeight;
    const sx = (vec.x + 1) / 2 * cw;
    const sy = (1 - vec.y) / 2 * ch;

    this._label.style.display = 'block';
    this._label.style.left    = sx + 'px';
    this._label.style.top     = sy + 'px';
  }

  // Remove from scene + DOM
  destroy(scene) {
    scene.remove(this._group);
    this._label.remove();
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Body (torso + legs combined as a box)
    const bodyGeo  = new THREE.BoxGeometry(0.8, 1.2, 0.4);
    const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x3a7bd5 });
    const body     = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6 + 0.6; // 0.6 = half height, placed above feet
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeo  = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const headMat  = new THREE.MeshLambertMaterial({ color: 0xf5c6a0 });
    const head     = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.2 + 0.25 + 0.6; // above body
    head.castShadow = true;
    group.add(head);

    return group;
  }
}

// Shortest-path angular difference for yaw interpolation
function _angleDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
