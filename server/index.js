import express       from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath }   from 'url';
import { dirname, join }   from 'path';
import { Room }            from './Room.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 3000;

// ── HTTP layer ────────────────────────────────────────────────────────────────
const app    = express();
const server = createServer(app);

// Health-check endpoint (used by Render / Railway keep-alive probes)
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', players: defaultRoom.players.size, tick: defaultRoom.tick }),
);

// Serve the Vite-built frontend; fall back to index.html for SPA navigation.
// Cache policy: index.html must NEVER be cached (it references hash-named
// bundles that change every deploy — a cached copy would point at a deleted
// file, leaving players with a dead "Play" button). The hashed assets
// themselves are immutable and can be cached forever.
const distDir = join(__dirname, '../dist');
app.use(express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('*', (_req, res) =>
  res.sendFile(join(distDir, 'index.html'), {
    headers: { 'Cache-Control': 'no-cache, must-revalidate' },
  }),
);

// ── WebSocket layer ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// Single global room for MVP (easy to extend to multiple rooms later)
const defaultRoom = new Room('default');
let uidCounter    = 0;

wss.on('connection', (ws) => {
  const id = `p${++uidCounter}_${Date.now()}`;
  let joined = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; } // ignore malformed JSON

    // First message must be 'join' with a player name
    if (!joined) {
      if (msg.type !== 'join') return;
      const name = String(msg.name ?? 'Unnamed')
        .trim()
        .slice(0, 20)
        .replace(/[<>&"']/g, '');           // basic sanitisation
      defaultRoom.addPlayer(ws, id, name || 'Unnamed');
      joined = true;
      return;
    }

    defaultRoom.handleMessage(id, msg);
  });

  const cleanup = () => {
    if (joined) defaultRoom.removePlayer(id);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`FPS game server listening on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
