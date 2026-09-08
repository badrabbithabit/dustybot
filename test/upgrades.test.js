// Unit tests for js/upgrades.js (pure logic — no DOM).
// Run: npm test   (or: node --test test/)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALANCE, BOTS, BOT_ORDER, RUN_UPGRADES, META_UPGRADES,
  makeRunStats, rollPicks, applyPick, metaCost, levelDef, THEME_ORDER,
} from '../js/upgrades.js';
import { Bot } from '../js/bot.js';

const fresh = bot => makeRunStats({}, bot || 'roomba');
const lvl = (s, id) => (s._runLevels || (s._runLevels = {}))[id] || 0;

test('rollPicks: 3 unique valid picks, none at max', () => {
  const s = fresh();
  for (let i = 0; i < 200; i++) {
    const picks = rollPicks(s);
    assert.equal(picks.length, 3, 'fresh pool always yields 3');
    const ids = picks.map(p => p.id);
    assert.equal(new Set(ids).size, 3, 'no duplicate ids in one roll');
    for (const p of picks) {
      assert.ok(RUN_UPGRADES.some(u => u.id === p.id), 'pick is a real upgrade');
      assert.ok(lvl(s, p.id) < p.max, 'never offers a maxed upgrade');
    }
  }
});

test('rollPicks: terminates when pool nearly drained (P0-5 regression)', () => {
  // Freeze bug: old `continue`-on-seen looped forever when <3 distinct
  // upgrades remained. Level everything to max-1, then max out 8 of 10.
  const s = fresh();
  for (const u of RUN_UPGRADES) {
    for (let i = 0; i < u.max - 1; i++) applyPick(s, u.id);
  }
  const picksA = rollPicks(s);              // 10 distinct left -> 3
  assert.equal(picksA.length, 3);
  for (let i = 0; i < 8; i++) applyPick(s, RUN_UPGRADES[i].id); // 2 left
  const picksB = rollPicks(s);              // must RETURN, with <=2
  assert.ok(picksB.length <= 2, 'returns whatever remains, no hang');
  assert.equal(new Set(picksB.map(p => p.id)).size, picksB.length, 'still unique');
  for (const u of RUN_UPGRADES) applyPick(s, u.id);
  assert.deepEqual(rollPicks(s), [], 'empty pool -> [] (game shows shard bonus)');
});

test('applyPick: respects max level and mutates stats', () => {
  const s = fresh();
  for (let i = 0; i < 5; i++) assert.ok(applyPick(s, 'suction'));
  assert.equal(applyPick(s, 'suction'), false, '6th Suction Core refused');
  let expSuction = 1.0;
  for (let i = 0; i < 5; i++) expSuction *= 1.2;   // same ops as impl, exact match
  assert.equal(s.suction, expSuction);
  assert.equal(s.suctionRange, 3.4 + 0.5 * 5);
  assert.equal(s.binMax, 100 + 5 * 5);
  assert.equal(applyPick(s, 'nope'), false, 'unknown id is a no-op');
});

test('Turbo Brush: side brush is an upgrade path (bots start brushless)', () => {
  for (const b of BOT_ORDER)
    assert.equal(fresh(b).brushLevel, 0, `${b} starts without a side brush`);
  const r = fresh('roomba');
  const pickup0 = r.pickupRadius;
  assert.ok(applyPick(r, 'brush'));
  assert.equal(r.brushLevel, 1, 'first pick adds the side brush');
  assert.equal(r.pickupRadius, pickup0, 'L1 grants no pickup bonus');
  assert.ok(applyPick(r, 'brush'));
  assert.equal(r.brushLevel, 2);
  assert.ok(r.pickupRadius > pickup0, 'L2+ grants the +20% pickup bonus');
  const s = fresh('mi');
  for (let i = 0; i < 10; i++) applyPick(s, 'brush');
  assert.equal(s.brushLevel, 5, 'capped at brushLevel 5');
});

test('boost: held boost fires ~1s bursts on the boostCd period (B1 regression)', () => {
  assert.ok(BALANCE.bot.boostDur > 0, 'boostDur is defined');
  const world = { W: 44, H: 44, isFree: () => true };
  const stats = fresh('roomba');
  const bot = new Bot(world, stats);
  bot.onBoost = () => {  // same wiring as game.js
    bot.boostCd = Math.max(BALANCE.bot.boostCdFloor, BALANCE.bot.boostCd * stats.boostCdMult);
  };
  const dt = 1 / 60, frames = 480;             // 8 s of holding the button
  let boosted = 0;
  for (let i = 0; i < frames; i++) {
    bot.update(dt, { x: 0, y: 1, boost: true });
    if (bot.boosting) boosted++;
  }
  // 2 bursts x ~60 frames ~= 120 frames (25% duty). The old code gave ~2.
  assert.ok(boosted >= 90, `expected ~120 boosted frames, got ${boosted}`);
  assert.ok(boosted <= 240, 'boost must not be active every frame');
});

test('metaCost: base * 1.6^lvl, Infinity for unknown', () => {
  assert.equal(metaCost('meta_suction', 0), 20);
  assert.equal(metaCost('meta_suction', 10), Math.round(20 * Math.pow(1.6, 10)));
  assert.equal(metaCost('meta_gold', 5), Math.round(200 * Math.pow(1.6, 5)));
  assert.equal(metaCost('nope', 1), Infinity);
});

test('makeRunStats: per-bot bases, meta math, suction cap x3', () => {
  const r = fresh('roomba'), m = fresh('mi'), k = fresh('shark');
  assert.equal(r.speed, 6.0);  assert.equal(m.speed, 7.2);  assert.equal(k.speed, 5.1);
  assert.equal(r.binMax, 100); assert.equal(m.binMax, 130); assert.equal(k.binMax, 90);
  assert.equal(r.goldChance, BALANCE.dirt.goldChance);

  const meta = {};
  for (const u of META_UPGRADES) meta[u.id] = u.max;   // everything maxed
  const S = makeRunStats(meta, 'roomba');
  assert.equal(S.suction, 1.0 * Math.min(3, 1 + 0.05 * 10)); // L10 = x1.5
  assert.equal(S.speed, 6.0 * (1 + 0.04 * 10));
  assert.equal(S.binMax, 100 + 8 * 10);
  assert.equal(S.pickupRadius, 1.7 * (1 + 0.04 * 8));
  assert.equal(S.shardMult, 1 * (1 + 0.03 * 10));
  assert.equal(S.goldChance, BALANCE.dirt.goldChance + 0.03 * 5);
  assert.equal(S.suctionRange, 3.4 * (1 + 0.06 * 8));
  assert.equal(makeRunStats({ meta_suction: 40 }, 'roomba').suction, 3.0,
    'meta suction hard-capped at x3 (needs L40 to hit it)');
  // makeRunStats with meta={}-style zero levels must equal bot base stats
  for (const b of BOT_ORDER) {
    const base = makeRunStats({}, b);
    assert.equal(base.binMax, BOTS[b].stats.binMax);
    assert.equal(base.suction, BOTS[b].stats.suction);
  }
});

test('levelDef: themes rotate 3-per-theme, dirt ramps with rotation', () => {
  for (let n = 1; n <= 48; n++) {
    const d = levelDef(n);
    assert.equal(d.themeKey, THEME_ORDER[Math.floor((n - 1) / 3) % 4]);
    assert.equal(d.roomName.length > 0, true);
    assert.ok(Array.isArray(d.obstacles));
    assert.ok(d.dirtCount >= BALANCE.dirt.base, 'dirt >= base');
    assert.ok(d.dirtCount <= BALANCE.dirt.max, 'dirt <= cap');
  }
  const l1 = levelDef(1), l13 = levelDef(13);
  assert.equal(l1.themeKey, 'residential');
  assert.equal(l13.themeKey, 'residential', '13th level back to first theme');
  // 12 extra levels * perLevel, plus one full rotation ramp
  assert.equal(l13.dirtCount, l1.dirtCount + 12 * BALANCE.dirt.perLevel + BALANCE.dirt.perRotation,
    'rotation adds level ramp + per-rotation ramp');
  const big = levelDef(1000);
  assert.equal(big.dirtCount, BALANCE.dirt.max, 'dirt capped at high levels');
});

test('levelDef: layout hard rules hold for every room (dock strip + spawn pad)', () => {
  // Bot spawns (22,22): no obstacle may cover the 20..24 x 20..24 pad.
  // Dock at (22,3.6) r1.9: nothing may intersect its trigger circle.
  const seen = new Set();
  for (let n = 1; n <= 48; n++) {
    const d = levelDef(n);
    seen.add(`${d.themeKey}:${d.slot}`);
    for (const o of d.obstacles) {
      const hitsCenter = o.x < 24 && o.x + o.w > 20 && o.y < 24 && o.y + o.h > 20;
      assert.ok(!hitsCenter, `${d.level} ${o.kind} covers spawn pad`);
      const hitsDock = o.x < 22 + 1.9 && o.x + o.w > 22 - 1.9 &&
                       o.y < 3.6 + 1.9 && o.y + o.h > 3.6 - 1.9;
      assert.ok(!hitsDock, `${d.level} ${o.kind} blocks the dock`);
      assert.ok(o.w > 0 && o.h > 0, 'obstacle has positive size');
    }
  }
  assert.equal(seen.size, 12, 'exactly 12 distinct rooms cycle');
});
