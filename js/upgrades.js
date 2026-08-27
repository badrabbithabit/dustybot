// All balance tables + upgrade logic. Single source of truth for numbers.
// 2D top-down, LEVEL-BASED vacuum. A run is a sequence of themed LEVELS:
// 3 residential rooms -> 3 offices -> 3 stores -> 3 space decks, then it loops
// through themes with a per-rotation difficulty ramp. Each level has fixed
// obstacles (furniture/desks/shelves/consoles) and a FIXED amount of themed
// dirt scattered at level start (it does NOT regenerate); the count scales
// with the level number. Clear a level by vacuuming every mote, then pick
// 1 of 3 upgrades. No failure mode yet. Shards are the persistent meta
// currency.

export const BALANCE = {
  arena: { w: 44, h: 44 },          // world units (square, screen-fitted)
  bot: { radius: 1.0, speed: 6.0, boostMult: 1.7, turnRate: 5.0, boostCd: 4.0, boostCdFloor: 1.0 },
  bin: { max: 100, fullAt: 100, clogSuctionMult: 0.5, clogWeightMult: 1.25 },
  dirt: {
    moteValue: 1,                   // base value of a common mote
    goldChance: 0.03,               // chance a spawned mote is the bonus type
    base: 26,                       // dirt count at level 1
    perLevel: 6,                    // + dirt per level (scales with level number)
    perRotation: 12,                // + dirt per full theme rotation (extra ramp)
    max: 160,
  },
  shardPerDust: 0.05,
  shardPerSecond: 0.05,             // passive shard trickle
  shardPerLevel: 2,
  metaCost: (base, lvl) => Math.round(base * Math.pow(1.6, lvl)),
  offline: { capHours: 8, basePerHour: 0.8, metaPerHour: 0.05 },
  dock: { x: 22, y: 3.6, triggerR: 1.9 },
};

// ---------------- In-run upgrades (1 of 3 picks on level-up) ----------------
export const RUN_UPGRADES = [
  { id: 'suction', name: 'Suction Core', icon: '🌀', max: 5, weight: 3,
    desc: lvl => `+20% suction & range, +5 bin (L${lvl})`,
    apply: (s, n) => { s.suction *= 1.2; s.suctionRange += 0.5; s.binMax += 5; } },
  { id: 'brush', name: 'Turbo Brush', icon: '🪥', max: 5, weight: 3,
    desc: lvl => lvl <= 1 ? `Adds a side brush (L1)` : `+20% pickup, brush grows (L${lvl})`,
    apply: (s, n) => { s.brushLevel = n; if (n >= 2) s.pickupRadius *= 1.2; } },
  { id: 'speed', name: 'Speed Coil', icon: '⚡', max: 5, weight: 3,
    desc: lvl => `+10% speed & turning (L${lvl})`,
    apply: (s, n) => { s.speed *= 1.10; s.turnRate *= 1.10; } },
  { id: 'bin', name: 'Extra Hopper', icon: '📦', max: 5, weight: 3,
    desc: lvl => `+25 bin capacity (L${lvl})`,
    apply: (s, n) => { s.binMax += 25; } },
  { id: 'magnet', name: 'Magnet Motor', icon: '🧲', max: 3, weight: 2,
    desc: lvl => `+15% dust pull distance (L${lvl})`,
    apply: (s, n) => { s.magnetRange += 1.4; } },
  { id: 'overdrive', name: 'Overdrive', icon: '🔥', max: 3, weight: 2,
    desc: lvl => `-20% boost cooldown (L${lvl})`,
    apply: (s, n) => { s.boostCdMult *= 0.8; } },
  { id: 'merchant', name: 'Scrap Merchant', icon: '🪙', max: 3, weight: 2,
    desc: lvl => `+15% dust→shard conversion (L${lvl})`,
    apply: (s, n) => { s.shardMult *= 1.15; } },
  { id: 'clean', name: 'Wide Suction', icon: '🌫️', max: 3, weight: 2,
    desc: lvl => `+15% pickup radius (L${lvl})`,
    apply: (s, n) => { s.pickupRadius *= 1.15; } },
  { id: 'cap', name: 'Deep Hopper', icon: '📦', max: 3, weight: 2,
    desc: lvl => `+20 bin capacity (L${lvl})`,
    apply: (s, n) => { s.binMax += 20; } },
  { id: 'junk', name: 'Gold Bristles', icon: '🍀', max: 2, weight: 1,
    desc: lvl => `+3% golden dust chance (L${lvl})`,
    apply: (s, n) => { s.goldChance += 0.03; } },
];

// ---------------- Meta upgrades (shards, persist across runs) ----------------
export const META_UPGRADES = [
  { id: 'meta_suction', name: 'Factory Suction', icon: '🌀', base: 20, max: 10,
    desc: lvl => `+5% suction (L${lvl})` },
  { id: 'meta_speed', name: 'Chassis Rollers', icon: '⚡', base: 20, max: 10,
    desc: lvl => `+4% move speed (L${lvl})` },
  { id: 'meta_bin', name: 'Wider Hopper', icon: '📦', base: 25, max: 10,
    desc: lvl => `+8 max bin (L${lvl})` },
  { id: 'meta_magnet', name: 'Magnet Coil', icon: '🧲', base: 40, max: 8,
    desc: lvl => `+4% pickup radius (L${lvl})` },
  { id: 'meta_ap', name: 'Auto-Pilot Sensor', icon: '🤖', base: 100, max: 1,
    desc: () => 'Unlocks offline shard collection' },
  { id: 'meta_polish', name: 'Shard Polisher', icon: '✨', base: 60, max: 10,
    desc: lvl => `+3% shard gains (L${lvl})` },
  { id: 'meta_gold', name: 'Lucky Bristles', icon: '🍀', base: 200, max: 5,
    desc: lvl => `+3% golden dust chance (L${lvl})` },
  { id: 'meta_mote', name: 'Mote Magnet', icon: '🧲', base: 50, max: 8,
    desc: lvl => `+6% suction range (L${lvl})` },
];

// Build the run stats object (what upgrades mutate) from meta levels.
export function makeRunStats(meta) {
  const L = id => meta[id] || 0;
  const s = {
    suction: 1.0, suctionRange: 3.4, pickupRadius: 1.7, brushLevel: 0,
    speed: BALANCE.bot.speed, turnRate: BALANCE.bot.turnRate,
    magnetRange: 0.0,
    binMax: BALANCE.bin.max,
    boostCdMult: 1.0,
    shardMult: 1.0,
    goldChance: BALANCE.dirt.goldChance,
    spawnMult: 1.0,
    // run accumulators (not from upgrades)
    dust: 0, bin: 0, dirtCollected: 0, level: 1, shardsEarned: 0,
  };
  s.suction *= Math.min(3, 1 + 0.05 * L('meta_suction'));
  s.speed *= 1 + 0.04 * L('meta_speed');
  s.binMax += 8 * L('meta_bin');
  s.pickupRadius *= 1 + 0.04 * L('meta_magnet');
  s.shardMult *= 1 + 0.03 * L('meta_polish');
  s.goldChance += 0.03 * L('meta_gold');
  s.suctionRange *= 1 + 0.06 * L('meta_mote');
  return s;
}

export function runLevels(s) {
  return s._runLevels || (s._runLevels = {});
}

export function rollPicks(s, count = 3) {
  const lvls = runLevels(s);
  const pool = [];
  for (const u of RUN_UPGRADES) {
    if ((lvls[u.id] || 0) >= u.max) continue;
    for (let i = 0; i < u.weight; i++) pool.push(u);
  }
  const picks = [];
  const used = new Set();
  while (picks.length < count && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    const u = pool[i];
    if (used.has(u.id)) continue;
    used.add(u.id);
    picks.push(u);
  }
  return picks;
}

export function applyPick(s, id) {
  const u = RUN_UPGRADES.find(x => x.id === id);
  if (!u) return false;
  const lvls = runLevels(s);
  const cur = lvls[u.id] || 0;
  if (cur >= u.max) return false;
  lvls[u.id] = cur + 1;
  u.apply(s, lvls[u.id]);
  return true;
}

export function metaCost(id, lvl) {
  const u = META_UPGRADES.find(x => x.id === id);
  if (!u) return Infinity;
  return BALANCE.metaCost(u.base, lvl);
}

// ===========================================================================
// THEMES — the 4 environments. Each theme defines the floor/wall/dock palette
// and the dirt/item palette for that environment. A run cycles
// residential -> office -> store -> space, 3 layouts each, then repeats with
// a per-rotation dirt-count ramp.
// ===========================================================================
export const THEMES = {
  residential: {
    name: 'Residential', sub: 'rooms', icon: '🏠',
    accent: '#ff8a5c',
    floorA: '#3a2b26', floorB: '#443129', grid: '#5a4038',
    wall: '#241a17', wallEdge: '#4a362f',
    dockRing: '#ffcf5c',
    dirt: { dust: '#d8b98a', big: '#c39a63', debris: '#9c7a52', gold: '#ffcf5c', shine: '#f7e6c4' },
  },
  office: {
    name: 'Office', sub: 'workspaces', icon: '💼',
    accent: '#5cc8ff',
    floorA: '#26313f', floorB: '#2d3b4c', grid: '#3c4c60',
    wall: '#161d26', wallEdge: '#33414f',
    dockRing: '#5cc8ff',
    dirt: { dust: '#aeb9c4', big: '#8b97a6', debris: '#6b7787', gold: '#5cffb0', shine: '#e8eef4' },
  },
  store: {
    name: 'Store', sub: 'sales floor', icon: '🛒',
    accent: '#ffd24d',
    floorA: '#2a2f3a', floorB: '#343b4a', grid: '#454e61',
    wall: '#191d26', wallEdge: '#39414f',
    dockRing: '#ffd24d',
    dirt: { dust: '#c8c2b6', big: '#9aa0a6', debris: '#70777d', gold: '#ff9d3c', shine: '#f2efe6' },
  },
  space: {
    name: 'Space', sub: 'station deck', icon: '🛰️',
    accent: '#c07bff',
    floorA: '#1c1f33', floorB: '#232741', grid: '#343a5c',
    wall: '#12142a', wallEdge: '#2b2f52',
    dockRing: '#c07bff',
    dirt: { dust: '#b9a6d8', big: '#9484b8', debris: '#6f6394', gold: '#7dffd1', shine: '#efe6ff' },
  },
};

export const THEME_ORDER = ['residential', 'office', 'store', 'space'];

// ---------------------------------------------------------------------------
// Room layouts. Each theme has 3 NAMED rooms; each room is a list of AABB
// obstacles {x, y, w, h, kind}. World is 44x44 (BALANCE.arena), coordinates in
// world units. `kind` drives the per-theme render style (furniture/desk/etc).
// HARD RULES for every room (the bot always spawns at the arena center):
//   * keep the top dock strip clear (y < ~9)
//   * keep a 4x4 clear pad around center (22,22) — x 20..24 AND y 20..24 must
//     be free, so the bot never spawns inside furniture
//   * keep at least a 2-wide corridor between obstacles for the bot to pass
// ---------------------------------------------------------------------------
const L = (x, y, w, h, kind) => ({ x, y, w, h, kind });

// { name, sub, obstacles } per room. `name` is shown in the level-intro banner.
export const LAYOUTS = {
  residential: [
    { name: 'Living Room', sub: 'sofa & media wall',
      obstacles: [ L(6, 27, 13, 5, 'sofa'), L(8, 30, 6, 4, 'table'), L(29, 8, 11, 5, 'media'), L(33, 31, 5, 5, 'plant') ] },
    { name: 'Bedroom', sub: 'bed & wardrobe',
      obstacles: [ L(6, 11, 12, 11, 'bed'), L(29, 9, 10, 5, 'dresser'), L(29, 31, 8, 6, 'wardrobe') ] },
    { name: 'Kitchen', sub: 'island & counters',
      obstacles: [ L(4, 28, 9, 5, 'counter'), L(31, 28, 9, 5, 'counter'), L(14, 32, 16, 4, 'island'), L(30, 8, 10, 4, 'counter') ] },
  ],
  office: [
    { name: 'Open Office', sub: 'desk banks',
      obstacles: [ L(8, 11, 10, 4, 'desk'), L(26, 11, 10, 4, 'desk'), L(8, 29, 10, 4, 'desk'), L(26, 29, 10, 4, 'desk'), L(6, 20, 4, 6, 'divider') ] },
    { name: 'Conference', sub: 'big table',
      obstacles: [ L(14, 28, 16, 7, 'table'), L(4, 12, 8, 5, 'cabinet'), L(32, 12, 8, 5, 'cabinet'), L(4, 30, 6, 6, 'cabinet') ] },
    { name: 'Cubicle Farm', sub: 'stall grid',
      obstacles: [ L(7, 12, 7, 6, 'cubicle'), L(30, 12, 7, 6, 'cubicle'), L(7, 26, 7, 6, 'cubicle'), L(30, 26, 7, 6, 'cubicle') ] },
  ],
  store: [
    { name: 'Retail Floor', sub: 'shelf aisles',
      obstacles: [ L(6, 14, 5, 12, 'shelf'), L(33, 14, 5, 12, 'shelf'), L(6, 30, 5, 8, 'shelf'), L(33, 30, 5, 8, 'shelf') ] },
    { name: 'Checkout', sub: 'counter & stock',
      obstacles: [ L(6, 12, 10, 4, 'counter'), L(28, 12, 10, 4, 'counter'), L(10, 29, 8, 6, 'stock'), L(26, 29, 8, 6, 'stock') ] },
    { name: 'Warehouse', sub: 'pallet stacks',
      obstacles: [ L(6, 12, 8, 7, 'pallet'), L(30, 12, 8, 7, 'pallet'), L(6, 29, 8, 7, 'pallet'), L(30, 29, 8, 7, 'pallet') ] },
  ],
  space: [
    { name: 'Engineering Deck', sub: 'consoles & hatch',
      obstacles: [ L(8, 14, 10, 5, 'console'), L(26, 14, 10, 5, 'console'), L(18, 30, 8, 6, 'hatch') ] },
    { name: 'Research Lab', sub: 'benches & core',
      obstacles: [ L(6, 16, 8, 6, 'bench'), L(30, 16, 8, 6, 'bench'), L(19, 30, 6, 7, 'core') ] },
    { name: 'Command Bridge', sub: 'control banks',
      obstacles: [ L(9, 12, 8, 6, 'console'), L(27, 12, 8, 6, 'console'), L(16, 30, 12, 5, 'console') ] },
  ],
};

// Resolve the theme + obstacle layout + dirt count for a given 1-based level.
export function levelDef(level) {
  const pos = level - 1;                            // 0-based level index
  const rot = Math.floor(pos / (3 * 4));            // full 4-theme rotations
  const themeKey = THEME_ORDER[Math.floor(pos / 3) % 4]; // which theme
  const slot = pos % 3;                             // which of the 3 rooms
  const theme = THEMES[themeKey];
  const room = LAYOUTS[themeKey][slot] || { name: theme.name, sub: '', obstacles: [] };
  const obstacles = (room.obstacles || []).map(o => ({ ...o }));
  const dirtCount = Math.min(BALANCE.dirt.max,
    BALANCE.dirt.base + (level - 1) * BALANCE.dirt.perLevel + rot * BALANCE.dirt.perRotation);
  return { level, themeKey, theme, slot, rot, roomName: room.name, roomSub: room.sub, obstacles, dirtCount };
}
