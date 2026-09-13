// Tests for bin-full behavior (js/dust.js + js/bot.js).
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
