// sim-run-curve.mjs — measures the SHAPE of a full run's difficulty curve.
// Unlike sim-bots.mjs (fixed builds per level), this plays a SEQUENTIAL run:
// stats carry across levels and after each clear a human-like pick is taken
// from the real rollPicks() 1-of-3. It reports per-level clear time and
// seconds-per-mote so we can see whether the run oscillates
// "build -> slightly overpowered -> work hard -> repeat" (sawtooth) or just
// ramps monotonically.
//
// Run: node tools/sim-run-curve.mjs [maxLevel] [seeds]
import { BALANCE, makeRunStats, levelDef, applyPick, rollPicks, RUN_UPGRADES } from '../js/upgrades.js';
import { Bot } from '../js/bot.js';
import { DustSystem } from '../js/dust.js';
import { steer } from './steer.mjs';

const DOCK_TARGET = { x: BALANCE.dock.x, y: BALANCE.dock.y, dock: true };

let _seed = 1;
function reseed(s) { _seed = s >>> 0; }
function rng() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
Math.random = rng;

function makeWorld(def) {
  const W = BALANCE.arena.w, H = BALANCE.arena.h;
  const res = 6, cw = Math.ceil(W * res), ch = Math.ceil(H * res);
  const wet = new Float32Array(cw * ch);
  let wetEnergy = 0;
  return {
    W, H, obstacles: def.obstacles,
    blocked(x, y, pad = 0) {
      for (const o of this.obstacles)
        if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
      return false;
    },
    isFree(x, y, r = BALANCE.bot.radius) {
      if (x < r || y < r || x > this.W - r || y > this.H - r) return false;
      return !this.blocked(x, y, r);
    },
    stampWet(x, y, amt, radius = 0.8) {
      if (amt <= 0) return;
      const cx = (x * res) | 0, cy = (y * res) | 0;
      const r = Math.max(1, Math.round(radius * res));
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
        const i = py * cw + px;
        const v = wet[i] + amt * (dx * dx + dy * dy > r * r * 0.5 ? 0.5 : 1);
        wet[i] = v < 1 ? v : 1;
        wetEnergy++;
      }
    },
    wetAt(x, y) {
      const px = (x * res) | 0, py = (y * res) | 0;
      if (px < 0 || py < 0 || px >= cw || py >= ch) return 0;
      return wet[py * cw + px];
    },
    updateWet(dt) {
      if (wetEnergy <= 0) return;
      const f = Math.exp(-0.08 * dt);
      for (let i = 0; i < wet.length; i++) {
        const v = wet[i] * f;
        wet[i] = v < 0.01 ? 0 : v;
      }
      wetEnergy *= f;
      if (wetEnergy < 0.01) wetEnergy = 0;
    },
  };
}

function pickTarget(bot, dust, ai, def) {
  const fullish = bot.bin >= 0.85 * bot.stats.binMax && bot.bin > 0;
  const finalDump = dust.items.length === 0 && bot.bin > 0;
  if (fullish || finalDump || bot.full) return DOCK_TARGET;
  let best = null, bd = Infinity;
  for (const it of dust.items) {
    if (ai.skip.has(it)) continue;
    const d = Math.hypot(it.x - bot.x, it.y - bot.y);
    if (d < bd) { bd = d; best = it; }
  }
  return best || null;
}

function simulateLevel(botId, levelN, stats, seed, timeCap = 300) {
  reseed(seed);
  const def = levelDef(levelN, 0);
  const world = makeWorld(def);
  const bot = new Bot(world, stats);
  bot.x = world.W / 2; bot.y = world.H / 2; bot.heading = -Math.PI / 2;
  const dust = new DustSystem(world);
  dust.spawnLevel(def.dirtCount, def.theme, stats, def);

  let t = 0, clogs = 0, dumps = 0, wasFull = false;
  const ai = { cur: null, bestD: 0, stall: 0, skip: new Set(), wp: null, wpFor: null };
  const dt = 1 / 60;
  const dock = BALANCE.dock;

  while (t < timeCap) {
    if (dust.items.length === 0 && bot.bin === 0) break;
    const target = pickTarget(bot, dust, ai, def);
    const { input } = steer(bot, world, target, ai);
    bot.update(dt, input);
    if (dust.dragMass > 0) {
      bot.speedMult = stats.motor / (stats.motor + BALANCE.drag.motorCost * dust.dragMass);
      bot.strain = 1 - bot.speedMult;
    } else { bot.speedMult = 1; bot.strain = 0; }
    dust.update(dt, bot, stats, { onCollect: () => {} }, world);
    world.updateWet(dt);
    if (bot.bin > 0 && Math.hypot(bot.x - dock.x, bot.y - dock.y) < dock.triggerR) {
      if (bot.dumpBin()) dumps++;
    }
    if (bot.full && !wasFull) clogs++;
    wasFull = bot.full;
    if (target && !target.dock) {
      const d2 = Math.hypot(target.x - bot.x, target.y - bot.y);
      if (ai.cur !== target) { ai.cur = target; ai.bestD = d2; ai.stall = 0; }
      else {
        if (d2 < ai.bestD) ai.bestD = d2;
        if (d2 > ai.bestD + 1.5) ai.stall += dt; else ai.stall = 0;
      }
      if (ai.stall > 2.5) { ai.skip.add(target); ai.cur = null; ai.stall = 0; if (ai.skip.size > 6) ai.skip.clear(); }
    } else ai.cur = null;
    t += dt;
  }
  const cleared = dust.items.length === 0 && bot.bin === 0;
  return { cleared, t, dumps, clogs, def };
}

// Human-like pick: score the 3 offered picks given the level's pressure.
function pickHeuristic(picks, stats, def) {
  const lv = id => (stats._runLevels && stats._runLevels[id]) || 0;
  const score = (u) => {
    const n = lv(u.id);
    const diminishing = n >= u.max ? 0.6 : 1; // humans still take past-max, but less eagerly
    switch (u.id) {
      case 'suction': return 3.0 * diminishing;
      case 'clean': return 2.6 * diminishing;
      case 'speed': return 2.5 * diminishing;
      case 'brush': return (n === 0 ? (def.staticShare > 0 ? 3.4 : 2.8) : 1.4) * diminishing;
      case 'traction': return (def.tarShare > 0 ? 3.2 : def.heavyShare > 0.35 ? 2.2 : 0.8) * diminishing;
      case 'bin': return 1.8 * diminishing;
      case 'cap': return 1.6 * diminishing;
      case 'magnet': return 1.5 * diminishing;
      case 'overdrive': return 1.0 * diminishing;
      case 'merchant': return 0.7 * diminishing;
      case 'junk': return 0.6 * diminishing;
      default: return 1;
    }
  };
  return picks.reduce((a, b) => score(b) > score(a) ? b : a);
}

const MAX_LEVEL = +(process.argv[2] || 60);
const SEEDS = +(process.argv[3] || 3);
const BOT = process.env.SIM_BOT || 'roomba';

const meanT = Array(MAX_LEVEL + 1).fill(0);
const fails = Array(MAX_LEVEL + 1).fill(0);
let lastDef = null;
const rows = [];

for (let s = 0; s < SEEDS; s++) {
  reseed(9000 + s * 137);
  const stats = makeRunStats({}, BOT);
  for (let n = 1; n <= MAX_LEVEL; n++) {
    const r = simulateLevel(BOT, n, stats, 1000 * n + s * 7 + 3);
    meanT[n] += r.cleared ? r.t : 300;
    if (!r.cleared) fails[n]++;
    lastDef = r.def;
    if (n < MAX_LEVEL) {
      const picks = rollPicks(stats);
      if (picks.length) applyPick(stats, pickHeuristic(picks, stats, r.def).id);
    }
  }
  // dump final build once
  if (s === 0) {
    const lv = stats._runLevels || {};
    console.log(`final build (${BOT}): ` + Object.entries(lv).map(([k, v]) => `${k}x${v}`).join(' ') +
      `  | suction=${stats.suction.toFixed(2)} suckR=${Math.max(stats.pickupRadius + 0.5, stats.suctionRange * stats.suction).toFixed(1)}` +
      ` speed=${stats.speed.toFixed(1)} bin=${stats.binMax} motor=${stats.motor.toFixed(2)} brush=${stats.brushLevel}`);
  }
}

console.log(`\n=== run curve (${BOT}, ${SEEDS} seeds) — t=clear s, s/m=seconds per mote ===`);
console.log('lvl dirt  heavy  t(s)  s/m  fails  | gear position pressure vs gear avg');
const gearAvg = {};
for (let n = 1; n <= MAX_LEVEL; n++) {
  const d = levelDef(n, 0);
  const spm = (meanT[n] / SEEDS) / d.dirtCount;
  const g = Math.floor((n - 1) / 12);
  (gearAvg[g] = gearAvg[g] || []).push(spm);
}
for (let n = 1; n <= MAX_LEVEL; n++) {
  const d = levelDef(n, 0);
  const t = meanT[n] / SEEDS;
  const spm = t / d.dirtCount;
  const g = Math.floor((n - 1) / 12);
  const avg = gearAvg[g].reduce((a, x) => a + x, 0) / gearAvg[g].length;
  const rel = spm / avg;
  const bar = '#'.repeat(Math.max(0, Math.round(rel * 20)));
  const gearTag = (n - 1) % 12 === 0 && n > 1 ? ' <<< GEAR UP' : '';
  console.log(
    `L${String(n).padStart(2)} ${String(d.dirtCount).padStart(4)} ${(100 * (d.bigShare + d.debrisShare)).toFixed(0).padStart(4)}% ` +
    `${t.toFixed(0).padStart(5)} ${spm.toFixed(3).padStart(5)} ${fails[n]}  | ${bar}${gearTag}`);
}

// Sawtooth check: within each gear, does pressure END lower than it STARTS
// (player overtakes = "slightly overpowered"), and does each gear START jump
// above the previous gear's END ("work hard" spike)?
console.log('\n=== gear shape ===');
const gears = Object.keys(gearAvg).map(Number).sort((a, b) => a - b);
for (const g of gears) {
  const arr = gearAvg[g];
  const first = arr[0], last = arr[arr.length - 1];
  const prev = gears.includes(g - 1) ? gearAvg[g - 1][gearAvg[g - 1].length - 1] : null;
  const build = ((first - last) / first * 100).toFixed(0);
  const spike = prev != null ? ((first - prev) / prev * 100).toFixed(0) : 'n/a';
  console.log(`gear ${g}: s/m start ${first.toFixed(3)} -> end ${last.toFixed(3)}  ` +
    `(player overtakes ${build}% within gear; gear-start spike vs prev gear end: ${spike}%)`);
}
