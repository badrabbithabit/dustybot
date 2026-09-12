// Steering AI — shared by the local sim (tools/sim-bots.mjs), the hangar
// auto-bay idle sim (js/hangar.js), and the debug trace tools.
// trace tools. The game itself uses human input; this is a stand-in player
// whose only job is to prove the levels are clearable at a reasonable pace.
//
// Strategy: aim at the target while the straight line (short of it) is clear.
// When an obstacle blocks that line, commit to a detour waypoint (a corner of
// the blocker) and keep aiming at it until the bot gets close to it or the
// target changes. The waypoint commitment is what stops the bot from
// re-planning every frame: without it the bot re-derives its decision from its
// current heading each tick, and near a corner that converges on a 180° flip
// (it sees the wall ahead, picks a perpendicular that's already blocked, and
// oscillates).
//
// Two refinements stop the two failure modes the naive "aim at the target,
// deflect locally" bot had:
//   • Oscillation on large obstacles — the gate check below.
//   • Refusing to enter narrow corridors — the two-tier local probe.
//
// A global grid pathfinder was tried and rejected: its BFS paths hug obstacles
// at cell resolution and the fast bots thrashed on constant re-planning, which
// made every scenario slower with more fails. The single-waypoint approach is
// slower in the worst pockets but never regresses the common case.
//
// Determinism: no Math.random — only the bot's own RNG (seeded in the sim).

import { BALANCE } from './upgrades.js';

export const R = BALANCE.bot.radius;
const APPROACH = 3.0;      // distance at which the direct aim takes over

// Liang-Barsky segment-vs-axis-aligned-rect test (true = the segment enters).
function segHitsRect(x0, y0, x1, y1, rx, ry, rw, rh) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rx, rx + rw - x0, y0 - ry, ry + rh - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

// True if the segment (x0,y0)->(x1,y1) is clear of every obstacle inflated by
// `r` (i.e. a bot of radius r can drive that straight line).
export function rayClear(world, x0, y0, x1, y1, r = R) {
  for (const o of world.obstacles)
    if (segHitsRect(x0, y0, x1, y1, o.x - r, o.y - r, o.w + 2 * r, o.h + 2 * r)) return false;
  return true;
}

// First obstacle whose inflated rect the segment clips (or null if clear).
export function firstBlocker(world, x0, y0, x1, y1, r = R) {
  for (const o of world.obstacles)
    if (segHitsRect(x0, y0, x1, y1, o.x - r, o.y - r, o.w + 2 * r, o.h + 2 * r)) return o;
  return null;
}

// Point on the segment (px,py)->(tx,ty) that is APPROACH short of the target;
// null when the target is already in the approach zone.
function gate(px, py, tx, ty) {
  const dx = tx - px, dy = ty - py;
  const d = Math.hypot(dx, dy);
  if (d <= APPROACH) return null;
  const t = (d - APPROACH) / d;
  return { x: px + dx * t, y: py + dy * t };
}

// The detour waypoint around `o`. Corners are scored by bot->corner +
// corner->target path length. Prefer the cheapest corner from which the TARGET
// is visible (the corner->target segment is clear): a corner whose line to the
// target is itself blocked means the bot commits to a point it can swing around
// but the target is still hidden from there, which stalls in corner pockets
// (the top-right corner of a cubicle with a wall behind it looks closest, but
// the target sits behind the cubicle from that corner). Fall back to the plain
// cheapest corner if none is visible — that is the common open case and is fast.
// (A corner under the bot's feet is left to the degenerate-aim guard in steer();
// a self-corner skip was tried and removed because it made the committed
// waypoint flip-flop. A reachability tier was also tried — it fixed one
// table-pocket spin but traded it for a new one, so it was dropped.)
export function detourWaypoint(world, bot, o, target, r = R) {
  const m = r + 0.5;
  const cs = [
    [o.x - m, o.y - m], [o.x + o.w + m, o.y - m],
    [o.x - m, o.y + o.h + m], [o.x + o.w + m, o.y + o.h + m],
  ];
  let best = null, bd = Infinity;
  let bestVis = null, bdv = Infinity;
  for (const [cx, cy] of cs) {
    if (!world.isFree(cx, cy, r)) continue;
    const c = Math.hypot(cx - bot.x, cy - bot.y) + Math.hypot(target.x - cx, target.y - cy);
    const cg = gate(cx, cy, target.x, target.y);
    if ((!cg || rayClear(world, cx, cy, cg.x, cg.y, r)) && c < bdv) { bdv = c; bestVis = { x: cx, y: cy }; }
    if (c < bd) { bd = c; best = { x: cx, y: cy }; }
  }
  return bestVis || best;
}

// Steer `bot` toward `target`, committing to a detour waypoint when the direct
// line is blocked. `ai` holds per-bot state ({wp, wpFor, ...}). Returns
// {input, d} where d is the straight-line distance to the ACTUAL target (so the
// caller's anti-stall logic still measures real progress).
export function steer(bot, world, target, ai, r = R) {
  const input = { x: 0, y: 0, boost: false, tap: null };
  if (!target) return { input, d: 0 };
  const d = Math.hypot(target.x - bot.x, target.y - bot.y);
  if (d <= 0.5) return { input, d };

  // Drop the committed waypoint if the target changed, the bot reached it, or
  // the bot is in the final-approach zone (direct aim takes over).
  if (ai.wp && (ai.wpFor !== target || d <= APPROACH ||
      Math.hypot(ai.wp.x - bot.x, ai.wp.y - bot.y) < 0.75)) ai.wp = null;

  const g = gate(bot.x, bot.y, target.x, target.y);
  let aim = target;
  if (ai.wp) {
    aim = ai.wp;
  } else if (g && !rayClear(world, bot.x, bot.y, g.x, g.y, r)) {
    const o = firstBlocker(world, bot.x, bot.y, g.x, g.y, r);
    if (o) {
      const wp = detourWaypoint(world, bot, o, target, r);
      if (wp) { ai.wp = wp; ai.wpFor = target; aim = wp; }
    }
  }

  // Degenerate aim (waypoint under the bot's feet): aim at the target instead.
  if (Math.hypot(aim.x - bot.x, aim.y - bot.y) < 0.25) aim = target;

  const dx = aim.x - bot.x, dy = aim.y - bot.y;
  let a = Math.atan2(dy, dx);
  // Local last-resort deflection for the final approach (sliding along an edge).
  // Two tiers:
  //   clear — a full 1.5u look-ahead is free (preferred: no wall contact).
  //   adv   — at least 0.7u of travel is free. The bot can still make
  //           progress and will slide; its collision substeps stop it at the
  //           surface. Without this tier the bot refuses to enter a narrow
  //           corridor: the 1.5u probe pokes through the far wall, so every
  //           direction reads "blocked" and the bot oscillates (down-left,
  //           then up, then down-left) instead of sliding in.
  const clear = (ang) => world.isFree(bot.x + Math.cos(ang) * 1.5, bot.y + Math.sin(ang) * 1.5, r);
  const adv = (ang) => world.isFree(bot.x + Math.cos(ang) * 0.7, bot.y + Math.sin(ang) * 0.7, r);
  if (!clear(a) && !adv(a)) {
    let best = null, bestSlide = null;
    for (const off of [0.55, -0.55, 1.1, -1.1, 1.75, -1.75, 2.4, -2.4, 3.0, -3.0]) {
      const ang = a + off;
      if (clear(ang)) { if (!best) best = ang; break; }
      if (adv(ang) && !bestSlide) bestSlide = ang;
    }
    a = best || bestSlide || a; // no free direction: hold (back-up handles it)
  }

  input.x = Math.cos(a);
  input.y = -Math.sin(a);
  return { input, d };
}
