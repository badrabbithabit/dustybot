// hangar.js — the auto-bay: a tiny idle sim that runs while the HANGAR screen
// is open. One SUDS mop-bot quietly vacuums a mini room, leaving a fading wet
// trail. It is a VISUAL for the idle channel — the shard economy is the flat
// hangarRate(save) (upgrades.js), banked per-frame by game.js.
//
// It drives the REAL Bot + DustSystem + steer (no DOM), so the mop trail and
// wet-mote soak behave exactly as they do in a live run.
import { BALANCE, makeRunStats } from './upgrades.js';
import { Bot } from './bot.js';
import { DustSystem } from './dust.js';
import { steer } from './steer.js';
import { PAL } from './palette.js';

const W = 24, H = 13;
const OBSTACLES = [
  { x: 4.5, y: 3.5, w: 4.5, h: 2.5, kind: 'sofa' },
  { x: 15, y: 6.5, w: 5, h: 2.5, kind: 'table' },
];
const DOCK = { x: 12, y: 2.0, triggerR: 1.7 };
const DOCK_TARGET = { x: DOCK.x, y: DOCK.y, dock: true };
const MAX_VISIBLE = BALANCE.hangar.maxVisible;

// Fake world: only what Bot/DustSystem/steer touch, plus a mini wet grid so
// the mop trail + soaked-mote rule work here too (coarser than the real one).
function makeWorld() {
  const res = 4;                       // cells per world unit (96×52 = 4992)
  const gw = Math.ceil(W * res), gh = Math.ceil(H * res);
  const grid = new Float32Array(gw * gh);
  const world = {
    W, H,
    obstacles: OBSTACLES,
    scale: 1, ox: 0, oy: 0,
    toScreen(x, y) { return { x: x * world.scale + world.ox, y: y * world.scale + world.oy }; },
    blocked(x, y, pad = 0) {
      for (const o of world.obstacles)
        if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
      return false;
    },
    isFree(x, y, r = BALANCE.bot.radius) {
      if (x < r || y < r || x > W - r || y > H - r) return false;
      return !world.blocked(x, y, r);
    },
    stampWet(x, y, amt) {
      const cx = Math.floor(x * res), cy = Math.floor(y * res);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= gw || py >= gh) continue;
        const i = py * gw + px;
        grid[i] = Math.min(1, grid[i] + amt * (dx === 0 && dy === 0 ? 1 : 0.5));
      }
    },
    wetAt(x, y) {
      const cx = Math.floor(x * res), cy = Math.floor(y * res);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return 0;
      return grid[cy * gw + cx];
    },
    updateWet(dt) {
      const k = Math.exp(-0.08 * dt);
      for (let i = 0; i < grid.length; i++)
        if (grid[i] > 0) grid[i] = grid[i] * k < 0.01 ? 0 : grid[i] * k;
    },
    drawWet(c) {
      const s = world.scale;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const v = grid[y * gw + x];
        if (v < 0.05) continue;
        c.fillStyle = `rgba(90,165,235,${Math.min(0.55, v * 0.55)})`;
        c.fillRect(x / res * s + world.ox, y / res * s + world.oy, (1 / res) * s + 0.5, (1 / res) * s + 0.5);
      }
    },
  };
  return world;
}

export class HangarIdle {
  constructor(save) {
    this.save = save;
    this.world = makeWorld();
    this.stats = makeRunStats((save && save.meta) || {}, 'mop'); // SUDS is the star
    this.bot = new Bot(this.world, this.stats);
    this.bot.x = W / 2; this.bot.y = H / 2; this.bot.heading = -Math.PI / 2;
    this.dust = new DustSystem(this.world);
    const theme = { name: 'HANGAR BAY', icon: '🏠', dirt: PAL, floorA: PAL.floorA, floorB: PAL.floorB };
    this.dust.spawnLevel(0, theme, this.stats, { bigShare: 0.3, debrisShare: 0.3 });
    for (let i = 0; i < MAX_VISIBLE; i++) this.dust._spawnOne();
    this.collected = 0;
    this.time = 0;
    this._spawnCd = 1.5;
    this.ai = { cur: null, bestD: 0, stall: 0, skip: new Set(), wp: null, wpFor: null };
  }

  update(dt) {
    this.time += dt;
    const { bot, dust, world, stats } = this;
    const ai = this.ai;

    // keep the bay dusted at a steady low level
    if (dust.count < MAX_VISIBLE) {
      this._spawnCd -= dt;
      if (this._spawnCd <= 0) {
        this._spawnCd = 2 + Math.random() * 2.5;
        dust._spawnOne();
      }
    }

    // target: nearest mote, or the dock for a dump
    let target = null;
    if (bot.bin >= 0.85 * stats.binMax || bot.full || (bot.bin > 0 && dust.count === 0)) target = DOCK_TARGET;
    else {
      let bd = Infinity;
      for (const it of dust.items) {
        if (ai.skip.has(it)) continue;
        const d = Math.hypot(it.x - bot.x, it.y - bot.y);
        if (d < bd) { bd = d; target = it; }
      }
    }
    const { input } = steer(bot, world, target, ai);

    bot.update(dt, input);
    dust.update(dt, bot, stats, { onCollect: (v) => { this.collected++; } }, world);
    world.updateWet(dt);
    if (bot.bin > 0 && Math.hypot(bot.x - DOCK.x, bot.y - DOCK.y) < DOCK.triggerR) bot.dumpBin();

    // anti-stall (same rule as the balance sim)
    if (target && !target.dock) {
      const d2 = Math.hypot(target.x - bot.x, target.y - bot.y);
      if (ai.cur !== target) { ai.cur = target; ai.bestD = d2; ai.stall = 0; }
      else {
        if (d2 < ai.bestD) ai.bestD = d2;
        if (d2 > ai.bestD + 1.5) ai.stall += dt; else ai.stall = 0;
      }
      if (ai.stall > 2.5) { ai.skip.add(target); ai.cur = null; ai.stall = 0; if (ai.skip.size > 6) ai.skip.clear(); }
    } else ai.cur = null;
  }

  // Draw to the hangar's own small canvas (screens are opaque — this can't
  // reuse the main game canvas). Backing store fixed at 520×280 (css 260×140).
  render(cv) {
    if (!cv) return;
    if (cv.width !== 520) { cv.width = 520; cv.height = 280; }
    const c = cv.getContext('2d');
    const s = Math.min(520 / W, 280 / H);
    this.world.scale = s;
    this.world.ox = (520 - W * s) / 2;
    this.world.oy = (280 - H * s) / 2;

    c.fillStyle = PAL.bg;
    c.fillRect(0, 0, 520, 280);
    // floor tiles
    const TILE = 2 * s;
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      c.fillStyle = (tx + ty) & 1 ? PAL.floorA : PAL.floorB;
      c.fillRect(this.world.ox + tx * TILE, this.world.oy + ty * TILE, TILE + 0.5, TILE + 0.5);
    }
    this.world.drawWet(c);
    // obstacles
    for (const o of OBSTACLES) {
      c.fillStyle = PAL.wall;
      c.fillRect(this.world.ox + o.x * s, this.world.oy + o.y * s, o.w * s, o.h * s);
      c.strokeStyle = PAL.grid;
      c.lineWidth = 2;
      c.strokeRect(this.world.ox + o.x * s + 1, this.world.oy + o.y * s + 1, o.w * s - 2, o.h * s - 2);
    }
    // dock
    const dx = this.world.ox + (DOCK.x - 1.5) * s, dy = this.world.oy + (DOCK.y - 1.2) * s;
    c.fillStyle = 'rgba(255,207,92,0.16)';
    c.fillRect(dx, dy, 3 * s, 2.4 * s);
    c.strokeStyle = PAL.gold;
    c.lineWidth = 2;
    c.strokeRect(dx, dy, 3 * s, 2.4 * s);
    c.fillStyle = PAL.gold;
    c.font = '10px monospace';
    c.textAlign = 'center';
    c.fillText('DOCK', dx + 1.5 * s, dy + 1.2 * s);
    this.dust.draw(c);
    this.bot.draw(c);
  }
}
