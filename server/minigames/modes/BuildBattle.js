// BuildBattle.js — Fortnite-style building practice: place walls and ramps
// (20 pieces each), which connect edge-to-edge and stack on top of one
// another. All placed geometry is removed automatically when the round ends
// (see onReset), regardless of how it ends (time-up, abort, or admin stop —
// all funnel through the shared MiniGame lifecycle).
//
// Placement is server-authoritative: the client only sends { pieceType, yaw,
// pitch }; this mode computes the aim ray from the player's own server-side
// eye position/rotation (exactly like Room.js's hitscan _shoot), then raycasts
// against the build-arena floor and existing pieces to find where to snap the
// new piece on the shared GRID (see shared/build.js).

import { MiniGame } from '../MiniGame.js';
import {
  BUILD_SPAWNS, BUILD_REACH, MAX_PIECES_PER_PLAYER,
  pieces, registerPiece, removePieceById, clearPieces, getPiecesArray,
  isCellOccupied, snapToGrid, inBuildArena, orientFromAim, rampDirFromAim,
  pieceBoxes,
} from '../../../shared/build.js';

export class BuildBattle extends MiniGame {
  static meta = {
    id:          'build_battle',
    name:        'Build Battle',
    description: 'Baue mit Wand & Rampe – 20 Objekte pro Spieler, verbindbar & stapelbar.',
    minPlayers:  1,
    maxPlayers:  6,
    teams:       false,
    durationSec: 180,
    implemented: true,
  };

  onStart() {
    clearPieces();
    this._nextPieceId = 1;
    this.countByOwner = new Map();

    let i = 0;
    for (const [id, p] of this.players) {
      this.countByOwner.set(id, 0);
      this.scoreboard.set(id, 0);
      p.mgSpawn = BUILD_SPAWNS[i % BUILD_SPAWNS.length];
      p.spawn();
      i++;
    }
    this._broadcastPieces();
  }

  onPlayerAction(id, action) {
    if (this.phase !== 'running') return;
    const player = this.players.get(id);
    if (!player) return;

    const yaw   = typeof action.yaw === 'number' ? action.yaw : player.yaw;
    const pitch = typeof action.pitch === 'number'
      ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, action.pitch)) : player.pitch;
    const eye = player.eyePos();
    const dir = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y:  Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };

    if (action.type === 'build_place') {
      const pieceType = action.pieceType === 'ramp' ? 'ramp' : 'wall';
      this._place(id, pieceType, eye, dir, yaw);
    } else if (action.type === 'build_remove') {
      this._remove(id, eye, dir);
    }
  }

  onReset() {
    clearPieces();
    this._broadcastPieces();
  }

  // ── Placement / removal ─────────────────────────────────────────────────────

  _place(id, pieceType, eye, dir, yaw) {
    const count = this.countByOwner.get(id) ?? 0;
    if (count >= MAX_PIECES_PER_PLAYER) {
      this.send(id, { type: 'mg_notice', text: 'Maximal 20 Objekte erreicht!' });
      return;
    }

    const hit = this._raycastPlacement(eye, dir);
    if (!hit) return;

    const { gx, gy, gz } = snapToGrid(hit.x, hit.y, hit.z);
    if (!inBuildArena(gx, gz)) {
      this.send(id, { type: 'mg_notice', text: 'Außerhalb der Bauzone!' });
      return;
    }
    if (isCellOccupied(gx, gy, gz)) return; // cell already taken — ignore silently

    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const piece = { id: `${id}_${this._nextPieceId++}`, ownerId: id, gx, gy, gz, type: pieceType };

    if (pieceType === 'ramp') piece.dir = rampDirFromAim(fx, fz);
    else                      piece.orient = orientFromAim(fx, fz);

    registerPiece(piece);
    this.countByOwner.set(id, count + 1);
    this.scoreboard.set(id, count + 1);
    this._broadcastPieces();
  }

  _remove(id, eye, dir) {
    const hitId = this._raycastPieceHit(eye, dir);
    if (!hitId) return;
    const piece = pieces.get(hitId);
    if (!piece || piece.ownerId !== id) return; // only remove your own pieces

    removePieceById(hitId);
    const count = Math.max(0, (this.countByOwner.get(id) ?? 1) - 1);
    this.countByOwner.set(id, count);
    this.scoreboard.set(id, count);
    this._broadcastPieces();
  }

  // ── Raycasting (server-authoritative) ───────────────────────────────────────

  _raycastPlacement(eye, dir) {
    let best = null, bestT = BUILD_REACH;

    // Ground plane (y = 0) inside the build arena.
    if (dir.y < -1e-6) {
      const t = -eye.y / dir.y;
      if (t > 0 && t < bestT) {
        const x = eye.x + dir.x * t, z = eye.z + dir.z * t;
        if (inBuildArena(x, z)) { bestT = t; best = { x, y: 0, z }; }
      }
    }
    // Existing pieces.
    for (const piece of pieces.values()) {
      for (const box of pieceBoxes(piece)) {
        const t = rayAABB(eye, dir, box);
        if (t !== null && t < bestT) {
          bestT = t;
          const hy = eye.y + dir.y * t;
          best = { x: eye.x + dir.x * t, y: hy, z: eye.z + dir.z * t };
        }
      }
    }
    return best;
  }

  _raycastPieceHit(eye, dir) {
    let bestId = null, bestT = BUILD_REACH;
    for (const piece of pieces.values()) {
      for (const box of pieceBoxes(piece)) {
        const t = rayAABB(eye, dir, box);
        if (t !== null && t < bestT) { bestT = t; bestId = piece.id; }
      }
    }
    return bestId;
  }

  _broadcastPieces() {
    this.broadcast({ type: 'mg_build_state', pieces: getPiecesArray() });
  }
}

// Ray–AABB slab test (same technique as Room.js's hitscan raycast).
function rayAABB(origin, dir, box) {
  const hw = box.w / 2, hh = box.h / 2, hd = box.d / 2;
  const minX = box.x - hw, maxX = box.x + hw;
  const minY = box.y - hh, maxY = box.y + hh;
  const minZ = box.z - hd, maxZ = box.z + hd;
  const eps = 1e-9;
  const ix = Math.abs(dir.x) > eps ? 1 / dir.x : (dir.x >= 0 ? Infinity : -Infinity);
  const iy = Math.abs(dir.y) > eps ? 1 / dir.y : (dir.y >= 0 ? Infinity : -Infinity);
  const iz = Math.abs(dir.z) > eps ? 1 / dir.z : (dir.z >= 0 ? Infinity : -Infinity);

  const tx1 = (minX - origin.x) * ix, tx2 = (maxX - origin.x) * ix;
  const ty1 = (minY - origin.y) * iy, ty2 = (maxY - origin.y) * iy;
  const tz1 = (minZ - origin.z) * iz, tz2 = (maxZ - origin.z) * iz;

  const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
  const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));

  if (tmax < 0 || tmin > tmax) return null;
  return tmin >= 0 ? tmin : tmax;
}
