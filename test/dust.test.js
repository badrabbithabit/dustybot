// Tests for bin-full behavior (js/dust.js + js/bot.js) and puff motes.
// Regression: a full bin must block pickup, not just suction — a mote at the
// bot's position (brush-swept or walked over) used to still get collected.
// Drives the REAL Bot + DustSystem on a minimal obstacle-free fake world.
import test from 'node:test';
import assert from 'node:assert/strict';

import { BALANCE, makeRunStats, levelDef } from '../js/upgrades.js';
import { Bot } from '../js/bot.js';
import { DustSystem } from '../js/dust.js';

function makeWorld() {
  const W = BALANCE.arena.w, H = BALANCE.arena.h;
  return {
    W, H,
    blocked() { return false; },
    isFree(x, y, r = BALANCE.bot.radius) {
      return x >= r && y >= r && x <= W - r && y <= H - r;
    },
  };
}

// Fresh bot + dust system with one 'dust' mote placed at a given spot.
function setup(moteAt) {
  const world = makeWorld();
  const stats = makeRunStats({}, 'roomba');
  const bot = new Bot(world, stats);
  bot.x = world.W / 2; bot.y = world.H / 2;
  const dust = new DustSystem(world);
  dust._spawnPiece(moteAt.x, moteAt.y, 'dust', 1);
  return { world, stats, bot, dust };
}

const CB = { onCollect: () => {}, onSuck: () => {}, onGold: () => {} };
const AT_BOT = () => ({ x: BALANCE.arena.w / 2, y: BALANCE.arena.h / 2 });

test('full bin: mote sitting on the bot is NOT collected', () => {
  const { world, stats, bot, dust } = setup(AT_BOT());
  bot.addDust(bot.stats.binMax); // fill the bin to capacity
  assert.ok(bot.full);
  assert.equal(dust.items.length, 1);
  dust.update(1 / 60, bot, stats, CB, world);
  assert.equal(dust.items.length, 1, 'mote must survive a full bin');
  assert.equal(bot.bin, bot.stats.binMax, 'bin must not grow past capacity');
});

test('non-full bin: same mote IS collected (control)', () => {
  const { world, stats, bot, dust } = setup(AT_BOT());
  assert.ok(!bot.full);
  dust.update(1 / 60, bot, stats, CB, world);
  assert.equal(dust.items.length, 0, 'mote should be vacuumed when bin has room');
  assert.equal(bot.bin, 1);
});

test('full bin: suction field is off (no pull on a nearby mote)', () => {
  const { world, stats, bot, dust } = setup({
    x: BALANCE.arena.w / 2 + 2, y: BALANCE.arena.h / 2,
  });
  bot.addDust(bot.stats.binMax);
  const it = dust.items[0];
  dust.update(1 / 60, bot, stats, CB, world);
  assert.equal(dust.items.length, 1);
  assert.equal(dust.items[0], it);
  assert.ok(Math.hypot(it.vx, it.vy) < 1e-9, 'no suction force when full');
});

test('addDust: full flag tracks THIS bot\'s binMax; dumpBin clears it', () => {
  for (const botId of ['roomba', 'mi', 'shark', 'mop', 'hog', 'zippy']) {
    const { bot } = { bot: new Bot(makeWorld(), makeRunStats({}, botId)) };
    bot.addDust(bot.stats.binMax - 1);
    assert.equal(bot.full, false, `${botId}: bin-1 is not full`);
    bot.addDust(1);
    assert.equal(bot.full, true, `${botId}: binMax is full`);
    const v = bot.dumpBin();
    assert.equal(v, bot.stats.binMax);
    assert.equal(bot.full, false, `${botId}: dumpBin clears full`);
  }
});

// ---- puff motes (split-on-vacuum) + the cumulative spawn counter ----
// Every mote (level dirt AND puff splinters) goes through the spawn funnel, so
// dust.spawned is the level's MOVING dirt total; game.js clears a level against
// it, not against the fixed def.dirtCount.
const PUFF_DEF = { bigShare: 0, debrisShare: 0, staticShare: 0, tarShare: 0, puffShare: 1 };

// `count` puff motes (gold off, all shares on puff), one of them parked on the
// bot so a single update() vacuums exactly it. The rest are parked in a corner,
// out of suction reach, so they can't skew the counts.
function puffField(count) {
  const world = makeWorld();
  const stats = { ...makeRunStats({}, 'roomba'), goldChance: 0 };
  const bot = new Bot(world, stats);
  bot.x = world.W / 2; bot.y = world.H / 2;
  const dust = new DustSystem(world);
  dust.spawnLevel(count, null, stats, PUFF_DEF);
  // the split is driven purely by type, so make the target mote a puff for sure
  // (puffShare 1 makes them ~all of the field; shares > cap normalize to dust)
  const puff = dust.items.find(it => it.type === 'puff') || dust.items[0];
  puff.type = 'puff'; puff.val = 2;   // 2 = the value _rollType gives a real puff
  for (const it of dust.items) if (it !== puff) { it.x = 2; it.y = world.H - 2; }
  puff.x = bot.x + 0.5; puff.y = bot.y;
  return { world, stats, bot, dust, puff };
}

test('spawned: vacuuming a puff grows the level total by its 3 splinters', () => {
  const { world, stats, bot, dust, puff } = puffField(12);
  assert.equal(dust.spawned, 12, 'spawnLevel sets the baseline total');
  assert.equal(puff.type, 'puff');
  dust.update(1 / 60, bot, stats, CB, world);
  assert.equal(dust.spawned, 12 + 3, 'splinters count toward the dirt total');
  assert.equal(dust.count, 12 - 1 + 3, 'one puff gone, three splinters on the floor');
});

test('bin: a puff pickup adds exactly 1 to the bin (no double-bin)', () => {
  const { world, stats, bot, dust } = puffField(4);
  dust.update(1 / 60, bot, stats, CB, world);
  assert.equal(bot.bin, 1, 'puff = 1 bin slot, splinters bin separately later');
});

test('blocked splinters: a puff is never consumed for zero value', () => {
  const { world, stats, bot, dust } = puffField(1);
  // every splinter spot is blocked (and the pool is not the limit): the puff
  // falls through and pays out as a normal mote instead of vanishing for free
  dust.world = { ...world, blocked() { return true; } };
  let paid = null;
  const cb = { onCollect: (v) => { paid = v; }, onSuck: () => {}, onGold: () => {} };
  dust.update(1 / 60, bot, stats, cb, world);
  assert.equal(dust.count, 0, 'the puff itself is vacuumed');
  assert.equal(dust.spawned, 1, 'no splinters were spawned');
  assert.equal(paid, 2, 'the player gets the puff value (2), not 0');
  assert.equal(bot.bin, 1);
});

test('shares > 1: the type roll stays valid and common dust survives', () => {
  const d = new DustSystem(makeWorld());
  // mirror what spawnLevel passes: type shares on the level def, gold on stats.
  // These sum to 1.21 of the non-gold roll (deep-gear + max goldChance).
  d._def = { bigShare: 0.30, debrisShare: 0.25, staticShare: 0.22, tarShare: 0.22, puffShare: 0.22 };
  const stats = { goldChance: 0.5 };
  const known = new Set(['dust', 'big', 'debris', 'gold', 'static', 'tar', 'puff']);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const t = d._rollType(stats);
    assert.equal(typeof t.type, 'string');
    assert.ok(known.has(t.type), `unknown mote type ${t.type}`);
    seen.add(t.type);
  }
  assert.ok(seen.has('dust'), 'shares are normalized: common dust keeps a floor');
});
