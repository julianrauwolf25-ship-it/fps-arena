// GamePhase.js — the lifecycle every mini-game runs through.
//
// LOBBY     → waiting in the staging area until enough players have queued
// COUNTDOWN → all players teleported in, frozen, 3-2-1 countdown on screen
// RUNNING   → the actual game is live
// ENDING    → winner(s) decided, results shown for a few seconds
// RESET     → arena/state restored, players sent back to the hub
//
// The GameManager drives transitions; individual modes react via hooks.

export const Phase = Object.freeze({
  LOBBY:     'lobby',
  COUNTDOWN: 'countdown',
  RUNNING:   'running',
  ENDING:    'ending',
  RESET:     'reset',
});
