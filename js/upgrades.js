// All balance tables + upgrade logic. Single source of truth for numbers.

export const BALANCE = {
  lives: 3,
  battery: { max: 100, drainMove: 4.0, drainBoost: 12.0, drainIdle: 0.4, padFill: 75 },
  bin: { max: 100, clogAt: 100, clogSuctionMult: 0.5, clogWeightMult: 1.25 },
  bot: { radius: 1.0, speed: 6.0, boostMult: 2.0, turnRate: 4.5, boostCd: 4.0, boostCdFloor: 1.0, boostDrainMult: 3.0 },
  room: {
    size: 26,               // half-extent of floor
    wall: 1.0,
    dustBudget: r => 90 + 22 * r,
    hazardCount: r => Math.min(14, 2 + Math.ceil(r * 1.2)),
    spawnRate: r => Math.min(6, 1 + r * 0.35),      // motes/sec from vents
    moteValue: r => 1 + 0.1 * r,
    ventCount: r => Math.min(6, 2 + Math.floor(r / 2)),
    obstacleCount: r => Math.min(8, 1 + Math.floor(r / 2)),
    shardBonus: r => 2 + Math.round(r * 0.8),
  },
  metaCost: (base, lvl) => Math.round(base * Math.pow(1.6, lvl)),
  offline: { capHours: 8, basePerHour: 0.8, metaPerHour: 0.05 },
  shardPerDust: 0.1,
};

// ---------------- In-run upgrades (1 of 3 picks) ----------------
export const RUN_UPGRADES = [
  { id: 'suction', name: 'Suction Core', icon: '🌀', max: 5, weight: 3,
    desc: lvl => `+20% suction & range, +5 bin (L${lvl})`,
    apply: (s, n) => { s.suction *= 1.2; s.suctionRange += 0.4; s.binMax += 5; } },
  { id: 'brush', name: 'Turbo Brush', icon: '🪥', max: 5, weight: 3,
    desc: lvl => `+15% pickup radius (L${lvl})`,
    apply: (s, n) => { s.pickupRadius *= 1.15; } },
  { id: 'speed', name: 'Speed Coil', icon: '⚡', max: 5, weight: 3,
    desc: lvl => `+10% speed & turning (L${lvl})`,
    apply: (s, n) => { s.speed *= 1.10; s.turnRate *= 1.10; } },
  { id: 'battery', name: 'Battery Cell', icon: '🔋', max: 5, weight: 3,
    desc: lvl => `+25% max battery, -5% drain (L${lvl})`,
    apply: (s, n) => { s.batteryMax *= 1.25; s.drainMult *= 0.95; } },
  { id: 'magnet', name: 'Magnet Motor', icon: '🧲', max: 3, weight: 2,
    desc: lvl => `+15% dust pull distance (L${lvl})`,
    apply: (s, n) => { s.magnetRange += 1.2; } },
  { id: 'overdrive', name: 'Overdrive', icon: '🔥', max: 3, weight: 2,
    desc: lvl => `-20% boost cooldown (L${lvl})`,
    apply: (s, n) => { s.boostCdMult *= 0.8; } },
  { id: 'merchant', name: 'Scrap Merchant', icon: '🪙', max: 3, weight: 2,
    desc: lvl => `+15% dust→shard conversion (L${lvl})`,
    apply: (s, n) => { s.shardMult *= 1.15; } },
  { id: 'shield', name: 'Nano Shield', icon: '🛡️', max: 2, weight: 1,
    desc: lvl => `+1 max life, heal 1 (L${lvl})`,
    apply: (s, n) => { s.maxLives += 1; s.lives = Math.min(s.maxLives, s.lives + 1); } },
  { id: 'vents', name: 'Smart Vents', icon: '💨', max: 1, weight: 1,
    desc: () => 'A wall vent becomes a charger pad',
    apply: (s, n) => { s.chargerVents += 1; } },
  { id: 'junk', name: 'Junk Filter', icon: '♻️', max: 1, weight: 1,
    desc: () => 'Hazmat dust +50% value, no splash',
    apply: (s, n) => { s.hazmatValueMult *= 1.5; s.hazmatSafe = true; } },
];

// ---------------- Meta upgrades (shards, persist) ----------------
export const META_UPGRADES = [
  { id: 'meta_suction', name: 'Factory Suction', icon: '🌀', base: 20, max: 10,
    desc: lvl => `+5% suction (L${lvl})` },
  { id: 'meta_speed', name: 'Chassis Rollers', icon: '⚡', base: 20, max: 10,
    desc: lvl => `+4% move speed (L${lvl})` },
  { id: 'meta_battery', name: 'Deep Battery', icon: '🔋', base: 30, max: 10,
    desc: lvl => `+6% max battery (L${lvl})` },
  { id: 'meta_magnet', name: 'Magnet Coil', icon: '🧲', base: 40, max: 8,
    desc: lvl => `+4% pickup radius (L${lvl})` },
  { id: 'meta_frame', name: 'Reinforced Frame', icon: '🛡️', base: 50, max: 3,
    desc: lvl => `+1 shield charge per run (L${lvl})` },
  { id: 'meta_ap', name: 'Auto-Pilot Sensor', icon: '🤖', base: 100, max: 1,
    desc: () => 'Unlocks offline dust collection' },
  { id: 'meta_polish', name: 'Shard Polisher', icon: '✨', base: 60, max: 10,
    desc: lvl => `+3% shard gains (L${lvl})` },
  { id: 'meta_gold', name: 'Lucky Bristles', icon: '🍀', base: 200, max: 5,
    desc: lvl => `+5% golden dust chance (L${lvl})` },
  { id: 'meta_heads', name: 'Starting Heads', icon: '❤️', base: 150, max: 1,
    desc: () => '+1 starting life' },
  { id: 'meta_clean', name: 'Pre-Cleaned Rooms', icon: '🧹', base: 250, max: 5,
    desc: lvl => `Hazard density -10% (L${lvl})` },
];

// Build the run stats object (what upgrades mutate) from meta levels.
export function makeRunStats(meta) {
  const L = id => meta[id] || 0;
  const s = {
    // core
    suction: 1.0, suctionRange: 3.2, pickupRadius: 1.6,
    speed: BALANCE.bot.speed, turnRate: BALANCE.bot.turnRate,
    magnetRange: 0.0,
    batteryMax: BALANCE.battery.max, drainMult: 1.0,
    binMax: BALANCE.bin.max,
    lives: BALANCE.lives, maxLives: BALANCE.lives,
    boostCdMult: 1.0, shardMult: 1.0,
    chargerVents: 0,
    hazmatValueMult: 1.0, hazmatSafe: false,
    goldChance: 0.01,
    shieldCharges: 0,
    // run accumulators (not from upgrades)
    dust: 0, bin: 0, shardsEarned: 0,
  };
  // apply meta (multiplicative, capped)
  s.suction *= Math.min(3, 1 + 0.05 * L('meta_suction'));
  s.speed *= 1 + 0.04 * L('meta_speed');
  s.batteryMax *= 1 + 0.06 * L('meta_battery');
  s.pickupRadius *= 1 + 0.04 * L('meta_magnet');
  s.shieldCharges = L('meta_frame');
  s.shardMult *= 1 + 0.03 * L('meta_polish');
  s.goldChance += 0.05 * L('meta_gold');
  s.lives += L('meta_heads');
  s.maxLives = s.lives;
  return s;
}

export function runLevels(s) {
  // returns map of run-upgrade id -> level (tracked by game)
  return s._runLevels || (s._runLevels = {});
}

export function rollPicks(s, count = 3) {
  const lvls = runLevels(s);
  const pool = [];
  for (const u of RUN_UPGRADES) {
    const cur = lvls[u.id] || 0;
    if (cur >= u.max) continue;
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
