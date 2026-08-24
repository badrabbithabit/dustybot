// ui.js — HUD, screens, toasts, hangar shop, upgrade pick cards.
import { META_UPGRADES, RUN_UPGRADES, metaCost, runLevels } from './upgrades.js';

const $ = id => document.getElementById(id);

export function show(id) { $(id).classList.remove('hidden'); }
export function hide(id) { $(id).classList.add('hidden'); }
export function showAll(hideList, showId) {
  for (const h of hideList) hide(h);
  if (showId) show(showId);
}

let toastTimer = null;
export function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = kind;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

export function setHud(state) {
  const { lives, maxLives, roomNo, dust, battery, batteryMax, bin, binMax } = state;
  $('lives').textContent = '❤'.repeat(Math.max(0, lives)) + '🛡'.repeat(state.shield || 0);
  $('room-label').textContent = `Room ${roomNo}`;
  $('dust-count').textContent = Math.floor(dust);
  const bFrac = Math.max(0, battery / batteryMax);
  const bf = $('battery-fill');
  bf.style.width = (bFrac * 100) + '%';
  bf.style.background = bFrac > 0.5 ? 'var(--ok)' : bFrac > 0.25 ? 'var(--gold)' : 'var(--danger)';
  $('battery-pct').textContent = Math.round(bFrac * 100);
  $('bin-fill').style.width = Math.min(100, bin / binMax * 100) + '%';
  if (state.progress != null) {
    $('room-progress-fill').style.width = Math.min(100, state.progress * 100) + '%';
  }
}

export function setMenu(state) {
  $('menu-shards').textContent = state.shards;
  $('best-room').textContent = `best room: ${state.bestRoom}`;
  $('stats-line').textContent = `runs: ${state.runs} · best dust: ${state.bestDust}`;
  if (state.offline) {
    const el = $('offline-toast');
    el.textContent = `While you were away, your bot collected ${state.offline} dust shards.`;
    el.classList.remove('hidden');
  } else {
    $('offline-toast').classList.add('hidden');
  }
}

export function buildHangar(save, onBuy) {
  $('hangar-shards').textContent = save.shards;
  const list = $('meta-list');
  list.innerHTML = '';
  for (const u of META_UPGRADES) {
    const lvl = save.meta[u.id] || 0;
    const maxed = lvl >= u.max;
    const cost = maxed ? 0 : metaCost(u.id, lvl);
    const can = !maxed && save.shards >= cost;
    const row = document.createElement('div');
    row.className = 'meta-row';
    row.innerHTML = `
      <div class="pick-icon">${u.icon}</div>
      <div class="meta-info">
        <div class="meta-name"><span>${u.name}</span><span class="meta-lvl">${maxed ? 'MAX' : `Lv ${lvl}/${u.max}`}</span></div>
        <div class="meta-desc">${u.desc(lvl)}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'meta-buy' + (maxed ? ' max' : can ? ' can' : '');
    btn.textContent = maxed ? 'MAX' : `${cost} ✦`;
    btn.disabled = !can;
    btn.onclick = () => onBuy(u.id);
    row.appendChild(btn);
    list.appendChild(row);
  }
}

export function buildPicks(picks, stats, onPick) {
  const lvls = runLevels(stats);
  const list = $('pick-list');
  list.innerHTML = '';
  for (const u of picks) {
    const lvl = (lvls[u.id] || 0) + 1;
    const card = document.createElement('button');
    card.className = 'pick-card';
    card.innerHTML = `
      <div class="pick-icon">${u.icon}</div>
      <div>
        <div class="pick-name">${u.name} <span class="pick-lvl">Lv ${lvl}/${u.max}</span></div>
        <div class="pick-desc">${u.desc(lvl)}</div>
      </div>`;
    card.onclick = () => onPick(u.id);
    list.appendChild(card);
  }
}

export function setOver(state) {
  $('over-title').textContent = state.won ? 'RUN COMPLETE' : 'RUN OVER';
  $('over-stats').innerHTML =
    `reached <b>Room ${state.roomNo}</b><br>` +
    `dust collected: <b>${Math.floor(state.dust)}</b><br>` +
    `best room: <b>${state.bestRoom}</b>`;
  $('over-shards').textContent = `+${state.shardsGained} ✦ banked`;
}
