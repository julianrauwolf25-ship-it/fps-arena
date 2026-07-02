// BuildBattle.js — Fortnite-style building practice: place walls and ramps
// (20 pieces each) on a strict grid — ramps FILL a cell, walls sit on cell
// EDGES — and everything is removed automatically when the round ends.
//
// Placement is server-authoritative but computed by the SAME shared function
// (shared/build.js computePlacement) that drives the client's translucent
// ghost preview, so what the player sees is exactly what the server places.
// The client only sends { pieceType, yaw, pitch }; eye position and feet
// height come from the server's own player state (like Room.js's hitscan).

import { MiniGame } from '../MiniGame.js';
import {
  BUILD_SPAWNS, BUILD_REACH, MAX_PIECES_PER_PLAYER,
  pieces, registerPiece, removePieceById, clearPieces, getPiecesArray,
  computePlacement, placementValid, inBuildArena,
  pieceAimBox, rayAABB,
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
      this._place(id, pieceType, eye, dir, yaw, player.y);
    } else if (action.type === 'build_remove') {
      this._remove(id, eye, dir);
    }
  }

  onReset() {
    clearPieces();
    this._broadcastPieces();
  }

  // ── Placement / removal ─────────────────────────────────────────────────────

  _place(id, pieceType, eye, dir, yaw, feetY) {
    const count = this.countByOwner.get(id) ?? 0;
    if (count >= MAX_PIECES_PER_PLAYER) {
      this.send(id, { type: 'mg_notice', text: 'Maximal 20 Objekte erreicht!' });
      return;
    }

    // Same computation the client used for its ghost preview.
    const piece = computePlacement(eye, dir, feetY, yaw, pieceType);
    if (!piece) return;
    if (!inBuildArena(piece.gx, piece.gz)) {
      this.send(id, { type: 'mg_notice', text: 'Außerhalb der Bauzone!' });
      return;
    }
    if (!placementValid(piece)) return;   // cell/edge already occupied — ignore

    piece.id      = `${id}_${this._nextPieceId++}`;
    piece.ownerId = id;
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

  _raycastPieceHit(eye, dir) {
    let bestId = null, bestT = BUILD_REACH;
    for (const piece of pieces.values()) {
      const t = rayAABB(eye, dir, pieceAimBox(piece));
      if (t !== null && t < bestT) { bestT = t; bestId = piece.id; }
    }
    return bestId;
  }

  _broadcastPieces() {
    this.broadcast({ type: 'mg_build_state', pieces: getPiecesArray() });
  }
}
