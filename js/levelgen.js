// Procedural room generator with semantic guardrails.
// Pure logic — node-testable, no DOM. No imports (keeps the module graph acyclic).
// Geometry constants mirror BALANCE in upgrades.js — keep in sync.
//
// A level is { name, sub, obstacles: [{x,y,w,h,kind}] }. Same shape as the old
// fixed LAYOUTS table, so World.setLevel() and the renderer are untouched.
//
// Guardrails (enforced by validateLayout, called on every generated layout):
//   hard:   in-bounds, dock strip (y<9) clear, spawn pad clear, >=4u corridors,
//           reachable free space (flood fill), sane obstacle count/kinds.
//   semantic: bed gets a nightstand at its head; coffee table in front of sofa;
//           media faces the sofa; counters hug walls; shelves stay parallel;
//           islands/hatch/core sit in the center-bottom zone; desks in row bands.

export const GEN = {
  ARENA: 44,
  BOT_R: 1.0,
  DOCK: { x: 22, y: 3.6, r: 1.9 },
  STRIP_Y: 9,                       // dock strip: no obstacle above this
  PAD: { x: 18, y: 18, w: 8, h: 8 },// spawn keep-out (center 22,22 + 2u corridor)
  WALL: 1.5,                        // hard in-bounds margin (wall-hugging pieces)
  WALK: 4.0,                        // min walkable corridor from a wall for pieces the
                                    // bot must thread past; matches the old open rooms
  TARGET_MAX: 5,                    // cap: old handcrafted rooms held 3-5 pieces
  // Min corridor between obstacles. Must stay >= 2*BOT_R + one 1u flood-fill
  // cell so a gap actually has a walkable cell center (the flood fill blocks
  // cells within BOT_R of any edge); 4u matches the old handcrafted rooms
  // (5-10u typical) and leaves the local-steering bot 2u of center freedom.
  GAP: 4.0,
  MIN_OBS: 3,
  MAX_OBS: 9,
};

// Every kind the world.js renderer has dedicated art for.
export const KINDS = [
  'sofa', 'table', 'media', 'plant', 'bed', 'dresser', 'wardrobe', 'island',
  'counter', 'desk', 'divider', 'cabinet', 'cubicle', 'shelf', 'stock',
  'pallet', 'console', 'hatch', 'bench', 'core',
];

// mulberry32 — small, fast, deterministic.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic uint32 hash of a (a,b) pair.
export function mix(a, b) {
  let h = (0x9e3779b9 ^ (a >>> 0)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ ((b >>> 0) * 0x85ebca6b)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const A = GEN.ARENA;
const r2 = (v) => Math.round(v * 2) / 2;   // snap to 0.5 grid
const cx = (o) => o.x + o.w / 2;
const cy = (o) => o.y + o.h / 2;
const overlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const gapX = (a, b) => Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
const gapY = (a, b) => Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));

// Small tables may nestle against beds/sofas (nightstands, coffee tables).
// Their placement is checked by the semantic rules instead of the corridor rule.
const isNestPair = (a, b) => {
  const small = (o) => o.kind === 'table' && o.w <= 9 && o.h <= 4.5;
  const big = (o) => o.kind === 'bed' || o.kind === 'sofa';
  return (small(a) && big(b)) || (small(b) && big(a));
};

// ---------------------------------------------------------------- validators

export function validateLayout(obstacles) {
  const v = [];
  if (obstacles.length < GEN.MIN_OBS || obstacles.length > GEN.MAX_OBS)
    v.push(`obstacle count ${obstacles.length} outside [${GEN.MIN_OBS},${GEN.MAX_OBS}]`);

  obstacles.forEach((o, i) => {
    if (!(o.w > 0) || !(o.h > 0)) v.push(`#${i} non-positive size`);
    if (!KINDS.includes(o.kind)) v.push(`#${i} unknown kind '${o.kind}'`);
    if (o.x < GEN.WALL - 1e-6 || o.y < GEN.WALL - 1e-6 ||
        o.x + o.w > A - GEN.WALL + 1e-6 || o.y + o.h > A - GEN.WALL + 1e-6)
      v.push(`#${i} ${o.kind} breaks the wall margin`);
    if (o.y < GEN.STRIP_Y - 1e-6)
      v.push(`#${i} ${o.kind} sits in the dock strip (y < ${GEN.STRIP_Y})`);
    if (overlap(o, GEN.PAD)) v.push(`#${i} ${o.kind} intersects the spawn pad`);
  });

  // Corridors (nesting tables are exempt — semantics checked below).
  for (let i = 0; i < obstacles.length; i++)
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i], b = obstacles[j];
      if (isNestPair(a, b)) continue;
      const gx = gapX(a, b), gy = gapY(a, b);
      const msg = (m) => v.push(`#${i} ${a.kind} / #${j} ${b.kind}: ${m}`);
      if (gx < 0 && gy < 0) msg('overlap');
      else if (gx < 0 && gy < GEN.GAP) msg(`vertical gap ${gy.toFixed(1)} < ${GEN.GAP}`);
      else if (gy < 0 && gx < GEN.GAP) msg(`horizontal gap ${gx.toFixed(1)} < ${GEN.GAP}`);
      else if (gx >= 0 && gy >= 0 && Math.max(gx, gy) < GEN.GAP)
        msg(`diagonal gap ${Math.max(gx, gy).toFixed(1)} < ${GEN.GAP}`);
    }

  // Beds: nightstand (small table) at the head (top edge), side by side.
  for (const bed of obstacles.filter((o) => o.kind === 'bed')) {
    const hasNight = obstacles.some((o) =>
      o !== bed && o.kind === 'table' && o.w <= 3.5 && o.h <= 3.5 &&
      !overlap(o, bed) &&
      gapX(o, bed) >= 0 && gapX(o, bed) <= 1.0 &&
      o.y <= bed.y + bed.h * 0.6);
    if (!hasNight) v.push(`bed at (${bed.x},${bed.y}) lacks a head-side nightstand`);
  }

  // Sofas: any table close by must sit in front of the sofa.
  for (const sofa of obstacles.filter((o) => o.kind === 'sofa')) {
    const facing = cy(sofa) < 22 ? 1 : -1; // top-half sofas face down
    for (const t of obstacles.filter((o) => o.kind === 'table')) {
      if (t === sofa) continue;
      const near = gapX(t, sofa) >= -1 && gapY(t, sofa) >= -1; // adjacent or touching
      if (!near) continue;
      if (Math.sign(cy(t) - cy(sofa)) !== facing ||
          gapX(t, sofa) > 1.0 ||
          overlap(t, sofa))
        v.push(`table at (${t.x},${t.y}) not in front of sofa at (${sofa.x},${sofa.y})`);
    }
  }

  // Counters hug a wall.
  for (const o of obstacles.filter((o) => o.kind === 'counter'))
    if (Math.min(o.x, o.y, A - o.x - o.w, A - o.y - o.h) > 2.0)
      v.push(`counter at (${o.x},${o.y}) does not hug a wall`);

  // Media faces the sofa.
  const sofa0 = obstacles.find((o) => o.kind === 'sofa');
  const media0 = obstacles.find((o) => o.kind === 'media');
  if (sofa0 && media0 && Math.sign(cy(media0) - cy(sofa0)) !== (cy(sofa0) < 22 ? 1 : -1))
    v.push('media does not face the sofa');

  // Shelves stay parallel (and non-square).
  const shelves = obstacles.filter((o) => o.kind === 'shelf');
  if (shelves.length >= 2) {
    const dirs = new Set(shelves.map((s) => (s.w > s.h ? 1 : s.h > s.w ? -1 : 0)));
    if (dirs.has(0) || dirs.size > 1) v.push('shelves are not all parallel');
  }

  // Zone rules.
  for (const o of obstacles.filter((o) => o.kind === 'island'))
    if (cy(o) < 27 || Math.abs(cx(o) - 22) > 8) v.push(`island at (${o.x},${o.y}) out of zone`);
  for (const o of obstacles.filter((o) => o.kind === 'desk'))
    if (!(o.y < 17 || o.y + o.h > 27)) v.push(`desk at (${o.x},${o.y}) outside row bands`);
  for (const o of obstacles.filter((o) => o.kind === 'hatch' || o.kind === 'core'))
    if (cy(o) < 27 || Math.abs(cx(o) - 22) > 9)
      v.push(`${o.kind} at (${o.x},${o.y}) out of center-bottom zone`);

  // Connectivity: flood fill over 1u cells, obstacles inflated by bot radius.
  const blocked = new Uint8Array(A * A);
  for (const o of obstacles) {
    const x0 = Math.max(0, Math.floor(o.x - GEN.BOT_R - 0.6));
    const x1 = Math.min(A - 1, Math.ceil(o.x + o.w + GEN.BOT_R));
    const y0 = Math.max(0, Math.floor(o.y - GEN.BOT_R - 0.6));
    const y1 = Math.min(A - 1, Math.ceil(o.y + o.h + GEN.BOT_R));
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++) {
        const px = i + 0.5, py = j + 0.5;
        if (px >= o.x - GEN.BOT_R && px <= o.x + o.w + GEN.BOT_R &&
            py >= o.y - GEN.BOT_R && py <= o.y + o.h + GEN.BOT_R)
          blocked[j * A + i] = 1;
      }
  }
  let free = 0;
  for (let i = 0; i < blocked.length; i++) if (!blocked[i]) free++;
  const start = 21 * A + 21;
  if (free > 0) {
    let seen = 0;
    if (!blocked[start]) {
      const stack = [start];
      blocked[start] = 1; seen = 1;
      while (stack.length) {
        const c = stack.pop();
        const i = c % A, j = (c / A) | 0;
        if (i > 0) { if (!blocked[c - 1]) { blocked[c - 1] = 1; seen++; stack.push(c - 1); } }
        if (i < A - 1) { if (!blocked[c + 1]) { blocked[c + 1] = 1; seen++; stack.push(c + 1); } }
        if (j > 0) { if (!blocked[c - A]) { blocked[c - A] = 1; seen++; stack.push(c - A); } }
        if (j < A - 1) { if (!blocked[c + A]) { blocked[c + A] = 1; seen++; stack.push(c + A); } }
      }
    } else {
      v.push('spawn point is blocked');
    }
    if (seen < free) v.push(`unreachable free cells: ${free - seen}`);
  }

  return v;
}

// ---------------------------------------------------------------- placement

function fits(o, placed) {
  if (o.x < GEN.WALL || o.y < GEN.WALL || o.x + o.w > A - GEN.WALL || o.y + o.h > A - GEN.WALL)
    return false;
  if (o.y < GEN.STRIP_Y) return false;
  // A 2-4u gap to a wall is "nearly passable": wider than the 2u bot
  // (so a mote could spawn in the strip and the bot half-fits) but shorter
  // than the WALK corridor the bot steers in straight lines. That is the
  // tightest, most frustrating case for the player and an unthreadable
  // corner for the sim proxy. Only allow gaps that are clearly impassable
  // (< bot diameter) or a real corridor (>= WALK).
  const dL = o.x, dR = A - (o.x + o.w), dB = A - (o.y + o.h);
  for (const g of [dL, dR, dB])
    if (g >= 2 * GEN.BOT_R - 1e-6 && g < GEN.WALK - 1e-6) return false;
  if (overlap(o, GEN.PAD)) return false;
  for (const p of placed) {
    if (isNestPair(o, p)) { if (overlap(o, p)) return false; continue; }
    const gx = gapX(o, p), gy = gapY(o, p);
    if (gx < 0 && gy < 0) return false;
    if (gx < 0 && gy < GEN.GAP) return false;
    if (gy < 0 && gx < GEN.GAP) return false;
    if (gx >= 0 && gy >= 0 && Math.max(gx, gy) < GEN.GAP) return false;
  }
  return kindFits(o, placed);
}

// Kind-specific constraints checked at placement time (subset of validateLayout).
function kindFits(o, placed) {
  switch (o.kind) {
    case 'counter':
      return Math.min(o.x, o.y, A - o.x - o.w, A - o.y - o.h) <= 2.0;
    case 'desk':
      return o.y < 17 || o.y + o.h > 27;
    case 'island':
      return cy(o) >= 27 && Math.abs(cx(o) - 22) <= 8;
    case 'hatch':
    case 'core':
      return cy(o) >= 27 && Math.abs(cx(o) - 22) <= 9;
    case 'shelf': {
      const dir = o.w > o.h ? 1 : o.h > o.w ? -1 : 0;
      if (dir === 0) return false;
      const other = placed.find((p) => p.kind === 'shelf');
      return !other || (other.w > other.h ? 1 : -1) === dir;
    }
    default:
      return true;
  }
}

const rngPick = (rng, arr) => arr[(rng() * arr.length) | 0];
const rngRange = (rng, a, b) => a + rng() * (b - a);
function rngShuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- atomic groups ---------------------------------------------------------

// Bed + nightstand at its head. Returns true and pushes both when placed.
function placeBedGroup(placed, rng, bw, bh) {
  const spots = [];
  for (const x0 of [2, 24])
    for (const band of [0, 1]) {
      const y = band ? rngRange(rng, 34, 42.5 - bh) : rngRange(rng, 9, 15);
      spots.push({ x: rngRange(rng, x0, x0 + 6), y });
    }
  for (const s of rngShuffle(rng, spots)) {
    const bed = { x: r2(s.x), y: r2(s.y), w: bw, h: bh, kind: 'bed' };
    if (bed.x + bed.w > A - GEN.WALL || bed.x < GEN.WALL) continue;
    const gap = r2(rngRange(rng, 0.5, 1.0));
    const cands = [
      { x: r2(bed.x - gap - 3), y: r2(bed.y + rngRange(rng, 0, 1.5)), w: 3, h: 3, kind: 'table' },
      { x: r2(bed.x + bed.w + gap), y: r2(bed.y + rngRange(rng, 0, 1.5)), w: 3, h: 3, kind: 'table' },
    ];
    for (const ns of cands) {
      if (ns.x < GEN.WALL || ns.x + 3 > A - GEN.WALL || ns.y < GEN.STRIP_Y) continue;
      if (ns.y > bed.y + bed.h * 0.6) continue;
      if (!fits(bed, placed)) continue;
      if (!fits(ns, placed.concat(bed))) continue;
      placed.push(bed, ns);
      return true;
    }
  }
  return false;
}

// Sofa with an optional coffee table in front. Returns true when placed.
function placeSofaGroup(placed, rng) {
  const sw = r2(rngRange(rng, 11, 13)), sh = r2(rngRange(rng, 4.5, 5.5));
  const spots = [];
  for (const band of [0, 1])
    for (let k = 0; k < 3; k++)
      spots.push({ x: rngRange(rng, 2, A - 2 - sw), y: band ? rngRange(rng, 42.5 - sh - 2, 42.5 - sh) : rngRange(rng, 9, 15) });
  for (const s of rngShuffle(rng, spots)) {
    const sofa = { x: r2(s.x), y: r2(s.y), w: sw, h: sh, kind: 'sofa' };
    if (sofa.x < GEN.WALL || sofa.x + sw > A - GEN.WALL || !fits(sofa, placed)) continue;
    const facing = cy(sofa) < 22 ? 1 : -1;
    // Optional coffee table, in front, x-centered on the sofa.
    const tw = r2(rngRange(rng, 6, 8)), th = r2(rngRange(rng, 3, 3.5));
    const gap = r2(rngRange(rng, 0.3, 0.8));
    const t = {
      x: r2(Math.min(Math.max(sofa.x + sw / 2 - tw / 2, GEN.WALL), A - GEN.WALL - tw)),
      y: facing > 0 ? r2(sofa.y + sh + gap) : r2(sofa.y - gap - th),
      w: tw, h: th, kind: 'table',
    };
    if (t.y < GEN.STRIP_Y || t.y + th > A - GEN.WALL) t.y = NaN;
    placed.push(sofa);
    if (isFinite(t.y) && fits(t, placed)) placed.push(t);
    return true;
  }
  return false;
}

// --- generic random filler --------------------------------------------------

// Random spot, biased to the perimeter ring so the open center band stays
// walkable (the old handcrafted rooms kept it free of mid-floor clutter;
// each room gets at most the one mid-floor piece its archetype defines).
// All spots keep a >= WALK corridor from every wall so the bot can thread
// past the piece (a <3u corridor is where local steering oscillates).
function randomSpot(rng, w, h) {
  const W = GEN.WALK;
  const anywhere = () => ({
    x: rngRange(rng, W, A - W - w),
    y: rngRange(rng, GEN.STRIP_Y, A - W - h),
  });
  const edge = 3.0; // extra keep-out band width from a wall
  const perim = () => {
    switch ((rng() * 4) | 0) {
      case 0: return { x: rngRange(rng, W, W + edge), y: rngRange(rng, Math.max(GEN.STRIP_Y, 10), A - W - h) };          // L
      case 1: return { x: rngRange(rng, A - W - w - edge, A - W - w), y: rngRange(rng, Math.max(GEN.STRIP_Y, 10), A - W - h) }; // R
      case 2: return { x: rngRange(rng, W, A - W - w), y: rngRange(rng, GEN.STRIP_Y, GEN.STRIP_Y + 3) };                 // T
      default: return { x: rngRange(rng, W, A - W - w), y: rngRange(rng, A - W - h - edge, A - W - h) };                // B
    }
  };
  const p = rng() < 0.75 ? perim() : anywhere();
  return {
    x: r2(Math.min(Math.max(p.x, W), A - W - w)),
    y: r2(Math.min(Math.max(p.y, GEN.STRIP_Y), A - W - h)),
  };
}

function placeFiller(placed, rng, kind, w, h) {
  for (let k = 0; k < 40; k++) {
    const s = randomSpot(rng, w, h);
    const o = { x: s.x, y: s.y, w, h, kind };
    if (fits(o, placed)) { placed.push(o); return true; }
  }
  return false;
}

// Wall-hugging piece (left/right/bottom — top is the dock strip).
function placeWallPiece(placed, rng, kind, w, h, wall) {
  const walls = wall ? [wall] : rngShuffle(rng, ['L', 'R', 'B']);
  for (const wl of walls) {
    for (let k = 0; k < 20; k++) {
      let o;
      if (wl === 'L') o = { x: r2(rngRange(rng, 1.5, 2.0)), y: r2(rngRange(rng, 10, A - 10 - h)), w, h, kind };
      else if (wl === 'R') o = { x: r2(rngRange(rng, A - 2.0 - w, A - 1.5 - w)), y: r2(rngRange(rng, 10, A - 10 - h)), w, h, kind };
      else o = { x: r2(rngRange(rng, 6, A - 6 - w)), y: r2(rngRange(rng, A - 2.0 - h, A - 1.5 - h)), w, h, kind };
      if (fits(o, placed)) { placed.push(o); return true; }
    }
  }
  return false;
}

function placeCounter(placed, rng, wall) {
  return placeWallPiece(placed, rng, 'counter', r2(rngRange(rng, 8, 10)), r2(rngRange(rng, 4, 5)), wall);
}

// ---------------------------------------------------------------- archetypes

// Each returns {name, sub, obstacles} or null when a required piece failed.
// `placed` is filled in place; required pieces must succeed or the attempt is
// discarded (generateLevel retries with a fresh rng).

const ARCH = {
  residential: {
    living(placed, rng) {
      if (!placeSofaGroup(placed, rng)) return null;
      const sofa = placed.find((o) => o.kind === 'sofa');
      const facing = cy(sofa) < 22 ? 1 : -1;
      // Media on the side the sofa faces.
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const mw = r2(rngRange(rng, 10, 12)), mh = r2(rngRange(rng, 4.5, 5.5));
        const m = facing > 0
          ? { x: r2(rngRange(rng, 12, A - 12 - mw)), y: r2(rngRange(rng, 28, A - 1.5 - mh)), w: mw, h: mh, kind: 'media' }
          : { x: r2(rngRange(rng, 12, A - 12 - mw)), y: r2(rngRange(rng, 9, 15)), w: mw, h: mh, kind: 'media' };
        ok = fits(m, placed);
        if (ok) placed.push(m);
      }
      if (!ok) return null;
      placeFiller(placed, rng, 'plant', 5, 5);
      return { name: 'Living Room', sub: 'sofa & media wall' };
    },
    bedroom(placed, rng) {
      if (!placeBedGroup(placed, rng, r2(rngRange(rng, 10, 11.5)), r2(rngRange(rng, 9, 10.5)))) return null;
      rngPick(rng, [
        () => placeFiller(placed, rng, 'wardrobe', 8.5, 5.5),
        () => placeFiller(placed, rng, 'dresser', 9.5, 5),
      ])();
      placeFiller(placed, rng, 'plant', 5, 5);
      return { name: 'Bedroom', sub: 'bed & nightstand' };
    },
    kitchen(placed, rng) {
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const iw = r2(rngRange(rng, 14, 16)), ih = r2(rngRange(rng, 4, 5));
        const o = { x: r2(22 - iw / 2 + rngRange(rng, -1, 1)), y: r2(rngRange(rng, 30, A - 1.5 - ih)), w: iw, h: ih, kind: 'island' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      if (!placeCounter(placed, rng, 'L') || !placeCounter(placed, rng, 'R')) return null;
      placeCounter(placed, rng, 'B');
      return { name: 'Kitchen', sub: 'island & counters' };
    },
    study(placed, rng) {
      let ok = false;
      for (let k = 0; k < 40 && !ok; k++) {
        const w = r2(rngRange(rng, 8, 10)), h = r2(rngRange(rng, 4, 5));
        const band = rngPick(rng, [0, 1]);
        const o = { x: r2(rngRange(rng, GEN.WALL, A - GEN.WALL - w)), y: r2(band ? rngRange(rng, 35, 42.5 - h) : rngRange(rng, 9, 13)), w, h, kind: 'desk' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      rngPick(rng, [
        () => placeFiller(placed, rng, 'shelf', 4, 9),
        () => placeFiller(placed, rng, 'shelf', 9, 4),
      ])();
      placeFiller(placed, rng, 'plant', 5, 5);
      return { name: 'Study', sub: 'desk & bookshelf' };
    },
  },

  office: {
    open(placed, rng) {
      const desks = rngPick(rng, [2, 3]);
      for (let d = 0; d < desks; d++) {
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) {
          const w = r2(rngRange(rng, 9, 10)), h = 4;
          const band = rngPick(rng, [0, 1]);
          const o = { x: r2(rngRange(rng, GEN.WALL, A - GEN.WALL - w)), y: r2(band ? rngRange(rng, 35, 42.5 - h) : rngRange(rng, 9, 13)), w, h, kind: 'desk' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      placeFiller(placed, rng, 'divider', 4, 7);
      rngPick(rng, [
        () => placeFiller(placed, rng, 'shelf', 4, 8),
        () => placeFiller(placed, rng, 'plant', 5, 5),
      ])();
      return { name: 'Open Office', sub: 'desk rows' };
    },
    conference(placed, rng) {
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const w = r2(rngRange(rng, 14, 16)), h = r2(rngRange(rng, 6, 7));
        const o = { x: r2(22 - w / 2 + rngRange(rng, -0.5, 0.5)), y: r2(rngRange(rng, 30, 42.5 - h)), w, h, kind: 'table' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      if (!placeWallPiece(placed, rng, 'cabinet', 7.5, 5, 'L')) return null;
      if (!placeWallPiece(placed, rng, 'cabinet', 7.5, 5, 'R')) return null;
      placeFiller(placed, rng, 'plant', 5, 5);
      return { name: 'Conference', sub: 'big meeting table' };
    },
    cubicles(placed, rng) {
      const cells = [[4, 9], [31, 9], [4, 33.5], [31, 33.5]];
      for (const [bx, by] of cells) {
        let ok = false;
        for (let k = 0; k < 20 && !ok; k++) {
          const o = { x: r2(bx + rngRange(rng, 0, 2)), y: r2(by + rngRange(rng, 0, 2)), w: 7, h: 6, kind: 'cubicle' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      return { name: 'Cubicle Farm', sub: '2x2 cubicles' };
    },
    breakRoom(placed, rng) {
      if (!placeCounter(placed, rng)) return null;
      // Table on the opposite side of the room (full corridor required).
      placeFiller(placed, rng, 'table', 7.5, 3.5);
      rngPick(rng, [
        () => placeFiller(placed, rng, 'shelf', 4, 8),
        () => placeFiller(placed, rng, 'plant', 5, 5),
      ])();
      return { name: 'Break Room', sub: 'counter & table' };
    },
  },

  store: {
    retail(placed, rng) {
      const vertical = rng() < 0.5;
      const n = rngPick(rng, [3, 4]);
      for (let s = 0; s < n; s++) {
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) {
          const w = vertical ? 5 : r2(rngRange(rng, 10, 12));
          const h = vertical ? r2(rngRange(rng, 10, 12)) : 5;
          // Vertical shelves only in side columns (the middle column must stay a walkable aisle).
          const x = vertical
            ? r2(rngPick(rng, [4, 35]) + rngRange(rng, 0, 2))
            : r2(rngRange(rng, 4, A - 4 - w));
          const y = vertical
            ? r2(rngRange(rng, 9, 14))
            : r2(rngPick(rng, [rngRange(rng, 9, 13), rngRange(rng, 33, 38.5)]));
          const o = { x, y, w, h, kind: 'shelf' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      placeFiller(placed, rng, 'table', 6.5, 4);
      return { name: 'Retail Floor', sub: 'shelf aisles' };
    },
    checkout(placed, rng) {
      if (!placeCounter(placed, rng, 'L') || !placeCounter(placed, rng, 'R')) return null;
      for (let s = 0; s < 2; s++) {
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) {
          const o = { x: r2(rngRange(rng, 6, A - 14)), y: r2(rngRange(rng, 33, 42.5 - 6)), w: r2(rngRange(rng, 7, 8)), h: r2(rngRange(rng, 5, 6)), kind: 'stock' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      return { name: 'Checkout', sub: 'counters & stock' };
    },
    warehouse(placed, rng) {
      const cells = [[4, 9], [30, 9], [4, 33.5], [30, 33.5]];
      for (const [bx, by] of cells) {
        let ok = false;
        for (let k = 0; k < 20 && !ok; k++) {
          const o = { x: r2(bx + rngRange(rng, 0, 2)), y: r2(by + rngRange(rng, 0, 2)), w: 8, h: 7, kind: 'pallet' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      return { name: 'Warehouse', sub: 'pallet grid' };
    },
    promo(placed, rng) {
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const w = r2(rngRange(rng, 12, 14)), h = r2(rngRange(rng, 4, 5));
        const o = { x: r2(22 - w / 2 + rngRange(rng, -1, 1)), y: r2(rngRange(rng, 30, 42.5 - h)), w, h, kind: 'island' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      const dir = rng() < 0.5;
      placeFiller(placed, rng, 'shelf', dir ? 4 : 10, dir ? 9 : 4);
      placeFiller(placed, rng, 'shelf', dir ? 4 : 10, dir ? 9 : 4);
      placeFiller(placed, rng, 'stock', 7.5, 5.5);
      return { name: 'Promo', sub: 'center island' };
    },
  },

  space: {
    deck(placed, rng) {
      for (let c = 0; c < 2; c++) {
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) {
          const w = r2(rngRange(rng, 9, 10)), h = 5;
          const band = rngPick(rng, [0, 1]);
          const o = { x: r2(rngRange(rng, GEN.WALL, A - GEN.WALL - w)), y: r2(band ? rngRange(rng, 35, 42.5 - h) : rngRange(rng, 9, 12)), w, h, kind: 'console' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const w = r2(rngRange(rng, 7, 8)), h = r2(rngRange(rng, 5.5, 6.5));
        const o = { x: r2(22 - w / 2 + rngRange(rng, -1, 1)), y: r2(rngRange(rng, 30, 42.5 - h)), w, h, kind: 'hatch' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      placeFiller(placed, rng, 'bench', 8, 6);
      return { name: 'Engineering Deck', sub: 'consoles & hatch' };
    },
    lab(placed, rng) {
      for (let b = 0; b < 2; b++) {
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) {
          const o = { x: r2(rngRange(rng, GEN.WALL, A - 14)), y: r2(rngRange(rng, 10, 16)), w: 8, h: 6, kind: 'bench' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const o = { x: r2(22 - 3 + rngRange(rng, -1, 1)), y: r2(rngRange(rng, 30, 42.5 - 7)), w: 6, h: 7, kind: 'core' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      placeFiller(placed, rng, 'cabinet', 8, 5);
      return { name: 'Research Lab', sub: 'benches & core' };
    },
    bridge(placed, rng) {
      for (let c = 0; c < 2; c++) {
        let ok = false;
        for (let k = 0; k < 40 && !ok; k++) {
          const o = { x: r2(rngRange(rng, GEN.WALL, A - 16)), y: r2(rngRange(rng, 9, 12)), w: 8, h: 6, kind: 'console' };
          ok = fits(o, placed);
          if (ok) placed.push(o);
        }
        if (!ok) return null;
      }
      let ok = false;
      for (let k = 0; k < 40 && !ok; k++) {
        const w = r2(rngRange(rng, 11, 12)), h = 5;
        const o = { x: r2(22 - w / 2 + rngRange(rng, -0.5, 0.5)), y: r2(rngRange(rng, 34, 42.5 - h)), w, h, kind: 'console' };
        ok = fits(o, placed);
        if (ok) placed.push(o);
      }
      if (!ok) return null;
      return { name: 'Command Bridge', sub: 'console row' };
    },
    habitat(placed, rng) {
      if (!placeBedGroup(placed, rng, 10, 9)) return null;
      if (!placeCounter(placed, rng)) return null;
      placeFiller(placed, rng, 'console', 8.5, 5);
      return { name: 'Habitation', sub: 'bunks & storage' };
    },
  },
};

// Fallback: hardcoded, always-valid sparse layouts (used only if 60 attempts fail).
const FALLBACKS = {
  residential: [
    { x: 4, y: 10, w: 5, h: 5, kind: 'plant' },
    { x: 35, y: 12, w: 4, h: 9, kind: 'shelf' },
    { x: 33, y: 33, w: 8, h: 5, kind: 'dresser' },
  ],
  office: [
    { x: 6, y: 10, w: 9, h: 4, kind: 'desk' },
    { x: 35, y: 12, w: 4, h: 8, kind: 'shelf' },
    { x: 29, y: 34, w: 8, h: 5, kind: 'cabinet' },
  ],
  store: [
    { x: 2, y: 12, w: 9, h: 4, kind: 'counter' },
    { x: 35, y: 12, w: 4, h: 9, kind: 'shelf' },
    { x: 30, y: 33, w: 8, h: 6, kind: 'stock' },
  ],
  space: [
    { x: 6, y: 12, w: 9, h: 5, kind: 'console' },
    { x: 29, y: 34, w: 9, h: 5, kind: 'console' },
    { x: 16.5, y: 30, w: 8, h: 6, kind: 'hatch' },
  ],
};

export function fallbackLayout(themeKey) {
  return {
    name: 'Storage Room',
    sub: 'fallback',
    obstacles: FALLBACKS[themeKey].map((o) => ({ ...o })),
  };
}

// ---------------------------------------------------------------- entry point

const THEMES_ORDER = ['residential', 'office', 'store', 'space'];

export function generateLevel(themeKey, level, runSeed = 0) {
  if (!THEMES_ORDER.includes(themeKey)) throw new Error(`unknown theme '${themeKey}'`);
  const rot = Math.floor((level - 1) / 12);
  // Difficulty ramps with dirtCount (see levelDef), not obstacle count — keep
  // rooms as open as the old handcrafted ones (3-5 pieces, open center band).
  const target = Math.max(GEN.MIN_OBS, Math.min(GEN.TARGET_MAX, 3 + rot));
  const base = mix(runSeed >>> 0, (level * 2654435761) >>> 0);
  // Deterministic archetype order for this (seed, level) — retried in order.
  const order = rngShuffle(makeRng(base), Object.values(ARCH[themeKey]));

  for (let k = 0; k < 60; k++) {
    const rng = makeRng(mix(base, (k * 0x9e3779b9 + 12741) >>> 0));
    const placed = [];
    const meta = order[k % order.length](placed, rng);
    if (!meta) continue;
    // Fill up to the target count with theme-appropriate filler.
    const fillers = FILL[themeKey];
    while (placed.length < target) {
      const f = rngPick(rng, fillers);
      if (!placeFiller(placed, rng, f[0], f[1], f[2])) {
        let any = false;
        for (const g of rngShuffle(rng, fillers))
          if (placeFiller(placed, rng, g[0], g[1], g[2])) { any = true; break; }
        if (!any) break;
      }
    }
    if (placed.length >= GEN.MIN_OBS && validateLayout(placed).length === 0)
      return { name: meta.name, sub: meta.sub, obstacles: placed };
  }
  const fb = fallbackLayout(themeKey);
  return { name: fb.name, sub: fb.sub, obstacles: fb.obstacles };
}

// Filler pools per theme (kind, w, h). 'table' is excluded on purpose —
// free tables can trip the sofa/bed semantic rules.
const FILL = {
  residential: [['plant', 5, 5], ['shelf', 4, 9], ['dresser', 9.5, 5], ['wardrobe', 8.5, 5.5]],
  office: [['plant', 5, 5], ['shelf', 4, 8], ['cabinet', 7.5, 5]],
  store: [['stock', 7.5, 5.5], ['bench', 8, 6], ['shelf', 4, 9]],
  space: [['bench', 8, 6], ['cabinet', 8, 5], ['plant', 5, 5], ['console', 8.5, 5]],
};
