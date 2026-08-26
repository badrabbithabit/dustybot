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
  if (!el) return;
  el.textContent = msg;
  el.className = kind;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

export function setHud(s) {
  $('dust-count').textContent = Math.floor(s.dust);
  // remaining-dirt meter: starts full, empties as you clean
  const frac = s.dirtTotal > 0 ? s.dirt / s.dirtTotal : 0;
  const df = $('dirt-fill');
  df.style.width = (frac * 100) + '%';
  df.style.background = frac < 0.33 ? 'var(--gold)' : 'var(--accent)';
  $('dirt-label').textContent = `${s.dirt} left`;
  $('level-badge').textContent = `${s.themeIcon || ''} ${s.level}`;
  const xf = $('xp-fill');
  xf.style.width = Math.min(100, s.xp / s.xpNeed * 100) + '%';
  $('bin-fill').style.width = Math.min(100, s.bin / s.binMax * 100) + '%';
  const t = Math.floor(s.time);
  $('time-label').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Level intro banner (shows the theme + "clear all the dirt" objective).
export function showLevelIntro(def, level) {
  const el = $('level-intro');
  if (!el) return;
  $('intro-theme').textContent = `${def.theme.icon} ${def.theme.name}`;
  $('intro-sub').textContent = `${def.theme.sub} · level ${level}`;
  $('intro-obj').textContent = `Clear all ${def.dirtCount} motes of dirt`;
  el.classList.add('show');
}
export function hideLevelIntro() {
  const el = $('level-intro');
  if (el) el.classList.remove('show');
}

function fmtTime(t) {
  t = Math.floor(t);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function setMenu(state) {
  $('menu-shards').textContent = state.shards;
  $('best-line').textContent = `best: ${fmtTime(state.bestTime)} · ${state.runs} runs`;
  const el = $('offline-toast');
  if (state.offline) {
    el.textContent = `While you were away, Auto-Pilot collected ${state.offline} shards.`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
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
  $('over-title').textContent = 'BURIED';
  $('over-stats').innerHTML =
    `reached level <b>${state.level}</b><br>` +
    `survived <b>${fmtTime(state.time)}</b><br>` +
    `dust collected: <b>${Math.floor(state.dust)}</b>`;
  $('over-shards').textContent = `+${state.shardsGained} ✦ banked`;
}
