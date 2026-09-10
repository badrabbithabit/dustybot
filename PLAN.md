# Dusty Bot — 2D Roguelike Robot Vacuum

Web-based, mobile-first (phone portrait), hosted on GitHub Pages.
You are a little robot vacuum in a top-down 2D room full of dust. Vacuum
everything, dump your bin at the dock, pick 1 of 3 upgrades, go deeper.
There is **no failure mode** — a run ends when you walk away. A persistent
meta-currency ("Dust Shards" ✦) carries between runs for permanent upgrades,
plus a small offline trickle (gated behind a meta unlock).

> This doc specs the **shipped implementation** (2D canvas). An earlier draft
> described a 3D/Three.js game with lives, battery and hazards — that design
> was dropped before launch; everything below matches `js/` as committed.

## 1. Core loop (level-based, no failure)

```
[Menu] -> [Select bot] -> [Level 1 intro] -> PLAY -> level clear
                                             |        ^
                                             v        |
                                        [Pick 1 of 3 upgrades]
                                             (repeat; themes rotate every 3 levels)
```

- A **level** is one named room with a **fixed dirt budget** scattered at
  start. Motes do **not** regenerate. Clear the level by collecting every mote.
- On clear: +2 ✦ level bonus, then a 1-of-3 upgrade pick, then the next level.
  When the upgrade pool is empty (all maxed), a bonus of `5 + level` ✦ is
  banked and the run just keeps going.
- **The bin & the dock.** Motes you collect go into the bin. When
  `bin >= binMax` the bot **clogs**: suction is fully off and speed is
  ÷1.25 (`BALANCE.bin.clogWeightMult`). The side brushes, magnet and
  touch-pickup still work, so a clogged bot can still finish a level — slowly.
  Drive over the **dock** (glowing ring, top-center) to dump the bin.
- **Difficulty ramp:** dirt count per level
  `min(160, 26 + (level-1)*6 + rotations*12)` (`BALANCE.dirt`), and themes
  cycle residential → office → store → space, 3 named rooms each, ramping
  every full rotation.

### Dust economy
- Mote types (spawn roll, `dust.js`): **dust** = 1 (common), **big** = 3,
  **debris** = 2, **gold** = 5 (chance `3% + upgrades`, see Gold Bristles /
  Lucky Bristles).
- Every mote collected banks `value * 0.05 * shardMult` ✦ (fractional parts
  accumulate in an accumulator; whole shards go to the save instantly).
- Passive trickle: `0.05 ✦/s * shardMult` while a level is being played.
- Level clear: +2 ✦.
- **Offline** (requires Auto-Pilot Sensor meta): on load,
  `shards += floor(0.8/h * (1 + 0.05*polisherLvl) * min(elapsed, 8h))`,
  granted only after ≥60s away, surfaced as a one-time "while you were away"
  toast. Deliberately slow: AFK is a drip, active play is the real economy.

## 2. Bots (character select)

Three bots modeled on real robot vacuums. Stats are the **run starting
values**; meta upgrades multiply on top (`makeRunStats`).

| | **ROOMBA** 🔴 all-rounder | **MI ROBOT** 🔵 LiDAR scout | **SHARK** 🟣 self-empty powerhead |
|---|---|---|---|
| suction | 1.0 | 0.9 | **1.3** |
| suction range | 3.4 | 3.0 | **4.2** |
| pickup radius | 1.7 | 1.5 | **1.9** |
| brush level | **2** | 1 | 1 |
| speed | 6.0 | **7.2** | 5.1 |
| turn rate | 5.0 | **6.4** | 4.0 |
| magnet range | 0 | 0.6 | **1.6** |
| bin capacity | 100 | **130** | 70 |
| boost cd mult | 1.0 | 1.0 | **0.85** |

Trade-off summary: Roomba = balanced; Mi = fast/turny/big bin but weaker
suction; Shark = monster suction + magnet but slow and tiny hopper (clogs
often — dock-hugging play).

## 3. Controls

- **Virtual joystick** (left-half touch zone, drawn knob): analog steer.
- **Tap-to-move** (right-half tap): sets a target point; the bot drives
  straight with obstacle sliding. Joystick input cancels the tap target.
- **Boost button** (hold, right side): ×1.7 speed, then a cooldown of
  `4.0s * boostCdMult` (floor 1.0s). Boost also spins the brushes faster.
- **Keyboard** (desktop): WASD/arrows to move, **Space** = boost,
  mouse click = tap-to-move.
- No free camera: the 44×44 world is letterbox-fit to the viewport.

## 4. In-run upgrades (1 of 3 after each level)

Weighted pool (`rollPicks`): each upgrade appears `weight` times in the pool;
a rolled pick removes **all** copies of its id, so the loop always terminates
and never offers an upgrade twice in one roll. Upgrades at max level are
excluded. The pool can run dry (10 upgrades, 37 total levels) — then the run
gets bonus shards instead of a pick (see §1).

| Upgrade | Effect per level | Max | Weight |
|---|---|---|---|
| 🌀 Suction Core | ×1.2 suction, +0.5 range, +5 bin | 5 | 3 |
| 🪥 Turbo Brush | L1 adds brush; then ×1.2 pickup radius | 5 | 3 |
| ⚡ Speed Coil | ×1.10 speed & turn rate | 5 | 3 |
| 📦 Extra Hopper | +25 bin | 5 | 3 |
| 🧲 Magnet Motor | +1.4 magnet pull distance | 3 | 2 |
| 🔥 Overdrive | ×0.8 boost cooldown | 3 | 2 |
| 🪙 Scrap Merchant | ×1.15 dust→shard conversion | 3 | 2 |
| 🌫️ Wide Suction | ×1.15 pickup radius | 3 | 2 |
| 📦 Deep Hopper | +20 bin | 3 | 2 |
| 🍀 Gold Bristles | +3% gold mote chance | 2 | 1 |

## 5. Meta upgrades (hangar — persist forever, cost `base * 1.6^level`)

| Upgrade | Base ✦ | Max | Effect per level |
|---|---|---|---|
| 🌀 Factory Suction | 20 | 10 | +5% suction (capped ×3 total) |
| ⚡ Chassis Rollers | 20 | 10 | +4% speed |
| 📦 Wider Hopper | 25 | 10 | +8 bin |
| 🧲 Magnet Coil | 40 | 8 | +4% pickup radius |
| 🧲 Mote Magnet | 50 | 8 | +6% suction range |
| ✨ Shard Polisher | 60 | 10 | +3% shard gains |
| 🤖 Auto-Pilot Sensor | 100 | 1 | unlocks offline shards |
| 🍀 Lucky Bristles | 200 | 5 | +3% gold chance |

## 6. Physics & pickup model (what the numbers do)

Per mote, per frame (`dust.js`):
1. **Brush sweep** (if `brushLevel > 0`): corner brushes push motes inward
   from all sides, stronger with more brush levels.
2. **Suction** (omnidirectional, not a cone): if `dist < suckR` where
   `suckR = max(pickupR + 0.5, suctionRange × suction)`, apply force
   `34 × suction × (1 - dist/suckR)²` toward the bot.
3. **Magnet** (passive, if `magnetRange > 0`): constant weak pull within
   `magnetRange + 2`.
4. **Friction**, then **pickup** on `dist < pickupRadius` → mote consumed,
   value goes to the bin (`bin = min(binMax, bin+1)`) and shards are banked.

Clog state scales suction ×0.5 in the formula but `suckR` is 0 while full, so
in practice **clog = suction off + speed ÷1.25**; brush/magnet/touch still
collect.

## 7. World, themes & layouts

- Arena **44×44 world units**, square, letterbox-fit to the screen
  (devicePixelRatio capped at 2). Bot spawns center (22, 22).
- **4 themes** (`THEMES`), each with floor/wall/dock/dirt palettes:
  🏠 Residential, 💼 Office, 🛒 Store, 🛰️ Space.
- **Procedural rooms** (`js/levelgen.js`). Every level is *generated*, not
  hand-authored. Each theme has a set of **room archetypes** — a hand-placed
  "anchor" obstacle arrangement that gives the room its character (e.g.
  bedroom = bed + nightstand, checkout = counter + stock line, cryo-bay =
  hatch + consoles). On top of the anchor set, a small number of **random
  filler** obstacles are drawn from a per-theme pool. Obstacles are AABBs
  `{x, y, w, h, kind}`; `kind` (sofa/desk/shelf/console/… — 20 kinds) drives
  the per-theme render style, unchanged.
- Level n: `rot = floor((n-1)/12)`, theme = index `floor((n-1)/3) % 4`.
  The archetype is chosen by shuffling the theme's archetypes with a
  deterministic key derived from `(runSeed, level)`, then retrying placement
  up to 60 times. Dirt count per §1; obstacle count ramps with `rot` (3 → 5)
  and is capped — difficulty comes mostly from the dirt ramp.
- **Deterministic per seed.** `levelDef(level, runSeed = 0)` →
  `generateLevel(themeKey, level, runSeed)`. A mulberry32 RNG makes a given
  `(themeKey, level, runSeed)` fully reproducible. The game rolls a fresh
  32-bit `runSeed` per run (so a room differs run to run); tests & the
  balance sim use `runSeed 0` for a stable reference layout.

### Generation HARD RULES (enforced by `validateLayout`)
* in-bounds, positive sizes, valid `kind`, obstacle count in [3, 9];
* keep the top dock strip clear (y < ~9) — the dock sits at (22, 3.6), r 1.9;
* keep the 4×4 clear pad around center (22, 22) — the bot spawns there;
* **≥ 4 u corridors** between obstacles (and to walls) so the bot can pass —
  the old handcrafted rooms used 4–7 u margins; this keeps generated rooms
  equally navigable and gives the sim's local-steering bot 2 u of center
  freedom to route around a piece;
* **flood-fill connectivity**: the free space must be a single connected
  region (no sealed pockets);
* **semantic guardrails** at placement time (bed gets a nightstand, media
  faces the sofa, counters hug walls, hatch/console sit center-bottom, desks
  in row bands) so rooms read as real rooms, not random boxes;
* a **`fallbackLayout(themeKey)`** is the last-resort output if no generated
  layout validates — it is itself always valid, so a run can never softlock.

> The balance-sim steering bot (`tools/steer.mjs`) is *not* a human: it aims
> at the nearest mote and commits to a detour waypoint around any blocking
> obstacle (obstacle-aware raycast + waypoint commitment, plus a two-tier
> clearance probe). A couple of base Shark runs still time out in tight
> corner pockets — treat "fails" in `BALANCE_REVIEW.md` as an upper bound on
> difficulty, not a game soft-lock (there is no failure state).

## 8. Tech plan

- **2D `<canvas>`**, hand-rolled circle-vs-AABB movement with wall/obstacle
  sliding. No physics lib, no engine, **no build step, no npm** — pure static
  ES modules, GitHub Pages serves the repo root as-is.
- **Particles:** motes are plain JS objects in a free-list pool (one level's
  dirt at a time, ≤160) — far below any particle cap.
- **Audio:** tiny WebAudio synth blips (no assets): click, suck, gold,
  clear, buy, upgrade, boost, dump. Mute button top-right.
- **Save:** `localStorage` key `dustybot_save_v2`:
  `{ shards, meta{}, lastSeen, bestTime, runs, bestShards }`.
  `bestTime` = fastest level-1 clear; `bestShards` = best single-run haul;
  saved on level clear, purchase, and on `pagehide`/tab-hide.
- **Offline calc:** on load, if `dt > 60s` and Auto-Pilot owned, bank
  `rate * min(dt, 8h)` (rate per §1) into shards and remember it for the
  one-time menu toast.
- **Perf targets (phone):** one canvas, one draw pass, no shadows beyond a
  fake blob ellipse under the bot, dpr ≤ 2, 60fps on mid-range Android.
- **Mobile viewport:** `viewport-fit=cover`, `user-scalable=no`,
  `touch-action: none` on canvas, safe-area insets, portrait-first.
- **PWA-lite:** `manifest.webmanifest` + inline `icon.svg` so it installs to
  the phone home screen.
- **Error trap:** `main.js` hooks `window.onerror`/`unhandledrejection` into
  a visible on-page banner (mobile-friendly, no DevTools needed).

### File layout
```
/ (repo root = Pages root)
  index.html              # screens: menu / select / hangar + HUD
  manifest.webmanifest
  icon.svg
  css/style.css
  js/main.js              # bootstrap, save/load, offline calc, loop, wiring
  js/game.js              # run state machine (menu/intro/run/pick), shards
  js/world.js             # 2D canvas world, themes, obstacles, rendering
  js/levelgen.js          # procedural room generator (seeded, guarded, pure)
  js/bot.js               # bot entity: movement, boost, bin, clog, brushes
  js/dust.js              # mote system: spawn, suction/brush/magnet, pickup
  js/controls.js          # joystick + tap-to-move + keyboard
  js/upgrades.js          # BOTS, run/meta upgrades, themes, levelDef, BALANCE
  js/ui.js                # screens, HUD, pick panel, toasts
  js/audio.js             # WebAudio synth
  js/palette.js           # shared canvas/CSS palette
```

### GitHub Pages
- Repo → Settings → Pages → Deploy from branch `/` (root).
- All relative URLs (`./js/...`); no base path, no CDN, no vendor files.
- Workflow `.github/workflows/pages.yml` deploys on push to main.

## 9. Balancing model (how numbers stay sane)

- **Shard income:** active play ≈ per-dust (0.05/mote) + trickle (0.05/s) +
  level bonus (2). A 26-mote level 1 ≈ ~2–4 ✦. Late levels (100+ motes,
  higher gold mix) ≈ 10–20 ✦ + bonuses.
- **Meta pacing:** `base * 1.6^lvl` → Factory Suction L10 ≈ 328 ✦,
  reachable in a few mid-game runs. New meta level ≈ 0.5–2 runs early,
  2–5 runs late.
- **AFK cap:** 0.8 ✦/h (×polish), 8h cap → a full day ≈ 6.4 ✦. Deliberately
  ~10× slower than active play.
- **Guardrails:** suction meta capped ×3; boost cooldown floor 1.0s; dirt
  count capped 160; bin is the only "soft fail" (clog) and it never blocks
  level completion.

## 10. QA checklist (manual playtest)

See `REVIEW.md` P4 for the full ordered checklist. Highlights:
- [ ] All 3 bots: distinct feel, clog at their own binMax, dock dumps.
- [ ] Long run (35+ levels): upgrade pool drains → bonus shards, no freeze.
- [ ] Refresh mid-run: shards/best stats survive (pagehide save).
- [ ] Offline toast fires once after 60s+ away with Auto-Pilot.
- [ ] Joystick + tap + keyboard + boost all work; safe-area layout on phone.
