// bot.js — the robot vacuum, top-down 2D sprite + movement. No health/battery;
// it has a dust bin (clogs when full) and a boost with cooldown.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';

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
    this._spinDir = 1;      // alternates each wall bounce: +1 ccw, -1 cw
    this._bounceTarget = null; // heading to turn toward while bouncing
    this._bounceN = null;   // normal of the surface we're bouncing off
    this._bounceCd = 0;     // s until the next bounce may re-arm (anti machine-gun)
    this._wasClear = true;  // was not touching a wall last frame (edge detect)
    this._nx = 0; this._ny = 0;
    this.onBoost = null;
    this._shadow = null;
  }

  addDust(n, xp) {
    this.bin = Math.min(this.stats.binMax, this.bin + n);
    this._dumpXp = (this._dumpXp || 0) + (xp || 0);
    this.full = this.bin >= BALANCE.bin.fullAt;
  }

  // Advance one axis, stopping at the first collision (bounds or obstacle) so
  // the bot slides along faces instead of cornering into them.
  _moveAxis(axis, delta) {
    if (delta === 0) return;
    const R = BALANCE.bot.radius;
    const dir = Math.sign(delta);
    let remaining = Math.abs(delta);
    let moved = 0;
    while (remaining > 1e-4) {
      const step = Math.min(0.1, remaining);
      const nx = axis === 'x' ? this.x + dir * step : this.x;
      const ny = axis === 'y' ? this.y + dir * step : this.y;
      if (this.world.isFree(nx, ny, R)) {
        if (axis === 'x') this.x = nx; else this.y = ny;
        remaining -= step; moved += step;
      } else {
        break; // hit a wall or obstacle face -> stop sliding this axis
      }
    }
    if (moved < Math.abs(delta)) {
      // we were blocked; kill velocity into the surface and record the
      // surface normal (points into the bot, i.e. "out of" the wall)
      if (axis === 'x') { this.vx = 0; this._nx = -dir; this._ny = 0; }
      else { this.vy = 0; this._nx = 0; this._ny = -dir; }
      this._hitWall = true;
    }
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

    // steering input
    let ix = input.x, iy = input.y;
    if (input.tap) {
      const dx = input.tap.x - this.x, dy = input.tap.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.6) { ix = dx / d; iy = dy / d; }
    }
    const mag = Math.min(1, Math.hypot(ix, iy));

    // boost
    this.boostCd = Math.max(0, this.boostCd - dt);
    const wantBoost = input.boost && this.boostCd === 0;
    if (wantBoost && !this.boosting) { this.boosting = true; this.onBoost && this.onBoost(); }
    if (!wantBoost) this.boosting = false;

    const clogWeight = this.full ? 1 / BALANCE.bin.clogWeightMult : 1;
    const speed = s.speed * (this.boosting ? BALANCE.bot.boostMult : 1) * clogWeight;

    // velocity from current heading, then integrate with collision
    this.vx = Math.sin(this.heading) * speed * mag;
    this.vy = -Math.cos(this.heading) * speed * mag;   // heading 0 = up on screen
    this._hitWall = false;
    this._moveAxis('x', this.vx * dt);
    this._moveAxis('y', this.vy * dt);

    // wall bounce (roomba-style): on a FRESH impact (was clear, now touching)
    // aim 45° off the surface normal — measured from the object hit — and steer
    // there at the bot's turn rate. The bounce ends as soon as the bot is no
    // longer touching the wall OR its heading is already pointing away from it,
    // so it gives one clean deflection and then normal control resumes. While
    // held against the same surface (still touching, same normal) it does NOT
    // re-arm — the existing slide (into-wall velocity zeroed in _moveAxis)
    // carries the bot along the wall instead of bouncing back and forth.
    const freshTouch = this._hitWall && this._wasClear;
    this._wasClear = !this._hitWall;
    // Only bounce on a glancing/impact hit. If the user is actively driving
    // INTO this wall (input has a component along the surface normal), don't
    // bounce — let the normal slide carry the bot along the wall instead. That
    // is what stopped the back-and-forth sway when held against a wall.
    this._bounceCd = Math.max(0, this._bounceCd - dt);
    if (freshTouch && mag > 0.1 && this._bounceCd <= 0) {
      this._bounceN = { x: this._nx, y: this._ny };
      const nAngle = Math.atan2(this._nx, -this._ny);
      this._bounceTarget = nAngle + this._spinDir * (Math.PI / 4);
      this._spinDir *= -1; // alternate which side of the normal we bail off
      this._bounceCd = 0.6; // s before another bounce may fire (prevents re-bounce sway)
    }
    // end the bounce once we've rolled off the surface or are pointing away
    if (this._bounceTarget != null) {
      const stillOn = this._hitWall && this._bounceN &&
        Math.abs(this._nx - this._bounceN.x) < 1e-6 &&
        Math.abs(this._ny - this._bounceN.y) < 1e-6;
      // heading's outward component vs the bounce normal
      const fwx = Math.sin(this.heading), fwy = -Math.cos(this.heading);
      const pointingAway = (fwx * this._bounceN.x + fwy * this._bounceN.y) > 0;
      if (!stillOn || pointingAway) this._bounceTarget = null;
    }

    // steer: an active bounce heading wins (so input can't yank us back into
    // the wall mid-deflection); otherwise follow user input. Both at turn rate.
    let steerTarget = null;
    if (this._bounceTarget != null) steerTarget = this._bounceTarget;
    else if (ix !== 0 || iy !== 0) steerTarget = Math.atan2(ix, iy);
    if (steerTarget != null) {
      let d = steerTarget - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = s.turnRate * dt;
      this.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
    }

    // spin: negative = counter-clockwise, the "right" way for a vac's brush
    // (sweeps dust IN toward the body instead of flinging it off)
    const spin = mag > 0 ? (this.boosting ? 30 : 14) : 2;
    this._brush -= dt * spin;
    return { moving: mag > 0.1, speed };
  }

  // Corner-brush sweep: motes within `reach` of the body (all around, since the
  // vac is a circle) get a tangential push that spirals them inward, like a
  // Roomba's side brush flinging dirt toward the center roller. Returns the
  // impulse (vx, vy) for a mote at (mx, my); zero if outside reach.
  brushSweep(mx, my, dt, bl) {
    const dx = mx - this.x, dy = my - this.y;
    const dist = Math.hypot(dx, dy);
    const reach = BALANCE.bot.radius * (1.6 + 0.12 * (bl || 0));
    if (dist > reach || dist < 0.25) return null;
    const t = dist / reach;                       // 0 at body -> 1 at reach edge
    const nx = dx / dist, ny = dy / dist;         // outward
    const sp = (1 - t * t) * 5.5 * dt;            // stronger closer to the body
    // tangential (perpendicular, counter-clockwise to match brush spin) + inward
    const tvx = -ny, tvy = nx;
    return { x: (tvx - nx * 0.7) * sp, y: (tvy - ny * 0.7) * sp };
  }

  draw(c) {
    const p = this.world.toScreen(this.x, this.y);
    const R = BALANCE.bot.radius * this.world.scale;
    // round blob shadow (offset down, like the bot sits on the floor)
    c.fillStyle = PAL.shadow;
    c.beginPath();
    c.ellipse(p.x, p.y + R * 0.45, R * 1.05, R * 0.55, 0, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(p.x, p.y);
    c.rotate(this.heading);
    // front spinning brush (heading 0 = forward = -Y); count 0/1/2, grows per level
    const bl = this.stats.brushLevel || 0;
    if (bl > 0) {
      const count = bl === 1 ? 1 : 2;
      const reach = R * (1.0 + 0.12 * bl);
      const br = R * 0.42;
      c.strokeStyle = PAL.gold;
      c.lineWidth = Math.max(2, R * 0.10);
      c.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const off = i === 0 ? -0.72 : 0.72;
        const cx = Math.sin(off) * reach;
        const cy = -Math.cos(off) * reach;
        c.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = this._brush + k * (Math.PI * 2 / 3);
          c.moveTo(cx, cy);
          c.lineTo(cx + Math.cos(a) * br, cy + Math.sin(a) * br);
        }
        c.stroke();
      }
      c.lineCap = 'butt';
    }
    // ---- round body (roomba-style disc) ----
    // outer dark rim
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fillStyle = PAL.accentOut;
    c.fill();
    // main coral body
    c.beginPath();
    c.arc(0, 0, R * 0.92, 0, Math.PI * 2);
    c.fillStyle = this.full ? PAL.accentDk : PAL.accent;
    c.fill();
    // front bumper: darker arc hugging the top (forward = -Y) edge
    c.beginPath();
    c.arc(0, 0, R * 0.92, Math.PI * 1.15, Math.PI * 1.85);
    c.strokeStyle = PAL.accentOut;
    c.lineWidth = Math.max(2, R * 0.14);
    c.stroke();
    // front dome (roomba "eye" bump) just inside the top edge
    c.beginPath();
    c.arc(0, -R * 0.5, R * 0.34, 0, Math.PI * 2);
    c.fillStyle = PAL.wall;
    c.fill();
    c.strokeStyle = PAL.accentHi;
    c.lineWidth = Math.max(1, R * 0.05);
    c.stroke();
    // status LED on the dome (blue = ok, red = full)
    c.beginPath();
    c.arc(0, -R * 0.5, Math.max(1.5, R * 0.10), 0, Math.PI * 2);
    c.fillStyle = this.full ? PAL.danger : PAL.blue;
    c.fill();
    // top highlight glint (upper-left, gives the disc some roundness)
    c.beginPath();
    c.arc(-R * 0.25, -R * 0.1, R * 0.45, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fill();
    c.restore();
  }
}
