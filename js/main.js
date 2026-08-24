// main.js — bootstrap: save/load, offline calc, main loop, UI wiring.
import { World } from './world.js';
import { Game } from './game.js';
import { BALANCE } from './upgrades.js';
import * as UI from './ui.js';
import * as Audio from './audio.js';

const SAVE_KEY = 'dustybot_save_v2';

function loadSave() {
  let s = { shards: 0, meta: {}, lastSeen: Date.now(), bestTime: 0, runs: 0, bestShards: 0 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      s = Object.assign(s, p);
      s.meta = p.meta || {};
    }
  } catch (e) { /* ignore */ }
  return s;
}
function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

// ---- offline shard collection (requires Auto-Pilot meta) ----
function computeOffline(save) {
  const now = Date.now();
  const dt = now - (save.lastSeen || now);
  if (dt < 60_000) return 0;
  if (!save.meta.meta_ap) return 0;
  const capMs = BALANCE.offline.capHours * 3600_000;
  const t = Math.min(dt, capMs);
  const rate = BALANCE.offline.basePerHour * (1 + BALANCE.offline.metaPerHour * ((save.meta.meta_polish) || 0));
  return Math.floor(rate * (t / 3600_000));
}

const canvas = document.getElementById('game');
const world = new World(canvas);
const save = loadSave();

const offlineGain = computeOffline(save);
if (offlineGain > 0) {
  save.shards += offlineGain;
  save._offlineGain = offlineGain;
}

const game = new Game(world, save);
game.onSave = () => writeSave(save);
writeSave(save);

// ---- UI wiring ----
const $ = id => document.getElementById(id);
$('btn-start').onclick = () => { Audio.resumeAudio(); Audio.sfx.click(); game.newRun(); };
$('btn-hangar').onclick = () => { Audio.sfx.click(); game.showHangar(); };
$('btn-back-menu').onclick = () => { Audio.sfx.click(); game.toMenu(); };
$('btn-retry').onclick = () => { Audio.sfx.click(); game.newRun(); };
$('btn-over-menu').onclick = () => { Audio.sfx.click(); game.showHangar(); };
$('btn-mute').onclick = () => {
  const m = !Audio.isMuted();
  Audio.setMuted(m);
  $('btn-mute').textContent = m ? '✕' : '♪';
};
const boostBtn = $('btn-boost');
const setBoost = v => game.controls.setBoost(v);
boostBtn.addEventListener('touchstart', e => { e.preventDefault(); Audio.resumeAudio(); setBoost(true); }, { passive: false });
boostBtn.addEventListener('touchend', e => { e.preventDefault(); setBoost(false); }, { passive: false });
boostBtn.addEventListener('mousedown', () => setBoost(true));
addEventListener('mouseup', () => setBoost(false));

game.toMenu();

// ---- main loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  world.render(dt, game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
