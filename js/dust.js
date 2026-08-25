// dust.js — dirt motes (pooled, plain objects), continuous ramping spawn,
// suction + pickup. Tracks the global dirt count; game reads count vs cap.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';

const MAX_DUST = 700;

const MOTE_STYLE = {
  dust:   { col: PAL.dirt1,  hi: PAL.dustShine, r: 0.30 },
  big:    { col: PAL.dirt2,  hi: PAL.dustShine, r: 0.50 },
  debris: { col: PAL.debris, hi: PAL.dirt2,     r: 0.36 },
  gold:   { col: PAL.gold,   hi: PAL.goldHi,    r: 0.42 },
};

export class DustSystem {
  constructor(world) {
    this.world = world;
    this.items = [];
    this._free = [];
    this._spawnAcc = 0;
  }

  get count() { return this.items.length; }

  reset(startCount) {
    for (const it of this.items) { this._free.push(it); }
    this.items = [];
    this._spawnAcc = 0;
    for (let i = 0; i < startCount; i++) this.spawn();
  }

  _rollType(stats) {
    const roll = Math.random();
    if (roll < stats.goldChance) return { type: 'gold', val: 5 };
    if (roll < stats.goldChance + 0.10) return { type: 'debris', val: 2 };
    if (roll < stats.goldChance + 0.22) return { type: 'big', val: 3 };
    return { type: 'dust', val: BALANCE.dirt.moteValue };
  }

  spawn(x, y) {
    if (this.items.length >= MAX_DUST) return null;
    const it = this._free.pop() || {};
    const t = this._rollType(this._stats || { goldChance: BALANCE.dirt.goldChance });
    it.x = (x != null) ? x : Math.random() * this.world.W;
    it.y = (y != null) ? y : Math.random() * this.world.H;
    it.vx = 0; it.vy = 0;
    it.type = t.type; it.val = t.val;
    it.r = MOTE_STYLE[t.type].r;
    it.phase = Math.random() * 6.28;
    this.items.push(it);
    return it;
  }

  update(dt, bot, stats, cb) {
    this._stats = stats;
    const W = this.world.W, H = this.world.H;
    const pickupR = stats.pickupRadius;
    const canVacuum = !bot.full;
    const suckR = canVacuum ? stats.suctionRange * stats.suction : 0;
    const clogMult = canVacuum ? 1 : BALANCE.bin.clogSuctionMult;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      // drift
      it.x += it.vx * dt; it.y += it.vy * dt;
      if (it.x < 0) { it.x = 0; it.vx *= -0.5; }
      if (it.y < 0) { it.y = 0; it.vy *= -0.5; }
      if (it.x > W) { it.x = W; it.vx *= -0.5; }
      if (it.y > H) { it.y = H; it.vy *= -0.5; }
      // suction
      const dx = bot.x - it.x, dy = bot.y - it.y;
      const dist = Math.hypot(dx, dy);
      if (dist < suckR + pickupR) {
        const force = (1 - dist / (suckR + pickupR)) * 16 * stats.suction * clogMult;
        it.vx += dx / (dist + 0.001) * force * dt * 6;
        it.vy += dy / (dist + 0.001) * force * dt * 6;
      }
      // magnet passive pull
      if (stats.magnetRange > 0 && dist < stats.magnetRange + 2) {
        it.vx += dx / (dist + 0.001) * 4 * dt;
        it.vy += dy / (dist + 0.001) * 4 * dt;
      }
      // friction
      it.vx *= (1 - Math.min(1, dt * 3));
      it.vy *= (1 - Math.min(1, dt * 3));
      // pickup
      if (dist < pickupR) {
        this.items.splice(i, 1);
        this._free.push(it);
        this._collected(it, bot, stats, cb);
        continue;
      }
      it.phase += dt * 2;
    }
  }

  _collected(it, bot, stats, cb) {
    bot.addDust(1, it._xp);
    const gained = it.val;
    if (it.type === 'gold') cb.onGold && cb.onGold();
    else cb.onSuck && cb.onSuck(it.type);
    cb.onCollect && cb.onCollect(gained, it);
  }

  draw(c) {
    for (const it of this.items) {
      const p = this.world.toScreen(it.x, it.y);
      const st = MOTE_STYLE[it.type] || MOTE_STYLE.dust;
      const r = it.r * this.world.scale;
      const s = Math.max(3, r * 1.9);
      const bob = Math.sin(it.phase) * 0.15 * r;
      const x = Math.round(p.x - s / 2);
      const y = Math.round(p.y + bob - s / 2);
      // soft shadow
      c.fillStyle = PAL.shadow;
      c.fillRect(x + 1, Math.round(p.y + s / 2), s - 2, Math.max(2, s * 0.2));
      // pixel mote: square + darker bottom/right + highlight
      c.fillStyle = st.col;
      c.fillRect(x, y, s, s);
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(x, y + s - Math.ceil(s / 3), s, Math.ceil(s / 3));
      c.fillRect(x + s - Math.ceil(s / 3), y, Math.ceil(s / 3), s);
      c.fillStyle = st.hi;
      c.fillRect(x, y, Math.ceil(s / 3), Math.ceil(s / 3));
    }
  }
}
