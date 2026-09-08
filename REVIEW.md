# Dusty Bot — Code Review & Action Checklist

Review date: 2026-07-16 · Project: 2D canvas vacuum roguelike (static site, no build step)

Work in this order: **P0 hard bugs → P1 minor bugs → P2 orphaned code → P3 docs → P4 manual QA → P5 polish/deploy.**

**Status (2026-07-16): P0 (1–7), P1 (8–9), P2 (orphans), P3 (docs) DONE; P5 tests added** —
see ✅ notes; verified by
`node --check` + headless logic tests (rollPicks termination, suction reach 3.1u, brush sweep,
clog-at-binMax for all 3 bots, bin-full suction cut-off, level-1 meta_gold spawn, levelDef 1..40).
Remaining: P2 orphan removal, P3 docs, P4 manual playtest, P5 polish.

---

## P0 — Functional bugs (fix first)

- [x] **1. `rollPicks` infinite loop → hard freeze (game-breaking)** — ✅ FIXED: pool now splices
  all copies of a picked id (always makes progress); `game._showPick` grants a
  `5 + level` shard bonus and auto-continues when the pool is empty.
  `js/upgrades.js` `rollPicks(s, 3)`: the `while (picks.length < count && pool.length)` loop never
  terminates when fewer than 3 *distinct* upgrades remain but at least one does. Verified: after
  33 picks only 2 distinct upgrades remain → loop spins forever, tab freezes. (0 remaining
  returns `[]` → empty pick panel, silent softlock instead.)
  *Fix:* track distinct ids and break when exhausted, e.g. cap by `new Set(pool.map(u=>u.id)).size`;
  handle empty pool in `game._showPick` (e.g. bonus shards + auto-continue).

- [x] **2. Suction range is dead — bot identity + 2 upgrades nullified** — ✅ FIXED: suction
  branch now uses `dist < suckR` with `suckR = max(pickupR + 0.5, suctionRange × suction)`.
  `js/dust.js:70` computes `suckR = stats.suctionRange * stats.suction` then never uses it; the
  suction loop uses `reach = pickupR + 1`. So `suctionRange` (roomba 3.4 / mi 3.0 / shark 4.2),
  the *Suction Core* range bonus (+0.5/lvl) and *Mote Magnet* meta (+6%/lvl) all do nothing.
  Actual reach is 2.5–2.9 for every bot.
  *Fix:* use `suckR` as the suction reach (e.g. `reach = Math.max(pickupR, suckR)`) and rebalance
  force falloff against the new range.

- [x] **3. Turbo Brush sweep never fires (wrong property path)** — ✅ FIXED: reads
  `(bot.stats && bot.stats.brushLevel) || 0`.
  `js/dust.js:76` reads `bot.brushLevel` — Bot has no such property; it lives at
  `bot.stats.brushLevel` (see `bot.js:204`). `undefined > 0` → sweep dead, so the brush's corner
  push and part of the *Turbo Brush* upgrade effect never work (visual brushes still change).
  *Fix:* `const bl = bot.stats.brushLevel || 0`.

- [x] **4. Bin-full/clog broken for 2 of 3 bots** — ✅ FIXED: `full = bin >= stats.binMax` in
  both `addDust` and `update`; dead `fullAt` (and unused `max`) removed from `BALANCE.bin`.
  `js/bot.js:38,79` compare `bin >= BALANCE.bin.fullAt` with `fullAt` hardcoded 100.
  Shark `binMax=70` → **never clogs** (its "tiny hopper" tradeoff is void);
  Mi `binMax=130` → clogs early at 100; Roomba 100 = OK. Verified by simulation.
  *Fix:* full = `bin >= stats.binMax` (drop or derive `fullAt`).

- [x] **5. Run stats never persisted — menu "best" line is frozen** — ✅ FIXED: `runs++` + save
  in `newRun`; `bestTime` = fastest level-1 clear, `bestShards` = best in-run haul, both
  persisted in `_levelClear`/`_bankShards`.
  `save.bestTime / runs / bestShards` are only read (`game.js:218-220`), never written.
  Menu always shows `best: 0:00 · 0 runs`.
  *Fix:* define semantics (e.g. `runs++` per run started; `bestTime` = fastest level-1 clear or
  best level reached) and write them in `game.js` on level clear / run end.

- [x] **6. Mid-run progress lost on refresh** — ✅ FIXED: `pagehide` + `visibilitychange` (hidden)
  both `writeSave` in `main.js`; level clear also persists via `onSave`.
  `main.js` only persists on menu/hangar actions (`onSave`). Shards banked mid-run
  (`game._bankShards` → in-memory `save.shards`) are lost on reload.
  *Fix:* also persist on level clear and on `visibilitychange`/`pagehide`.

- [x] **7. Level-1 spawn ignores meta gold chance** — ✅ FIXED: `spawnLevel(count, theme, stats)`
  sets `_stats` immediately (game passes `this.stats`).
  `js/dust.js` `_rollType` uses `this._stats || default`, but `_stats` is only set during
  `update()`. On a fresh run, `spawnLevel()` runs first → level 1 dirt ignores
  `meta_gold` / *Gold Bristles*. *Fix:* set `this._stats = stats` inside `spawnLevel` (pass stats in).

## P1 — Minor bugs / inconsistencies

- [x] **8.** `stats.dust` HUD counter counted motes, not value — ✅ FIXED: `stats.dust += val`
  (gold = 2) in `game._onCollect`.
- [x] **9.** Offline toast re-appeared on every menu visit — ✅ FIXED: `toMenu` reads
  `_offlineGain` once and resets it to 0 before `setMenu`.
- [ ] **10.** Pick state freezes the game (`game.update` returns early on `state !== 'run'`),
  but `index.html` comment says "game keeps running behind" — pick one and document it.
- [ ] **11.** `dust.spawnLevel(count, theme)` signature: `theme` param name is misleading —
  it's the full theme object; fine, but consider `(count, theme, stats)` after fix #7.
- [ ] **12.** `index.html` viewport: `user-scalable=no` + tiny 6–8px Press Start 2P text hurts
  readability/accessibility. Intentional? Add `aria-label` to `#game` canvas.

## P2 — Orphaned code (remove or deliberately revive)

Verified dead (grep + trace), no runtime effect if removed:

- [x] **`UI.setOver`** (`ui.js:225`) — never called; no game-over state exists. ✅ removed
- [x] **`#screen-over`** + `#over-title/#over-stats/#over-shards/#btn-retry/#btn-over-menu`
  (`index.html`) + their listeners in `main.js` — unreachable screen. ✅ removed
- [x] **Unused SFX** (`audio.js`): `sfx.bigSuck`, `sfx.hurt`, `sfx.life`, `sfx.over`, `sfx.pad`. ✅ removed
- [x] **`BOTS` import** in `game.js:7` — never referenced. ✅ removed
- [x] **XP chain (dead concept):** `it._xp` (`dust.js:115`, always undefined),
  `addDust(n, xp)` xp param, `bot._dumpXp` (`bot.js:18,37`), reset in `game.js:147`. ✅ removed
- [x] **`stats.dirtCollected`** — written (`game.js:91,174`), never read. ✅ removed
- [x] **`stats.spawnMult`** (`upgrades.js:147`) — no upgrade modifies it, never read. ✅ removed
- [x] **`controls.tapTarget`** (`controls.js:9,69,101`) — set, never read
  (game uses its own `_tapInput` via the `onTap` callback). ✅ removed
- [x] **`controls.raycaster`** (`controls.js:13`) — 3D-era leftover, always null. ✅ removed
- [x] **`BALANCE.bot.speed` / `BALANCE.bot.turnRate`** — unused (values duplicated in
  `BOTS.roomba.stats`); **`BALANCE.bin.max`** — unused (only `fullAt`/clog mults used). ✅ removed
- [x] **CSS orphans:** `.pxb` helper, `#battery-wrap`, `#battery-fill` (no battery elements in
  HTML — battery plan was dropped). ✅ removed; also `.shards-gain` (died with the over screen)
- [x] **`bot.update()` return** `{moving, speed}` ignored by caller; `world.render(dt, game)`
  `dt` unused — drop params or use them. ✅ both signatures slimmed (`addDust(n)`, `render(game)`)
- [x] `menuState()` fields — N/A in shipped code (`toMenu` passes a literal; no such fn).
- [x] **Bonus orphans found during removal:** `stats.bin` (HUD reads `bot.bin`),
  `_onCollect(val, it)` unused `it` param. ✅ removed

## P3 — Documentation drift

- [x] **`PLAN.md` described a different game** (Three.js 3D, hazards, lives, battery, XP) ✅
  REWRITTEN (2026-07-16): now specs the shipped 2D game — core loop, bot stat tables, run/meta
  upgrade tables, pickup physics, themes/layouts + hard rules, save schema, balancing model.
- [x] `index.html` 3D-era comments — ✅ verified clean (grep: no 3d/three/raycast refs remain).
- [x] README — ✅ added (`README.md`: run locally, controls, save schema, file map).

## P4 — Manual QA matrix (playtest)

Do this after P0–P2. Desktop (keys/mouse) and mobile (joystick/tap/boost):

- [ ] All 3 bots: distinct look, stats felt (speed/suction/bin), portrait matches in-game bot.
- [ ] All 12 rooms (4 themes × 3): spawn pad clear, no motes stuck in corners unreachable,
  corridors passable, dock reachable, no overlap with top dock strip.
- [ ] Full loop: menu → select → run → dock dump → level clear → pick (verify 3 distinct
  cards, game state during pick) → next level theme change.
- [ ] Upgrade edge: force-max a bot (console) → level clear → **must not freeze** (validates fix #1).
- [ ] Bin full: Roomba to 100 → clog (half suction, heavy) → dump at dock → recovers.
- [ ] Boost: hold Space / button, cooldown UI (`.cooling` class), Overdrive reduces it.
- [ ] Hangar: buy each meta, cost curve, MAX state, shards update, offline gain toast
  (buy Auto-Pilot, set `lastSeen` back 24h → reload → toast + cap at 8h).
- [ ] Shards: dust→shard trickle visible; refresh mid-run keeps nothing (pre-fix) /
  keeps progress (post-fix #6).
- [ ] Mute toggle persists across reload.
- [ ] Resize/rotate mid-run: floor texture rebuilds, no crash, bot stays in bounds.
- [ ] Long-press / multi-touch: joystick + boost simultaneously works.
- [ ] Save corruption: bad localStorage value → falls back to defaults (code path exists, confirm).

## P5 — Polish, PWA, deploy

- [ ] PWA: manifest has only an SVG icon — add PNG icons (192/512) + `apple-touch-icon`;
  consider a tiny service worker for true offline (thematic fit: robot vacuum offline mode 😄).
  Add `"id": "./"` to manifest.
- [ ] Audio: no ambient hum; optional low-volume room-tone loop while `state === 'run'`.
  `sfx.suck` throttling (70ms) is fine.
- [ ] Performance: floor texture rebuilds on every resize (carpet noise loop up to ~2600 px) —
  acceptable; debounce resize if mobile browsers feel it.
- [ ] Deploy: GH Pages workflow is correct (uploads repo root, triggers on main/master).
  Verify repo Pages settings point to the GitHub Actions source; add `404.html`? not needed
  (single page). Check that `main` is the pushed branch name.
- [x] **`package.json` + unit tests** (2026-07-16): added `package.json` (private, `type:
  module`, no deps, `"test": "node --test"`) and `test/upgrades.test.js` — 7 tests, all pass:
  `rollPicks` uniqueness/validity (200 rolls), **drained-pool termination (P0-5 regression
  guard: 2-left → returns, all-maxed → `[]`)**, `applyPick` max-level guard + stat math,
  `metaCost` formula + unknown id, `makeRunStats` per-bot bases / maxed-meta values / x3
  suction cap, `levelDef` theme rotation + dirt ramp + cap, and **layout hard rules** for all
  12 rooms × 4 rotations (spawn pad + dock circle clear). Run: `npm test` or `node --test`.

---

## Evidence log (from this review)

- `node --check` passes on all 9 JS files; no runtime import errors.
- Simulated 40 levels of `levelDef`: all center pads (20–24 × 20–24), dock circles, and dirt
  counts (26→160 cap) OK.
- Simulated upgrade pool: **hang risk after 33 picks** (2 distinct left); empty pool at 37.
- Clog simulation: roomba 100/100 clogs OK · mi 100/130 early clog · shark 70/100 never.
- Grep-verified orphans listed in P2 (each has exactly one definition/assignment site, zero readers).
