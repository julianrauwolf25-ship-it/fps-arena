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

const JOIN_RADIUS = 3.2;

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
    } else {
      this.elPrompt.style.display = 'none';
    }
  }

  // E pressed near a sign → join that mode
  tryJoin() {
    if (this.nearSign) this.net.mgJoin(this.nearSign.id);
  }

  leave() { this.net.mgLeave(); this._clearTargets(); this._renderOverlay(null); }

  // ── Network handlers ────────────────────────────────────────────────────────

  onState(msg)   { this.state = msg; this._renderOverlay(msg); }
  onTargets(msg) { this._syncTargets(msg.targets); }
  onEvent(msg)   { if (msg.event === 'target_hit') this._pingHit(); }
  onNotice(msg)  { this._toast(msg.text); }

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
