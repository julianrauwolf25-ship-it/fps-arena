import { Network }     from './Network.js';
import { LocalPlayer } from './LocalPlayer.js';
import { Game }        from './Game.js';
import { HUD }         from './HUD.js';
import { MiniGames }   from './MiniGames.js';
import { WEAPONS, ARENA_HALF } from '../../shared/constants.js';

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
let game = null, localPlayer = null, hud = null, net = null, miniGames = null;
let inGame = false, lastInputStr = null;
let mouseLeftDown = false;   // tracked for full-auto weapons
let lastShotMs    = 0;       // client-side fire-rate gate
let wasInParkour  = false;   // tracks arena↔parkour transitions

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
      if (msg.shooterId === net.myId) hud.flashHitmarker(msg.kill, msg.headshot);
      if (msg.kill) hud.addKillFeed(msg.shooterName, msg.targetName, msg.shooterId, msg.targetId);
      if (msg.targetId === net.myId) hud.showHitVignette();
    },

    onPlayerJoin(msg)  { if (inGame) game.addRemotePlayer(msg.id, msg.name); },
    onPlayerLeave(msg) { if (inGame) game.removeRemotePlayer(msg.id); },

    // Mini-game framework
    onMgCatalogue(msg) { miniGames?.setCatalogue(msg.modes); },
    onMgState(msg)     { miniGames?.onState(msg); },
    onMgTargets(msg)   { miniGames?.onTargets(msg); },
    onMgEvent(msg)     { miniGames?.onEvent(msg); },
    onMgNotice(msg)    { miniGames?.onNotice(msg); },
  });

  net.connect();
}

// ── Start game ────────────────────────────────────────────────────────────────
function startGame(myId, initialSnapshot) {
  inGame      = true;
  game        = new Game(canvas);
  localPlayer = new LocalPlayer();
  hud         = new HUD(myId);
  miniGames   = new MiniGames(game, net);

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

  // Parkour: checkpoint reached
  localPlayer.onCheckpoint = () => { hud.flashMessage('✔ Checkpoint', 'Gespeichert'); };

  // Mini-game lobby: E joins the nearest sign, Esc leaves the current game
  window.addEventListener('keydown', (e) => {
    if (!inGame) return;
    if (e.code === 'KeyE')   miniGames.tryJoin();
    if (e.code === 'Escape') miniGames.leave();
  });

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
  // Visual feedback = bullet holes where the rounds land (no muzzle flash / recoil)
  game.spawnImpacts(localPlayer.eyePosition(), localPlayer.yaw, localPlayer.pitch, localPlayer.currentWeapon);
}

// ── Game loop ─────────────────────────────────────────────────────────────────
// Physics runs at the render rate (variable dt) and the camera draws it
// directly — so there is no physics/display rate-mismatch beat. A drift-
// compensated limiter locks the loop to a clean 120 FPS.
const TARGET_FPS = 120;
const FRAME_MS   = 1000 / TARGET_FPS;
let   lastTime   = 0;   // timestamp of the last *rendered* frame
let   nextDue    = 0;   // scheduled time of the next frame (for the limiter)

// FPS counter (averaged over ~0.5 s)
let fpsTimer = 0, fpsFrames = 0;

function loop(ts) {
  if (!inGame) return;
  requestAnimationFrame(loop);

  // ── 120 FPS limiter ───────────────────────────────────────────────────────
  if (nextDue === 0) { nextDue = ts; lastTime = ts; }
  if (ts < nextDue - 1) return;            // too early → wait for the next tick
  nextDue += FRAME_MS;
  if (ts > nextDue) nextDue = ts + FRAME_MS; // fell behind → resync, no catch-up

  let dt = (ts - lastTime) / 1000;
  lastTime = ts;
  if (!isFinite(dt) || dt <= 0) dt = 1 / TARGET_FPS;
  dt = Math.min(dt, 0.1);                   // clamp after a stall/tab-out

  // Full-auto weapons keep firing while the left button is held
  if (mouseLeftDown && WEAPONS[localPlayer.currentWeapon].auto) tryShoot();

  if (!localPlayer.dead) localPlayer.update(dt);

  // Mini-game signs: proximity prompt + label projection
  miniGames.update(localPlayer);

  // Show a one-time hint when crossing from the arena into the parkour zone
  const inParkour = localPlayer.x > ARENA_HALF;
  if (inParkour && !wasInParkour) {
    hud.flashMessage('Parkour', 'Links = schwer  ·  Rechts = leicht  ·  Runterfallen = zurück zum Checkpoint', 3500);
  }
  wasInParkour = inParkour;

  game.render(localPlayer, dt);

  // Update the on-screen FPS readout
  fpsTimer += dt; fpsFrames++;
  if (fpsTimer >= 0.5) { hud.setFPS(Math.round(fpsFrames / fpsTimer)); fpsTimer = 0; fpsFrames = 0; }
}
