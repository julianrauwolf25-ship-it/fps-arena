// main.js — entry point: lobby → connect → game loop
import { Network }     from './Network.js';
import { LocalPlayer } from './LocalPlayer.js';
import { Game }        from './Game.js';
import { HUD }         from './HUD.js';
import { MAX_AMMO }    from '../../shared/constants.js';

// ── Lobby UI ──────────────────────────────────────────────────────────────────
const lobbyEl    = document.getElementById('lobby');
const nameInput  = document.getElementById('name-input');
const joinBtn    = document.getElementById('join-btn');
const connStatus = document.getElementById('conn-status');

nameInput.focus();
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });
joinBtn.addEventListener('click', attemptJoin);

// ── Game globals ──────────────────────────────────────────────────────────────
const canvas      = document.getElementById('c');
let game          = null;
let localPlayer   = null;
let hud           = null;
let net           = null;
let inGame        = false;
let lastInput     = null;
let inputInterval = null;
let players       = [];    // latest scoreboard data from snapshot

// ── Connection ────────────────────────────────────────────────────────────────
function attemptJoin() {
  const name = nameInput.value.trim() || 'Player';
  connStatus.textContent = 'Connecting…';
  joinBtn.disabled = true;

  net = new Network({
    onOpen() {
      connStatus.textContent = 'Connected — joining…';
      net.join(name);
    },
    onClose()  { connStatus.textContent = 'Disconnected. Reload to reconnect.'; joinBtn.disabled = false; },
    onError()  { connStatus.textContent = 'Connection error.'; joinBtn.disabled = false; },

    onInit(msg) {
      startGame(msg.id, msg.snapshot);
    },

    onSnapshot(msg) {
      if (!inGame) return;
      players = msg.players;
      game.processSnapshot(msg, net.myId, localPlayer);
      hud.updateScoreboard(players, net.myId);
      // Sync ammo / reload from authoritative snapshot for our player
      const me = players.find(p => p.id === net.myId);
      if (me) {
        hud.setHealth(me.health);
        hud.setAmmo(me.ammo, me.reloading);
        hud.showRespawn(me.dead);
      }
    },

    onHit(msg) {
      if (!inGame) return;
      if (msg.shooterId === net.myId) {
        hud.flashHitmarker(msg.kill);
      }
      if (msg.kill) {
        const sn = msg.shooterName;
        const tn = msg.targetName;
        hud.addKillFeedEntry(sn, tn, net.myId, msg.shooterId, msg.targetId);
      }
    },

    onPlayerJoin(msg) {
      if (!inGame) return;
      game.addRemotePlayer(msg.id, msg.name);
    },

    onPlayerLeave(msg) {
      if (!inGame) return;
      game.removeRemotePlayer(msg.id);
    },
  });

  net.connect();
}

// ── Start game after server ack ───────────────────────────────────────────────
function startGame(myId, initialSnapshot) {
  inGame      = true;
  game        = new Game(canvas);
  localPlayer = new LocalPlayer();
  hud         = new HUD(myId);

  // Populate remote players from initial snapshot
  if (initialSnapshot) {
    for (const ps of initialSnapshot.players) {
      if (ps.id !== myId) game.addRemotePlayer(ps.id, ps.name);
    }
  }

  // Hide lobby, show HUD
  lobbyEl.classList.add('hidden');
  hud.show();
  hud.setHealth(100);
  hud.setAmmo(MAX_AMMO, false);

  // Pointer lock on canvas click (while in-game)
  canvas.addEventListener('click', () => {
    if (inGame && !localPlayer.dead) canvas.requestPointerLock();
  });

  // Shoot on mouse button (pointer locked only)
  window.addEventListener('mousedown', (e) => {
    if (!inGame || !document.pointerLockElement || localPlayer.dead) return;
    if (e.button === 0) {
      net.sendShoot(localPlayer.yaw, localPlayer.pitch);
    }
  });

  // Reload on R
  window.addEventListener('keydown', (e) => {
    if (!inGame || localPlayer.dead) return;
    if (e.code === 'KeyR' && !localPlayer.reloading) {
      net.sendReload();
    }
  });

  // Send input to server at ~20 Hz (matches tick rate)
  inputInterval = setInterval(() => {
    if (!inGame) return;
    const input = localPlayer.currentInput();
    // Only send if something changed (saves bandwidth)
    const inputStr = JSON.stringify(input);
    if (inputStr !== lastInput) {
      lastInput = inputStr;
      net.sendInput(input, localPlayer.seq);
    }
  }, 50);

  // Start render loop
  requestAnimationFrame(loop);
}

// ── Main render/update loop ───────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  if (!inGame) return;
  requestAnimationFrame(loop);

  const dt = Math.min((ts - lastTime) / 1000, 0.1);
  lastTime  = ts;

  if (!localPlayer.dead) {
    localPlayer.update(dt);
  }

  game.render(localPlayer);
}
