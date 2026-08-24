// All balance tables + upgrade logic. Single source of truth for numbers.
// 2D top-down endless vacuum: no rooms/levels. Dirt (the death pressure)
// spawns continuously and its rate ramps with LEVEL. Death = global dirt
// hits its cap. XP from dust drives level-ups (upgrade picks). Shards are
// the persistent meta currency.

export const BALANCE = {
  arena: { w: 44, h: 44 },          // world units (square, screen-fitted)
  bot: { radius: 1.0, speed: 6.0, boostMult: 1.7, turnRate: 5.0, boostCd: 4.0, boostCdFloor: 1.0 },
  bin: { max: 100, clogAt: 100, clogSuctionMult: 0.5, clogWeightMult: 1.25 },
  dirt: {
    cap: 150,                       // global dirt at/above this = bot buried (death)
    start: 18,
    spawnBase: 1.2,                 // dirt/sec at level 1
    levelRamp: 0.35,                // + dirt/sec per level (main pressure driver)
    spawnRamp: 0.01,                // small extra dirt/sec per second survived
    spawnMax: 14,
    moteValue: 1,
    goldChance: 0.03,
  },
  xp: { curve: lvl => 12 + 6 * lvl, maxLevel: 30 },   // XP needed to go lvl -> lvl+1
  shardPerDust: 0.05,
  shardPerSecond: 0.05,             // passive shard trickle
  shardPerLevel: 2,
  metaCost: (base, lvl) => Math.round(base * Math.pow(1.6, lvl)),
  offline: { capHours: 8, basePerHour: 0.8, metaPerHour: 0.05 },
};

// ---------------- In-run upgrades (1 of 3 picks on level-up) ----------------
export const RUN_UPGRADES = [
  { id: 'suction', name: 'Suction Core', icon: '🌀', max: 5, weight: 3,
    desc: lvl => `+20% suction & range, +5 bin (L${lvl})`,
    apply: (s, n) => { s.suction *= 1.2; s.suctionRange += 0.5; s.binMax += 5; } },
  { id: 'brush', name: 'Turbo Brush', icon: '🪥', max: 5, weight: 3,
    desc: lvl => `+15% pickup radius (L${lvl})`,
    apply: (s, n) => { s.pickupRadius *= 1.15; } },
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
  { id: 'clean', name: 'Air Scrubbers', icon: '🌫️', max: 3, weight: 2,
    desc: lvl => `Dirt spawns 10% slower (L${lvl})`,
    apply: (s, n) => { s.spawnMult *= 0.9; } },
  { id: 'cap', name: 'Deep Storage', icon: '🧯', max: 3, weight: 2,
    desc: lvl => `+15 dirt before the bury (L${lvl})`,
    apply: (s, n) => { s.dirtCap += 15; } },
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
  { id: 'meta_dirt', name: 'Dust Dampener', icon: '🧯', base: 50, max: 8,
    desc: lvl => `Dirt spawns 4% slower (L${lvl})` },
  { id: 'meta_cap', name: 'Buried? No.', icon: '🛡️', base: 150, max: 5,
    desc: lvl => `+12 dirt cap (L${lvl})` },
];

// Build the run stats object (what upgrades mutate) from meta levels.
export function makeRunStats(meta) {
  const L = id => meta[id] || 0;
  const s = {
    suction: 1.0, suctionRange: 3.4, pickupRadius: 1.7,
    speed: BALANCE.bot.speed, turnRate: BALANCE.bot.turnRate,
    magnetRange: 0.0,
    binMax: BALANCE.bin.max,
    boostCdMult: 1.0,
    shardMult: 1.0,
    goldChance: BALANCE.dirt.goldChance,
    spawnMult: 1.0,
    dirtCap: BALANCE.dirt.cap,
    // run accumulators (not from upgrades)
    dust: 0, bin: 0, level: 1, xp: 0, shardsEarned: 0,
  };
  s.suction *= Math.min(3, 1 + 0.05 * L('meta_suction'));
  s.speed *= 1 + 0.04 * L('meta_speed');
  s.binMax += 8 * L('meta_bin');
  s.pickupRadius *= 1 + 0.04 * L('meta_magnet');
  s.shardMult *= 1 + 0.03 * L('meta_polish');
  s.goldChance += 0.03 * L('meta_gold');
  s.spawnMult *= Math.max(0.4, 1 - 0.04 * L('meta_dirt'));
  s.dirtCap += 12 * L('meta_cap');
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

export function xpNeed(s) { return BALANCE.xp.curve(s.level); }

export function gainXp(s, n) {
  s.xp += n;
  let leveled = 0;
  while (s.level < BALANCE.xp.maxLevel && s.xp >= xpNeed(s)) {
    s.xp -= xpNeed(s);
    s.level++;
    leveled++;
  }
  if (s.level >= BALANCE.xp.maxLevel) s.xp = 0;
  return leveled;
}

export function metaCost(id, lvl) {
  const u = META_UPGRADES.find(x => x.id === id);
  if (!u) return Infinity;
  return BALANCE.metaCost(u.base, lvl);
}
