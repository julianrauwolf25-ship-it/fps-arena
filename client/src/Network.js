// Network.js — WebSocket client wrapper
// Derives the WS URL from window.location so it works locally and in production
// without any code changes.

export class Network {
  constructor(handlers) {
    this.handlers   = handlers; // { onInit, onSnapshot, onHit, onPlayerJoin, onPlayerLeave }
    this.ws         = null;
    this.connected  = false;
    this.myId       = null;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url   = `${proto}//${location.host}`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.handlers.onOpen?.();
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.handlers.onClose?.();
    });

    this.ws.addEventListener('error', () => {
      this.handlers.onError?.();
    });

    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._dispatch(msg);
    });
  }

  _dispatch(msg) {
    switch (msg.type) {
      case 'init':        this.myId = msg.id; this.handlers.onInit?.(msg);       break;
      case 'snapshot':    this.handlers.onSnapshot?.(msg);                       break;
      case 'hit':         this.handlers.onHit?.(msg);                            break;
      case 'playerJoin':  this.handlers.onPlayerJoin?.(msg);                     break;
      case 'playerLeave': this.handlers.onPlayerLeave?.(msg);                    break;
      // Mini-game framework messages
      case 'mg_catalogue': this.handlers.onMgCatalogue?.(msg);                   break;
      case 'mg_state':     this.handlers.onMgState?.(msg);                       break;
      case 'mg_targets':   this.handlers.onMgTargets?.(msg);                     break;
      case 'mg_event':     this.handlers.onMgEvent?.(msg);                       break;
      case 'mg_notice':    this.handlers.onMgNotice?.(msg);                      break;
      case 'mg_weapon_lock': this.handlers.onMgWeaponLock?.(msg);               break;
      case 'mg_build_state': this.handlers.onMgBuildState?.(msg);               break;
    }
  }

  // ── Send helpers ────────────────────────────────────────────────────────────

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  join(name) { this.send({ type: 'join', name }); }

  sendInput(input, seq) { this.send({ type: 'input', input, seq }); }

  sendShoot(yaw, pitch, weapon) { this.send({ type: 'shoot', yaw, pitch, weapon }); }

  mgJoin(mode) { this.send({ type: 'mg_join', mode }); }
  mgLeave()    { this.send({ type: 'mg_leave' }); }

  // Generic mini-game action (Build Battle place/remove, etc). yaw/pitch travel
  // alongside so the server computes the aim ray itself (never trusts a
  // client-supplied origin/direction) — same pattern as sendShoot.
  sendMgAction(action, yaw, pitch) { this.send({ type: 'mg_action', action, yaw, pitch }); }

  sendReload() { this.send({ type: 'reload' }); }
}
