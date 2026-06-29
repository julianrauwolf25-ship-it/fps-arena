import * as THREE from 'three';

const INTERP_DELAY_MS = 100;
const BUFFER_LIMIT    = 20;

export class RemotePlayer {
  constructor(id, name, scene) {
    this.id   = id;
    this.name = name;
    this._buf = [];
    this._group = this._buildMesh();
    scene.add(this._group);

    this._label = document.createElement('div');
    this._label.className = 'name-label';
    this._label.textContent = name;
    document.body.appendChild(this._label);
  }

  addSnapshot(snap, serverTime) {
    this._buf.push({ time: serverTime, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw, dead: snap.dead });
    if (this._buf.length > BUFFER_LIMIT) this._buf.shift();
  }

  update(camera, renderer) {
    if (this._buf.length < 2) return;

    const renderTime = Date.now() - INTERP_DELAY_MS;
    let i = this._buf.length - 1;
    while (i > 0 && this._buf[i].time > renderTime) i--;

    const a = this._buf[i];
    const b = this._buf[Math.min(i + 1, this._buf.length - 1)];
    const span = b.time - a.time;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.time) / span)) : 0;

    const x   = a.x   + (b.x - a.x) * t;
    const y   = a.y   + (b.y - a.y) * t;
    const z   = a.z   + (b.z - a.z) * t;
    const yaw = a.yaw + _angleDiff(b.yaw, a.yaw) * t;

    this._group.visible = !b.dead;
    this._group.position.set(x, y, z);
    // FIX: use yaw directly (not negated) to match camera convention
    this._group.rotation.y = yaw;

    this._updateLabel(x, y + 2.2, z, camera, renderer);
  }

  _updateLabel(wx, wy, wz, camera, renderer) {
    if (!this._group.visible) { this._label.style.display = 'none'; return; }
    const vec = new THREE.Vector3(wx, wy, wz).project(camera);
    if (vec.z >= 1) { this._label.style.display = 'none'; return; }
    const cw = renderer.domElement.clientWidth;
    const ch = renderer.domElement.clientHeight;
    this._label.style.display = 'block';
    this._label.style.left = ((vec.x + 1) / 2 * cw) + 'px';
    this._label.style.top  = ((1 - vec.y) / 2 * ch) + 'px';
  }

  destroy(scene) {
    scene.remove(this._group);
    this._label.remove();
  }

  _buildMesh() {
    const grp     = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a7bd5 });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf5c6a0 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
    body.position.y = 1.2;     // center of body above feet
    body.castShadow = true;
    grp.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMat);
    head.position.y = 2.05;    // above body
    head.castShadow = true;
    grp.add(head);

    return grp;
  }
}

function _angleDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
