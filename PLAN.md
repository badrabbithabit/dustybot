# Dusty Bot — 2D Roguelike Robot Vacuum

Web-based, mobile-first (phone portrait), hosted on GitHub Pages.
You are a little robot vacuum in a top-down 2D room full of dust. Vacuum
everything, dump your bin at the dock, pick 1 of 3 upgrades, go deeper.
There is **no failure mode** — a run ends when you walk away. A persistent
meta-currency ("Dust Shards" ✦) carries between runs for permanent upgrades,
plus idle/offline trickle channels (gated behind meta unlocks).

> This doc specs the **shipped implementation** (2D canvas). An earlier draft
> described a 3D/Three.js game with lives, battery and hazards — that design
> was dropped before launch. The idle/endless extension (6 bots, heavy-dust
> drag, mopping, new dirt types, auto-bay) is specced in `IDLE_PLAN.md` and
> is included below. **`js/upgrades.js` (`BALANCE`) is the single source of
> truth for every number** — if this doc and the code disagree, the code wins.

### Core loop (level-based, no failure)

```
[Menu] -> [Select bot] -> [Level 1 intro] -> PLAY -> level clear
                                             |        ^
                                             v        |
                                        [Pick 1 of 3 upgrades]
                                             (repeat; themes rotate every 3 levels)
```

- A **level** is one named room with a **fixed dirt budget** scattered at
  start. Motes do **not** regenerate. Clear the level by collecting every
  mote **and dumping the bin at the dock** (dirt counts as cleared only once
  it leaves the bin).
- On clear: `2 + 0.05·(level−1)` ✦ level bonus, then a 1-of-3 upgrade pick,
  then the next level. The upgrade pool never empties — every run upgrade is
  always a valid pick. Picks past the base tier get diminishing returns
  (strength tapers as `max/(lvl+1)`) with hard clamps keeping derived stats
  bounded.
- **The bin & the dock.** Motes you collect go into the bin. When
  `bin >= binMax` the bot **clogs**: suction is fully off, pickup is gated
  off, and speed is ÷1.25 (`BALANCE.bin.clogWeightMult`). The side brushes
  and magnet still push motes around, so a clogged bot can still finish a
  level — slowly. Drive over the **dock** (glowing ring, top-center) to dump.
- **Difficulty ramp (sawtooth):** the run is a pressure cycle — build to
  slightly-overpowered by each gear's end, then a hard spike at the next gear
  start (“work hard”), repeat. Dirt count: gentle within-gear ramp + hard jump
  per rotation: `ramp = 4*(level-1)`; if `ramp > 120`: `120 + (ramp-120)*0.3`;
  `dirt = min(300, 44 + rampEff + 26*rot)`. Heavy-mote share jumps `+5%` per
  gear. New dirt types SURGE at the gear start (first ~6 levels, e.g. static
  enters at 12% then settles to 5%). Shape measured by `tools/sim-run-curve.mjs`.
  Themes cycle residential → office → store → space, 3 rooms each;
  one difficulty “gear” per full rotation (12 levels, `gearUp` banner).

### Dust economy
- Mote types (spawn roll, `dust.js`): **dust** = 1 (common), **debris** = 2,
  **puff** = 2, **big** = 3, **static** = 3, **tar** = 4, **gold** = 5
  (chance `3% + Gold/Lucky Bristles`, clamped ≤ 0.5).
- Heavy-mote share (big+debris) climbs `26% + 5%/rotation`, cap 55%.
- New dirt types, hard-introduced per gear (steady shares of the roll, capped
  at 10/6/6%; each also gets a gear-start SURGE of +7/+6/+5% decaying over the
  first ~6 levels of every gear): ⚡ **static** (lv 13+, repels suction — brush/mop
  counters), 🟫 **tar** (lv 25+, mass 3.0, oozes at 0.15 u/s), ☁️ **puff** (lv 37+,
  splits into 3 dust motes when vacuumed). Behaviors live in `dust.js`.
- Every mote collected banks `value * 0.05 * shardMult` ✦ (fractional parts
  accumulate in an accumulator; whole shards go to the save instantly).
- Passive trickle: `0.05 ✦/s * shardMult` while a level is being played.
- Level clear: `2 + 0.05·(level−1)` ✦.
- **Offline** (requires Auto-Pilot Sensor meta): on load, absences of
  **≥ 60s** grant `floor(1.2/h * (1 + 0.05*polishLvl) * (1 + 0.12*(bestLevel−1)) *
  min(elapsed, 8h))` whole shards, surfaced as a one-time "while you were
  away" toast; the sub-shard remainder is carried in `save._offFrac` so quick
  reloads neither drop nor double-grant fractions (`offlineGrant`,
  `js/upgrades.js`). Deliberately slow: AFK is a drip, active play is the
  real economy.
- **Hangar Auto-Bay** (requires Auto-Bay meta, max 3 → ×0/×1/×2/×4): while
  the hangar screen is open, a SUDS mop-bot visibly cleans a mini bay
  (`js/hangar.js`, driven by the real Bot/DustSystem/steer). Shards accrue
  at a flat `0.3/hr * (1 + 0.1*(bestLevel−1)) * mult` — the sim is a visual,
  the flat rate is the economy.

## Bots (character select — 6, three unlock by lifetime best level)

Stats are the **run starting values**; meta upgrades multiply on top
(`makeRunStats`). No bot starts with a side brush — Turbo Brush IS the
brush upgrade path. `motor` resists heavy-dust drag (ZIP's 99 = immune).

| | 🔴 **ROOMBA** | 🔵 **MI** | 🟣 **SHARK** | 🧽 **SUDS** (lv5) | 🐗 **BULLDOG** (lv12) | ⚡ **ZIP** (lv20) |
|---|---|---|---|---|---|---|
| suction | 1.0 | 1.0 | **1.3** | 0.8 | 1.1 | 1.0 |
| suction range | 2.6 | 2.4 | **3.4** | 2.4 | 2.8 | 3.0 |
| pickup radius | 1.7 | 1.5 | **1.9** | 1.6 | 1.8 | 1.6 |
| speed | 6.0 | **7.2** | 5.1 | 5.6 | 5.6 | **7.4** |
| turn rate | 5.0 | 6.4 | 4.0 | 5.0 | 4.6 | **6.8** |
| magnet range | 0 | 0.6 | **1.6** | 0 | 0.8 | 1.2 |
| bin capacity | 100 | **130** | 90 | 110 | **150** | 95 |
| boost cd mult | 1.0 | 1.0 | 0.85 | 1.0 | 0.9 | **0.8** |
| motor | 1.0 | 1.0 | 1.0 | 1.0 | **2.0** | 99 |
| special | all-rounder | LiDAR scout | self-empty | **mop trail** | heavy hauler | no drag, +10% shards |

## Controls

- **Virtual joystick** (bottom-left 42%×42% zone, drawn knob): steer —
  input snaps to the **8 compass directions**.
- **Tap-to-move** (tap anywhere on the floor outside the joystick zone):
  sets a target point; the bot drives straight with obstacle sliding.
  Joystick input cancels the tap target.
- **Boost button** (hold, right side): ×1.7 speed bursts of 1.0s, then a
  cooldown of `4.0s * boostCdMult` (floor 1.0s) — holding it cycles
  burst/cooldown (~25% duty at base). Boost also spins the brushes faster.
- **Keyboard** (desktop): WASD/arrows to move, **Space** = boost, mouse
  click = tap-to-move, **ESC / P** = pause (pause screen links to help).
- No free camera: the 44×44 world is letterbox-fit to the viewport.

## In-run upgrades (1 of 3 after each level)

Weighted pool (`rollPicks`): each upgrade appears `weight` times; a rolled
pick removes all copies of its id. The pool is **never empty** — all 11
upgrades stay available forever. Picks beyond the base `max` tier get
**diminishing returns** (strength = `max/(lvl+1)`) with hard clamps (§9).

| Upgrade | Effect per level | Max | Weight |
|---|---|---|---|
| 🌀 Suction Core | ×1.2 suction, +0.5 range, +5 bin | 5 | 3 |
| 🪥 Turbo Brush | L1 adds side brush; then ×1.2 pickup radius | 5 | 3 |
| ⚡ Speed Coil | ×1.10 speed & turn rate | 5 | 3 |
| 🐗 Heavy Motor | ×1.5 motor (shrugs off heavy-dust drag) | 4 | 4 |
| 📦 Extra Hopper | +25 bin | 5 | 3 |
| 🧲 Magnet Motor | +1.4 magnet pull distance | 3 | 2 |
| 🔥 Overdrive | ×0.8 boost cooldown | 3 | 2 |
| 🪙 Scrap Merchant | ×1.15 dust→shard conversion | 3 | 2 |
| 🌫️ Wide Suction | ×1.15 pickup radius | 3 | 2 |
| 📦 Deep Hopper | +20 bin | 3 | 2 |
| 🍀 Gold Bristles | +3% gold mote chance | 2 | 1 |

## Meta upgrades (hangar — persist forever, cost `base * 1.6^level`)

| Upgrade | Base ✦ | Max | Effect per level |
|---|---|---|---|
| 🌀 Factory Suction | 20 | 10 | +5% suction (capped ×3 total) |
| ⚡ Chassis Rollers | 20 | 10 | +4% speed |
| 📦 Wider Hopper | 25 | 10 | +8 bin |
| 🧲 Magnet Coil | 40 | 8 | +4% pickup radius |
| 🛰️ Auto-Bay | 60 | 3 | hangar idle shards ×1/×2/×4 |
| 🐗 Drivetrain Kit | 40 | 4 | +25% motor (heavy-dust drag) |
| 🤖 Auto-Pilot Sensor | 100 | 1 | unlocks offline shards |
| ✨ Shard Polisher | 60 | 10 | +3% shard gains |
| 🍀 Lucky Bristles | 200 | 5 | +3% gold chance |
| 🧲 Mote Magnet | 50 | 8 | +6% suction range |

## Physics & pickup model (what the code actually does)

Per mote, per frame (`dust.js`):
1. **Soak check** (mop bots): on wet floor (`wetAt ≥ 0.25`) a heavy mote's
   effective mass halves and it pays ×1.5 value; static is fully negated.
2. **Brush sweep** (if `brushLevel > 0`): corner brushes push motes inward
   from all sides, stronger with more brush levels.
3. **Drift + bounce** off arena bounds; **tar** oozes in its own heading at
   0.15 u/s, bouncing off walls and furniture.
4. **Suction** (omnidirectional, not a cone): if `dist < suckR` where
   `suckR = max(pickupR + 0.5, suctionRange × suction)` (0 while clogged),
   apply acceleration `34 × suction × (1 − dist/suckR)² × 6 / (1 + 0.5·mass)`.
   **Static** motes instead repel (and shove the bot back).
5. **Magnet** (passive, if `magnetRange > 0`): pull `4 / (1 + 0.3·mass)`
   within `magnetRange + 2`.
6. **Friction**, then **pickup** on `dist < pickupRadius` **and bin not
   full** → mote consumed, +1 to the bin (`bin = min(binMax, bin+1)`),
   shards banked. **Puff** motes instead split into 3 dust motes.
- **Heavy-dust drag:** motes with mass ≥ 0.3 inside `suckR` sum into
  `dragMass`; the bot's speed is multiplied by
  `motor / (motor + 0.12·dragMass)` (game.js). `motor = botDef.motor ×
  meta Drivetrain × Heavy Motor picks`.
- **Mop trail:** SUDS stamps wetness (`0.55/unit traveled`) into a 6-px/unit
  grid that decays ~12s (`world.js updateWet`).

## World, themes & layouts

- Arena **44×44 world units**, square, letterbox-fit to the screen
  (devicePixelRatio capped at 2). Bot spawns center (22, 22).
- **4 themes** (`THEMES`), each with floor/wall/dock/dirt palettes:
  🏠 Residential, 💼 Office, 🛒 Store, 🛰️ Space.
- **Procedural rooms** (`js/levelgen.js`). Every level is *generated*, not
  hand-authored. Each theme has hand-placed **archetypes** (bedroom = bed +
  nightstand, checkout = counters + stock, cryo-bay = hatch + consoles, …)
  plus random **filler** from a per-theme pool. Obstacles are AABBs
  `{x, y, w, h, kind}`; `kind` (20 kinds) drives the render style.
- Level n: `rot = floor((n-1)/12)`, theme = `floor((n-1)/3) % 4`. The
  archetype is chosen by shuffling with a deterministic key from
  `(runSeed, level)`, retrying placement up to 60 times. Obstacle count
  ramps `3 + rot`, capped at 6.
- **Deterministic per seed.** `levelDef(level, runSeed = 0)` →
  `generateLevel(themeKey, level, runSeed)` with a mulberry32 RNG. The game
  rolls a fresh 32-bit `runSeed` per run; tests & the balance sim use
  `runSeed 0`.

### Generation HARD RULES (enforced by `validateLayout`)
* in-bounds, positive sizes, valid `kind`, obstacle count in [3, 9];
* keep the top dock strip clear (y < 9) — the dock sits at (22, 3.6), r 1.9;
* keep the 8×8 clear pad around center (22, 22) — the bot spawns there;
* **≥ 4 u corridors** between obstacles (and to walls) so the bot can pass;
* **flood-fill connectivity**: free space is one connected region;
* **semantic guardrails** at placement time (bed gets a nightstand, media
  faces the sofa, counters hug walls, hatch/console/core sit center-bottom,
  desks in row bands, shelves parallel);
* a **`fallbackLayout(themeKey)`** is the last-resort output if no generated
  layout validates — it is itself always valid, so a run can never softlock.

> The balance-sim steering bot (`js/steer.js`, shared with the hangar bay)
> is *not* a human: it aims at the nearest mote and commits to a detour
> waypoint around blockers. A couple of base runs still time out in tight
> corner pockets — treat "fails" in `BALANCE_REVIEW.md` as an upper bound
> on difficulty, not a game soft-lock (there is no failure state).
> **Input convention:** `steer()` returns a world direction with **+y =
> down**, matching `bot.js`'s `atan2(ix, -iy)` — see `test/steer.test.js`
> (a sign flip here silently mirrors all AI movement).

## Tech plan

- **2D `<canvas>`**, hand-rolled circle-vs-AABB movement with wall/obstacle
  sliding. No physics lib, no engine, **no build step, no npm deps, no CDN**
  — pure static ES modules, GitHub Pages serves the repo root as-is. The
  Press Start 2P webfont (SIL OFL 1.1) is self-hosted at
  `fonts/press-start-2p.woff2`.
- **Update check:** `semverNewer(server, bundled)` — a server rollback does
  NOT prompt a reload.
- **Particles:** motes are plain JS objects in a free-list pool (≤300 per
  level, MAX_DUST=400).
- **Audio:** tiny WebAudio synth blips (no assets): click, suck, gold,
  clear, buy, upgrade, boost, dump. Mute button top-right (per-session).
- **Save:** `localStorage` key `dustybot_save_v2`:
  `{ shards, meta{}, lastSeen, bestTime, runs, bestShards, bestLevel, bot,
  idle{motes,ms}, _offlineGain(transient) }`.
  `bestTime` = fastest level-1 clear; `bestShards` = best single-run haul;
  `bestLevel` = lifetime best level (gates bot unlocks). Saved on level
  clear, purchase, and on `pagehide`/tab-hide.
- **Offline calc:** on load, if Auto-Pilot owned, bank
  `floor(rate * min(dt, 8h))` (rate per §1) and remember it for the one-time
  menu toast.
- **Perf targets (phone):** one canvas, one draw pass, no shadows beyond a
  fake blob ellipse under the bot, dpr ≤ 2, 60fps on mid-range Android.
- **Mobile viewport:** `viewport-fit=cover`, `user-scalable=no`,
  `touch-action: none` on canvas, safe-area insets, portrait-first.
- **PWA-lite:** `manifest.webmanifest` + inline `icon.svg`.
- **Error trap:** `main.js` hooks `window.onerror`/`unhandledrejection`
  into a visible on-page banner (mobile-friendly, no DevTools needed).
- **Update delivery:** `?v=` cache-busters in `index.html` + live
  `version.json` check with a reload banner. Bump all three version spots
  with `npm run bump`; `npm test` fails if they drift.

### File layout
```
/ (repo root = Pages root)
  index.html              # screens: menu / select / hangar + HUD
  manifest.webmanifest
  icon.svg
  fonts/press-start-2p.woff2   # self-hosted webfont (SIL OFL 1.1)
  css/style.css
  js/main.js              # bootstrap, save/load, offline calc, loop, wiring
  js/game.js              # run state machine (menu/intro/run/pick/pause)
  js/world.js             # 2D canvas world, themes, obstacles, wet layer
  js/levelgen.js          # procedural room generator (seeded, guarded, pure)
  js/bot.js               # bot entity: movement, bounce, boost, bin, mop stamp
  js/dust.js              # motes: suction/brush/magnet/pickup/soak/drag/types
  js/steer.js             # shared steering AI (hangar bay + balance sim)
  js/hangar.js            # hangar auto-bay idle sim (own mini world)
  js/controls.js          # joystick + tap-to-move + keyboard
  js/upgrades.js          # BOTS, upgrades, themes, levelDef, BALANCE (truth)
  js/ui.js                # screens, HUD, pick panel, toasts, portraits
  js/help.js              # shared help content (data-driven, testable)
  js/audio.js             # WebAudio synth
  js/palette.js           # shared canvas/CSS palette
  js/version.js           # VERSION constant (bump via npm run bump)
  test/                   # node --test: dust, steer, upgrades, levelgen,
                          # idle, help, version-sync (4 spots incl. package.json)
  tools/sim-bots.mjs      # headless balance sim (real Bot+Dust+steer)
```

## Balancing model (how numbers stay sane)

- **Shard income:** active play ≈ per-dust (0.05/mote) + trickle (0.05/s) +
  level bonus (2 + 0.05·(lvl−1)). A level-1 room ≈ 3–5 ✦; late levels
  (100+ motes, heavier mix) ≈ 10–20 ✦ + bonuses.
- **Meta pacing:** `base * 1.6^lvl` → Factory Suction L10 ≈ 328 ✦.
- **AFK cap:** 1.2 ✦/h (×polish ×bestLevel), 8h cap. Deliberately ~10×
  slower than active play.
- **Guardrails:** suction meta capped ×3; boost cooldown floor 1.0s; dirt
  count capped 300 (below MAX_DUST=400); in-run pick clamps keep suckR <
  arena; bin is the only "soft fail" (clog) and it never blocks level
  completion.

## QA checklist (manual playtest)

See `REVIEW.md` P4 for the full ordered checklist. Highlights:
- [ ] All 6 bots: distinct feel, clog at their own binMax, dock dumps.
- [ ] Long run (200+ levels): picks never drain, diminishing returns keep
      stats bounded, no freeze; static/tar/puff appear at their gears.
- [ ] Refresh mid-run: shards/best stats survive (pagehide save).
- [ ] Offline toast fires once with Auto-Pilot; Auto-Bay bay bot actually
      chases motes (steer sign regression guard: `test/steer.test.js`).
- [ ] Joystick + tap + keyboard + boost + pause all work; safe-area on phone.
