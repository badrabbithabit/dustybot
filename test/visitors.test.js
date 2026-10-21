// Tests for js/visitors.js (VISITORS_PLAN.md §10). No DOM, no Date.now():
// a fake world (obstacle rects + bodies, same blocked/isFree shape as
// test/dust.test.js), a fake bot, fixed dt, and the real DustSystem.
import test from 'node:test';
import assert from 'node:assert/strict';

import { BALANCE } from '../js/upgrades.js';
import { GEN, generateLevel } from '../js/levelgen.js';
import { DustSystem } from '../js/dust.js';
import { schedule, Visitors } from '../js/visitors.js';

const V = BALANCE.visitors;
const DT = 1 / 60;

function makeWorld(obstacles = []) {
  const W = BALANCE.arena.w, H = BALANCE.arena.h;
  return {
    W, H, obstacles, bodies: [], shakeT: 0, scale: 1, ox: 0, oy: 0,
    toScreen(x, y) { return { x, y }; },
    blocked(x, y, pad = 0, ignore = null) {
      for (const o of this.obstacles) {
        if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
      }
      for (const b of this.bodies) {
        if (b === ignore) continue;
        const dx = x - b.x, dy = y - b.y, rad = b.r + pad;
        if (dx * dx + dy * dy < rad * rad) return true;
      }
      return false;
    },
    isFree(x, y, r = BALANCE.bot.radius, ignore = null) {
      if (x < r || y < r || x > W - r || y > H - r) return false;
      return !this.blocked(x, y, r, ignore);
    },
  };
}

function makeBot(x = 22, y = 25, bin = 0) {
  return { x, y, vx: 0, vy: 0, bin, full: false, stats: { binMax: 100 } };
}

function setup(obstacles = []) {
  const world = makeWorld(obstacles);
  const dust = new DustSystem(world);
  dust.spawned = 0;
  const vis = new Visitors(world, dust);
  vis.reset();
  vis.immunityT = 0; // reset() arms a short immunity; tests opt out explicitly
  return { world, dust, vis };
}

const run = (vis, bot, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) vis.update(DT, bot, {});
};

// ---------------------------------------------------------------- schedule

test('schedule: deterministic for the same (level, runSeed)', () => {
  for (let lvl = 1; lvl <= 40; lvl++) {
    assert.deepEqual(schedule(lvl, 7), schedule(lvl, 7));
    assert.deepEqual(schedule(lvl, 0), schedule(lvl, 0));
  }
});

test('schedule: different seeds produce different plans over a range', () => {
  const seen = new Set();
  for (let lvl = 1; lvl <= 20; lvl++)
    for (let seed = 0; seed < 50; seed++)
      seen.add(JSON.stringify(schedule(lvl, seed)));
  assert.ok(seen.size >= 3, `expected varied plans, got ${seen.size}`);
});

test('schedule: exactly one humanStart per 3-level block (levels 1..300)', () => {
  const blocks = new Map();
  for (let lvl = 1; lvl <= 300; lvl++) {
    if (schedule(lvl, 0).humanStart) {
      const b = Math.floor((lvl - 1) / 3);
      blocks.set(b, (blocks.get(b) || 0) + 1);
    }
  }
  assert.equal(blocks.size, 100, 'every one of the 100 blocks has a start spawn');
  for (const [b, n] of blocks) assert.equal(n, 1, `block ${b} has ${n} start spawns`);
});

test('schedule: exactly one sasquatch per 10-level window, never with midHuman', () => {
  const wins = new Map();
  for (let lvl = 1; lvl <= 300; lvl++) {
    const s = schedule(lvl, 0);
    assert.ok(!(s.sasquatch && s.midHuman), `level ${lvl}: sasquatch AND midHuman`);
    if (s.sasquatch) {
      const w = Math.floor((lvl - 1) / 10);
      wins.set(w, (wins.get(w) || 0) + 1);
    }
  }
  assert.equal(wins.size, 30, 'every one of the 30 windows has a Sasquatch');
  for (const [w, n] of wins) assert.equal(n, 1, `window ${w} has ${n} Sasquatches`);
});

// ------------------------------------------------------- spawn point (§2.1)

test('spawn: free point, outside the dock strip, clear of dock and bot', () => {
  const obstacles = [
    { x: 5, y: 12, w: 10, h: 10 },
    { x: 30, y: 30, w: 8, h: 8 },
  ];
  const bot = makeBot(22, 25);
  let checked = 0;
  for (let k = 0; k < 40; k++) {
    const { world, vis } = setup(obstacles);
    if (!vis._trySpawn('human', bot)) continue;
    const v = vis.list[0];
    checked++;
    assert.ok(v.y >= GEN.STRIP_Y, `visitor at y=${v.y} inside the dock strip`);
    assert.ok(Math.hypot(v.x - BALANCE.dock.x, v.y - BALANCE.dock.y) >= 3.2, 'too close to the dock');
    assert.ok(Math.hypot(v.x - bot.x, v.y - bot.y) >= V.minSpawnDistFromBot, 'too close to the bot');
    for (const o of obstacles) {
      const inside = v.x > o.x - v.r && v.x < o.x + o.w + v.r
        && v.y > o.y - v.r && v.y < o.y + o.h + v.r;
      assert.ok(!inside, `visitor body overlaps obstacle at (${o.x},${o.y})`);
    }
  }
  assert.ok(checked >= 30, `rejection sampling should almost always succeed (got ${checked}/40)`);
});

test('onLevelStart: the queued human spawns on the first update', () => {
  let lvl = 1;
  while (!schedule(lvl, 0).humanStart) lvl++;
  const { vis } = setup();
  const bot = makeBot();
  vis.onLevelStart(lvl, 0, 'office');
  assert.equal(vis.list.length, 0, 'no spawn before the first update (intro banner)');
  vis.update(DT, bot, {});
  assert.equal(vis.list.length, 1, 'level-start human queued and spawned');
});

// ------------------------------------------------------------ solidity (§3)

test('world.bodies: a live visitor makes blocked()/isFree() true over it', () => {
  const { world, vis } = setup();
  const bot = makeBot();
  assert.ok(vis._trySpawn('human', bot));
  const v = vis.list[0];
  assert.equal(world.bodies.length, 1);
  assert.deepEqual(
    { x: world.bodies[0].x, y: world.bodies[0].y, r: world.bodies[0].r },
    { x: v.x, y: v.y, r: v.r },
  );
  assert.ok(world.blocked(v.x, v.y, 0), 'blocked() must see the body');
  assert.ok(!world.isFree(v.x, v.y, 0.05), 'isFree() must be false over the body');
});

// -------------------------------------------------------- sticky feet (§4)

// Regression: a visitor must not be walled in by its own body. world.bodies is
// synced before _step, so without the isFree(..., ignore) exemption every
// visitor froze at its spawn point — no walking, no foot drops, no exit, and a
// carry that never reached a drop target. Assert real travel, then departure.
test('visitors walk: a live visitor travels, then leaves the level', () => {
  const { world, vis } = setup();
  const bot = makeBot(2, 41); // far from the visitor: this test is about walking
  vis._trySpawn('human', bot);
  const v = vis.list[0];
  const p0 = { x: v.x, y: v.y };
  run(vis, bot, 2);
  const travelled = Math.hypot(v.x - p0.x, v.y - p0.y);
  assert.ok(travelled > 1.5,
    `visitor travelled only ${travelled.toFixed(2)}u in 2 s (human speed ${BALANCE.visitors.humanSpeed}/s)`);

  // Life cap (10-15 s) then it walks to an edge and despawns, body and all.
  for (let i = 0; i < Math.round(40 / DT) && vis.list.length; i++) vis.update(DT, bot, {});
  assert.equal(vis.list.length, 0, 'visitor must leave the level on its own');
  assert.equal(world.bodies.length, 0, 'its body must leave world.bodies too');
});

test('sticky feet: takeNear sticks a mote; despawn re-drops it (count/spawned invariant)', () => {
  const { world, dust, vis } = setup();
  const bot = makeBot();
  assert.ok(vis._trySpawn('human', bot));
  const v = vis.list[0];
  world.bodies.length = 0; // park the mote next to the visitor without self-blocking
  dust._spawnPiece(v.x + 0.3, v.y, 'dust', 1);
  assert.equal(dust.count, 1, 'mote placed')
  const count0 = dust.count, spawned0 = dust.spawned;

  const oldChance = V.stickyChance;
  V.stickyChance = 1; // deterministic pickup
  v.stickyCd = 0;
  vis.update(DT, bot, {});
  V.stickyChance = oldChance;

  assert.equal(v.stuck.length, 1, 'mote should stick to the feet');
  assert.equal(dust.count, count0 - 1, 'takeNear removes it from the floor');
  assert.equal(dust.spawned, spawned0, 'takeNear must NOT bump spawned');

  v.life = 0; // force the exit; the mote must be re-dropped before despawn
  for (let i = 0; i < Math.round(25 / DT) && vis.list.length; i++) vis.update(DT, bot, {});
  assert.equal(vis.list.length, 0, 'visitor despawned');
  assert.equal(dust.count, count0, 'the stuck mote is back on the floor');
  // A RELOCATED mote must not raise the level's dirt total, or `_cleared >=
  // dust.spawned` becomes unreachable and the level can never clear.
  assert.equal(dust.spawned, spawned0, 'drop() relocates — it must NOT bump spawned');
});

// ------------------------------------------------------ carry (§5)

function grabBot(setupOut, bin = 20) {
  const { world, dust, vis } = setupOut;
  const bot = makeBot(22, 25, bin);
  assert.ok(vis._trySpawn('human', bot));
  const v = vis.list[0];
  // teleport onto the bot (overlap) and run one frame -> grab
  v.x = bot.x; v.y = bot.y + v.r + BALANCE.bot.radius - 0.2;
  vis.update(DT, bot, {});
  assert.ok(vis.carrying, 'overlap while walking must trigger the carry');
  return { world, dust, vis, bot, v };
}

test('carry: bot pinned to the hands, bin spill == motes dropped', () => {
  const { world, dust, vis, bot, v } = grabBot(setup());
  assert.equal(bot.vx, 0); assert.equal(bot.vy, 0);
  assert.ok(Math.hypot(bot.x - v.x, bot.y - v.y) < v.r + 2, 'bot pinned near the hands');

  const bin0 = bot.bin, count0 = dust.count;
  run(vis, bot, 2.5); // < the 5 s cap, < the shortest carry (8u / 2.6 = 3.1 s)
  assert.ok(vis.carrying, 'still carrying mid-carry');
  const dropped = dust.count - count0;   // spilled motes land on the floor
  assert.ok(dropped >= 1, 'motes must spill while carried');
  assert.equal(bin0 - bot.bin, dropped, 'bin decrements by exactly the motes dropped');
  assert.equal(dust.spawned, 0, 'a spill relocates a mote, it never raises the total');
  assert.ok(bin0 - bot.bin <= Math.floor(V.spillCapFrac.human * bin0) + 1, 'spill cap');
});

test('carry: hard cap drops the bot at a free point outside the dock strip', () => {
  const { world, dust, vis, bot, v } = grabBot(setup());
  v.carry.target = { x: v.x, y: 0 }; // unreachable (dock strip wall) -> cap fires
  const bin0 = bot.bin, count0 = dust.count;
  run(vis, bot, V.carryCap.human + 0.5);
  assert.ok(!vis.carrying, 'carryCap must end the carry');
  assert.ok(vis.immune, 'drop arms immunity');
  assert.equal(bin0 - bot.bin, dust.count - count0, 'spill accounting holds through the cap');
  // The bot must be set down CLEAR of the visitor's body (it is solid) — no
  // clearing world.bodies first: being dropped under the visitor would pin the
  // player until the visitor happens to walk away.
  assert.ok(world.isFree(bot.x, bot.y, BALANCE.bot.radius + 0.2), 'drop point must be free');
  assert.ok(Math.hypot(bot.x - v.x, bot.y - v.y) > v.r + BALANCE.bot.radius,
    'the bot is not dropped inside the visitor');
  assert.ok(bot.y >= GEN.STRIP_Y, 'drop point outside the dock strip');
  assert.ok(Math.hypot(bot.x - BALANCE.dock.x, bot.y - BALANCE.dock.y) >= 3.2, 'clear of the dock');
});

// ------------------------------------------------------- immunity (§5)

test('immunity: blocks an immediate re-grab, then expires', () => {
  const { world, vis, bot, v } = grabBot(setup());
  // end the carry manually (drop) and park the bot on the visitor
  vis._dropBot(v, bot, false);
  assert.ok(vis.immune, 'drop arms the immunity timer');
  bot.x = v.x; bot.y = v.y;
  run(vis, bot, 1);
  assert.ok(!vis.carrying, 'immune bot cannot be grabbed again');
  run(vis, bot, V.immunity.human + 0.2);
  assert.ok(!vis.immune, 'immunity expired');
  bot.x = v.x; bot.y = v.y;
  vis.update(DT, bot, {});
  assert.ok(vis.carrying, 'after immunity the overlap grabs again');
});

// ------------------------------------------- one visitor at a time (§1)

test('one visitor at a time: a deferred spawn is skipped after its cap', () => {
  const { vis } = setup();
  const bot = makeBot();
  assert.ok(vis._trySpawn('human', bot));
  vis._mid = { kind: 'human', due: 0, defer: 0.2 };
  run(vis, bot, 0.5);
  assert.equal(vis.list.length, 1, 'no second visitor while one is alive');
  assert.equal(vis._mid, null, 'deferred spawn skipped after deferHuman budget');
});

test('reset: clears visitors, world.bodies and pending spawns; arms immunity', () => {
  const { world, vis } = setup();
  const bot = makeBot();
  vis.onLevelStart(1, 0, 'residential');
  vis._mid = { kind: 'human', due: 0, defer: 1 };
  vis.update(DT, bot, {});
  vis.reset();
  assert.equal(vis.list.length, 0);
  assert.equal(world.bodies.length, 0);
  assert.equal(vis._start, null);
  assert.equal(vis._mid, null);
  assert.ok(vis.immune, 'reset arms a short immunity');
});

// ------------------------------------------------- art (§6): draw smoke test
// A hand-written mock 2D context (same shape as test/obstacles.test.js) so the
// renderers run headless: plain fills/strokes/ellipses/paths, no filters, no
// text metrics. globalAlpha is trapped so the fade can be asserted.
function createMockContext() {
  const noop = () => {};
  const gradientMock = { addColorStop: noop };
  const calls = { ellipse: 0, arc: 0, fill: 0, stroke: 0, fillRect: 0 };
  const alphas = [];
  let _alpha = 1;
  const ctx = {
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, lineDashOffset: 0,
    get globalAlpha() { return _alpha; },
    set globalAlpha(a) { _alpha = a; alphas.push(a); },
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    arc: () => { calls.arc++; }, arcTo: noop,
    ellipse: () => { calls.ellipse++; },
    rect: noop, fillRect: () => { calls.fillRect++; }, strokeRect: noop, clearRect: noop,
    fill: () => { calls.fill++; }, stroke: () => { calls.stroke++; }, clip: noop,
    translate: noop, rotate: noop, scale: noop, setTransform: noop, resetTransform: noop,
    setLineDash: noop, getLineDash: () => [],
    createLinearGradient: () => gradientMock, createRadialGradient: () => gradientMock,
  };
  return { ctx, calls, alphas };
}

test('draw: all five visitor looks render on a mock 2D context', () => {
  const bot = makeBot();
  for (const themeKey of ['residential', 'office', 'store', 'space']) {
    const { vis } = setup();
    assert.ok(vis._trySpawn('human', bot));
    const v = vis.list[0];
    v.themeKey = themeKey;
    v.age = 1;                       // past the 0.35 s fade-in
    v.walkPhase = 1.2;               // mid-stride: arms swinging
    v.stuck.push({ type: 'dust', val: 1 }, { type: 'gold', val: 5 }); // sticky feet
    const { ctx, calls } = createMockContext();
    vis.draw(ctx);
    assert.ok(calls.ellipse > 6 && calls.fill > 6, `${themeKey}: nothing was drawn`);
    assert.equal(ctx.globalAlpha, 1, `${themeKey}: globalAlpha restored`);
  }

  // Sasquatch: bigger body, glow under it, "!" marker (paths, not text).
  const { vis } = setup();
  assert.ok(vis._trySpawn('sasquatch', bot));
  const sas = vis.list[0];
  sas.age = 1;
  sas.walkPhase = 2.4;
  sas.stuck.push({ type: 'debris', val: 2 });
  const { ctx, calls, alphas } = createMockContext();
  vis.draw(ctx);
  assert.ok(calls.ellipse > 10 && calls.fillRect >= 1, 'sasquatch not drawn');
  assert.equal(ctx.globalAlpha, 1, 'sasquatch: globalAlpha restored');

  // carry pose (arms forward to the hands) and the exit fade-out, no throw.
  sas.state = 'carry';
  vis.draw(ctx);
  sas.state = 'exit';
  sas.target = { x: sas.x + 1, y: sas.y }; // still a step to go, so it fades, not gone
  sas.exitT = V.exitCap - 0.1; // last 0.5 s of the exit walk -> fading
  vis.draw(ctx);
  assert.ok(alphas.some(a => a > 0 && a < 1), 'exit fade-out alpha applied');

  // a fresh spawn fades in (alpha well under 1) rather than popping in.
  const { vis: v2 } = setup();
  assert.ok(v2._trySpawn('human', bot));
  const fresh = v2.list[0];
  const m2 = createMockContext();
  v2.update(DT, bot, {});            // age = DT
  v2.draw(m2.ctx);
  assert.ok(m2.alphas.some(a => a < 0.2), 'spawn fade-in alpha applied');
});

// ----------------------------------------------------------------- soak
// Regression for the accounting BLOCKER the review caught: a relocated mote
// (sticky feet, or a mote shaken out of the bin during a carry) must never
// raise dust.spawned, because the level clears on `_cleared >= dust.spawned`.
// Conservation law (dust.js): spawned == floor + stuck + bin + credited.
test('soak: 3 real layouts x 60 s — motes conserved, spawn total frozen', () => {
  for (const level of [3, 14, 27]) {
    const room = generateLevel('office', level, 12345);
    const world = makeWorld(room.obstacles);
    const dust = new DustSystem(world);
    const stats = { goldChance: 0.03, pickupRadius: 1.4, suction: 1, suctionRange: 2, binMax: 100 };
    dust.spawnLevel(80, { dirt: {} }, stats, { bigShare: 0.15, debrisShare: 0.1 });
    const spawned0 = dust.spawned;

    const vis = new Visitors(world, dust);
    vis.onLevelStart(level, 12345, 'office');

    // Pretend the player already vacuumed 30 motes (floor -> bin, not dumped):
    // that is the state in which a grab actually spills something.
    const bot = makeBot(22, 25, 0);
    for (let k = 0; k < 30; k++) { if (dust.items.length) { dust.items.pop(); bot.bin++; } }

    let credited = 0, grabs = 0, wasCarrying = false, frames = 0;
    let dir = 0;
    for (let f = 0; f < Math.round(60 / DT); f++) {
      frames++;
      if (f % 45 === 0) dir = (f * 0.7) % 6.283;      // a wandering bot
      if (vis.carrying) { bot.x = bot.x; }            // input is locked while carried
      // force one grab per level so the carry/spill path is definitely walked
      if (f === Math.round(20 / DT) && !vis.carrying && !vis.immune) {
        if (!vis.list.length) vis._trySpawn('human', bot);
        if (vis.list.length) { const v = vis.list[0]; v.x = bot.x + 0.5; v.y = bot.y; }
      }
      vis.update(DT, bot, {});
      if (vis.carrying && !wasCarrying) grabs++;
      wasCarrying = vis.carrying;
      // game.js does exactly this with `unplaced` (a mote a despawn could not
      // put back is credited, never silently dropped)
      credited += vis.unplaced; vis.unplaced = 0;

      const stuck = vis.list.reduce((n, v) => n + v.stuck.length, 0);
      assert.equal(dust.count + stuck + bot.bin + credited, dust.spawned,
        `lv${level} f${f}: mote conservation broken`);
      assert.ok(bot.bin >= 0, `lv${level} f${f}: bin went negative`);
      assert.ok(dust.spawned === spawned0, `lv${level} f${f}: relocation inflated dust.spawned`);
      // The bot must never end up somewhere it could not legally stand — the
      // same clearance its own movement uses. NOT radius+0.2: a visitor that is
      // about to grab legitimately closes to v.r + BOT_R (2.2 u centre-to-
      // centre), which is 1.1 u of gap and perfectly legal.
      if (!vis.carrying)
        assert.ok(world.isFree(bot.x, bot.y, BALANCE.bot.radius),
          `lv${level} f${f}: the bot is standing inside something solid`);
    }
    assert.equal(dust.spawned, spawned0, `lv${level}: the level total must not drift`);
    assert.ok(grabs >= 1, `lv${level}: the soak must exercise a carry (got ${grabs})`);
    assert.ok(frames === Math.round(60 / DT));
  }
});
