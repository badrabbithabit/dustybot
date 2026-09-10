// sim-bots.mjs — balance sim: drives the REAL Bot + DustSystem (js/*.js, no DOM
// needed) with a simple "nearest mote, detour to dock when bin 85% full" AI.
// Compares the 3 bots across levels and upgrade scenarios.
// Run: node tools/sim-bots.mjs
import { BALANCE, makeRunStats, levelDef, applyPick, RUN_UPGRADES } from '../js/upgrades.js';
import { Bot } from '../js/bot.js';
import { DustSystem } from '../js/dust.js';
import { steer } from './steer.mjs';

// Stable reference for the dock target (so waypoint-commitment can key on it).
const DOCK_TARGET = { x: BALANCE.dock.x, y: BALANCE.dock.y, dock: true };

// ---- seeded RNG (LCG) so runs are reproducible ----------------------------
let _seed = 1;
function reseed(s) { _seed = s >>> 0; }
function rng() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
const _realRandom = Math.random;
Math.random = rng;

// ---- fake world (only what Bot/DustSystem touch) --------------------------
function makeWorld(def) {
  return {
    W: BALANCE.arena.w,
    H: BALANCE.arena.h,
    obstacles: def.obstacles,
    blocked(x, y, pad = 0) {
      for (const o of this.obstacles)
        if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
      return false;
    },
    isFree(x, y, r = BALANCE.bot.radius) {
      if (x < r || y < r || x > this.W - r || y > this.H - r) return false;
      return !this.blocked(x, y, r);
    },
  };
}

// ---- AI ------------------------------------------------------------------
function pickTarget(bot, dust, ai) {
  // go to dock: bin 85%+ full (pre-clog trips), or clogged, or final dump
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

// Steering lives in tools/steer.mjs (obstacle-aware raycast + detour
// commitment; the commitment is what kills the old ram-deflect-ram loop).
// It mutates ai.wp / ai.wpFor on the per-bot `ai` object.

function simulateLevel(botId, levelN, scenario, seed, timeCap = 240) {
  reseed(seed);
  const def = levelDef(levelN);
  const world = makeWorld(def);
  const stats = makeRunStats({}, botId);
  if (scenario === 'mid') {
    applyPick(stats, 'suction'); applyPick(stats, 'suction');
    applyPick(stats, 'speed'); applyPick(stats, 'bin'); applyPick(stats, 'clean');
  } else if (scenario === 'maxed') {
    for (const u of RUN_UPGRADES) for (let i = 0; i < u.max; i++) applyPick(stats, u.id);
  }
  const bot = new Bot(world, stats);
  bot.x = world.W / 2; bot.y = world.H / 2; bot.heading = -Math.PI / 2;
  const dust = new DustSystem(world);
  dust.spawnLevel(def.dirtCount, def.theme, stats);

  let t = 0, dist = 0, clogs = 0, dumps = 0, val = 0, wasFull = false;
  const ai = { cur: null, bestD: 0, stall: 0, skip: new Set(), wp: null, wpFor: null };
  const dt = 1 / 60;
  const dock = BALANCE.dock;

  while (t < timeCap) {
    // clear when every mote is collected AND dumped (same rule as game.js)
    if (dust.items.length === 0 && bot.bin === 0) break;

    const target = pickTarget(bot, dust, ai);
    const { input, d } = steer(bot, world, target, ai);

    const px = bot.x, py = bot.y;
    bot.update(dt, input);
    dist += Math.hypot(bot.x - px, bot.y - py);
    dust.update(dt, bot, stats, { onCollect: (v) => { val += v; } });

    if (bot.bin > 0 && Math.hypot(bot.x - dock.x, bot.y - dock.y) < dock.triggerR) {
      const v = bot.dumpBin();
      if (v) dumps++;
    }
    if (bot.full && !wasFull) clogs++;
    wasFull = bot.full;

    // anti-stall: if farther from target than its best progress + 1.5 for 2.5s, skip it
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
  const shards = val * BALANCE.shardPerDust * stats.shardMult +
                 t * BALANCE.shardPerSecond * stats.shardMult + BALANCE.shardPerLevel;
  return {
    cleared, t: +t.toFixed(1), dist: Math.round(dist), clogs, dumps,
    shards: +shards.toFixed(1), motesLeft: dust.items.length,
    suckR: +(Math.max(stats.pickupRadius + 0.5, stats.suctionRange * stats.suction)).toFixed(2),
  };
}

// ---- run the matrix -------------------------------------------------------
const LEVELS = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
const BOTS = ['roomba', 'mi', 'shark'];
const SCENARIOS = ['base', 'mid', 'maxed'];
const REPS = 3;

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

console.log('=== level clear times (s), mean of', REPS, 'runs x 12 levels (L1..L34) ===\n');
for (const scenario of SCENARIOS) {
  const rows = {};
  for (const b of BOTS) {
    const per = { t: [], dist: [], clogs: [], dumps: [], shards: [], fails: 0, levelT: {}, failsList: [] };
    for (const lv of LEVELS) {
      per.levelT[lv] = [];
      for (let r = 0; r < REPS; r++) {
        const s = simulateLevel(b, lv, scenario, 1000 * lv + r * 7 + (scenario === 'mid' ? 111 : scenario === 'maxed' ? 222 : 0));
        if (!s.cleared) { per.fails++; per.failsList.push(`L${lv}r${r + 1}`); }
        per.levelT[lv].push(s.cleared ? s.t : null);
        per.t.push(s.cleared ? s.t : timeCapOr(s));
        per.dist.push(s.dist); per.clogs.push(s.clogs); per.dumps.push(s.dumps); per.shards.push(s.shards);
      }
    }
    rows[b] = {
      t: mean(per.t).toFixed(1), dist: Math.round(mean(per.dist)),
      clogs: mean(per.clogs).toFixed(2), dumps: mean(per.dumps).toFixed(2),
      shards: mean(per.shards).toFixed(1), fails: per.fails,
      levelT: per.levelT, failsList: per.failsList,
    };
  }
  console.log(`[${scenario}]  (fail = not cleared in 240s)`);
  console.log('  bot     clear(s)  dist  clogs  dumps  shards/level  fails');
  for (const b of BOTS) {
    const r = rows[b];
    console.log(`  ${b.padEnd(7)} ${r.t.padStart(7)}   ${String(r.dist).padStart(4)}  ${r.clogs.padStart(5)}  ${r.dumps.padStart(5)}   ${r.shards.padStart(6)}        ${r.fails}`);
  }
  if (scenario === 'base') {
    console.log('[base] per-level clear times (s); F = failed >240s');
    console.log('  ' + 'bot'.padEnd(7) + LEVELS.map(lv => 'L' + String(lv).padStart(2)).join(' '));
    for (const b of BOTS) {
      const cells = LEVELS.map(lv => {
        const ts = rows[b].levelT[lv].filter(x => x != null);
        return ts.length ? (ts.reduce((a, x) => a + x, 0) / ts.length).toFixed(0).padStart(3) : ' F';
      });
      console.log('  ' + b.padEnd(7) + cells.join(' '));
    }
    for (const b of BOTS) if (rows[b].failsList.length) console.log(`  fails(${b}): ${rows[b].failsList.join(', ')}`);
  }
  console.log('');
}

function timeCapOr(s) { return 240; }

// ---- boost micro-test (real Bot, boost held for 8s) -----------------------
console.log('=== boost test: input.boost held for 8.0s, real Bot.update ===');
{
  reseed(42);
  const def = levelDef(1);
  const world = makeWorld(def);
  const stats = makeRunStats({}, 'roomba');
  const bot = new Bot(world, stats);
  bot.onBoost = () => {
    bot.boostCd = BALANCE.bot.boostCd * stats.boostCdMult;
    bot.boostCd = Math.max(BALANCE.bot.boostCdFloor, bot.boostCd);
  };
  let frames = 0, boostFrames = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 8 / dt; i++) {
    bot.update(dt, { x: 0.7, y: 0.7, boost: true, tap: null });
    frames++;
    if (bot.boosting) boostFrames++;
  }
  console.log(`  frames with 1.7x speed active: ${boostFrames} / ${frames}  (${(100 * boostFrames / frames).toFixed(1)}%)`);
  console.log(`  (i.e. ~${(boostFrames * dt).toFixed(2)}s of boost over 8s of holding the button)`);
}
