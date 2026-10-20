# VISITORS_PLAN.md — Wandering Visitors feature spec (v1.2.0)

New feature: **wandering visitors** — people (and a rare Sasquatch) who walk
through a level. If the bot bumps into one, the visitor **picks the bot up and
carries it to a random spot**, spilling part of the bin on the way.

This file is the contract for the implementation. `js/upgrades.js` (`BALANCE`)
stays the single source of truth for numbers — the visitor numbers live in
`BALANCE.visitors`.

## 1. Spawn schedule (deterministic, seeded by the run seed)

| What | When |
|---|---|
| **Human, at level start** | exactly **one per 3-level theme block**: roll `rngInt(mix(runSeed, 7919 + 131*block), 3)` → the slot (0/1/2) inside the block gets the start spawn. `block = floor((level-1)/3)`, `slot = (level-1)%3`. |
| **Sasquatch, mid-level** | exactly **one per 10-level window**, and it **only ever appears mid-level** (never at level start): roll `rngInt(mix(runSeed, 104729 + 97*win), 10)` → the offset inside the window. `win = floor((level-1)/10)`, `off = (level-1)%10`. |
| **Human, mid-level** | one roll per level: `rng(mix(runSeed, 22471 + level)) < BALANCE.visitors.midChance` (0.22). **Max one mid-level visitor per level** — if the Sasquatch is scheduled for that level, the mid-level human roll is skipped. |

- Pure exported function: `schedule(level, runSeed = 0) -> { humanStart, sasquatch, midHuman }` (booleans).
  Uses `makeRng`/`mix` from `js/levelgen.js` (no `Math.random`, so tests and
  `tools/sim-*.mjs` stay reproducible).
- Mid-level spawn time: `rng`-picked `midTime[0]..midTime[1]` seconds (6–40 s)
  after the level's `run` state starts.
- **One visitor at a time.** If a visitor is present when a spawn is due, defer
  it (Sasquatch up to 20 s, human up to 10 s), then skip it.

## 2. Visitor lifecycle

1. **Spawn** at a rejection-sampled free point: `world.isFree(x, y, r + 0.3)`,
   `y >= GEN.STRIP_Y` (never in the dock strip), ≥ 3.2 u from the dock, ≥ 8 u
   from the bot, ≤ 60 tries (then skip the spawn rather than place it badly).
2. **Wander** (`lifeMin..lifeMax` = 10–15 s, rolled per visitor): pick a random
   free walk target, walk to it, pick another. Speed `humanSpeed` 1.6 u/s
   (Sasquatch 1.4). Movement uses the same axis-split + `world.isFree` step as
   `bot._moveAxis`, so visitors slide along furniture and never clip it.
3. **Tracks motes**: if a mote is within `trackR` (7 u) the walk target is that
   mote (they drift toward dirt — this is what makes them findable).
4. **Exit**: when the lifetime expires, target the nearest arena edge point,
   walk there at `speed * exitSpeedMult`, and despawn on arrival (fade out).
   If it cannot reach an edge within `exitCap` (6 s) more, fade out in place.
   **Any mote stuck to its feet must be dropped before despawn** (see §4).
5. `reset()` on level change clears visitors and `world.bodies` (the level's
   dust is rebuilt by `dust.spawnLevel`, so carried motes are simply discarded
   there — that is the only place discarding is allowed).

## 3. Solidity

- `World` gains `this.bodies = []` — moving circular bodies `{x, y, r}`.
  `World.blocked(x, y, pad)` tests them in addition to obstacle rects, so
  `isFree`, `bot._moveAxis`, `dust` spawn sampling and `steer()` all treat a
  visitor as solid automatically.
- Visitors are **solid** (confirmed). Two guardrails against pinning the bot:
  - any overlap triggers the grab anyway (§5), and
  - while the bot's immunity timer is active, a visitor never paths to within
    `avoidR` (2.5 u) of the bot.
- Visitors must never enter the dock strip (`y < GEN.STRIP_Y`) — the player has
  to be able to reach the dock.

## 4. Sticky feet (visitors relocate dirt)

- When a visitor's centre is within `mote.r + footR` (footR 0.55) of a mote,
  `stickyChance` (8%, cooldown `stickyCd` 1.2 s, at most `carryMax` = 2 motes
  stuck at a time) sticks it to their shoe: `dust.takeNear()` removes it from
  the floor **without** crediting `_cleared`.
- While walking, every `dropDist` (0.8 u) travelled, each stuck mote has
  `dropFrac` (25%) chance to fall off `dropBack` (1–3 u) behind the visitor.
- **CONSERVATION LAW (the invariant everything else obeys):**

  ```
  dust.spawned == motes on the floor + motes stuck to a visitor + bot.bin + game._cleared
  ```

  The level clears on `_cleared >= dust.spawned`, so every mote the level ever
  spawned has to end up dumped at the dock. Therefore:
  - `dust.drop()` RELOCATES an existing mote and must **not** bump `spawned`
    (only genuinely new motes — `_spawnOne`, puff splinters — raise the total);
  - a mote taken by `takeNear` is always re-placed with `drop()` before the
    visitor despawns;
  - if a despawn cannot place it (tight corner / pool cap) it is counted in
    `visitors.unplaced` and game.js credits it to `_cleared`.
  A mote may move; it may never simply vanish, or the level can never clear
  (and there is no fail state to rescue the run).

## 5. Grab → carry → drop

- **Trigger:** any overlap (`dist < visitor.grabR + BALANCE.bot.radius`) while
  the visitor is walking and the bot is not immune (`immunity` 3.5 s human /
  5 s Sasquatch, set on drop; also set on `reset()`).
- **During the carry:** player input is zeroed (`{x:0,y:0,boost:false,tap:null}`),
  the bot is pinned to the visitor's hands (`bot.x/bot.y` = hand point, so
  `bot.draw` renders it dangling in front of the arms), the visitor walks at
  `carrySpeed` (human 2.6, Sasquatch 1.9) toward a drop target
  `carryDist` away (human 8–14 u, Sasquatch 18–26 u).
- **Drop target validity:** `world.isFree(x, y, BOT_R + 0.2)`, outside the dock
  strip, ≥ 3.2 u from the dock, in-bounds. Re-roll up to 24 times; if none is
  found, drop at the visitor's own feet.
- **Set-down spot:** the bot is never set down *under* the visitor — visitors
  are solid, so a bot dropped at the visitor's centre cannot take a single step
  until the visitor wanders off. `_setDownSpot` places it `v.r + BOT_R + 0.4`
  away, biased toward the carry direction, validated with `world.isFree`
  (which already sees the visitor's body).
- **Hard cap:** `carryCap` (human 5 s, Sasquatch 9 s) — on expiry drop at the
  nearest free point immediately.
- **Bin spill (confirmed):** while carried, motes fall out of the bot's bin
  every `spillInterval` (human 1.2 s, Sasquatch 0.5 s), capped at
  `spillCapFrac` (40% / 60%) of the bin at grab time. Each spill =
  `dust.drop(...)` **then** `bot.bin -= 1` (skip both if the drop failed, e.g.
  pool cap / blocked). A spill only moves a mote from `bin` back onto the
  floor — `dust.spawned` is untouched, so the clear counter stays in lockstep.
- **Sasquatch extra consequence:** on grab it shakes the bot — an immediate
  burst of 2–4 spilled motes, a roar, a red `warn` toast, and a ~0.6 s screen
  shake (`world.shakeT`), plus the longer/farther carry above.
- After the drop: immunity, `bot.vx = bot.vy = 0`, input unlocked, toast.

## 6. Art (theme-tied, top-down, Canvas 2D only)

Four human designs, chosen by the level's `themeKey`, plus the Sasquatch:

| themeKey | design |
|---|---|
| residential | houseperson — robe, slippers, hair bun |
| office | office worker — shirt + tie, coffee cup |
| store | shopper — cap, tote bag |
| space | astronaut — helmet, backpack |
| (any) | **Sasquatch** — ~2× size, dark fur, glowing eyes, huge shoulders |

Draw pattern follows `bot.draw`: `dropShadow`/shadow ellipse →
`translate(toScreen)` → `rotate(heading)` → shoulders ellipse → swinging arms
(`walkPhase`) → head/hair/helmet → carried-mote dots at the feet when sticky
feet are loaded. Reuse `shade`, `rr`, `ell`, `dropShadow`, `glowRadial` from
`js/obstacles.js`. **Do not** add a kind to `KINDS`/`OB_DRAW` —
`test/obstacles.test.js` pins both at exactly 20.

Draw order in `world.render`: after `_drawDock`, **after** `dust.draw`,
**before** `bot.draw` (so a carried bot sits on top of the hands).

## 7. Audio (`js/audio.js`)

Add `footstep()` (soft throttled thud, ≤ 2.5/s per visitor), `grab()` (short
yelp), `roar()` (low growl for the Sasquatch), `drop()` (dull thud). Same
`blip`/`noise` synth style as the existing sfx.

## 8. Wiring (`js/game.js`)

- constructor: `this.visitors = new Visitors(this.world, this.dust)`.
- `loadLevel(n)`: `this.visitors.reset()` then
  `this.visitors.onLevelStart(n, this._runSeed, def.themeKey)`.
- `update(dt)`: after `dust.update(...)`, before the dock-dump block:
  `this.visitors.update(dt, this.bot, this)`.
- If `this.visitors.carrying`: feed zeroed input and **skip the dock dump
  check** (a carried bot must not dump itself).
- `toMenu()`/`newRun()`: `this.visitors.reset()`.
- The hangar idle scene and `tools/sim-*.mjs` do **not** get visitors.

## 9. Docs / release

- `PLAN.md`: a "Wandering visitors" section (schedule, carry, sticky feet).
- `js/help.js`: a new `VISITORS` section (help.test.js only asserts that
  GOAL/CONTROLS/DUST/SHARDS exist, so adding one is safe) + extend
  `test/help.test.js` to pin the new section.
- `REVIEW.md`: QA entry.
- Version: `node tools/bump-version.mjs 1.2.0` (four files, enforced by
  `test/version.test.js`).
- `npm test` gates the Pages deploy — all tests must pass before pushing.

## 10. Tests (`test/visitors.test.js`, no DOM, no `Date.now()`)

1. `schedule` is deterministic for the same `(level, runSeed)` and differs
   across seeds.
2. Over levels 1–300: exactly one `humanStart` per 3-level block, exactly one
   `sasquatch` per 10-level window, `sasquatch && midHuman` never both.
3. Spawn point is never inside an obstacle, never in the dock strip, ≥ 8 u
   from the bot (fake world object).
4. `world.bodies` makes `blocked()`/`isFree()` true over the visitor.
5. Sticky feet: `takeNear` + `drop` obey the §4 conservation law (count
   returns, `spawned` unchanged, the clear target stays reachable); a visitor
   despawning with a stuck mote drops it.
6. Carry: input lock, bin spill decrements bin by exactly the number of motes
   dropped, `spawned` unchanged, hard cap drops the bot, and the drop point is
   free, outside the dock strip **and clear of the visitor's own body**.
7. Immunity blocks an immediate re-grab and expires.
8. One visitor at a time; a deferred spawn is skipped after its cap.
9. Soak: 3 real generated layouts × 60 s with a wandering bot and a loaded
   bin — `floor + stuck + bin + credited == spawned` every frame, bin never
   negative, `spawned` never drifts, and the bot is never left standing inside
   a solid body.
