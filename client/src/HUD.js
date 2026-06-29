// HUD.js — all DOM-based UI updates (health, ammo, kill feed, scoreboard)

const MAX_KILLFEED = 6;
const KILLFEED_TTL = 4000; // ms

export class HUD {
  constructor(myId) {
    this.myId = myId;

    this._healthFill = document.getElementById('health-fill');
    this._healthNum  = document.getElementById('health-num');
    this._ammoCount  = document.getElementById('ammo-count');
    this._reloadMsg  = document.getElementById('reload-msg');
    this._killfeed   = document.getElementById('killfeed');
    this._respawn    = document.getElementById('respawn');
    this._respawnMsg = document.getElementById('respawn-msg');
    this._hitmarker  = document.getElementById('hitmarker');
    this._sbRows     = document.getElementById('sb-rows');
    this._scoreboard = document.getElementById('scoreboard');
    this._lockPrompt = document.getElementById('lock-prompt');

    this._kfEntries = [];
    this._hmTimeout = null;

    // Scoreboard toggle (Tab key)
    window.addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); this._scoreboard.classList.add('visible'); } });
    window.addEventListener('keyup',   (e) => { if (e.code === 'Tab') this._scoreboard.classList.remove('visible'); });

    // Pointer-lock hint
    document.addEventListener('pointerlockchange', () => {
      this._lockPrompt.classList.toggle('hidden', !!document.pointerLockElement);
    });
  }

  show() { document.getElementById('hud').style.display = 'block'; }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, hp));
    this._healthFill.style.width  = pct + '%';
    this._healthFill.style.background =
      pct > 60 ? '#4caf50' : pct > 30 ? '#ff9800' : '#f44336';
    this._healthNum.textContent   = Math.ceil(pct);
  }

  setAmmo(ammo, reloading) {
    this._ammoCount.textContent  = ammo;
    this._reloadMsg.textContent  = reloading ? 'Reloading…' : '';
    this._ammoCount.style.color  = ammo === 0 ? '#f44336' : '#fff';
  }

  showRespawn(show) {
    this._respawn.classList.toggle('visible', show);
    this._respawnMsg.textContent = show ? 'You were eliminated…' : '';
  }

  flashHitmarker(kill) {
    this._hitmarker.style.setProperty('--hm-color', kill ? '#ffff00' : '#ff4040');
    this._hitmarker.classList.add('flash');
    clearTimeout(this._hmTimeout);
    this._hmTimeout = setTimeout(() => this._hitmarker.classList.remove('flash'), 200);
    // override colour inline since we can't use CSS vars in ::before/after without JS
    const parts = this._hitmarker.querySelectorAll('*');
    // Just pulse the opacity — colour is controlled by CSS
    this._hitmarker.style.color = kill ? '#ffff00' : '#ff4040';
  }

  addKillFeedEntry(shooterName, targetName, myId, shooterId, targetId) {
    const el = document.createElement('div');
    el.className = 'kf-entry';

    const isMyKill   = shooterId === myId;
    const isMyDeath  = targetId  === myId;
    const sClass     = isMyKill  ? ' class="kf-you"' : '';
    const tClass     = isMyDeath ? ' class="kf-you"' : '';
    el.innerHTML = `<span${sClass}>${_esc(shooterName)}</span> ✕ <span${tClass}>${_esc(targetName)}</span>`;

    this._killfeed.prepend(el);
    this._kfEntries.push(el);
    if (this._kfEntries.length > MAX_KILLFEED) {
      const old = this._kfEntries.shift();
      old.remove();
    }
    setTimeout(() => el.remove(), KILLFEED_TTL);
  }

  updateScoreboard(players, myId) {
    // Keep the header row, replace the rest
    const header = this._sbRows.querySelector('.header');
    this._sbRows.innerHTML = '';
    this._sbRows.appendChild(header);

    // Sort by kills descending
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    for (const p of sorted) {
      const row  = document.createElement('div');
      row.className = 'sb-row' + (p.id === myId ? ' sb-me' : '');
      row.innerHTML =
        `<span>${_esc(p.name)}</span>` +
        `<span>${p.kills}</span><span>${p.deaths}</span>` +
        `<span>${p.dead ? '💀' : p.health}</span>`;
      this._sbRows.appendChild(row);
    }
  }
}

function _esc(str) {
  return String(str).replace(/[<>&"']/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' })[c]);
}
