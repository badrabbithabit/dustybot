// bot.js — the robot vacuum, top-down 2D sprite + movement. No health/battery;
// it has a dust bin (clogs when full) and a boost with cooldown.
import { BALANCE } from './upgrades.js';

export class Bot {
  constructor(world, stats) {
    this.world = world;
    this.stats = stats;
    this.x = world.W / 2;
    this.y = world.H / 2;
    this.heading = 0;
    this.vx = 0; this.vy = 0;
    this.bin = 0;
    this._dumpXp = 0;
    this.full = false;
    this.boostCd = 0;
    this.boosting = false;
    this.alive = true;
    this._brush = 0;
    this.onBoost = null;
  }

  addDust(n, xp) {
    this.bin = Math.min(this.stats.binMax, this.bin + n);
    this._dumpXp = (this._dumpXp || 0) + (xp || 0);
    this.full = this.bin >= BALANCE.bin.fullAt;
  }
  dumpBin() {
    if (this.bin <= 0) return null;
    const v = this.bin;
    this.bin = 0;
    this.full = false;
    return v;
  }

  update(dt, input) {
    if (!this.alive) return;
    const s = this.stats;
    this.full = this.full && this.bin >= BALANCE.bin.fullAt;

    // steering
    let ix = input.x, iy = input.y;
    if (input.tap) {
      const dx = input.tap.x - this.x, dy = input.tap.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.6) { ix = dx / d; iy = dy / d; }
    }
    if (ix !== 0 || iy !== 0) {
      const target = Math.atan2(ix, iy);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = s.turnRate * dt;
      this.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
    }

    // boost
    this.boostCd = Math.max(0, this.boostCd - dt);
    const wantBoost = input.boost && this.boostCd === 0;
    if (wantBoost && !this.boosting) { this.boosting = true; this.onBoost && this.onBoost(); }
    if (!wantBoost) this.boosting = false;

    const clogWeight = this.full ? 1 / BALANCE.bin.clogWeightMult : 1;
    const speed = s.speed * (this.boosting ? BALANCE.bot.boostMult : 1) * clogWeight;
    const mag = Math.min(1, Math.hypot(ix, iy));
    this.vx = Math.sin(this.heading) * speed * mag;
    this.vy = -Math.cos(this.heading) * speed * mag;   // heading 0 = up on screen
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // wall clamp
    const R = BALANCE.bot.radius;
    this.x = Math.max(R, Math.min(this.world.W - R, this.x));
    this.y = Math.max(R, Math.min(this.world.H - R, this.y));

    this._brush += dt * (mag > 0 ? (this.boosting ? 30 : 14) : 2);
    return { moving: mag > 0.1, speed };
  }

  draw(c) {
    const p = this.world.toScreen(this.x, this.y);
    const r = BALANCE.bot.radius * this.world.scale;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(this.heading);
    // body
    c.fillStyle = '#d14a28';
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    // front accent
    c.fillStyle = '#ff8a66';
    c.beginPath(); c.arc(0, 0, r * 0.92, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); c.lineTo(0, 0); c.closePath(); c.fill();
    // side brushes (spin)
    c.strokeStyle = '#ffd54a'; c.lineWidth = Math.max(1.5, r * 0.08);
    for (let i = 0; i < 2; i++) {
      const a = this._brush + i * Math.PI;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05); c.stroke();
    }
    // top sensor
    c.fillStyle = '#1c2735';
    c.beginPath(); c.arc(0, -r * 0.25, r * 0.34, 0, Math.PI * 2); c.fill();
    // LED (green ok / red bin full)
    c.fillStyle = this.full ? '#ff4a6a' : '#4aff9e';
    c.beginPath(); c.arc(0, -r * 0.25, r * 0.16, 0, Math.PI * 2); c.fill();
    c.restore();
  }
}
