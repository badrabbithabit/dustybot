// bot.js — the robot vacuum, top-down 2D sprite + movement. No health/battery;
// it has a dust bin (clogs when full) and a boost with cooldown.
// Each bot (see BOTS in upgrades.js) has its own look, drawn in drawBot_*.
import { BALANCE, BOTS } from './upgrades.js';
import { PAL } from './palette.js';

export class Bot {
  constructor(world, stats) {
    this.world = world;
    this.stats = stats;
    this.botId = stats.bot || 'roomba';
    this.botDef = BOTS[this.botId] || BOTS.roomba;
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
    this._spinDir = 1;      // alternates which side a head-on bounce rolls off
    this._bounceCd = 0;     // s until the next bounce may re-arm (anti machine-gun)
    this._bounceTarget = null; // reflected heading to steer toward while touching wall
    this._bounceInput = null;  // "x,y" string of the stick that caused the hit
    this._clearFrames = 0;    // consecutive frames the bot has been off the wall
    this._wasClear = true;    // was not touching a wall last frame (edge detect)
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
    if (Math.abs(delta) < 1e-4) return; // ignore float noise (e.g. cos(90deg)!=0)
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
    if (moved < Math.abs(delta) - 1e-4) {
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
    this._nx = 0; this._ny = 0;
    this._moveAxis('x', this.vx * dt);
    this._moveAxis('y', this.vy * dt);

    // Wall bounce (Roomba-style reflection). On a FRESH impact, compute the
    // mirror-reflection heading and steer toward it. The bounce stays active
    // for as long as the bot is touching the wall — so the held "up" input
    // doesn't yank the heading back into the wall and cause wiggling. The
    // moment the bot rolls clear of the wall, control returns to the stick.
    // If the player changes their input direction mid-bounce, we also drop the
    // bounce immediately and follow the new direction.
    const freshTouch = this._hitWall && this._wasClear;
    this._wasClear = !this._hitWall;
    this._bounceCd = Math.max(0, this._bounceCd - dt);

    if (freshTouch && mag > 0.1 && this._bounceCd <= 0) {
      const ivx = Math.sin(this.heading), ivy = -Math.cos(this.heading);
      const dot = ivx * this._nx + ivy * this._ny;
      let rx = ivx - 2 * dot * this._nx;
      let ry = ivy - 2 * dot * this._ny;
      let bounceH = Math.atan2(rx, -ry);
      // Near head-on: roll off at 45deg from normal instead of a hard reversal
      let dh = bounceH - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(dh) > Math.PI / 3) {
        const nAngle = Math.atan2(this._nx, -this._ny);
        bounceH = nAngle + this._spinDir * (Math.PI / 4);
        this._spinDir *= -1;
      }
      this._bounceTarget = bounceH;
      this._bounceInput = ix + ',' + iy;
      this._bounceCd = 0.3;
    }
    // Drop the bounce once the bot has been clear of the wall for a few frames
    // (filters out per-frame contact flickering) or if the player changed their
    // input direction.
    if (this._bounceTarget != null) {
      this._clearFrames = this._hitWall ? 0 : this._clearFrames + 1;
      if (this._clearFrames >= 3 || this._bounceInput !== (ix + ',' + iy)) {
        this._bounceTarget = null;
        this._bounceInput = null;
        this._clearFrames = 0;
      }
    }

    // steer: bounce heading wins while touching the wall; otherwise follow input.
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
    switch (this.botDef.shape) {
      case 'lidar': this._drawMi(c, R); break;
      case 'shark': this._drawShark(c, R); break;
      default: this._drawRoomba(c, R);
    }
    c.restore();
  }

  // shared: the spinning side brushes in front of the body (heading 0 = -Y)
  _drawBrushes(c, R, count) {
    const bl = this.stats.brushLevel || 0;
    if (bl <= 0 || count === 0) return;
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

  // shared: top highlight glint for the round bodies
  _drawGlint(c, R) {
    c.beginPath();
    c.arc(-R * 0.25, -R * 0.1, R * 0.45, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fill();
  }

  // ---- iRobot Roomba: classic red disc, front IR bump, two side brushes ----
  _drawRoomba(c, R) {
    const col = this.botDef.colors;
    const body = this.full ? col.bodyDk : col.body;
    this._drawBrushes(c, R, 2);
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = col.rim; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.92, 0, Math.PI * 2); c.fillStyle = body; c.fill();
    // front bumper arc
    c.beginPath(); c.arc(0, 0, R * 0.92, Math.PI * 1.15, Math.PI * 1.85);
    c.strokeStyle = col.rim; c.lineWidth = Math.max(2, R * 0.14); c.stroke();
    // front "eye" bump + status LED
    c.beginPath(); c.arc(0, -R * 0.5, R * 0.34, 0, Math.PI * 2); c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1, R * 0.05); c.stroke();
    c.beginPath(); c.arc(0, -R * 0.5, Math.max(1.5, R * 0.10), 0, Math.PI * 2);
    c.fillStyle = this.full ? PAL.danger : PAL.blue; c.fill();
    // rear charge contacts (two little pads)
    c.fillStyle = col.rim;
    c.fillRect(-R * 0.22, R * 0.72, R * 0.16, R * 0.12);
    c.fillRect(R * 0.06, R * 0.72, R * 0.16, R * 0.12);
    this._drawGlint(c, R);
  }

  // ---- Xiaomi Mi: blue slim disc with a round LiDAR turret, two brushes ----
  _drawMi(c, R) {
    const col = this.botDef.colors;
    const body = this.full ? col.bodyDk : col.body;
    this._drawBrushes(c, R, 2);
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = col.rim; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.94, 0, Math.PI * 2); c.fillStyle = body; c.fill();
    // LiDAR turret (rotates with the brush spin = it's spinning as it scans)
    c.save();
    c.translate(0, 0);
    c.beginPath(); c.arc(0, 0, R * 0.46, 0, Math.PI * 2); c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1, R * 0.05); c.stroke();
    c.rotate(this._brush * 2);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(R * 0.40, 0);
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1.5, R * 0.07); c.stroke();
    c.beginPath(); c.arc(R * 0.40, 0, R * 0.08, 0, Math.PI * 2);
    c.fillStyle = this.full ? PAL.danger : PAL.ok; c.fill();
    c.restore();
    // slim front bumper strip
    c.beginPath(); c.arc(0, 0, R * 0.94, Math.PI * 1.25, Math.PI * 1.75);
    c.strokeStyle = col.rim; c.lineWidth = Math.max(2, R * 0.10); c.stroke();
    this._drawGlint(c, R);
  }

  // ---- Shark: purple disc, big rear suction port, single brush, "hopper" band ----
  _drawShark(c, R) {
    const col = this.botDef.colors;
    const body = this.full ? col.bodyDk : col.body;
    this._drawBrushes(c, R, 1);
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = col.rim; c.fill();
    c.beginPath(); c.arc(0, 0, R * 0.94, 0, Math.PI * 2); c.fillStyle = body; c.fill();
    // "self-empty hopper" band across the middle (darker ring segment)
    c.beginPath(); c.arc(0, 0, R * 0.94, -0.5, 0.5);
    c.lineTo(0, 0); c.closePath();
    c.fillStyle = col.rim; c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1;
    // big round suction port at the back (it faces the way it came from)
    c.beginPath(); c.arc(0, R * 0.42, R * 0.40, 0, Math.PI * 2);
    c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1.5, R * 0.06); c.stroke();
    c.beginPath(); c.arc(0, R * 0.42, R * 0.16, 0, Math.PI * 2);
    c.fillStyle = col.domeHi; c.fill();
    // small front sensor eye
    c.beginPath(); c.arc(0, -R * 0.62, R * 0.16, 0, Math.PI * 2);
    c.fillStyle = col.dome; c.fill();
    c.strokeStyle = col.domeHi; c.lineWidth = Math.max(1, R * 0.04); c.stroke();
    c.beginPath(); c.arc(0, -R * 0.62, Math.max(1, R * 0.07), 0, Math.PI * 2);
    c.fillStyle = this.full ? PAL.danger : PAL.blue; c.fill();
    this._drawGlint(c, R);
  }
}
