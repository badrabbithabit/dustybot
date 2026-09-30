// Regression tests for the shared steering AI (js/steer.js).
// The input convention is a WORLD direction (+y = down), matching
// bot.js's steerTarget = atan2(ix, -iy). A sign flip on input.y mirrored
// movement across the horizontal: the hangar auto-bay bot drove away from
// motes and pinned itself to the top wall (0 motes collected in 60s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { steer } from '../js/steer.js';
import { Bot } from '../js/bot.js';

const openWorld = {
  W: 44, H: 44, obstacles: [],
  isFree: (x, y, r = 1) => x > r && y > r && x < 44 - r && y < 44 - r,
  blocked: () => false,
};

function driveTo(bot, world, target, seconds = 10) {
  const ai = { cur: null, bestD: 0, stall: 0, skip: new Set(), wp: null, wpFor: null };
  const dt = 1 / 60;
  for (let i = 0; i < seconds / dt; i++) {
    const { input } = steer(bot, world, target, ai);
    bot.update(dt, input);
  }
  return Math.hypot(target.x - bot.x, target.y - bot.y);
}

function makeBot() {
  const stats = { speed: 6, turnRate: 5, binMax: 100, bot: 'roomba' };
  const bot = new Bot(openWorld, stats);
  bot.x = 22; bot.y = 22; bot.heading = 0;
  return bot;
}

test('steer: input is a world direction (+y = down) — target below pushes +y input', () => {
  const bot = makeBot();
  const { input } = steer(bot, openWorld, { x: 22, y: 30 }, {});
  assert.ok(input.y > 0.9, `expected +y input for a target below, got ${input.y}`);
});

test('steer: real Bot reaches targets in all four quadrants', () => {
  for (const t of [{ x: 30, y: 30 }, { x: 14, y: 30 }, { x: 30, y: 14 }, { x: 14, y: 14 }]) {
    const bot = makeBot();
    const d = driveTo(bot, openWorld, t, 10);
    assert.ok(d < 1, `bot at (${bot.x.toFixed(1)},${bot.y.toFixed(1)}) never reached (${t.x},${t.y}), d=${d.toFixed(2)}`);
  }
});

test('steer: detours around a blocking obstacle instead of grinding on it', () => {
  const world = {
    ...openWorld,
    obstacles: [{ x: 20, y: 20, w: 4, h: 4, kind: 'table' }],
    blocked: (x, y, pad = 0) =>
      x > 20 - pad && x < 24 + pad && y > 20 - pad && y < 24 + pad,
  };
  const bot = makeBot();
  bot.x = 22; bot.y = 14; // directly above the blocker; target directly below it
  const d = driveTo(bot, world, { x: 22, y: 32 }, 15);
  assert.ok(d < 1.5, `bot at (${bot.x.toFixed(1)},${bot.y.toFixed(1)}) failed to detour, d=${d.toFixed(2)}`);
});
