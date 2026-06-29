# FPS Arena

A browser-based multiplayer first-person shooter built with Three.js + Node.js WebSockets.  
No game engine — everything is hand-rolled.

## Controls

| Action | Key |
|--------|-----|
| Move | WASD / Arrow keys |
| Look | Mouse (click to capture) |
| Jump | Space |
| Sprint | Shift |
| Shoot | Left click |
| Reload | R |
| Scoreboard | Hold Tab |

---

## 1 — Run locally (two terminal windows)

### Prerequisites
- Node.js ≥ 18  ([nodejs.org](https://nodejs.org))

### Steps

```bash
# 1. Enter the project folder
cd fps-game

# 2. Install dependencies (only needed once)
npm install

# 3. Terminal A — start the game server
npm run dev:server
# → Listening on http://localhost:3000

# 4. Terminal B — start the Vite dev frontend
npm run dev:client
# → Vite serves http://localhost:5173  (proxies WS to :3000)
```

Open **http://localhost:5173** in two browser tabs (or two browsers) — you'll see each other immediately.

> **Tip:** `npm run dev:server` uses Node's `--watch` flag (Node 18+) to auto-restart on server file changes.

---

## 2 — Deploy to the internet (Render.com — free tier)

Render natively supports persistent WebSocket connections, unlike Vercel/Netlify.

### 2a. Push to GitHub

```bash
git init
git add .
git commit -m "Initial FPS Arena"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/fps-arena.git
git push -u origin main
```

### 2b. Create a Render Web Service

1. Go to **https://dashboard.render.com** → **New → Web Service**
2. Connect your GitHub repo.
3. Render auto-detects `render.yaml` — just confirm:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Click **Create Web Service**.
5. Wait ~2 minutes for the build.

### 2c. Share with friends

Your public URL will be something like `https://fps-arena-xxxx.onrender.com`.  
Send it to friends — they open it in a browser and join the same room instantly.

> The WebSocket client auto-detects `wss://` when the page is served over HTTPS, so no config changes are needed.

### 2b-alt. Deploy via Docker (any provider)

```bash
docker build -t fps-arena .
docker run -p 3000:3000 fps-arena
# → http://localhost:3000
```

Push to any container registry (Docker Hub, GHCR) and deploy to Railway, Fly.io, etc.

---

## Architecture

```
Browser
  └─ Three.js render loop (60fps)
  └─ LocalPlayer (client-side prediction)
  └─ RemotePlayer (snapshot interpolation, 100ms delay buffer)
  └─ WebSocket → wss://host/

Node.js server
  └─ Express (serves dist/, /health)
  └─ ws (WebSocket server)
  └─ Room (authoritative game loop, 20 Hz)
       └─ ServerPlayer (physics, hitscan raycasting)
```

**Network flow:**

1. Client sends `input` messages (~20 Hz) with WASD/look state.
2. Server ticks at 20 Hz, simulates all players, broadcasts `snapshot` to everyone.
3. Client immediately applies its own movement (prediction); reconciles with server snapshot.
4. Remote players are rendered interpolated, 100 ms behind latest snapshot, for smooth motion.
5. Shoot events are sent as separate `shoot` messages; server does authoritative hitscan ray–AABB and broadcasts the `hit` result.

**Security:**
- All client inputs are sanitised and rate-limited server-side.
- The server never trusts client-reported hit results — it re-computes the raycast itself.
- Input fields are whitelisted (unknown keys ignored).

---

## Project structure

```
fps-game/
├── shared/constants.js    # tick rate, physics, map layout (imported by both sides)
├── server/
│   ├── index.js           # HTTP + WebSocket entry point
│   ├── Room.js            # authoritative game loop, shoot logic
│   └── Player.js          # server-side player physics + state
├── client/
│   ├── index.html         # HUD markup + styles
│   └── src/
│       ├── main.js        # lobby → connect → game loop
│       ├── Game.js        # Three.js scene + map
│       ├── LocalPlayer.js # prediction + input
│       ├── RemotePlayer.js# interpolation + mesh
│       ├── Network.js     # WebSocket client
│       └── HUD.js         # DOM UI (health, ammo, killfeed, scoreboard)
├── vite.config.js
├── package.json
├── Dockerfile
└── render.yaml
```
