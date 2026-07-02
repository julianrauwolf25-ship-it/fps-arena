// MiniGames.js — CLIENT side of the mini-game framework.
//
// Responsibilities (Hub + Lobby UI milestone):
//   • Build the 10 selection signs in the hub plaza from the server catalogue.
//   • Proximity "press E to join" prompt; send mg_join / mg_leave.
//   • Render the lobby/countdown/running/ending overlay from mg_state.
//   • Render Target Rush target spheres from mg_targets.
//
// It is deliberately self-contained: main.js forwards the mg_* network messages
// and calls update() each frame; everything else lives here.

import * as THREE from 'three';
import {
  GRID, WALL_THICKNESS, MAX_PIECES_PER_PLAYER,
  registerPiece, clearPieces,
  computePlacement, placementValid,
} from '../../shared/build.js';

const JOIN_RADIUS = 3.2;

// World-space rotation (radians) for the ramp wedge mesh per ascend `dir`
// (0=+z,1=+x,2=-z,3=-x) — see _makePieceMesh for the geometry convention.
const RAMP_ROT = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];

// Where the sign rows sit in the mini-games plaza (west of the arena).
const ROW_Z = [-15, 15];
const ROW_X = [-38, -48, -58, -68, -78];

export class MiniGames {
  constructor(game, net) {
    this.game  = game;
    this.net   = net;
    this.scene = game.scene;

    this.signs    = [];          // { id, name, implemented, pos, label, pad }
    this.targets  = new Map();   // id → THREE.Mesh
    this.state    = null;        // latest mg_state
    this.nearSign = null;

    // Build Battle
    this.buildMeshes    = new Map(); // piece id → THREE.Mesh
    this.buildPieceType = 'wall';    // currently selected piece type (client-only choice)
    this._rampGeo       = null;      // lazily-built shared wedge geometry
    this.buildInputOn    = true;     // manual toggle (B key) — build vs. shoot while in the mode

    // Ghost preview: translucent meshes showing where the piece WOULD go.
    // Built lazily on first use; blue = valid spot, red = blocked/out of zone.
    this._ghostWall = null;
    this._ghostRamp = null;
    this._ghostPiece = null;         // last computed prospective piece (for debugging)

    this._cacheDom();
  }

  _cacheDom() {
    this.elOverlay  = document.getElementById('mg-overlay');
    this.elCenter   = document.getElementById('mg-center');
    this.elTop      = document.getElementById('mg-topbar');
    this.elTimer    = document.getElementById('mg-timer');
    this.elMode     = document.getElementById('mg-mode');
    this.elScores   = document.getElementById('mg-scores');
    this.elPrompt   = document.getElementById('mg-prompt');
    this.elNotice   = document.getElementById('mg-notice');
    this.elBuild      = document.getElementById('build-panel');
    this.elBuildType  = document.getElementById('build-type');
    this.elBuildCount = document.getElementById('build-count');
    this.elBuildSlots = this.elBuild?.querySelectorAll('.bp-slot') ?? [];
  }

  // ── Build the selection signs from the server catalogue ─────────────────────

  setCatalogue(modes) {
    // Clear any previous signs (e.g. on reconnect)
    for (const s of this.signs) { this.scene.remove(s.post); this.scene.remove(s.pad); }
    this.signs = [];

    modes.forEach((m, i) => {
      const x = ROW_X[i % ROW_X.length];
      const z = ROW_Z[Math.floor(i / ROW_X.length)];
      const color = m.implemented ? 0xe8c86a : 0x667080;

      // Two wooden posts holding a sign board (like a hanging shop sign)
      const post = new THREE.Group();
      const postMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });
      for (const sx of [-1.7, 1.7]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.4, 0.18), postMat);
        pole.position.set(sx, 1.7, 0);
        pole.castShadow = true;
        post.add(pole);
      }
      // Cross beam
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.18, 0.18), postMat);
      beam.position.set(0, 3.5, 0);
      post.add(beam);

      // The sign BOARD — the mini-game name is painted onto it (a texture),
      // not floating in the air.
      const boardTex = this._signTexture(m);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(3.3, 1.7),
        new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.7, side: THREE.DoubleSide,
          emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 0.35 }),
      );
      board.position.set(0, 2.4, 0);
      post.add(board);

      post.position.set(x, 0, z);
      this.scene.add(post);

      // Glowing join pad on the ground in front of the sign
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.5, 0.12, 20),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4 }),
      );
      pad.position.set(x, 0.07, z + 2.2);
      this.scene.add(pad);

      this.signs.push({ ...m, padPos: new THREE.Vector3(x, 0, z + 2.2), post, pad });
    });
  }

  // Paints a mini-game's name + info onto a wooden sign-board texture.
  _signTexture(m) {
    const w = 512, h = 264;
    const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = cv.getContext('2d');

    // Wooden board with plank lines + border
    ctx.fillStyle = m.implemented ? '#6b4a2b' : '#4b4f57';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
    for (let y = 22; y < h; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = m.implemented ? '#e8c86a' : '#8a93a6'; ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    // Name (wraps to two lines if long)
    ctx.fillStyle = m.implemented ? '#ffe9a8' : '#c3c9d4';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
    const lines = wrap(m.name.toUpperCase(), 12);
    const fs = lines.length > 1 ? 52 : 62;
    ctx.font = `bold ${fs}px Arial, sans-serif`;
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, 96 + i * (fs + 6) - (lines.length - 1) * (fs + 6) / 2));

    // Sub line
    ctx.shadowBlur = 3;
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillStyle = m.implemented ? '#bfe6b0' : '#9aa3b3';
    ctx.fillText(m.implemented ? `${m.minPlayers}–${m.maxPlayers} Spieler` : 'folgt bald', w / 2, h - 44);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  // ── Per-frame update (proximity prompt + label projection) ──────────────────

  update(localPlayer) {
    // Don't offer joining while already in a running/lobby game
    const inGame = this.state && this.state.phase !== 'reset';

    // Nearest join pad within range
    this.nearSign = null;
    if (!inGame) {
      let best = JOIN_RADIUS;
      for (const s of this.signs) {
        const dx = localPlayer.x - s.padPos.x, dz = localPlayer.z - s.padPos.z;
        const d = Math.hypot(dx, dz);
        if (d < best) { best = d; this.nearSign = s; }
      }
    }

    if (this.nearSign) {
      this.elPrompt.style.display = 'block';
      this.elPrompt.innerHTML = this.nearSign.implemented
        ? `<kbd>E</kbd> &nbsp;<b>${esc(this.nearSign.name)}</b> beitreten`
        : `<b>${esc(this.nearSign.name)}</b> — folgt bald`;
    } else if (this.isBuildMode()) {
      this.elPrompt.style.display = 'block';
      this.elPrompt.innerHTML = '<kbd>1</kbd> Wand · <kbd>2</kbd> Rampe · <kbd>Links</kbd> Bauen · <kbd>Rechts</kbd> Entfernen · <kbd>B</kbd> Schießen';
    } else if (this.inBuildRound()) {
      this.elPrompt.style.display = 'block';
      this.elPrompt.innerHTML = '<kbd>B</kbd> zurück zum Bauen';
    } else {
      this.elPrompt.style.display = 'none';
    }

    this._updateBuildPanel();
    this._updateGhost(localPlayer);
  }

  // ── Ghost preview (translucent placement preview) ────────────────────────────

  _ensureGhosts() {
    if (this._ghostWall) return;
    const mat = () => new THREE.MeshBasicMaterial({
      color: 0x33aaff, transparent: true, opacity: 0.35,
      depthWrite: false, side: THREE.DoubleSide,
    });
    // Wall ghost: unit-thin box, scaled per orientation each frame.
    this._ghostWall = new THREE.Mesh(new THREE.BoxGeometry(1, GRID, 1), mat());
    this._ghostWall.visible = false;
    this.scene.add(this._ghostWall);
    // Ramp ghost: same wedge geometry as the real ramp mesh.
    this._ensureRampGeo();
    this._ghostRamp = new THREE.Mesh(this._rampGeo, mat());
    this._ghostRamp.visible = false;
    this.scene.add(this._ghostRamp);
  }

  _updateGhost(localPlayer) {
    if (!this.isBuildMode()) { this._hideGhosts(); return; }
    this._ensureGhosts();

    // Same inputs the confirm-click will send → same shared computation the
    // server runs, so the preview is exactly where the piece will appear.
    const eye = localPlayer.eyePosition();
    const dir = {
      x: -Math.sin(localPlayer.yaw) * Math.cos(localPlayer.pitch),
      y:  Math.sin(localPlayer.pitch),
      z: -Math.cos(localPlayer.yaw) * Math.cos(localPlayer.pitch),
    };
    const piece = computePlacement(eye, dir, localPlayer.y, localPlayer.yaw, this.buildPieceType);
    this._ghostPiece = piece;
    if (!piece) { this._hideGhosts(); return; }

    // Valid → blue, blocked/out-of-zone or piece cap reached → red.
    const mine    = this.state?.scores?.find(s => s.id === this.net.myId);
    const capFull = (mine ? mine.score : 0) >= MAX_PIECES_PER_PLAYER;
    const ok      = placementValid(piece) && !capFull;
    const color   = ok ? 0x33aaff : 0xff4444;

    if (piece.type === 'ramp') {
      this._ghostWall.visible = false;
      this._ghostRamp.visible = true;
      this._ghostRamp.material.color.setHex(color);
      this._ghostRamp.position.set(piece.gx, piece.gy, piece.gz);
      this._ghostRamp.rotation.y = RAMP_ROT[piece.dir] ?? 0;
    } else {
      this._ghostRamp.visible = false;
      this._ghostWall.visible = true;
      this._ghostWall.material.color.setHex(color);
      this._ghostWall.position.set(piece.gx, piece.gy + GRID / 2, piece.gz);
      if (piece.orient === 'x') this._ghostWall.scale.set(GRID, 1, WALL_THICKNESS);
      else                      this._ghostWall.scale.set(WALL_THICKNESS, 1, GRID);
    }
  }

  _hideGhosts() {
    if (this._ghostWall) this._ghostWall.visible = false;
    if (this._ghostRamp) this._ghostRamp.visible = false;
  }

  // E pressed near a sign → join that mode
  tryJoin() {
    if (this.nearSign) this.net.mgJoin(this.nearSign.id);
  }

  leave() {
    this.net.mgLeave();
    this._clearTargets();
    this._clearBuildPieces();
    this._hideGhosts();
    this.buildInputOn = true; // reset for next time
    this._renderOverlay(null);
  }

  // ── Build Battle ─────────────────────────────────────────────────────────────

  /** Are we actively in build-input mode (round running AND not toggled off via B)? */
  isBuildMode() {
    return !!(this.state && this.state.mode === 'build_battle' && this.state.phase === 'running' && this.buildInputOn);
  }

  /** True while inside a running Build Battle round, regardless of the B toggle
   *  (used to gate the B key itself and the always-visible controls hint). */
  inBuildRound() {
    return !!(this.state && this.state.mode === 'build_battle' && this.state.phase === 'running');
  }

  /** B key: swap between building and shooting without leaving the round. */
  toggleBuildInput() {
    if (!this.inBuildRound()) return;
    this.buildInputOn = !this.buildInputOn;
    this._toast(this.buildInputOn ? '🔨 Baumodus AN' : '🔫 Baumodus AUS — Schießen aktiv');
  }

  setBuildPieceType(type) {
    this.buildPieceType = type === 'ramp' ? 'ramp' : 'wall';
  }

  placeBuild(localPlayer) {
    if (!this.isBuildMode()) return;
    this.net.sendMgAction({ type: 'build_place', pieceType: this.buildPieceType }, localPlayer.yaw, localPlayer.pitch);
  }

  removeBuild(localPlayer) {
    if (!this.isBuildMode()) return;
    this.net.sendMgAction({ type: 'build_remove' }, localPlayer.yaw, localPlayer.pitch);
  }

  onBuildState(msg) {
    // Resync the physics registry so LOCAL movement prediction collides with
    // whatever is currently built (shared/build.js — same module used by
    // shared/collision.js on this client).
    clearPieces();
    for (const p of msg.pieces) registerPiece(p);

    // Resync visuals. Piece counts are small (≤ 20 × maxPlayers), so a full
    // clear-and-rebuild each time is simpler and cheap enough vs. diffing.
    for (const mesh of this.buildMeshes.values()) this.scene.remove(mesh);
    this.buildMeshes.clear();
    for (const p of msg.pieces) {
      const mesh = this._makePieceMesh(p);
      this.scene.add(mesh);
      this.buildMeshes.set(p.id, mesh);
    }
  }

  _clearBuildPieces() {
    clearPieces();
    for (const mesh of this.buildMeshes.values()) this.scene.remove(mesh);
    this.buildMeshes.clear();
  }

  _ensureRampGeo() {
    if (this._rampGeo) return;
    // A right-triangle profile (rises from height 0 at local X=-GRID/2 to
    // GRID at X=+GRID/2), extruded GRID deep along Z — a smooth wedge. The
    // player actually walks it via an analytic slope (shared/build.js
    // applyRampWalk), so this visual matches the real walkable surface.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(GRID, 0); shape.lineTo(GRID, GRID); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: GRID, bevelEnabled: false });
    geo.translate(-GRID / 2, 0, -GRID / 2);
    this._rampGeo = geo;
  }

  _makePieceMesh(p) {
    if (p.type === 'ramp') {
      this._ensureRampGeo();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.7 });
      const mesh = new THREE.Mesh(this._rampGeo, mat);
      mesh.position.set(p.gx, p.gy, p.gz);
      mesh.rotation.y = RAMP_ROT[p.dir] ?? 0;
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    }
    const w = p.orient === 'x' ? GRID : WALL_THICKNESS;
    const d = p.orient === 'x' ? WALL_THICKNESS : GRID;
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a66b, roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, GRID, d), mat);
    mesh.position.set(p.gx, p.gy + GRID / 2, p.gz);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  _updateBuildPanel() {
    if (!this.elBuild) return;
    if (!this.isBuildMode()) { this.elBuild.style.display = 'none'; return; }

    this.elBuild.style.display = 'block';
    this.elBuildType.textContent = this.buildPieceType === 'ramp' ? 'Rampe' : 'Wand';
    const slot = this.buildPieceType === 'ramp' ? '2' : '1';
    for (const el of this.elBuildSlots) el.classList.toggle('active', el.dataset.slot === slot);

    const mine = this.state?.scores?.find(s => s.id === this.net.myId);
    const count = mine ? mine.score : 0;
    this.elBuildCount.textContent = `${count}/${MAX_PIECES_PER_PLAYER}`;
  }

  // ── Network handlers ────────────────────────────────────────────────────────

  onState(msg) {
    // Fresh Build Battle round starting → default back to build-input mode.
    const enteringRun = msg.mode === 'build_battle' && msg.phase === 'running'
      && !(this.state && this.state.phase === 'running');
    if (enteringRun) this.buildInputOn = true;

    this.state = msg;
    this._renderOverlay(msg);
  }
  onTargets(msg) { this._syncTargets(msg.targets); }
  onNotice(msg)  { this._toast(msg.text); }

  onEvent(msg) {
    switch (msg.event) {
      case 'target_hit': this._pingHit(); break;
      case 'tagged':     this._toast(`💣 ${msg.name} hat die Bombe!`); break;
      case 'levelup':    this._toast(`Stufe ${msg.level}/${msg.total}`); break;
      case 'eliminated': if (msg.id === this.net.myId) this._toast('☠ Ausgeschieden – Zuschauer'); break;
    }
  }

  // ── Overlay rendering by phase ──────────────────────────────────────────────

  _renderOverlay(s) {
    if (!s || s.phase === 'reset') {
      this.elOverlay.classList.remove('active');
      this.elTop.style.display = 'none';
      this.elCenter.style.display = 'none';
      if (!s) this.state = null;
      return;
    }
    this.elOverlay.classList.add('active');

    if (s.phase === 'lobby') {
      this._center(`<h2>${esc(s.name)}</h2><p>Warte auf Spieler…</p><p class="mg-sub">${s.scores.length} Spieler · <kbd>Esc</kbd> verlassen</p>`);
      this.elTop.style.display = 'none';
    } else if (s.phase === 'countdown') {
      this._center(`<h2>${esc(s.name)}</h2><div class="mg-count">${s.countdown}</div><p class="mg-sub">Macht euch bereit!</p>`);
      this.elTop.style.display = 'none';
    } else if (s.phase === 'running') {
      this.elCenter.style.display = 'none';
      this.elTop.style.display = 'flex';
      this.elMode.textContent  = s.name;
      this.elTimer.textContent = fmtTime(s.timeLeft);
      this._scores(s.scores);
    } else if (s.phase === 'ending') {
      const w = s.winner;
      const txt = !w || w.type === 'draw' ? 'Unentschieden'
        : w.type === 'team'   ? `🏆 ${esc(w.name)} gewinnt!`
        : w.type === 'coop_end' ? `Welle ${w.wave} erreicht`
        : `🏆 ${esc(w.name || '?')} gewinnt!`;
      this._center(`<h2>${esc(s.name)}</h2><div class="mg-winner">${txt}</div><p class="mg-sub">Zurück zum Hub…</p>`);
      this.elTop.style.display = 'none';
    }
  }

  _center(html) { this.elCenter.style.display = 'block'; this.elCenter.innerHTML = html; }

  _scores(scores) {
    this.elScores.innerHTML = scores.slice(0, 6)
      .map((r, i) => `<div class="mg-row ${r.id === this.net.myId ? 'me' : ''}"><span>${i + 1}. ${esc(r.name)}</span><b>${r.score}</b></div>`)
      .join('');
  }

  // ── Target Rush target spheres ──────────────────────────────────────────────

  _syncTargets(list) {
    const seen = new Set();
    for (const t of list) {
      seen.add(t.id);
      let m = this.targets.get(t.id);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.SphereGeometry(t.r, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xaa1010, emissiveIntensity: 0.7, roughness: 0.4 }),
        );
        this.scene.add(m);
        this.targets.set(t.id, m);
      }
      m.position.set(t.x, t.y, t.z);
    }
    // Remove stale
    for (const [id, m] of this.targets) {
      if (!seen.has(id)) { this.scene.remove(m); this.targets.delete(id); }
    }
  }

  _clearTargets() {
    for (const m of this.targets.values()) this.scene.remove(m);
    this.targets.clear();
  }

  _pingHit() {
    this.elTimer?.animate?.([{ color: '#7CFC00' }, { color: '#fff' }], { duration: 300 });
  }

  _toast(text) {
    this.elNotice.textContent = text;
    this.elNotice.classList.add('show');
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => this.elNotice.classList.remove('show'), 2200);
  }
}

function esc(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
}
// Greedy word-wrap into lines of at most `max` characters.
function wrap(text, max) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
