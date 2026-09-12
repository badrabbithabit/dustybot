# Dusty Bot — Idle / Endless Extension Plan

> **STATUS (read me first): IMPLEMENTED (2026-07-08).** User answered §8 with
> "Go" — all defaults accepted. Code, tests, and docs are in place; see §11.
> **Follow-up (2026-07-08, also confirmed with "Go"): three new dirt types**
> (static/tar/puff) — design in §4G, implemented and sim-verified.
> This doc is the source of truth for this change. If context is lost, read this
> file + `README.md` + `js/upgrades.js` (the `BALANCE` object is the source of
> truth for all tunables) and continue from §10 (checklist).

## 1. What the user asked for (2026-07-08)

1. Add an **endless / idle-game aspect** — research idle/clicker design, esp.
   **very slow passive progression while not playing**.
2. **Suction power should affect how quickly motes get sucked up.**
3. **Big motes should slow the bot down until it's upgraded enough.**
4. **Leveling: start hard → upgrades unlock speed → difficulty slowly
   increases → repeat** (endless, gently ramping).
5. **More bot designs unlocked by level completion**, including **mopping bots
   with a visible wet-floor trail**.
6. This is a big change: **ask questions first** (see §8) and **keep good
   documentation** (this file) so the work survives context compaction.

## 2. Codebase map (what exists today)

| File | Role |
|---|---|
| `js/upgrades.js` | **`BALANCE` = all tunables** (arena, dust, motes, offline, levels, bot stats, meta/run upgrades, costs). `BOTS` (3 bots: Roomba/Mi/Shark), `META_UPGRADES` (9), `RUN_UPGRADES` (11), `pickRunUpgrades`, `runLevels`, `applyPick`, `metaCost`, `levelDef`. |
| `js/game.js` | `Game` — run state machine (`menu/select/picking/playing/finished`), level load, bank, best-time, shard trickle (`0.05/s` while playing), pick flow. |
| `js/bot.js` | `Bot` — physics (accel/friction/turn), bin + clog, boost, per-bot draw. **Speed = `BOTS[id].speed` + run upgrades; no per-frame speed hooks yet.** |
| `js/dust.js` | `DustSystem` — spawn (`spawnLevel`), 4 mote types (dust/big/gold/debris), suction pull (`34*suction*(1-d/suckR)^2*6`), magnet pull, pickup, `draw`. Motes are plain objects `{x,y,vx,vy,kind,r,val,pulse}` — **no mass yet**. |
| `js/levelgen.js` | Procedural rooms (seeded), guardrails, `validateLayout`. Pure, node-testable. |
| `js/world.js` | `World` — floor pre-render per theme, obstacles, dock, render pass. `setLevel(theme, obstacles, themeKey)`. |
| `js/ui.js` | HUD, screens, toasts, hangar shop, pick cards, bot select (`buildBots`, `drawPortrait` with per-shape art: round/lidar/shark). |
| `js/main.js` | bootstrap, **offline calc** (`computeOffline`: needs `meta_ap`, 6h cap, `1.2/h + 0.05*polish/h`), save key **`dustybot_save_v2`**, main loop, UI wiring. |
| `tools/sim-bots.mjs`, `tools/steer.mjs` | Headless sim of real Bot+DustSystem with a steering AI (node). `test/*.test.js` run via `node --test test/`. |

Existing relevant mechanics: meta upgrade **`meta_ap` "Auto-Pilot"** already
gates a flat offline trickle (1.2/h, 6h cap). Level intro banner, theme
rotation every 12 levels, `levelDef` dirt curve `40+6(l-1)+12(rot)` capped 160,
`levelBonus = min(5, 0.5+0.1(l-1))`.

## 3. Research summary — idle/clicker design (synthesized from established
design practice; no live web research — no web access in this environment)

Key patterns from the canonical idle games (Cookie Clicker, Clicker Heroes,
AdVenture Capitalist, Melvor Idle, Idle Champions) and what they imply here:

1. **Active income stays the engine; idle is a trickle.** Standard rule of
   thumb: idle/offline income ≈ **5–25% of equivalent active income**, never
   enough to replace playing. The user explicitly wants **very slow** — so
   target ~10% of active, and *active* must remain clearly better.
2. **Idle rate should track player power, not be flat.** Tie it to the player's
   current progression (best level / meta level) so the trickle grows and the
   idle fantasy scales ("your bot got better while you were away" instead of
   "same 1.2/h forever").
3. **Time caps prevent absurdity, not fun.** 4–12h caps are universal. Cap +
   diminishing-returns curve keeps numbers sane. We propose 8h.
4. **Show the "away report" with flavor, not just a number.** "Cleaned 1,234
   motes in 6h12m" is 10× more satisfying than "+23 ✦" and costs nothing
   (estimate motes from shards).
5. **Idle should be *themed*, not bolted on.** Real robot vacuums keep cleaning
   on their own schedule — "Auto-Bay: your bot keeps cleaning while you're
   here but AFK" is a perfect in-fiction justification. A **visible** idle
   (bot roaming, motes being picked) in a corner canvas is a strong, cheap
   hook — "the game is alive on its menu".
6. **Pacing loop (idle meta):** hard start → quick answers (speed/efficiency
   upgrades appear early in the choice pool) → slow ramp → new "gear" of
   difficulty. The user's "start hard, unlock speed, slow increase, repeat" is
   exactly this; implementation = difficulty steps at theme-rotation
   boundaries ("gears"), flat-ish 12-level plateaus between them.
7. **Don't let idle feed a *second* economy** (no new currency yet). One
   currency (✦ shards) keeps the meta shop as the single sink; idle just pays
   into it slowly. (Revisit if/when a prestige layer is added.)

## 4. Proposed design (defaults — user to confirm in §8)

### 4A. Idle layer ("the bot keeps cleaning")

**A1 — Offline collection (existing, upgraded).** Still gated behind
`meta_ap` (Auto-Pilot meta, as today). New formula:

```
hours   = min( (now - lastSeen)/3600e3 , 8 )              // BALANCE.idle.capHours
rate/h  = (1.2 + 0.05*polishLv) * (1 + 0.12*(bestLevel-1))
shards  = floor( rate/h * hours )
motes   = floor( shards / 0.12 )                          // flavor only
```

`bestLevel` = highest level cleared, lifetime (new save field, default 0 →
treated as 1 in the formula). Worked examples (base, polish 0):
lv1: **1.2/h** (8h away ≈ 9✦) · lv10: 2.3/h · lv25: 4.6/h · lv50: 8.3/h.
Active play earns roughly ~4–10✦ per level (60–150s each) → offline stays
~10% of a few minutes of active play. **Very slow, as requested.**
Menu toast becomes: `Away 6h12m — bot cleaned ~1,230 motes · +23 ✦`.

**A2 — Live idle in the Hangar (new).** New meta upgrade
**`autobay` "Auto-Bay"** (cost 60, ×1.6, max 3):
- L1 unlocks a small ambient sim (own ~240×130 canvas at the top of the
  hangar screen): the selected bot roams a mini-room, motes spawn, it picks
  them up (uses the real steering AI, see §5 `js/steer.js`).
- Each mote collected = `0.004 * (1 + 0.5*(autobayLv-1))` ✦ (dribbled,
  HUD-less; banked to `save.shards` directly, save on interval + pagehide).
- Motes spawn every 1.5s, cap 24 in the room. Even at L1 this is a modest
  drip (~10–20✦/h if you camp the hangar — fine, you're not playing a level).
- The ambient sim runs **only while the hangar screen is visible**
  (pause on any other screen) so it never fights the run loop.

**A3 — In-run trickle** stays as-is (0.05 dust/s ≈ 0.3/h). No change.

### 4B. Suction = how fast motes come in (motes gain mass)

New `BALANCE.moteMass = { dust: 0.05, big: 1.0, gold: 0.6, debris: 1.4 }`.
Mote physics in `DustSystem.update`:

```
suctionAcc = 34 * suction * (1-d/suckR)^2 * 6 / (1 + 0.5*mass)
magnetPull = 1.5 * magnet * 0.5 / (1 + 0.3*mass)         // was 0.75*magnet
```

Higher suction → motes visibly accelerate into the bot faster; heavy motes
resist (debris at base suction barely moves → you must get closer or upgrade).
Pickup radius itself is unchanged (mass doesn't change reach, only response).

### 4C. Heavy-dust drag (big motes slow the bot until upgraded)

While motes with `mass >= 0.3` (big/gold/debris) are **inside the bot's
suction field** (being pulled), they drag on the bot:

```
dragMass  = Σ mass of heavy motes within suckR of bot     // computed in dust.update
motor     = bot.motor * (1 + 0.5*tractionLv) * (1 + 0.25*drivetrainMeta)
speedMult = motor / (motor + dragMass * 0.12)             // 0.12 = BALANCE.drag.weight
```

- `bot.motor` base 1.0 (new per-bot stat; Hog 2.0, Zippy 99 "hover", Mop 1.0).
- **New run upgrade `traction` "Heavy Motor"** (max 4, cost 3/4/5/6):
  +50% motor each — the direct answer to "my bot is dragging".
- **New meta upgrade `drivetrain` "Drivetrain"** (cost 40, ×1.6, max 4):
  +25% motor each.
- Feel at base (motor 1): 1 big mote → 0.91× speed, 2 big → 0.81×,
  2 debris → 0.67×. With traction L3 + drivetrain L2 (motor = 1*2.5*1.5=3.75):
  2 big → 0.94×. **Noticeable, fixable — exactly the ask.**
- Feedback: HUD badge `STRAIN 19%` (top-left, below level badge) when
  speedMult < 0.97; bot sprite gets a slight rotation wobble proportional to
  strain. Strained motes (the ones causing drag) render with a faint red
  velocity streak.
- Mop-bot interaction: motes on **wet** floor have effective mass halved, so
  soaked heavy motes drag half as much (see 4E).

### 4D. Level curve: hard start → speed unlocks → slow repeating ramp, endless

- **Hard start:** level 1 motes **44** (was 40) with a *higher* heavy share:
  big 20% / debris 6% (was 18%/5%). With the new drag mechanic, early levels
  genuinely feel heavy for a stock bot.
- **Speed unlocks early:** `speed` and `traction` get elevated pick weights at
  low levels (weight ×1.5 while run level < 5, alongside `suction`'s existing
  early boost) so the player gets an answer within 1–2 levels.
- **Soft ramp:** `dirt = min(150, 44 + 5*(level-1) + 10*rotation)` — hits the
  150 cap around lv 22 (rot 0) instead of 160@~22, stays flat after.
- **Repeating difficulty = "gears":** difficulty steps happen **at rotation
  boundaries** (every 12 levels, i.e. each new theme). Per rotation: heavy
  mote share +2 pts (big+debris combined, capped at 42%), obstacles already
  step up via existing `obs = 3 + rot*1.1` capped 9. Level intro banner shows
  a **"⚙ GEAR UP — messier floor"** variant on rotation boundaries so the
  repeat is legible.
- **Endless:** levels stay unbounded (already are). `levelBonus =
  min(8, 0.5 + 0.08*level)` (was 0.5+0.1 capped 5) — slow, unbounded.
- Note for later (out of scope now): `BALANCE.dust.timeBonus` currently pays
  *slower* clears more (noted in BALANCE_REVIEW.md) — it inverts the speed
  incentive the user wants; flag to user, don't change unasked.

### 4E. Mopping bot + wet-floor trail (one of 3 new bots)

**MOPPER "Suds" (🧽)** — unlocked at `bestLevel >= 5`.
- Stats: suction 0.75, speed 6.6, turnRate 5.6, bin 110, pickup 1.5,
  brush 1, magnet 0.3, motor 1.0. Weak sucker, medium mover, **utility bot**.
- **Wet trail:** while moving >1u/s, stamps a wet patch (r≈1.5u) behind it.
  Rendering: offscreen `wetCanvas` (arena-sized, 220×220) — each frame: fade
  (`destination-out`, alpha 0.02) then a soft blue circle stamp; drawn in
  `World.render` between floor and obstacles. Fades out over ~5–8s.
  Game state: coarse `wetGrid` 33×33 (1.33u cells), value 0..1, set on stamp,
  decays `*= 0.9`/s — O(1) `wetAt(x,y)` query (canvas is render-only).
- **Soak mechanic:** a mote over wet>0.25 is *soaked*: effective mass /2 and
  value ×1.5 (rounded at pickup). Soaked motes render with a blue tint + a
  tiny droplet. Play pattern: pre-soak an area, then suck it up (heavy motes
  soaked = half the drag too).
- Bin: same dust-bin semantics (pad absorbs into the bin). No water-tank
  abstraction (keeps scope).

**Two more bots** (same unlock pattern, all via `bestLevel`):
- **HOG "Bulldog" (🐗), `bestLevel >= 12`** — the tank. suction 1.15, speed
  4.6, turnRate 3.6, bin 160, pickup 2.0, magnet 1.0, brush 2, **motor 2.0**
  (drag barely touches it). Shape: chunky shark-variant (wide intake arc).
- **ZIPPY "Hover" (⚡), `bestLevel >= 20`** — the speedster. suction 0.7,
  speed 8.4, turnRate 7.5, bin 80, pickup 1.3, magnet 0.4, brush 1,
  **motor 99 (hover: immune to drag)**. Shape: shark w/ fins, cyan palette.
  (Speedster but weak bin/suction — the trade-off triad: Mop = utility,
  Hog = tank, Zippy = glass-cannon speed.)

Unlocks are **lifetime** (`save.bestLevel`, updated in `Game.nextLevel`), not
per-run. Select screen: locked cards show "clear level N to unlock", greyed.
`drawPortrait` gains a 4th shape variant (mop = round body + blue U-pad +
water tank dome). `BOTS` gains `unlockLevel`, `motor`, `shape: 'mop'`;
existing bots keep `motor: 1` (Hog/Zippy overrides).

### 4F. Save format (additive, keep key `dustybot_save_v2`)

New optional fields (old saves work unchanged — defaults via `Object.assign`):
```
bestLevel: 0            // highest level cleared, lifetime
idle: { motes: 0, ms: 0 }   // lifetime idle counters (flavor stats)
```
No field meanings change → **no key bump**. `meta.autobay` / `meta.drivetrain`
ride in the existing `meta` map. `lastSeen` already exists.

### 4G. New dirt types (follow-up, confirmed with "Go")

Difficulty beyond "more motes": three new dirt behaviors, one per gear
boundary, each with a distinct counter (so no single meta-upgrade answers
all of them). Shares are of the **non-gold** mote pool, ramp per gear
(`rot`, every 12 levels) via `BALANCE.dirt.*Shares[g]` (g = min(3, rot)):

| Type | Gear | Mass | Value | Behavior | Counter(s) |
|---|---|---|---|---|---|
| ⚡ `static` | 2 (lv 13+) | 0.25 | 3 | In the suction field it **repels**: the mote scatters and the bot is shoved back. Soaked (wet floor) → normal suction. | Turbo Brush (contact sweep ignores static), mop soak (soak check extended to `type === 'static'`), raw suction range |
| 🟫 `tar` | 3 (lv 25+) | 3.0 | 4 | **Oozes** at `tarSpeed` (0.15 u/s) in a fixed direction; bounces off walls/obstacles with direction reversal + jitter. Super-heavy → big drag contribution (0.12·3 = 0.36 per tar). | Heavy Motor / Drivetrain Kit, mop soak (mass→1.5), suction power |
| ☁️ `puff` | 4 (lv 37+) | 0.05 | 0 → 3 | On pickup gives **0** value but **splits into 3 dust motes** (val 1 each, `_spawnPiece`, respects `MAX_DUST=400`). Net 3 for extra work. | Speed — clean it before you leave the level; fast bots finish the fragments too |

- Gear shares (rot 0/1/2/3): static 0/5/8/10%, tar 0/0/5/6%, puff 0/0/0/6%.
- `levelDef` returns `staticShare, tarShare, puffShare, newDirt` (intro text
  naming the newcomer, shown by the `#intro-gear` banner on exactly lv 13/25/37).
- `dust.js`: `MOTE_R` += static 0.40 / tar 0.62 / puff 0.55; `_rollType` tiers
  gold→debris→big→static→tar→puff→dust; static repel = mote velocity kick
  (terminal ≈1 u/s) + bot **position** nudge 0.7·f·dt (isFree-checked, so it
  can't push the bot into a wall); tar ooze in the drift stage; puff split on
  pickup; per-type draw details (spark / gloss / fluffy bumps).
- Hangar idle is unaffected (its spawn def sets no new-dirt shares).
- Sim-verified: L13 (static debut) clears on par with neighbours; L40/L52
  (full gear) are the hardest levels without any bot failing outright
  (shark 84 s = intended pressure on low-motor builds).

## 5. Implementation notes per file (ordered)

1. **`js/upgrades.js`**
   - `BALANCE.idle = { capHours: 8, basePerHour: 1.2, polishPerHour: 0.05,
     levelScale: 0.12, motePerShard: 0.12 }`.
   - `BALANCE.moteMass = { dust:0.05, big:1, gold:0.6, debris:1.4 }`.
   - `BALANCE.drag = { heavyMass: 0.3, weight: 0.12 }`.
   - `BALANCE.mop = { stampR: 1.5, minSpeed: 1, wetCell: 1.33, dryRate: 0.9,
     soakThresh: 0.25, massDiv: 2, valMult: 1.5 }`.
   - `levelDef`: new dirt curve `min(150, 44+5(l-1)+10rot)`; heavy-share base
     26% (+2/rot, cap 42%); `def.gearUp = (level-1) % 12 === 0 && level > 1`;
     `levelBonus = min(8, 0.5+0.08*level)`.
   - `BOTS`: add `mopper`, `hog`, `zippy` (stats above, `unlockLevel` 5/12/20,
     `motor` 1/2/99, shapes 'mop'/'tank'/'shark'); existing bots `motor:1`,
     `unlockLevel: 0`.
   - `RUN_UPGRADES`: add `traction` (icon 🔩, "Heavy Motor", max 4, cost
     [3,4,5,6], "bot.motor +50% — resists heavy-dust drag"), early weight
     boost at low levels (mirror `suction`'s `l<5 ? 1.5 : 1`).
   - `META_UPGRADES`: add `autobay` (🤖, max 3, cost 60, ×1.6, "bot cleans in
     the hangar while you browse; +idle rate") and `drivetrain` (⚙️, max 4,
     cost 40, ×1.6, "motor +25%").
   - `applyPick`: `case 'traction'`.
2. **`js/steer.js`** (NEW) — move the steering AI from `tools/steer.mjs` into
   a shared DOM-free module (`steerToward(mote, bot, obstacles)` +
   `nearestMote(motes, x, y, maxD)`); `tools/steer.mjs` re-exports it so the
   sim keeps working. Hangar idle + sim share one AI.
3. **`js/dust.js`** — motes get `mass` (by kind) + `soaked` flag; acc/magnet
   mass-scaled; `dust.update(dt, bot, wetAt)` computes `dragMass` (heavy motes
   in suckR) and returns it; soaked = `wetAt(mote) > 0.25` → effMass/2,
   valMult on pickup; soaked render (blue tint/droplet); strained-mote streaks
   for drag contributors.
4. **`js/bot.js`** — `this.motor` from bot def; `this.speedMult` set by Game
   each frame (1 when no drag); velocity *= speedMult; wobble rotation by
   strain when drawing; Mop: after moving, `world.stampWet(x, y - facing,
   stampR)` if speed>minSpeed (only when bot has `mop: true`).
5. **`js/world.js`** — wet system: `wetCanvas` (220², offscreen) + `wetGrid`
   (Float32Array 33²); `stampWet(x,y,r)`, `updateWet(dt)` (fade + grid decay,
   called from Game update **only during playing**… note: call from render?
   NO — update in `game.update`, render in `render`), `wetAt(x,y)`; clear in
   `setLevel`; draw wet layer in `render()` after floor, before obstacles
   (soft blue `rgba(90,170,255,0.16)` per stamp, rounded, slightly darker edge).
6. **`js/game.js`**
   - `newRun()`: bot from `save.selectedBot` must be unlocked; load level as
     now. `nextLevel()`: `save.bestLevel = max(bestLevel, level)` before
     `level++`; if `def.gearUp` use banner variant.
   - `update(dt)`: after `dust.update`, `const drag = dust.dragMass;
     bot.speedMult = drag>0 ? motor/(motor+drag*0.12) : 1;`
     pass `world.wetAt` into dust.update when bot is a mop.
   - HUD: expose `strain` (=1-speedMult) in `UI.setHud`.
   - **Hangar idle mode:** `game.state='hangar'` already exists for the screen;
     add `game.idleSim` = mini-sim (own motes array, bot pos, uses `steer.js`;
     its own 24u×14u room w/ 2 obstacle rects) updated in `game.update` only
     while hangar visible; mote pickup → `save.shards += value`, `game.onSave()`
     throttled (every 5s). Render onto `#hangar-idle` canvas in the main
     `frame()` when visible.
7. **`js/main.js`** — `computeOffline(save)`: new formula (§4A, use
   `save.bestLevel`); toast flavor `~N motes`; `save.idle` counters;
   hangar-idle value scaling reads `save.meta.autobay`.
8. **`js/ui.js`** — `buildBots(save…)`: locked cards (needs
   `save.bestLevel`; grey card + "🔒 clear level N"); tagline → "N machines";
   `showLevelIntro(def, level, gearUp)`; HUD `#drag-hud` element (hidden
   unless strain>3%); hangar screen: `#hangar-idle` canvas + Auto-Bay status
   line.
9. **`index.html`** — `#drag-hud` in HUD; `#hangar-idle` canvas in hangar
   screen; (tagline text updates via JS).
10. **`js/world.js` portrait art** is actually in `ui.js` (`drawPortrait`) —
    add `mop`, `tank` shapes there.
11. **Tests/sim**
    - `test/upgrades.test.js`: new upgrades exist/cost/apply; `levelDef` new
      curve bounds (dirt ≤150, heavy share ≤42%, gearUp at 13/25/37…);
      BOTS new entries have motor/unlockLevel.
    - `test/idle.test.js` (NEW): offline formula monotonic in bestLevel and
      time; cap at 8h; missing-fields migration (old save shape); motes
      estimate integer.
    - `tools/sim-bots.mjs`: sim all 6 bots (base/mid/maxed scenarios),
      enable drag (it's automatic once dust reports it), add a **mop
      scenario** (wet grid stub: always-wet test? simpler: verify mopper
      clears slower-but-ok; assert no NaNs and clear times in range).
    - `test/levelgen.test.js` unchanged (levelgen untouched — curve is in
      `levelDef`).
12. **Docs** — update `README.md` (controls/features/balance), append
    `BALANCE_REVIEW.md`? No — keep that historical. Update this file's
    changelog (§11) as work lands.

## 6. Formula summary (single source — all constants live in BALANCE)

| Thing | Formula |
|---|---|
| offline shards | `floor((1.2+0.05·polish)·(1+0.12·(bestLevel−1)) · min(hours,8))` (needs meta_ap) |
| away motes (flavor) | `floor(shards / 0.12)` |
| hangar idle | per mote `0.004·(1+0.5·(autobay−1))` ✦, spawn 1/1.5s, cap 24 (needs autobay) |
| suction acc | `34·suction·(1−d/suckR)²·6 / (1+0.5·mass)` |
| magnet pull | `1.5·magnet·0.5 / (1+0.3·mass)` |
| drag speedMult | `motor / (motor + 0.12·ΣheavyMass in suckR)`, `motor = botDef.motor·(1+0.5·traction)·(1+0.25·drivetrain)` |
| soaked mote | on wet>0.25: mass/2, value ×1.5 |
| dirt/level | `min(150, 44 + 5·(l−1) + 10·rot)` |
| heavy share | `26% + 2%/rot`, cap 42% (big:debris 4:1 of that pool… keep existing 18/6 ratio scaled) |
| level bonus | `min(8, 0.5 + 0.08·level)` |

## 7. Risks / open technicals

- Wet-grid decay timing: update in `game.update` (dt-based), NOT render (fps-based).
- `dust.update` currently takes `(dt, bot)`; adding `wetAt` is an optional 3rd arg (default null → no soak) to keep sim simple.
- Hangar idle must not touch `world`/`game.dust` (the run world may be torn
  down); it's a self-contained mini-sim with its own render target.
- Drag must not stack with boost weirdly: apply speedMult to the desired-velocity
  target (before accel), so boost still multiplies on top of an already-slowed
  base. (Verify in sim: boost + max drag still < base no-drag speed? Acceptable
  if boost slightly overcomes strain — feels right.)
- 6 bots × 3 scenarios × 12 levels × 3 seeds sim runtime — keep seed count at 2
  if slow (old run was already ~fine).
- `buildBots` signature changes (needs save for unlocks) — update call site in
  `game.showSelect()`.

## 8. Open questions for the user (asked 2026-07-08 — ANSWERED 2026-07-08:
user replied **"Go"**, all defaults accepted as written below)

1. **Idle scope** — OK with *both* offline trickle (upgraded) AND a visible
   hangar idle (small canvas, behind new meta upgrade "Auto-Bay")? [default: yes]
2. **Offline pace** — 1.2/h base @lv1, +12%/level, 8h cap (≈9✦ overnight @lv1,
   ≈66✦ @lv50)? "Very slow" per your ask — confirm. [default: yes]
3. **Drag strength** — 2 debris motes ≈ −33% speed at base, fully answerable
   by Heavy Motor (run) + Drivetrain (meta)? Should gold motes also drag
   (they're rare+valuable)? [default: yes, all heavy types]
4. **Level curve** — lv1 = 44 motes (heavier mix), ramp 5/level to cap 150,
   difficulty steps only at 12-level "gear" boundaries, levels endless?
   [default: yes]
5. **New bots** — exactly 3 (Mop 🧽 lv5 · Hog 🐗 lv12 · Zippy ⚡ lv20),
   unlocked by *lifetime best level*, mop's hook = wet trail + soaked motes
   (mass/2, value ×1.5)? [default: yes]
6. **Save** — keep key `dustybot_save_v2` with additive fields (no migration
   break)? [default: yes]
7. **(Flag, no change planned)** the existing time bonus pays *slower* clears
   more, which fights the "unlock speed" goal — want a follow-up fix or leave
   it for now? [default: leave]

## 9. Out of scope (explicit)

- No prestige/ascension layer yet (shards stay the only meta currency).
- No new themes, no new rooms (levelgen untouched).
  *("No new mote types" was lifted by the 2026-07-08 follow-up — see §4G.)*
- No auto-pilot *during* a run (the bot does not play the level for you).
- No sound changes.
- Not fixing the time-bonus inversion (§8.7) unless asked.

## 10. Checklist (update as work lands)

- [x] User answers §8 ("Go" — all defaults)
- [x] `js/upgrades.js`: BALANCE.idle/moteMass/drag/mop; levelDef curve; BOTS +3; traction/autobay/drivetrain
- [x] `js/steer.js` shared; tools/steer.mjs re-exports
- [x] `js/dust.js`: mass, soaked, dragMass return, render cues
- [x] `js/bot.js`: motor, speedMult, wobble, mop stamp
- [x] `js/world.js`: wetCanvas + wetGrid, render layer, clear on setLevel
- [x] `js/game.js`: bestLevel, gearUp banner, drag→speedMult, hangar idle sim, hud strain
- [x] `js/hangar.js`: new — HangarIdle live sim class (own canvas, fake world, mop bot)
- [x] `js/main.js`: offline formula + flavor toast, idle counters
- [x] `js/ui.js` + `index.html` + `css/style.css`: locked bot cards, drag HUD, hangar canvas, intro gear variant, portraits (mop/tank/hover)
- [x] tests: 26/26 green (upgrades, levelgen, idle); sim all 6 bots on wet world + drag, 14 levels to L52
- [x] README updated; §11 changelog
- [x] New dirt types (§4G): `upgrades.js` shares + `levelDef`, `dust.js` behaviors/draw, `ui.js` intro text, palette colors, sim LEVELS +40/52, share tests
- [ ] Manual QA in browser (offline calc, drag feel, wet trail look, unlocks, endless to lv 60, new dirt at 13/25/37) — needs a human at a screen

## 11. Changelog

- **2026-07-08** — Doc created (research + full design).
- **2026-07-08** — Implemented (user said "Go", defaults accepted):
  - `js/steer.js` new (shared AI: `R`, `rayClear`, `firstBlocker`, `detourWaypoint`, `steer`); `tools/steer.mjs` re-exports it.
  - `js/upgrades.js`: `BALANCE.moteMass/drag/mop/offline/hangar`; `offlineGain(save)` + `hangarRate(save)`; `levelDef` endless curve (dirt `min(150, 44+5(l−1)+10·rot)`, gearUp every 12 levels, bigShare/debrisShare ramp); BOTS +3 (SUDS mop lv5, HOG tank lv12, ZIPPY hover lv20, unlocked by `bestLevel`); run upgrade `traction` (max 4, ×1.5 motor); meta `autobay` (max 3 → hangar mult 0/1/2/4) + `drivetrain` (max 4, motor ×(1+0.25·lvl)).
  - `js/dust.js`: motes have `mass`; suction/magnet scaled by effective mass; wet `wetAt` soak (heavy motes on wet floor: mass÷2, value×1.5, blue droplet cue); `dragMass` accumulator; `spawnLevel` takes level `def` for mix shares.
  - `js/bot.js`: `speedMult`/`strain` fields, drag slowdown, strain wobble, mop wet-trail stamping; draw cases for `mop`/`tank`/`hover`.
  - `js/world.js`: resolution-independent wet grid (`_wetRes=6`, Float32Array, decay `exp(−0.08·dt)`, energy-gated ImageData render), cleared on `setLevel`.
  - `js/hangar.js` new: `HangarIdle` — self-contained mop-bot cleaning sim for the hangar screen (fake world 24×13, own 520×280 canvas, dock dumps, anti-stall).
  - `js/game.js`: `bestLevel` tracking, gear-up intro banner, drag→`bot.speedMult` wiring + `#drag-hud` (🐗 HEAVY DUST %), hangar screen state + live `hangarRate` shard accrual + `save.idle` persistence.
  - `js/main.js`: upgraded offline gain (flavor toast, meta_ap gated at call site) + hangar idle counters on return to menu.
  - `js/ui.js` + `index.html` + `css/style.css`: hangar canvas + idle line + shards chip, locked bot cards (grayscale, unlock hint), drag HUD, `#intro-gear` banner, portraits for mop/tank/hover, "six machines · six play styles".
  - `test/idle.test.js` new; `test/upgrades.test.js` P0-5 fixed; **25/25 pass**.
  - `tools/sim-bots.mjs`: all 6 bots, wet grid in fake world, drag `speedMult` in loop; full 6-bot sim run clean (base clears 47–68 s across bots/levels; mop verified to stamp wet, reach wetness 1.0, and soak heavy motes for ×1.5 value via probe).
  - **Known/deferred** (see balance review): time-bonus inversion (left as-is per §8.7), Turbo Brush `brushLevel` flag, `boostDur` 1.0s (works as designed).
- **2026-07-08** — New dirt types (user follow-up, confirmed "Go"; design §4G):
  - `js/upgrades.js`: `BALANCE.moteMass` += static 0.25 / tar 3.0 / puff 0.05; `BALANCE.dirt` += `staticShares` [0,.05,.08,.10], `tarShares` [0,0,.05,.06], `puffShares` [0,0,0,.06], `tarSpeed` 0.15; `levelDef` returns `staticShare/tarShare/puffShare/newDirt` (gear-keyed, capped at rot 3).
  - `js/dust.js`: `MOTE_R` extended; `_rollType` gains static/tar/puff tiers; tar gets `it.dir` + ooze movement (bounce on walls/obstacles); static repels in the suction field (mote kick + isFree-checked bot position nudge; soaked → normal suction); puff splits into 3 dust motes (`_spawnPiece`, MAX_DUST-safe) on pickup; soak check extended to static; per-type draw details + `_colors` entries.
  - `js/ui.js`: gear-up intro banner names the new dirt (`def.newDirt`) when present.
  - `js/palette.js`: `staticCh`, `tar`, `puff` colors.
  - `tools/sim-bots.mjs`: LEVELS 12→14 (added 40, 52). Full 6-bot sim clean; new-dirt levels ramp without breaking any bot.
  - `test/idle.test.js`: +new-dirt share/boundary test → **26/26 pass**.
