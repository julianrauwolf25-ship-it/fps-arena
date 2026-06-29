import { Network }     from './Network.js';
import { LocalPlayer } from './LocalPlayer.js';
import { Game }        from './Game.js';
import { HUD }         from './HUD.js';
import { WEAPONS }     from '../../shared/constants.js';

// ── Lobby ─────────────────────────────────────────────────────────────────────
const lobbyEl    = document.getElementById('lobby');
const nameInput  = document.getElementById('name-input');
const joinBtn    = document.getElementById('join-btn');
const connStatus = document.getElementById('conn-status');

nameInput.focus();
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });
joinBtn.addEventListener('click', attemptJoin);

// ── Game state ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
let game = null, localPlayer = null, hud = null, net = null;
let inGame = false, lastInputStr = null;
let mouseLeftDown = false;   // tracked for full-auto weapons
let lastShotMs    = 0;       // client-side fire-rate gate

// ── Connect ───────────────────────────────────────────────────────────────────
function attemptJoin() {
  const name = nameInput.value.trim() || 'Player';
  connStatus.textContent = 'Connecting…';
  joinBtn.disabled = true;

  net = new Network({
    onOpen()  { connStatus.textContent = 'Connected — joining…'; net.join(name); },
    onClose() { connStatus.textContent = 'Disconnected. Reload to reconnect.'; joinBtn.disabled = false; },
    onError() { connStatus.textContent = 'Connection error.'; joinBtn.disabled = false; },

    onInit(msg) { startGame(msg.id, msg.snapshot); },

    onSnapshot(msg) {
      if (!inGame) return;
      game.processSnapshot(msg, net.myId, localPlayer);
      hud.updateScoreboard(msg.players);
      const me = msg.players.find(p => p.id === net.myId);
      if (me) {
        hud.setHealth(me.health);
        hud.setAmmo(me.ammo, me.reloading, localPlayer.currentWeapon);
        hud.showRespawn(me.dead);
      }
    },

    onHit(msg) {
      if (!inGame) return;
      if (msg.shooterId === net.myId) hud.flashHitmarker(msg.kill);
      if (msg.kill) hud.addKillFeed(msg.shooterName, msg.targetName, msg.shooterId, msg.targetId);
      if (msg.targetId === net.myId) hud.showHitVignette();
    },

    onPlayerJoin(msg)  { if (inGame) game.addRemotePlayer(msg.id, msg.name); },
    onPlayerLeave(msg) { if (inGame) game.removeRemotePlayer(msg.id); },
  });

  net.connect();
}

// ── Start game ────────────────────────────────────────────────────────────────
function startGame(myId, initialSnapshot) {
  inGame      = true;
  game        = new Game(canvas);
  localPlayer = new LocalPlayer();
  hud         = new HUD(myId);

  if (initialSnapshot) {
    for (const ps of initialSnapshot.players) {
      if (ps.id !== myId) game.addRemotePlayer(ps.id, ps.name);
    }
  }

  lobbyEl.classList.add('hidden');
  hud.show();
  hud.setHealth(100);
  hud.setAmmo(WEAPONS.pistol.ammo, false, 'pistol');

  // Weapon switch callback — updates viewmodel and HUD
  localPlayer.onWeaponSwitch = (id) => {
    game.setWeapon(id);
    hud.setWeapon(id);
    hud.setAmmo(WEAPONS[id].ammo, false, id);
  };

  // Reload callback
  localPlayer.onReload = () => { net.sendReload(); };

  // Pointer lock on click
  canvas.addEventListener('click', () => {
    if (inGame && !localPlayer.dead) canvas.requestPointerLock();
  });

  // LEFT click = shoot (semi-auto fires on press; full-auto handled in loop)
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      mouseLeftDown = true;
      tryShoot();   // immediate first shot
    }
    if (e.button === 2 && inGame) hud.setADS(true, localPlayer.currentWeapon);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseLeftDown = false;
    if (e.button === 2 && inGame) hud.setADS(false, localPlayer.currentWeapon);
  });

  // Send inputs ~20 Hz
  setInterval(() => {
    if (!inGame) return;
    const input = localPlayer.currentInput();
    const str   = JSON.stringify(input);
    if (str !== lastInputStr) { lastInputStr = str; net.sendInput(input, localPlayer.seq); }
  }, 50);

  requestAnimationFrame(loop);
}

// ── Shooting ────────────────────────────────────────────────────────────────
// Client-side fire-rate gate keeps the cadence smooth and avoids spamming the
// server faster than the weapon allows. The server still validates everything.
function tryShoot() {
  if (!inGame || !document.pointerLockElement || localPlayer.dead) return;
  if (localPlayer.reloading) return;

  const w   = WEAPONS[localPlayer.currentWeapon];
  const now = performance.now();
  if (now - lastShotMs < w.fireRate) return;
  lastShotMs = now;

  net.sendShoot(localPlayer.yaw, localPlayer.pitch, localPlayer.currentWeapon);
  game.triggerKick(localPlayer.currentWeapon);
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  if (!inGame) return;
  requestAnimationFrame(loop);

  const dt = Math.min((ts - lastTime) / 1000, 0.1);
  lastTime = ts;

  // Full-auto weapons keep firing while the left button is held
  if (mouseLeftDown && WEAPONS[localPlayer.currentWeapon].auto) tryShoot();

  if (!localPlayer.dead) localPlayer.update(dt);
  game.render(localPlayer, dt);
}
