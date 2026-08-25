// bot.js — the robot vacuum, top-down 2D sprite + movement. No health/battery;
// it has a dust bin (clogs when full) and a boost with cooldown.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';

// 11x11 pixel sprite: '.'=transparent, K=dark outline, R=coral body, H=coral
// hi (front), W=white glint, C=dome, B=blue LED, M=magenta LED (bin full).
const SPRITE = [
  '....KKK....',
  '...KHHHK...',
  '..KHRRRRK..',
  '..KRRRRRK..',
  '.KRRCCRRK..',
  '.KRCCCcRRK.',
  '..KRRRRRK..',
  '..KRRRRRK..',
  '..KRRRRRK..',
  '...KHHHK...',
  '....KKK....',
];
const SPRITE_PX = 11;

function makeSprite(led) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE_PX;
  const c = cv.getContext('2d');
  const map = { K: PAL.accentOut, R: PAL.accent, H: PAL.accentHi, W: '#ffffff', C: PAL.wall, B: PAL.blue, M: PAL.danger };
  for (let y = 0; y < SPRITE_PX; y++) {
    for (let x = 0; x < SPRITE_PX; x++) {
      let ch = SPRITE[y][x];
      if (ch === 'c') ch = led; // center LED cell
      const col = map[ch];
      if (!col || ch === '.') continue;
      c.fillStyle = col;
      c.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

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
    this._sprOk = makeSprite('B');
    this._sprFull = makeSprite('M');
    this._shadow = null;
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
    const size = r * 2.3;
    // pixel blob shadow
    c.fillStyle = PAL.shadow;
    const sh = r * 1.7;
    c.fillRect(p.x - sh / 2, p.y + r * 0.45, sh, sh * 0.55);
    c.fillRect(p.x - sh * 0.3, p.y + r * 0.45 + sh * 0.55, sh * 0.6, sh * 0.25);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(this.heading);
    // side brushes (spin, chunky)
    c.strokeStyle = PAL.gold;
    c.lineWidth = Math.max(2, r * 0.12);
    c.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const a = this._brush + i * Math.PI;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05); c.stroke();
    }
    c.lineCap = 'butt';
    // body sprite (nearest-neighbor scaled)
    c.imageSmoothingEnabled = false;
    c.drawImage(this.full ? this._sprFull : this._sprOk, -size / 2, -size / 2, size, size);
    c.restore();
  }
}
