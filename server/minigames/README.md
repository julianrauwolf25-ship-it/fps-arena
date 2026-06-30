# Mini-Game Framework

A self-contained, server-authoritative framework for hub-based mini-games, built
on top of our existing Three.js + Node/WebSocket FPS. **This is not Minecraft** —
the original spec's Minecraft concepts are adapted to our engine (see below).

## Concept mapping (Minecraft → this engine)

| Spec term            | Implemented as                                              |
|----------------------|-------------------------------------------------------------|
| Wool / breakable blocks | Destructible tile entities the mode tracks & removes     |
| Bow / Crossbow / Trident | `projectile` weapons in `weapons.js` (server-simulated arc) |
| Sword                | `melee` weapon (short-range instant hit)                    |
| TNT / explosion      | A timed elimination event broadcast to clients              |
| Target blocks        | Sphere/AABB target entities (reference mode: `TargetRush`)  |
| Mobs (Zombie mode)   | Server-driven AI agents (wave manager)                      |

## Architecture (clean framework ↔ mode separation)

```
server/minigames/
├── GamePhase.js     LOBBY → COUNTDOWN → RUNNING → ENDING → RESET
├── MiniGame.js      abstract base: lifecycle, players, timers, scoreboard, auto-reset
├── GameManager.js   registry + instances; the ONLY integration point with the netcode
├── Team.js          teams for team modes
├── GameTimer.js     tick-driven count-down/up (no wall-clock drift)
├── Scoreboard.js    per-player scores, ranking, winner detection
├── weapons.js       shared arsenal: bows, crossbow, trident, sword, gun-game ladder
└── modes/
    ├── index.js     MODES registry (hub menu is built from this)
    ├── TargetRush.js  ✅ full reference implementation
    └── (9 more)       🚧 scaffolded with final meta + the exact hooks to fill in
```

A **mode** only implements its rules via hooks; everything shared is free:

```js
class MyMode extends MiniGame {
  static meta = { id, name, description, minPlayers, maxPlayers, teams, durationSec };
  onStart()              {}  // set up arena, hand out weapons, spawn players
  onUpdate(dt)           {}  // per-tick rules
  onPlayerShoot(id, shot){}  // a shot was fired (origin+dir) — score/break/etc.
  onPlayerHit(a, b, w)   {}  // player a hit player b with weapon w
  checkWin()             {}  // return a winner descriptor or null
  onReset()              {}  // tear down what onStart built
}
```

## Lobby / hub flow

1. The open arena is the **hub**. Each mini-game has a **sign/portal** there.
2. Picking one → `GameManager.joinQueue(playerId, modeId)` → the mode's LOBBY.
3. When `minPlayers` is reached the instance auto-runs a **5-second countdown**,
   then `onStart()`.
4. During RUNNING the manager ticks the mode; it scores via the `Scoreboard`
   and broadcasts `mg_state` (~4×/s) for the HUD timer + scoreboard.
5. On a win condition (or the round timer expiring) → **ENDING** shows results
   for 6 s → **RESET** restores the arena and `returnToHub()` frees the players.

## Integration point

The framework talks to the world through one small adapter passed to
`new GameManager(host)`:

```js
host = {
  broadcastTo(ids, msg),  // send JSON to a set of player ids
  getPlayer(id),          // → server player object
  teleport(player, pos),  // move a player (spawns)
  sendToHub(player),      // return a player to the lobby world
}
```

The server's `Room` will own a `GameManager`, forward `shoot`/`hit` events into
`manager.onShoot/onHit`, and call `manager.update(dt)` each tick. Players not in
a game keep playing the normal hub deathmatch — modes run alongside it.

## Status

- ✅ Framework core (lifecycle, teams, timers, scoreboards, weapons registry)
- ✅ Mode registry + `TargetRush` reference mode (works end-to-end once wired)
- 🚧 Hub sign UI + client HUD (`mg_state`/`mg_targets` rendering) — next
- 🚧 Projectile (arrow/trident) simulation on the server — next
- 🚧 The remaining 9 modes — each scaffolded with its hooks
```
