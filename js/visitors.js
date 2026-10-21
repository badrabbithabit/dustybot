// js/visitors.js — wandering visitors (VISITORS_PLAN.md v1.2.0).
// People (and a rare Sasquatch) wander each level; touching one gets the bot
// picked up, carried off and partially spilled. Solid bodies (world.bodies),
// sticky feet relocate dirt (dust.takeNear/drop accounting per §4), and the
// spawn schedule is deterministic (makeRng/mix — no Math.random in schedule()).
//
// DOM-free: importable from plain node. audio.js defers its AudioContext until
// resumeAudio(), and every sfx no-ops while ctx is null, so the Audio calls
// below are safe headless (verified: import + sfx calls in node are inert).
import { BALANCE } from './upgrades.js';
import { GEN, makeRng, mix } from './levelgen.js';
import { shade, rr, ell, glowRadial } from './obstacles.js';
import * as Audio from './audio.js';

const V = BALANCE.visitors;
const TAU = Math.PI * 2;
const DOCK_MIN = 3.2; // keep clear of the dock (same rule as dust spawn)

// ---------------------------------------------------------------------------
// §1 Spawn schedule — deterministic in (level, runSeed).
//   humanStart: exactly one per 3-level theme block (slot 0/1/2),
//   sasquatch:  exactly one per 10-level window, mid-level only,
//   midHuman:   per-level roll, skipped when the Sasquatch owns that level.
// ---------------------------------------------------------------------------
export function schedule(level, runSeed = 0) {
  const block = Math.floor((level - 1) / 3), slot = (level - 1) % 3;
  const humanStart = Math.floor(makeRng(mix(runSeed, 7919 + 131 * block))() * 3) === slot;
  const win = Math.floor((level - 1) / 10), off = (level - 1) % 10;
  const sasquatch = Math.floor(makeRng(mix(runSeed, 104729 + 97 * win))() * 10) === off;
  const midHuman = !sasquatch && makeRng(mix(runSeed, 22471 + level))() < V.midChance;
  return { humanStart, sasquatch, midHuman };
}

// Placeholder palette for drawVisitor (a later worker replaces the art).
const THEME_BODY = {
  residential: '#8a6f5c', office: '#4a5a72', store: '#3f7a6a', space: '#9aa0a8',
};

function makeVisitor(kind, x, y, themeKey) {
  const sas = kind === 'sasquatch';
  return {
    kind, x, y,
    r: sas ? V.sasRadius : V.radius,
    speed: sas ? V.sasSpeed : V.humanSpeed,
    carrySpeed: sas ? V.sasCarrySpeed : V.carrySpeed,
    themeKey: themeKey || 'residential',
    state: 'walk',            // 'walk' | 'exit' | 'carry'
    target: null,             // walk target {x,y}
    life: V.lifeMin + Math.random() * (V.lifeMax - V.lifeMin), // §2 lifetime
    exitT: 0,                 // seconds spent walking out (exitCap)
    heading: Math.random() * TAU,
    walkPhase: 0,             // arm-swing phase for the art worker
    stuck: [],                // motes on the feet (snaps from takeNear)
    stickyCd: 0,              // sticky-feet roll cooldown
    dropAcc: 0,               // travelled distance since the last foot-drop roll
    stepT: 0,                 // footstep sfx throttle
    carry: null,              // { t, spillT, binAtGrab, spilled, target } while carrying
    _dead: false,
  };
}

export class Visitors {
  constructor(world, dust) {
    this.world = world;
    this.dust = dust;
    this.list = [];           // at most ONE live visitor (§1 one-at-a-time)
    this.plan = null;         // schedule() result for the current level
    this.themeKey = 'residential';
    this.levelT = 0;          // seconds since onLevelStart
    this._start = null;       // queued level-start spawn { kind, due, defer }
    this._mid = null;         // queued mid-level spawn  { kind, due, defer }
    this.immunityT = 0;       // post-drop / post-reset no-grab timer
    this.unplaced = 0;        // motes a despawn could not put back -> game credits them
    this.onEvent = null;      // (ev) => {} — {type:'spawn'|'grab'|'drop', kind, x, y}
  }

  // UI hooks live in game.js (toasts/banner), the module stays UI-free so it
  // stays testable and DOM-free.
  _emit(type, v, extra) {
    if (!this.onEvent) return;
    this.onEvent(Object.assign({ type, kind: v.kind, x: v.x, y: v.y }, extra || {}));
  }

  get carrying() { return this.list.some(v => v.state === 'carry'); }
  get immune() { return this.immunityT > 0; }

  // Clear everything (level change / menu). Carried motes are discarded ONLY
  // here — the level's dust is rebuilt by dust.spawnLevel (§2.5).
  reset() {
    this.list = [];
    if (this.world && this.world.bodies) this.world.bodies.length = 0;
    if (this.world) this.world.shakeT = 0;   // no shake leaking into menu/next level
    this.plan = null;
    this._start = null;
    this._mid = null;
    this.levelT = 0;
    this.immunityT = V.immunity.human; // short immunity so a reload can't insta-grab
    this.unplaced = 0;
  }

  // Queue this level's spawns. The actual spawn happens on the first update()
  // after this call (i.e. after the intro banner).
  onLevelStart(level, runSeed = 0, themeKey = 'residential') {
    this.themeKey = themeKey || 'residential';
    this.plan = schedule(level, runSeed);
    this.levelT = 0;
    this._start = null;
    this._mid = null;
    if (this.plan.humanStart) this._start = { kind: 'human', due: 0, defer: V.deferHuman };
    if (this.plan.sasquatch || this.plan.midHuman) {
      const kind = this.plan.sasquatch ? 'sasquatch' : 'human';
      const rng = makeRng(mix(runSeed, 51241 + level)); // deterministic spawn time
      const due = V.midTime[0] + rng() * (V.midTime[1] - V.midTime[0]);
      this._mid = { kind, due, defer: kind === 'sasquatch' ? V.deferSas : V.deferHuman };
    }
  }

  // One frame. game is the Game object (unused here; kept for the §8 wiring).
  update(dt, bot, game) {
    this.levelT += dt;
    if (this.immunityT > 0) this.immunityT = Math.max(0, this.immunityT - dt);

    // Queued spawns: at most one live visitor; a due spawn defers (human
    // deferHuman s, Sasquatch deferSas s) and is then skipped.
    for (const key of ['_start', '_mid']) {
      const p = this[key];
      if (!p || this.levelT < p.due) continue;
      if (this.list.length === 0) { this._trySpawn(p.kind, bot); this[key] = null; }
      else { p.defer -= dt; if (p.defer <= 0) this[key] = null; }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      v.age = (v.age || 0) + dt; // art: spawn fade-in clock (visual only)
      if (v.state === 'carry') this._updateCarry(v, dt, bot);
      else if (v.state === 'walk') this._updateWalk(v, dt, bot);
      else this._updateExit(v, dt, bot);
      if (v._dead) {
        // §4 invariant: drop stuck motes BEFORE despawning. Remove the body
        // first so dust.drop at the feet isn't blocked by the visitor itself.
        this.list.splice(i, 1);
        this._syncBodies();
        this._dropStuck(v);
      }
    }
    this._syncBodies();
  }

  // ------------------------------------------------------------------ spawn
  // §2.1 rejection-sampled free point: outside the dock strip, >= 3.2u from
  // the dock, >= minSpawnDistFromBot from the bot; skip after spawnTries.
  _trySpawn(kind, bot) {
    const sas = kind === 'sasquatch';
    const r = sas ? V.sasRadius : V.radius;
    const y0 = Math.max(GEN.STRIP_Y, r);
    const W = this.world.W, H = this.world.H;
    for (let k = 0; k < V.spawnTries; k++) {
      const x = r + Math.random() * (W - 2 * r);
      const y = y0 + Math.random() * (H - r - y0);
      if (!this.world.isFree(x, y, r + 0.3)) continue;
      if (Math.hypot(x - BALANCE.dock.x, y - BALANCE.dock.y) < DOCK_MIN) continue;
      if (bot && Math.hypot(x - bot.x, y - bot.y) < V.minSpawnDistFromBot) continue;
      this.list.push(makeVisitor(kind, x, y, this.themeKey));
      this._syncBodies();   // solid from the moment it appears, not next frame
      if (sas) Audio.sfx.roar();
      this._emit('spawn', this.list[this.list.length - 1]);
      return true;
    }
    return false; // no decent spot: skip the spawn rather than place it badly
  }

  // ---------------------------------------------------------------- movement
  // Axis-split step like bot._moveAxis: slide along furniture, never clip it.
  // Visitors never enter the dock strip; while the bot is immune they also keep
  // avoidR clear of it (§3 guardrail).
  _step(v, dx, dy, bot) {
    let moved = 0;
    for (const [axis, delta] of [['x', dx], ['y', dy]]) {
      if (Math.abs(delta) < 1e-4) continue; // ignore float noise
      const dir = Math.sign(delta);
      let remaining = Math.abs(delta);
      while (remaining > 1e-4) {
        const step = Math.min(0.1, remaining);
        const nx = axis === 'x' ? v.x + dir * step : v.x;
        const ny = axis === 'y' ? v.y + dir * step : v.y;
        if (ny < GEN.STRIP_Y) break; // never walk into the dock strip
        // The bot's circle is solid to the visitor whenever a grab is not the
        // intent: while immune, and on the way out (an exiting visitor must not
        // engulf the player — that would leave the bot inside a body and
        // world.isFree would trap it). Otherwise the overlap IS the grab (§5).
        if ((this.immune || v.state === 'exit') && bot
          && Math.hypot(nx - bot.x, ny - bot.y) < Math.max(V.avoidR, v.r + BALANCE.bot.radius)) break;
        // v._body is this visitor's own circle in world.bodies — excluded, or a
        // visitor would be walled in by itself and never move an inch.
        if (!this.world.isFree(nx, ny, v.r, v._body)) break;
        if (axis === 'x') v.x = nx; else v.y = ny;
        remaining -= step; moved += step;
      }
    }
    return moved;
  }

  _pickTarget(v) {
    const W = this.world.W, H = this.world.H;
    for (let k = 0; k < 12; k++) {
      const x = v.r + Math.random() * (W - 2 * v.r);
      const y = Math.max(GEN.STRIP_Y, v.r) + Math.random() * (H - v.r - Math.max(GEN.STRIP_Y, v.r));
      if (this.world.isFree(x, y, v.r)) return { x, y };
    }
    return { x: v.x, y: v.y };
  }

  // Nearest edge point below the dock strip (§2.4 exit target).
  _edgeTarget(v) {
    const m = v.r + 0.2;
    const cands = [
      { x: v.x, y: GEN.STRIP_Y },
      { x: m, y: Math.max(v.y, GEN.STRIP_Y) },
      { x: this.world.W - m, y: Math.max(v.y, GEN.STRIP_Y) },
      { x: v.x, y: this.world.H - m },
    ];
    let best = cands[0], bd = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.x - v.x, c.y - v.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _nearestMote(x, y, r) {
    let best = null, bd = r * r;
    for (const it of this.dust.items) {
      const dx = it.x - x, dy = it.y - y, d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = it; }
    }
    return best;
  }

  // ------------------------------------------------------------------- walk
  _updateWalk(v, dt, bot) {
    v.life -= dt;
    if (v.life <= 0) { v.state = 'exit'; v.exitT = 0; v.target = this._edgeTarget(v); return; }

    // §2.3 a nearby mote becomes the walk target (visitors drift toward dirt).
    const mote = this._nearestMote(v.x, v.y, V.trackR);
    if (mote) v.target = { x: mote.x, y: mote.y };
    else if (!v.target || Math.hypot(v.target.x - v.x, v.target.y - v.y) < 0.4) v.target = this._pickTarget(v);

    const dx = v.target.x - v.x, dy = v.target.y - v.y;
    const d = Math.hypot(dx, dy) || 1;
    const moved = this._step(v, (dx / d) * v.speed * dt, (dy / d) * v.speed * dt, bot);
    if (moved > 1e-4) {
      v.heading = Math.atan2(dy, dx);
      v.walkPhase += dt * 8;
      this._footstep(v, dt);
      this._feet(v, moved, dt);
    }

    // §5 grab: any overlap while walking and not immune.
    if (bot && !this.immune && Math.hypot(v.x - bot.x, v.y - bot.y) < v.r + BALANCE.bot.radius) {
      this._beginCarry(v, bot);
    }
  }

  _footstep(v, dt) {
    v.stepT += dt;
    if (v.stepT >= 0.4) { v.stepT = 0; Audio.sfx.footstep(); } // <= 2.5/s
  }

  // §4 sticky feet: pick up near the shoes, shed motes behind while walking.
  _feet(v, moved, dt) {
    v.stickyCd -= dt;
    if (v.stickyCd <= 0 && v.stuck.length < V.carryMax) {
      v.stickyCd = V.stickyCd; // cooldown gates the roll, hit or miss
      let hit = null, bd = Infinity;
      for (const it of this.dust.items) {
        const dist = Math.hypot(it.x - v.x, it.y - v.y);
        if (dist <= V.footR + it.r && dist < bd) { bd = dist; hit = it; }
      }
      if (hit && Math.random() < V.stickyChance) {
        const snap = this.dust.takeNear(v.x, v.y, V.footR + hit.r);
        if (snap) v.stuck.push(snap);
      }
    }
    v.dropAcc += moved;
    while (v.dropAcc >= V.dropDist) {
      v.dropAcc -= V.dropDist;
      for (let i = v.stuck.length - 1; i >= 0; i--) {
        if (Math.random() >= V.dropFrac) continue;
        const s = v.stuck[i];
        const bx = v.x - Math.cos(v.heading) * V.dropBack;
        const by = v.y - Math.sin(v.heading) * V.dropBack;
        if (this.dust.drop(bx, by, s.type, s.val)) v.stuck.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------- exit
  // `bot` is passed so the avoidR rule applies while leaving too: an exiting
  // Sasquatch (r 2 -> a 3u pin radius) must not walk the bot into a wall.
  _updateExit(v, dt, bot) {
    v.exitT += dt;
    const dx = v.target.x - v.x, dy = v.target.y - v.y;
    if (Math.hypot(dx, dy) < 0.5) { v._dead = true; return; }
    const d = Math.hypot(dx, dy) || 1;
    const sp = v.speed * V.exitSpeedMult * dt;
    const moved = this._step(v, (dx / d) * sp, (dy / d) * sp, bot);
    if (moved > 1e-4) { v.heading = Math.atan2(dy, dx); v.walkPhase += dt * 8; this._footstep(v, dt); }
    if (v.exitT >= V.exitCap) v._dead = true; // couldn't reach an edge: fade in place
  }

  // §4: every stuck mote goes back on the floor before the visitor leaves.
  _dropStuck(v) {
    for (const s of v.stuck) {
      if (this.dust.drop(v.x, v.y, s.type, s.val)) continue;
      // Nowhere to put it (tight corner, pool cap): the mote is gone, so it
      // must be CREDITED as cleared or the level could never reach
      // `_cleared >= dust.spawned` (dust.js conservation law). game.js picks
      // this up right after update().
      this.unplaced++;
    }
    v.stuck = [];
  }

  // ------------------------------------------------------- grab / carry / drop
  _beginCarry(v, bot) {
    v.state = 'carry';
    const sas = v.kind === 'sasquatch';
    v.carry = {
      t: 0, spillT: 0,
      binAtGrab: bot.bin || 0,
      spilled: 0,
      from: { x: bot.x, y: bot.y },   // where it stood when grabbed (was free)
      target: this._dropTarget(v),
    };
    Audio.sfx.grab();
    this._emit('grab', v, { bin: bot.bin || 0 });
    if (sas) {
      Audio.sfx.roar();
      this.world.shakeT = 0.6; // screen shake (§5)
      const n = V.sasBurst[0] + Math.floor(Math.random() * (V.sasBurst[1] - V.sasBurst[0] + 1));
      for (let i = 0; i < n; i++) this._spill(v, bot);
    }
  }

  _hand(v) {
    const d = v.r + 0.8; // hands reach in front of the body
    return { x: v.x + Math.cos(v.heading) * d, y: v.y + Math.sin(v.heading) * d };
  }

  // §5 drop target: carryDist away, free for the bot, outside the dock strip,
  // >= 3.2u from the dock. Re-roll up to 24 times, else drop at the feet.
  _dropTarget(v) {
    const sas = v.kind === 'sasquatch';
    const [d0, d1] = sas ? V.sasCarryDist : V.carryDist;
    const R = BALANCE.bot.radius + 0.2;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * TAU, d = d0 + Math.random() * (d1 - d0);
      const x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d;
      if (y < GEN.STRIP_Y) continue;
      if (!this.world.isFree(x, y, R)) continue;
      if (Math.hypot(x - BALANCE.dock.x, y - BALANCE.dock.y) < DOCK_MIN) continue;
      return { x, y };
    }
    return { x: v.x, y: v.y };
  }

  _spill(v, bot) {
    const c = v.carry;
    if (!c || !bot || (bot.bin || 0) <= 0) return;
    const frac = v.kind === 'sasquatch' ? V.spillCapFrac.sas : V.spillCapFrac.human;
    if (c.spilled >= frac * c.binAtGrab) return;
    const h = this._hand(v);
    // drop FIRST; only credit the spill if a mote actually landed (pool cap /
    // blocked spot) — keeps dust.spawned and bot.bin in lockstep (§5).
    if (!this.dust.drop(h.x, h.y, 'dust', 1)) return;
    c.spilled++;
    bot.bin -= 1;
    if (bot.stats) bot.full = bot.bin >= bot.stats.binMax;
  }

  _updateCarry(v, dt, bot) {
    const c = v.carry;
    const sas = v.kind === 'sasquatch';
    c.t += dt; c.spillT += dt;

    const dx = c.target.x - v.x, dy = c.target.y - v.y;
    const d = Math.hypot(dx, dy);
    let moved = 0;
    if (d > 0.3) {
      const sp = v.carrySpeed * dt;
      moved = this._step(v, (dx / d) * sp, (dy / d) * sp, null);
      v.heading = Math.atan2(dy, dx);
      v.walkPhase += dt * 8;
    }
    // pin the bot to the hands; input is zeroed by game.js via `carrying`.
    // Clamped to the arena: the hands sit 0.8 u AHEAD of the visitor's centre,
    // so at a wall the dangled bot would otherwise poke through the boundary.
    const h = this._hand(v);
    const R = BALANCE.bot.radius;
    const px = Math.min(BALANCE.arena.w - R, Math.max(R, h.x));
    const py = Math.min(BALANCE.arena.h - R, Math.max(R, h.y));
    // Only drag the bot somewhere it could legally stand. The visitor path-
    // checks its OWN body (r 1.1); the bot hangs 0.8 u ahead of the hands, so
    // a desk or crate can sit exactly where the bot would be pinned. Park it
    // instead of phasing it through furniture (soak caught this).
    if (this.world.isFree(px, py, R)) { bot.x = px; bot.y = py; }
    bot.vx = 0; bot.vy = 0;

    const si = sas ? V.spillInterval.sas : V.spillInterval.human;
    while (c.spillT >= si) { c.spillT -= si; this._spill(v, bot); }
    if (moved > 1e-4) this._footstep(v, dt);

    const cap = sas ? V.carryCap.sas : V.carryCap.human;
    if (c.t >= cap) this._dropBot(v, bot, true);
    else if (d <= 0.6) this._dropBot(v, bot, false);
  }

  // Ring search for a free floor spot. The final `return {x, y}` hands back the
  // origin when NOTHING in the arena is free — callers must re-check (see
  // _dropBot's use of `carry.from`).
  _nearestFree(x, y, r) {
    if (this.world.isFree(x, y, r) && y >= GEN.STRIP_Y) return { x, y };
    for (let ring = 1; ring <= 24; ring++) {
      const rad = ring * 0.5;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
        if (py >= GEN.STRIP_Y && this.world.isFree(px, py, r)) return { x: px, y: py };
      }
    }
    return { x, y };
  }

  _dropBot(v, bot, atCap) {
    const c = v.carry;
    // Set the bot DOWN clear of the visitor's own body: dropping it at
    // c.target would put the bot centre under the visitor, and every
    // bot._moveAxis step would then fail isFree (the visitor is solid) until
    // it wandered off — ~1.3 s of helpless player after EVERY carry.
    let p = this._setDownSpot(v, atCap ? { x: v.x, y: v.y } : c.target);
    // Last resort: `_nearestFree` can in principle still hand back a blocked
    // point (a visitor wedged in a pocket tighter than any free spot in the
    // arena — unreachable with levelgen's 2 u corridors, but never leave the
    // bot inside a solid body). The grab position was free by definition.
    if (!this.world.isFree(p.x, p.y, BALANCE.bot.radius + 0.2) &&
        this.world.isFree(c.from.x, c.from.y, BALANCE.bot.radius + 0.2)) p = c.from;
    bot.x = p.x; bot.y = p.y; bot.vx = 0; bot.vy = 0;
    this.immunityT = v.kind === 'sasquatch' ? V.immunity.sas : V.immunity.human;
    Audio.sfx.drop();
    this._emit('drop', v, { atCap, spilled: c ? c.spilled : 0 });
    v.carry = null;
    // resume walking, or leave if the lifetime already ran out (§5)
    if (v.life <= 0) { v.state = 'exit'; v.exitT = 0; v.target = this._edgeTarget(v); }
    else v.state = 'walk';
  }

  // A free spot for the bot at `v.r + BOT_R + 0.4` from the visitor (so the
  // two bodies never overlap), biased toward where the visitor was walking.
  // world.isFree already sees world.bodies, so the visitor's own body is
  // excluded automatically.
  _setDownSpot(v, target) {
    const R = BALANCE.bot.radius;
    const clear = v.r + R + 0.4;
    const a0 = Math.atan2(target.y - v.y, target.x - v.x);
    for (let k = 0; k < 16; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.45;
      const x = v.x + Math.cos(a) * clear, y = v.y + Math.sin(a) * clear;
      if (y < GEN.STRIP_Y) continue;
      if (!this.world.isFree(x, y, R + 0.2)) continue;
      if (Math.hypot(x - BALANCE.dock.x, y - BALANCE.dock.y) < DOCK_MIN) continue;
      return { x, y };
    }
    return this._nearestFree(v.x, v.y, R + 0.2);
  }

  // §3 solidity: one {x,y,r} entry per live visitor, synced every frame.
  _syncBodies() {
    const b = this.world.bodies;
    if (!b) return;
    b.length = 0;
    for (const v of this.list) {
      // One stable object per visitor: _step passes it as world.isFree's
      // `ignore` argument (identity comparison), so it must not be rebuilt.
      const body = v._body || (v._body = { x: v.x, y: v.y, r: v.r });
      body.x = v.x; body.y = v.y; body.r = v.r;
      b.push(body);
    }
  }

  // Illustrated people (§6); the fade/alpha lives in drawVisitor.
  draw(c) {
    for (const v of this.list) drawVisitor(c, v, this.world, this);
  }
}

// ---------------------------------------------------------------------------
// Art (VISITORS_PLAN.md §6) — five illustrated top-down people, drawn in CSS
// pixels from world.toScreen(). Pattern follows bot.draw: shadow ellipse (a
// little +y) -> translate(toScreen) -> rotate(heading) -> torso/shoulders along
// local +X (visitor heading is atan2(dy,dx)) -> arms swinging on walkPhase
// (opposite phase) -> head/hair/helmet. Plain fills/strokes/ellipses/paths
// only (no filters, no text metrics) so it renders against a bare 2D context.
// ---------------------------------------------------------------------------

const SKIN = '#e8c9a0';
const THEME_HAIR = {
  residential: '#4a3526', office: '#2f2a26', store: '#5b3a22', space: '#243043',
};
const MOTE_DOT = {
  gold: '#f5c542', debris: '#7a5b3a', tar: '#2c2a33', big: '#a89c86',
  static: '#9fb6d4', puff: '#cfc7b8', dust: '#8d8478',
};

// Two arms as small ellipses; one leads, one follows (opposite walkPhase).
// While carrying, both reach forward toward the hands (_hand direction).
function drawArms(c, r, sw, carry, handX, sleeve, hand) {
  for (const side of [-1, 1]) {
    const ph = side * sw;
    const ax = carry ? handX : r * 0.16 + ph * r * 0.34;
    const ay = carry ? side * r * 0.26 : side * r * 0.54;
    ell(c, ax, ay, r * 0.2, r * 0.15, sleeve);
    ell(c, ax + r * 0.1, ay, r * 0.1, r * 0.09, hand);
  }
}

// Two shoes peeking out of the hem, alternating with the gait.
function drawShoes(c, r, sw, col, edge) {
  for (const side of [-1, 1]) {
    ell(c, -r * 0.5 + side * sw * r * 0.16, side * r * 0.26, r * 0.2, r * 0.13, col, edge, 1);
  }
}

// residential — houseperson: dressing gown, slippers, hair bun at the back.
function drawHouseperson(c, v, r, sw, bob, carry, handX) {
  const robe = THEME_BODY.residential;
  drawShoes(c, r, sw, '#cbb79f', '#8f7f6d');
  ell(c, bob, 0, r * 0.72, r * 0.6, robe, shade(robe, 0.6), 1.5);      // gown
  ell(c, bob + r * 0.36, 0, r * 0.24, r * 0.44, shade(robe, 0.82));    // shawl collar
  ell(c, bob - r * 0.06, 0, r * 0.08, r * 0.5, shade(robe, 1.16));     // centre fold
  drawArms(c, r, sw, carry, handX, shade(robe, 0.85), SKIN);
  ell(c, bob + r * 0.16, 0, r * 0.34, r * 0.34, SKIN, shade(THEME_HAIR.residential, 0.8), 1);
  ell(c, bob - r * 0.12, 0, r * 0.3, r * 0.3, THEME_HAIR.residential); // hair
  ell(c, bob - r * 0.4, 0, r * 0.15, r * 0.15, shade(THEME_HAIR.residential, 1.3), shade(THEME_HAIR.residential, 0.7), 1); // bun
}

// office — office worker: shirt, tie, coffee cup in the right hand.
function drawOfficeWorker(c, v, r, sw, bob, carry, handX) {
  const shirt = '#dfe6ef', tie = THEME_BODY.office;
  drawShoes(c, r, sw, '#22262c', '#0d1013');
  ell(c, bob, 0, r * 0.66, r * 0.55, shirt, shade(shirt, 0.68), 1.5);  // shirt
  ell(c, bob, 0, r * 0.4, r * 0.44, shade(shirt, 1.05));               // shoulder blades
  rr(c, bob - r * 0.02, -r * 0.09, r * 0.6, r * 0.18, r * 0.07);       // tie down the back
  c.fillStyle = tie; c.fill();
  drawArms(c, r, sw, carry, handX, shade(shirt, 0.86), SKIN);
  // coffee cup riding the right forearm
  const cx = (carry ? handX : r * 0.34) + r * 0.16, cy = r * 0.5;
  ell(c, cx, cy, r * 0.15, r * 0.15, '#f7fafc', '#94a3b8', 1);
  ell(c, cx, cy, r * 0.1, r * 0.1, '#3b2214');
  ell(c, bob + r * 0.14, 0, r * 0.33, r * 0.33, SKIN, shade(THEME_HAIR.office, 1.3), 1);
  ell(c, bob - r * 0.1, 0, r * 0.28, r * 0.29, THEME_HAIR.office);     // short hair
  ell(c, bob + r * 0.02, -r * 0.16, r * 0.16, r * 0.1, shade(THEME_HAIR.office, 1.4)); // side part
}

// store — shopper: baseball cap (brim forward) and a canvas tote bag.
function drawShopper(c, v, r, sw, bob, carry, handX) {
  const shirt = THEME_BODY.store, cap = '#b8532f';
  drawShoes(c, r, sw, '#f1f2f4', '#9aa0a8');
  ell(c, bob, 0, r * 0.68, r * 0.56, shirt, shade(shirt, 0.62), 1.5);  // jumper
  ell(c, bob + r * 0.3, 0, r * 0.2, r * 0.4, shade(shirt, 0.8));       // shoulder yoke
  drawArms(c, r, sw, carry, handX, shade(shirt, 0.88), SKIN);
  // tote bag hanging off the right arm, straps over the shoulder
  const bx = r * 0.3, by = r * 0.66;
  rr(c, bx - r * 0.2, by - r * 0.18, r * 0.4, r * 0.36, r * 0.06);
  c.fillStyle = '#d8c49a'; c.fill();
  c.strokeStyle = '#9c8763'; c.lineWidth = Math.max(1, r * 0.04); c.stroke();
  c.beginPath();
  c.arc(bx, by - r * 0.18, r * 0.13, Math.PI, TAU);
  c.stroke();
  c.fillStyle = '#7f8b6b'; c.fillRect(bx - r * 0.12, by - r * 0.1, r * 0.1, r * 0.1); // groceries
  ell(c, bob + r * 0.14, 0, r * 0.33, r * 0.33, THEME_HAIR.store);     // hair
  ell(c, bob + r * 0.16, 0, r * 0.29, r * 0.29, cap, shade(cap, 0.65), 1); // cap crown
  ell(c, bob + r * 0.44, 0, r * 0.13, r * 0.17, shade(cap, 0.8));      // brim forward
  ell(c, bob + r * 0.16, 0, r * 0.07, r * 0.07, shade(cap, 1.3));      // button
}

// space — astronaut: backpack, puffy suit, helmet ring with a dark visor.
function drawAstronaut(c, v, r, sw, bob, carry, handX) {
  const suit = '#e6e9ee', pack = THEME_BODY.space;
  rr(c, bob - r * 0.82, -r * 0.34, r * 0.42, r * 0.68, r * 0.1);       // life-support pack
  c.fillStyle = pack; c.fill();
  c.strokeStyle = shade(pack, 0.65); c.lineWidth = 1; c.stroke();
  ell(c, bob - r * 0.6, 0, r * 0.07, r * 0.07, '#38bdf8');             // status lamp
  ell(c, bob, 0, r * 0.72, r * 0.6, suit, shade(suit, 0.66), 1.5);     // suit torso
  ell(c, bob + r * 0.3, 0, r * 0.2, r * 0.42, shade(suit, 0.86));      // chest control panel base
  rr(c, bob + r * 0.22, -r * 0.12, r * 0.18, r * 0.24, r * 0.04);
  c.fillStyle = '#334155'; c.fill();
  drawArms(c, r, sw, carry, handX, shade(suit, 0.92), '#cfd6de');      // puffy sleeves
  ell(c, bob + r * 0.16, 0, r * 0.42, r * 0.42, '#cfd6de', shade(pack, 1.15), Math.max(1.5, r * 0.09)); // helmet ring
  ell(c, bob + r * 0.2, 0, r * 0.3, r * 0.3, '#22303f');               // visor
  ell(c, bob + r * 0.28, -r * 0.08, r * 0.11, r * 0.06, 'rgba(255,220,140,0.55)'); // gold sheen
}

// any theme — Sasquatch: ~2x radius, dark shaggy fur, huge shoulders, glow eyes.
function drawSasquatch(c, v, r, sw, bob, carry, handX) {
  const fur = '#3d2b1f', furDk = '#2a1d14';
  drawShoes(c, r, sw, furDk, '#1a1109');
  // shaggy mantle: radiating tufts under the shoulders
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.3;
    ell(c, bob + Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.64, r * 0.14, r * 0.1, shade(fur, 0.78));
  }
  ell(c, bob, 0, r * 0.8, r * 0.72, fur, furDk, 2);                    // huge shoulders
  ell(c, bob + r * 0.1, 0, r * 0.5, r * 0.5, shade(fur, 1.14));        // shoulder hump
  for (const side of [-1, 1]) {                                       // long, thick arms
    const ph = side * sw;
    const ax = carry ? handX : r * 0.2 + ph * r * 0.32;
    ell(c, ax, side * r * 0.74, r * 0.26, r * 0.2, fur, furDk, 1);
    ell(c, ax + r * 0.16, side * r * 0.74, r * 0.13, r * 0.11, shade(furDk, 1.2));
  }
  ell(c, bob + r * 0.36, 0, r * 0.34, r * 0.32, furDk, '#1a1109', 1.5); // low head
  ell(c, bob + r * 0.52, 0, r * 0.2, r * 0.11, shade(furDk, 1.35));     // brow ridge
  for (const side of [-1, 1]) {                                        // glowing eyes
    const ex = bob + r * 0.46, ey = side * r * 0.13;
    glowRadial(c, ex, ey, r * 0.02, r * 0.16, 'rgba(255,96,40,0.75)', 'rgba(255,96,40,0)');
    ell(c, ex, ey, r * 0.06, r * 0.05, '#ff8a4a');
  }
}

const VIS_DRAW = {
  residential: drawHouseperson, office: drawOfficeWorker,
  store: drawShopper, space: drawAstronaut,
};

function drawVisitor(c, v, world, vis) {
  const s = world.scale || 1;
  const p = world.toScreen(v.x, v.y);
  const r = v.r * s;
  const sas = v.kind === 'sasquatch';

  // Fade: 0.35 s in on spawn, out over the last 0.5 s of the exit walk (or as
  // it steps off the edge / despawns). Purely visual — the body stays solid.
  let a = Math.min(1, (v.age || 0) / 0.35);
  if (v.state === 'exit') {
    const left = Math.max(0, V.exitCap - v.exitT);
    const near = v.target ? Math.hypot(v.target.x - v.x, v.target.y - v.y) : 99;
    a = Math.min(a, left / 0.5, near / 1.5);
  }
  if (v._dead) a = 0;
  a = Math.max(0, Math.min(1, a));
  if (a <= 0.01) return;

  c.save();
  c.globalAlpha = a;

  // ground shadow, offset a little +y (same read as bot.draw)
  c.fillStyle = 'rgba(0,0,0,0.30)';
  c.beginPath();
  c.ellipse(p.x, p.y + r * 0.5, r * (sas ? 1.05 : 0.95), r * (sas ? 0.56 : 0.5), 0, 0, TAU);
  c.fill();
  if (sas) glowRadial(c, p.x, p.y, r * 0.3, r * 1.7, 'rgba(150,80,30,0.22)', 'rgba(150,80,30,0)');

  // two-frame gait bob + where the hands are while carrying the bot
  const sw = Math.sin(v.walkPhase);
  const bob = (sw >= 0 ? 1 : -1) * r * 0.05;
  const carry = v.state === 'carry';
  let handX = r * 0.8;
  if (carry) {
    const h = vis && vis._hand ? vis._hand(v)
      : { x: v.x + Math.cos(v.heading) * (v.r + 0.8), y: v.y + Math.sin(v.heading) * (v.r + 0.8) };
    handX = (h.x - v.x) * s * Math.cos(v.heading) + (h.y - v.y) * s * Math.sin(v.heading);
  }

  c.save();
  c.translate(p.x, p.y);
  c.rotate(v.heading); // visitor heading is atan2(dy,dx) -> forward is local +X
  (sas ? drawSasquatch : (VIS_DRAW[v.themeKey] || drawHouseperson))(c, v, r, sw, bob, carry, handX);
  c.restore();

  // sticky feet (§4): a mote or two riding the shoes
  if (v.stuck && v.stuck.length) {
    for (let i = 0; i < Math.min(2, v.stuck.length); i++) {
      c.fillStyle = MOTE_DOT[v.stuck[i].type] || MOTE_DOT.dust;
      c.beginPath();
      c.arc(p.x + (i ? r * 0.42 : -r * 0.42), p.y + r * 0.52, Math.max(1.2, r * 0.11), 0, TAU);
      c.fill();
    }
  }

  // Sasquatch warning: a red "!" above the head (drawn with paths, no text)
  if (sas) {
    const w = Math.max(2, r * 0.11), hgt = Math.max(6, r * 0.46);
    c.fillStyle = '#ff4040';
    c.fillRect(p.x - w / 2, p.y - r * 1.3 - hgt, w, hgt);
    c.beginPath();
    c.arc(p.x, p.y - r * 1.3 + w * 0.8, w * 0.7, 0, TAU);
    c.fill();
  }

  c.globalAlpha = 1; // the bare 2D stack may be shallow; be explicit
  c.restore();
}
