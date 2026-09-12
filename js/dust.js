// dust.js — dirt motes (pooled, plain objects). A FIXED set is scattered at the
// start of each level (it does NOT regenerate). Motes are themed to the current
// level's environment.
//
// Mass model (IDLE_PLAN.md): every mote has a mass (BALANCE.moteMass by type).
// Heavy motes (mass >= BALANCE.drag.heavyMass) resist suction/magnet, and while
// inside the suction field they sum into `this.dragMass` — the bot's speed is
// reduced by motor / (motor + cost * dragMass) in game.js. A mopped (wet)
// floor "soaks" heavy motes: effective mass /2 and +50% value.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';

const MAX_DUST = 400;

// Per-mote-type radius; colors come from the active theme (see draw).
const MOTE_R = { dust: 0.30, big: 0.50, debris: 0.36, gold: 0.42, static: 0.40, tar: 0.62, puff: 0.55 };

export class DustSystem {
  constructor(world) {
    this.world = world;
    this.items = [];
    this._free = [];
    this.theme = null;        // theme object for coloring (set by spawnLevel)
  }

  get count() { return this.items.length; }

  // Scatter `count` themed motes at open (non-obstacle, non-dock) floor spots.
  // `def` (levelDef result) carries the level's big/debris share (difficulty gears).
  spawnLevel(count, theme, stats, def) {
    this.reset();
    this.theme = theme;
    this._stats = stats || null;   // gold chance (meta + upgrades) applies from level 1
    this._def = def || null;       // bigShare/debrisShare (difficulty gears)
    for (let i = 0; i < count; i++) this._spawnOne();
  }

  reset() {
    for (const it of this.items) { this._free.push(it); }
    this.items = [];
  }

  _rollType(stats) {
    const def = this._def || {};
    const bigShare = def.bigShare ?? 0.12;      // of the non-gold motes
    const debrisShare = def.debrisShare ?? 0.10;
    const staticShare = def.staticShare ?? 0;   // gear-gated new dirt (levelDef)
    const tarShare = def.tarShare ?? 0;
    const puffShare = def.puffShare ?? 0;
    const roll = Math.random();
    if (roll < stats.goldChance) return { type: 'gold', val: 5 };
    if (roll < stats.goldChance + debrisShare) return { type: 'debris', val: 2 };
    if (roll < stats.goldChance + debrisShare + bigShare) return { type: 'big', val: 3 };
    if (roll < stats.goldChance + debrisShare + bigShare + staticShare) return { type: 'static', val: 3 };
    if (roll < stats.goldChance + debrisShare + bigShare + staticShare + tarShare) return { type: 'tar', val: 4 };
    if (roll < stats.goldChance + debrisShare + bigShare + staticShare + tarShare + puffShare) return { type: 'puff', val: 2 };
    return { type: 'dust', val: BALANCE.dirt.moteValue };
  }

  _spawnOne() {
    if (this.items.length >= MAX_DUST) return null;
    const it = this._free.pop() || {};
    const t = this._rollType(this._stats || { goldChance: BALANCE.dirt.goldChance });
    // find an open spot: in-bounds, not on an obstacle, not on the dock
    let x, y, tries = 0;
    do {
      x = 1.5 + Math.random() * (this.world.W - 3);
      y = 9 + Math.random() * (this.world.H - 10.5); // keep the top dock strip clear
      tries++;
    } while (tries < 40 && (
      this.world.blocked(x, y, 0.6) ||
      Math.hypot(x - BALANCE.dock.x, y - BALANCE.dock.y) < 3.2
    ));
    it.x = x; it.y = y;
    it.vx = 0; it.vy = 0;
    it.type = t.type; it.val = t.val;
    it.r = MOTE_R[t.type];
    it.mass = BALANCE.moteMass[t.type] ?? 0.05; // heavy motes drag the bot
    if (t.type === 'tar') it.dir = Math.random() * 6.283; // ooze heading
    it.phase = Math.random() * 6.28;
    it.soaked = false;
    this.items.push(it);
    return it;
  }

  // Place one mote at a fixed spot (puff splinters). Skips silently at the pool cap.
  _spawnPiece(x, y, type, val) {
    if (this.items.length >= MAX_DUST) return null;
    const r = MOTE_R[type] || 0.3;
    if (x < r || y < r || x > this.world.W - r || y > this.world.H - r || this.world.blocked(x, y, r)) return null;
    const it = this._free.pop() || {};
    it.x = x; it.y = y; it.vx = 0; it.vy = 0;
    it.type = type; it.val = val; it.r = r;
    it.mass = BALANCE.moteMass[type] ?? 0.05;
    it.phase = Math.random() * 6.28;
    it.soaked = false;
    this.items.push(it);
    return it;
  }

  update(dt, bot, stats, cb, world) {
    this._stats = stats;
    const w = world || this.world;
    const W = w.W, H = w.H;
    const pickupR = stats.pickupRadius;
    const canVacuum = !bot.full;
    // suction reach = suctionRange scaled by suction power. Now actually used:
    // per-bot range identity + Suction Core + Mote Magnet all take effect
    // (previously suction only ever reached pickupR + 1 and suckR was dead).
    const suckR = canVacuum ? Math.max(pickupR + 0.5, stats.suctionRange * stats.suction) : 0;
    const brushLvl = (bot.stats && bot.stats.brushLevel) || 0;

    // Wet-floor queries (mopping bot). No world.wetAt (e.g. sim) = dry floor.
    const wetAt = w.wetAt ? (x, y) => w.wetAt(x, y) : null;
    const heavyMass = BALANCE.drag.heavyMass;
    const wetThresh = BALANCE.mop.wetThresh;
    let dragMass = 0;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      // soak check: heavy motes halve in mass on wet floor; static is
      // dissipate-d entirely (the mop is its counter, like the brush)
      let em = it.mass;
      let soaked = false;
      if (wetAt && (it.mass >= heavyMass || it.type === 'static')) {
        soaked = wetAt(it.x, it.y) >= wetThresh;
        if (soaked) em = it.mass / BALANCE.mop.massDiv;
      }
      it.soaked = soaked;
      // corner-brush sweep (spins motes inward from all sides)
      const sw = brushLvl > 0 ? bot.brushSweep(it.x, it.y, dt, brushLvl) : null;
      if (sw) { it.vx += sw.x; it.vy += sw.y; }
      // drift
      it.x += it.vx * dt; it.y += it.vy * dt;
      if (it.x < 0) { it.x = 0; it.vx *= -0.5; }
      if (it.y < 0) { it.y = 0; it.vy *= -0.5; }
      if (it.x > W) { it.x = W; it.vx *= -0.5; }
      if (it.y > H) { it.y = H; it.vy *= -0.5; }
      // tar: oozes slowly in its own heading, bouncing off walls & furniture
      if (it.type === 'tar') {
        const sp = BALANCE.dirt.tarSpeed * dt;
        const nx = it.x + Math.cos(it.dir) * sp;
        const ny = it.y + Math.sin(it.dir) * sp;
        if (nx < 0 || ny < 0 || nx > W || ny > H || w.blocked(nx, ny, it.r)) {
          it.dir = Math.atan2(-Math.sin(it.dir), -Math.cos(it.dir)) + (Math.random() - 0.5) * 1.2;
        } else { it.x = nx; it.y = ny; }
      }
      // suction: omnidirectional circle around the bot, like a real robot vac —
      // no directional cone. Strongest near the body, fading to zero at range.
      // Mass resists: heavy motes take longer to pull in.
      const dx = bot.x - it.x, dy = bot.y - it.y;
      const dist = Math.hypot(dx, dy);
      if (dist < suckR) {
        const f = 1 - dist / suckR;
        const ux = dx / (dist + 0.001), uy = dy / (dist + 0.001);
        if (it.type === 'static' && !soaked) {
          // charged clump: repels. The mote scatters and the bot takes a
          // shove back — brush contact or a wet floor beats it.
          it.vx -= ux * 3.0 * f * dt;
          it.vy -= uy * 3.0 * f * dt;
          const px = bot.x - ux * 0.7 * f * dt, py = bot.y - uy * 0.7 * f * dt;
          if (w.isFree(px, py, BALANCE.bot.radius)) { bot.x = px; bot.y = py; }
        } else {
          const force = f * f * 34 * stats.suction / (1 + 0.5 * em);
          it.vx += ux * force * dt * 6;
          it.vy += uy * force * dt * 6;
        }
        if (em >= heavyMass) dragMass += em; // heavy dust in the field drags the bot
      }
      // magnet passive pull (mass-resisted too)
      if (stats.magnetRange > 0 && dist < stats.magnetRange + 2) {
        it.vx += dx / (dist + 0.001) * 4 / (1 + 0.3 * em) * dt;
        it.vy += dy / (dist + 0.001) * 4 / (1 + 0.3 * em) * dt;
      }
      // friction
      it.vx *= (1 - Math.min(1, dt * 3));
      it.vy *= (1 - Math.min(1, dt * 3));
      // pickup — soaked heavy motes pay 1.5x
      if (dist < pickupR) {
        let gained = soaked && it.mass >= heavyMass
          ? Math.round(it.val * BALANCE.mop.valueMult) : it.val;
        // puff: vacuuming it splits it into 3 smaller motes (the cleaning makes work)
        if (it.type === 'puff') {
          gained = 0;
          for (let k = 0; k < 3; k++) {
            const a = Math.random() * 6.283, d = 0.6 + Math.random() * 0.8;
            this._spawnPiece(it.x + Math.cos(a) * d, it.y + Math.sin(a) * d, 'dust', 1);
          }
        }
        this.items.splice(i, 1);
        this._free.push(it);
        this._collected(it, bot, stats, cb, gained);
        continue;
      }
      it.phase += dt * 2;
    }
    this.dragMass = dragMass; // game.js: bot.speedMult = motor/(motor + cost*dragMass)
  }

  _collected(it, bot, stats, cb, gained) {
    bot.addDust(1);
    const g = gained ?? it.val;
    if (it.type === 'gold') cb.onGold && cb.onGold();
    else cb.onSuck && cb.onSuck(it.type);
    cb.onCollect && cb.onCollect(g, it);
  }

  // Theme-aware mote colors.
  _colors(type) {
    const d = (this.theme && this.theme.dirt) || PAL;
    const map = {
      dust:   { col: d.dust,   hi: d.shine, },
      big:    { col: d.big,    hi: d.shine, },
      debris: { col: d.debris, hi: d.big,   },
      gold:   { col: d.gold,   hi: d.shine, },
      static: { col: d.staticCh, hi: '#ffffff' },
      tar:    { col: d.tar,     hi: d.debris, },
      puff:   { col: d.puff,    hi: '#ffffff' },
    };
    return map[type] || map.dust;
  }

  draw(c) {
    for (const it of this.items) {
      const p = this.world.toScreen(it.x, it.y);
      const st = this._colors(it.type);
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
      // per-type details
      if (it.type === 'static') {
        // flickering spark cycling the four corners
        const k = Math.floor(it.phase * 1.5) % 4, q = Math.ceil(s / 3);
        const cx = [x + q - 2, x + s - q - 1, x + s - q - 1, x + q - 2][k];
        const cy = [y + q - 2, y + q - 2, y + s - q - 1, y + s - q - 1][k];
        c.fillStyle = '#ffffff';
        c.fillRect(cx, cy, 2, 2);
      } else if (it.type === 'tar') {
        // glossy streak across the blob
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(x + Math.ceil(s / 4), y + Math.ceil(s / 2) - 1, Math.ceil(s / 2), 2);
      } else if (it.type === 'puff') {
        // two fluffy bumps hugging the core
        const q = Math.ceil(s / 2);
        c.fillStyle = st.col;
        c.fillRect(x - q / 2 + 1, y + 1, q, q);
        c.fillRect(x + s - q + 1, y + 2, q, q);
      }
      // soaked (wet-floor) heavy mote: little blue droplet marker
      if (it.soaked) {
        c.fillStyle = PAL.blue;
        c.fillRect(x + Math.ceil(s / 2) - 1, y - 3, 3, 3);
      }
    }
  }
}
