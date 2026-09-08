// ui.js — HUD, screens, toasts, hangar shop, upgrade pick cards, character select.
import { META_UPGRADES, RUN_UPGRADES, metaCost, runLevels, BOTS, BOT_ORDER } from './upgrades.js';

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
  $('bin-fill').style.width = Math.min(100, s.bin / s.binMax * 100) + '%';
  const t = Math.floor(s.time);
  $('time-label').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Level intro banner (shows the room name + theme + "clear all the dirt").
export function showLevelIntro(def, level) {
  const el = $('level-intro');
  if (!el) return;
  const room = def.roomName || def.theme.name;
  $('intro-theme').textContent = `${def.theme.icon} ${room}`;
  $('intro-sub').textContent = `${def.theme.name}${def.roomSub ? ' · ' + def.roomSub : ''} · level ${level}`;
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

// ---- Character select ----
// Render a static top-down portrait of a bot def onto an 84x84 canvas.
// Reuses the same shapes as the in-game bot (round/lidar/shark) at a fixed
// heading (facing up) and a mid brush angle, so the card matches the run.
function drawPortrait(cv, botId) {
  const d = BOTS[botId];
  const S = 84, cx = S / 2, cy = S / 2, R = S * 0.36;
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  c.save();
  c.translate(cx, cy);
  const col = d.colors;
  const body = col.body;
  const brush = 0.7; // frozen brush angle for the portrait
  // brushes (front = -Y)
  const brushCount = { round: 2, lidar: 2, shark: 1 }[d.shape] || 2;
  const reach = R * 1.12, br = R * 0.42;
  c.strokeStyle = '#ffcf5c'; c.lineWidth = Math.max(2, R * 0.10); c.lineCap = 'round';
  for (let i = 0; i < brushCount; i++) {
    const off = i === 0 ? -0.72 : 0.72;
    const bx = Math.sin(off) * reach, by = -Math.cos(off) * reach;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = brush + k * (Math.PI * 2 / 3);
      c.moveTo(bx, by); c.lineTo(bx + Math.cos(a) * br, by + Math.sin(a) * br);
    }
    c.stroke();
  }
  c.lineCap = 'butt';
  if (d.shape === 'lidar') {
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = col.rim; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.94, 0, Math.PI * 2); c.fillStyle = body; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.46, 0, Math.PI * 2); c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1, R * 0.05); c.stroke();
    c.beginPath(); c.moveTo(0, 0); c.lineTo(R * 0.40, 0);
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1.5, R * 0.07); c.stroke();
    c.beginPath(); c.arc(R * 0.40, 0, R * 0.08, 0, Math.PI * 2); c.fillStyle = '#4dffa6'; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.94, Math.PI * 1.25, Math.PI * 1.75);
    c.strokeStyle = col.rim; c.lineWidth = Math.max(2, R * 0.10); c.stroke();
  } else if (d.shape === 'shark') {
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = col.rim; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.94, 0, Math.PI * 2); c.fillStyle = body; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.94, -0.5, 0.5); c.lineTo(0, 0); c.closePath();
    c.fillStyle = col.rim; c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1;
    c.beginPath(); c.arc(0, R * 0.42, R * 0.40, 0, Math.PI * 2); c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1.5, R * 0.06); c.stroke();
    c.beginPath(); c.arc(0, R * 0.42, R * 0.16, 0, Math.PI * 2); c.fillStyle = col.domeHi; c.fill();
    c.beginPath(); c.arc(0, -R * 0.62, R * 0.16, 0, Math.PI * 2); c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1, R * 0.04); c.stroke();
    c.beginPath(); c.arc(0, -R * 0.62, Math.max(1, R * 0.07), 0, Math.PI * 2); c.fillStyle = '#3fb6ff'; c.fill();
  } else {
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = col.rim; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.92, 0, Math.PI * 2); c.fillStyle = body; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.92, Math.PI * 1.15, Math.PI * 1.85);
    c.strokeStyle = col.rim; c.lineWidth = Math.max(2, R * 0.14); c.stroke();
    c.beginPath(); c.arc(0, -R * 0.5, R * 0.34, 0, Math.PI * 2); c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1, R * 0.05); c.stroke();
    c.beginPath(); c.arc(0, -R * 0.5, Math.max(1.5, R * 0.10), 0, Math.PI * 2); c.fillStyle = '#3fb6ff'; c.fill();
    c.fillStyle = col.rim;
    c.fillRect(-R * 0.22, R * 0.72, R * 0.16, R * 0.12);
    c.fillRect(R * 0.06, R * 0.72, R * 0.16, R * 0.12);
  }
  // glint
  c.beginPath(); c.arc(-R * 0.25, -R * 0.1, R * 0.45, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.10)'; c.fill();
  c.restore();
}

const STAT_BARS = [
  { key: 'speed', label: 'SPEED', max: 8, color: 'var(--blue)' },
  { key: 'suction', label: 'SUCTION', max: 1.5, color: 'var(--accent)' },
  { key: 'binMax', label: 'HOPPER', max: 140, color: 'var(--gold)' },
  { key: 'magnetRange', label: 'MAGNET', max: 2, color: 'var(--ok)' },
];

export function buildBots(save, selectedId, onPick) {
  const list = $('bot-list');
  list.innerHTML = '';
  for (const id of BOT_ORDER) {
    const d = BOTS[id];
    const card = document.createElement('div');
    card.className = 'bot-card' + (id === selectedId ? ' selected' : '');
    const port = document.createElement('div');
    port.className = 'bot-portrait';
    const cv = document.createElement('canvas');
    drawPortrait(cv, id);
    port.appendChild(cv);
    const info = document.createElement('div');
    info.className = 'bot-info';
    let bars = '';
    for (const b of STAT_BARS) {
      const v = d.stats[b.key];
      const frac = Math.max(0, Math.min(1, v / b.max));
      bars += `<div class="bot-bar-row"><span>${b.label}</span>` +
        `<span class="bot-bar"><div style="width:${Math.round(frac * 100)}%;background:${b.color}"></div></span></div>`;
    }
    info.innerHTML = `
      <div class="bot-name">${d.icon} ${d.name}</div>
      <div class="bot-sub">${d.sub}</div>
      <div class="bot-blurb">${d.blurb}</div>
      <div class="bot-bars">${bars}</div>`;
    card.appendChild(port);
    card.appendChild(info);
    card.onclick = () => { onPick(id); };
    list.appendChild(card);
  }
}

