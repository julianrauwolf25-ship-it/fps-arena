import { WEAPONS, WEAPON_KEYS } from '../../shared/constants.js';

const KILLFEED_TTL = 4000;
const MAX_KF       = 6;

export class HUD {
  constructor(myId) {
    this.myId = myId;

    this._healthFill = document.getElementById('health-fill');
    this._healthNum  = document.getElementById('health-num');
    this._ammoCount  = document.getElementById('ammo-count');
    this._ammoMax    = document.getElementById('ammo-max');
    this._reloadMsg  = document.getElementById('reload-msg');
    this._weapName   = document.getElementById('weapon-name');
    this._killfeed   = document.getElementById('killfeed');
    this._scoreboard = document.getElementById('scoreboard');
    this._sbRows     = document.getElementById('sb-rows');
    this._respawn    = document.getElementById('respawn');
    this._hitmarker  = document.getElementById('hitmarker');
    this._lockPrompt = document.getElementById('lock-prompt');
    this._weapSlots  = document.querySelectorAll('.weap-slot');
    this._crosshair  = document.getElementById('crosshair');

    this._hmTimer = null;
    this._kfList  = [];

    window.addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); this._scoreboard.classList.add('visible'); } });
    window.addEventListener('keyup',   (e) => { if (e.code === 'Tab')   this._scoreboard.classList.remove('visible'); });

    document.addEventListener('pointerlockchange', () => {
      this._lockPrompt.classList.toggle('hidden', !!document.pointerLockElement);
    });
  }

  show() {
    document.getElementById('hud').style.display = 'block';
    this.setWeapon('pistol');
  }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, hp));
    this._healthFill.style.width = pct + '%';
    this._healthFill.style.background = pct > 60 ? '#4caf50' : pct > 30 ? '#ff9800' : '#f44336';
    this._healthNum.textContent = Math.ceil(pct);
  }

  setAmmo(ammo, reloading, weaponId) {
    this._ammoCount.textContent = ammo;
    this._ammoMax.textContent   = '/' + (WEAPONS[weaponId]?.ammo ?? '?');
    this._ammoCount.style.color = ammo === 0 ? '#f44336' : '#fff';
    this._reloadMsg.textContent = reloading ? 'RELOADING…' : '';
  }

  setWeapon(id) {
    const w = WEAPONS[id];
    if (!w) return;
    this._weapName.textContent = w.name.toUpperCase();
    this._weapSlots.forEach((el) => {
      el.classList.toggle('active', el.dataset.weapon === id);
    });
  }

  setADS(isAds) {
    this._crosshair.classList.toggle('ads', isAds);
  }

  showRespawn(show) {
    this._respawn.classList.toggle('visible', show);
  }

  flashHitmarker(kill) {
    this._hitmarker.style.borderColor = kill ? '#ffe000' : '#ff4040';
    this._hitmarker.classList.add('flash');
    clearTimeout(this._hmTimer);
    this._hmTimer = setTimeout(() => this._hitmarker.classList.remove('flash'), 180);
  }

  addKillFeed(shooterName, targetName, shooterId, targetId) {
    const el = document.createElement('div');
    el.className = 'kf-entry';
    const sc = shooterId === this.myId ? ' class="kf-you"' : '';
    const tc = targetId  === this.myId ? ' class="kf-you"' : '';
    el.innerHTML = `<span${sc}>${_e(shooterName)}</span> <span class="kf-x">✕</span> <span${tc}>${_e(targetName)}</span>`;
    this._killfeed.prepend(el);
    this._kfList.push(el);
    if (this._kfList.length > MAX_KF) this._kfList.shift().remove();
    setTimeout(() => el.remove(), KILLFEED_TTL);
  }

  updateScoreboard(players) {
    const header = this._sbRows.querySelector('.header');
    this._sbRows.innerHTML = '';
    this._sbRows.appendChild(header);
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'sb-row' + (p.id === this.myId ? ' sb-me' : '');
      row.innerHTML =
        `<span>${_e(p.name)}</span>` +
        `<span>${p.kills}</span><span>${p.deaths}</span>` +
        `<span>${p.dead ? '💀' : p.health}</span>`;
      this._sbRows.appendChild(row);
    }
  }
}

function _e(s) {
  return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c]);
}
