// Tests for the procedural room generator (js/levelgen.js) and its
// integration into levelDef().
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GEN, KINDS, makeRng, mix,
  generateLevel, validateLayout, fallbackLayout,
} from '../js/levelgen.js';
import { levelDef, BALANCE } from '../js/upgrades.js';

const THEMES = ['residential', 'office', 'store', 'space'];
const LEVELS = 300;
const SEEDS = [0, 12345];

test('rng: deterministic per seed, varied across seeds', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  for (const v of [...sa, ...[c()]]) {
    assert.ok(v >= 0 && v < 1);
  }
});

test('mix: stable 32-bit mix of (a,b)', () => {
  assert.equal(mix(1, 2), mix(1, 2));
  assert.notEqual(mix(1, 2), mix(2, 1));
  assert.equal(mix(0, 0), mix(0, 0));
});

test('determinism: same (theme, level, seed) → identical layout', () => {
  for (const t of THEMES)
    for (const lvl of [1, 13, 48, 137, 299])
      for (const s of SEEDS) {
        const a = JSON.stringify(generateLevel(t, lvl, s));
        const b = JSON.stringify(generateLevel(t, lvl, s));
        assert.equal(a, b, `${t} lvl ${lvl} seed ${s}`);
      }
});

test('variety: different run seeds change the layout (level 1..12 of each theme)', () => {
  for (const t of THEMES)
    for (const lvl of [1, 5, 9]) {
      const base = JSON.stringify(generateLevel(t, lvl, 0));
      let differs = 0;
      for (let s = 1; s <= 20; s++)
        if (JSON.stringify(generateLevel(t, lvl, s)) !== base) differs++;
      assert.ok(differs >= 5, `${t} lvl ${lvl}: only ${differs}/20 seeds differ`);
    }
});

test('hard rules: validateLayout() passes for every generated layout (2400 levels)', () => {
  let fallbacks = 0;
  for (const seed of SEEDS)
    for (const t of THEMES)
      for (let lvl = 1; lvl <= LEVELS; lvl++) {
        const L = generateLevel(t, lvl, seed);
        const v = validateLayout(L.obstacles);
        assert.deepEqual(v, [], `${t} lvl ${lvl} seed ${seed}: ${v.join('; ')}`);
        if (L.sub === 'fallback') fallbacks++;
      }
  // The generator must almost never need the fallback.
  assert.ok(fallbacks < 20, `fallback used ${fallbacks} times`);
});

const gapX = (a, b) => Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));

test('semantic: every bed has a head-side nightstand (side-by-side, top 60%)', () => {
  for (const t of THEMES)
    for (const lvl of [1, 2, 13, 25, 61, 137, 299])
      for (const s of SEEDS) {
        const L = generateLevel(t, lvl, s);
        for (const bed of L.obstacles.filter((o) => o.kind === 'bed')) {
          const night = L.obstacles.find((o) =>
            o.kind === 'table' && o.w <= 3.5 && o.h <= 3.5 &&
            gapX(o, bed) >= 0 && gapX(o, bed) <= 1.0 &&   // side-by-side
            o.y >= bed.y - 0.51 && o.y <= bed.y + bed.h * 0.6 - 0.5); // head end
          assert.ok(night, `${t} lvl ${lvl} s${s}: bed without nightstand`);
        }
      }
});

test('semantic: tables near a sofa sit in front of it', () => {
  for (const t of THEMES)
    for (const lvl of [1, 4, 13, 40, 100, 250])
      for (const s of SEEDS) {
        const L = generateLevel(t, lvl, s);
        const sofas = L.obstacles.filter((o) => o.kind === 'sofa');
        for (const sofa of sofas) {
          const facing = sofa.y + sofa.h / 2 < 22 ? 1 : -1;
          for (const t2 of L.obstacles.filter((o) => o.kind === 'table')) {
            const near = Math.max(t2.x - (sofa.x + sofa.w), sofa.x - (t2.x + t2.w)) >= -1 &&
                         Math.max(t2.y - (sofa.y + sofa.h), sofa.y - (t2.y + t2.h)) >= -1;
            if (!near) continue;
            assert.equal(Math.sign(t2.y + t2.h / 2 - (sofa.y + sofa.h / 2)), facing,
              `${t} lvl ${lvl} s${s}: table not in front of sofa`);
          }
        }
      }
});

test('semantic: counters hug walls, desks in row bands, hatch/core/island in zone, shelves parallel', () => {
  const A = GEN.ARENA;
  for (const t of THEMES)
    for (let lvl = 1; lvl <= 120; lvl++) {
      const L = generateLevel(t, lvl, 9);
      for (const o of L.obstacles) {
        if (o.kind === 'counter')
          assert.ok(Math.min(o.x, o.y, A - o.x - o.w, A - o.y - o.h) <= 2.0,
            `${t} lvl ${lvl}: counter off-wall`);
        if (o.kind === 'desk')
          assert.ok(o.y < 17 || o.y + o.h > 27, `${t} lvl ${lvl}: desk out of band`);
        if (o.kind === 'island')
          assert.ok(o.y + o.h / 2 >= 27 && Math.abs(o.x + o.w / 2 - 22) <= 8,
            `${t} lvl ${lvl}: island out of zone`);
        if (o.kind === 'hatch' || o.kind === 'core')
          assert.ok(o.y + o.h / 2 >= 27 && Math.abs(o.x + o.w / 2 - 22) <= 9,
            `${t} lvl ${lvl}: ${o.kind} out of zone`);
      }
      const shelves = L.obstacles.filter((o) => o.kind === 'shelf');
      if (shelves.length >= 2) {
        const dirs = new Set(shelves.map((s) => (s.w > s.h ? 1 : s.h > s.w ? -1 : 0)));
        assert.ok(!dirs.has(0) && dirs.size === 1, `${t} lvl ${lvl}: shelves not parallel`);
      }
      for (const o of L.obstacles) assert.ok(KINDS.includes(o.kind), `unknown kind ${o.kind}`);
    }
});

test('validateLayout: catches overlapping obstacles', () => {
  const v = validateLayout([
    { x: 4, y: 10, w: 9, h: 4, kind: 'shelf' },
    { x: 8, y: 12, w: 9, h: 4, kind: 'shelf' },
  ]);
  assert.ok(v.length > 0, 'should flag the overlap (and count)');
});

test('validateLayout: catches a sealed pocket (unreachable cells)', () => {
  // Four shelves forming a closed ring around (22, 30).
  const v = validateLayout([
    { x: 14, y: 22, w: 16, h: 3, kind: 'shelf' },
    { x: 14, y: 35, w: 16, h: 3, kind: 'shelf' },
    { x: 14, y: 25, w: 3, h: 10, kind: 'shelf' },
    { x: 27, y: 25, w: 3, h: 10, kind: 'shelf' },
  ]);
  assert.ok(v.some((s) => s.includes('unreachable')), `expected unreachable, got: ${v.join('; ')}`);
});

test('fallbackLayout: valid for every theme', () => {
  for (const t of THEMES)
    assert.deepEqual(validateLayout(fallbackLayout(t).obstacles), [], t);
});

test('levelDef: still exposes theme/room/dirt and now carries generated obstacles', () => {
  const d1 = levelDef(1), d4 = levelDef(4), d7 = levelDef(7);
  assert.equal(d1.themeKey, 'residential');
  assert.equal(d4.themeKey, 'office');
  assert.equal(d7.themeKey, 'store');
  assert.equal(d1.slot, 0);
  assert.equal(d4.slot, 0);
  assert.equal(d1.dirtCount, BALANCE.dirt.base);
  assert.ok(Array.isArray(d1.obstacles) && d1.obstacles.length >= GEN.MIN_OBS);
  assert.ok(d1.roomName && d1.roomSub);
  assert.ok(d1.theme.icon && d1.theme.name);
  // Deterministic for tests/sim (runSeed defaults to 0)
  assert.deepEqual(levelDef(5).obstacles, levelDef(5).obstacles);
});
