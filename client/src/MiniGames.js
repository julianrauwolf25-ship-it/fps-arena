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
    for (const s of this.signs) { this.scene.remove(s.post); this.scene.remove(s.pad); s.label.remove(); }
    this.signs = [];

    modes.forEach((m, i) => {
      const x = ROW_X[i % ROW_X.length];
      const z = ROW_Z[Math.floor(i / ROW_X.length)];
      const color = m.implemented ? 0xe8c86a : 0x667080;

      // Post + panel
      const post = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 3, 6),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }),
      );
      pole.position.y = 1.5;
      post.add(pole);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.4, 0.2),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: m.implemented ? 0.5 : 0.15, roughness: 0.5 }),
      );
      panel.position.y = 3.2;
      post.add(panel);
      post.position.set(x, 0, z);
      this.scene.add(post);

      // Glowing join pad on the ground
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.5, 0.12, 20),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4 }),
      );
      pad.position.set(x, 0.07, z + 2.2);
      this.scene.add(pad);

      // DOM label (billboarded each frame)
      const label = document.createElement('div');
      label.className = 'mg-sign-label' + (m.implemented ? '' : ' soon');
      label.innerHTML = `<b>${esc(m.name)}</b><span>${m.implemented ? `${m.minPlayers}-${m.maxPlayers} Spieler` : 'folgt bald'}</span>`;
      document.body.appendChild(label);

      this.signs.push({ ...m, pos: new THREE.Vector3(x, 3.2, z), padPos: new THREE.Vector3(x, 0, z + 2.2), post, pad, label });
    });
  }

  // ── Per-frame update (proximity prompt + label projection) ──────────────────

  update(localPlayer) {
    const cam = this.game.camera, rend = this.game.renderer;

    // Project sign labels to screen
    for (const s of this.signs) {
      const v = s.pos.clone().project(cam);
      if (v.z >= 1) { s.label.style.display = 'none'; continue; }
      s.label.style.display = 'block';
      s.label.style.left = ((v.x + 1) / 2 * rend.domElement.clientWidth) + 'px';
      s.label.style.top  = ((1 - v.y) / 2 * rend.domElement.clientHeight) + 'px';
    }

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
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
