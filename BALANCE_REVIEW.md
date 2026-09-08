# Dusty Bot — Bot & Upgrade Balance Review

Review of the three bots and the run/meta upgrade paths, based on a headless
simulation of the *real* `Bot.update` + `DustSystem.update` (no browser), plus a
line-by-line read of `js/upgrades.js`, `js/bot.js`, `js/dust.js`, `js/game.js`.

Sim harness: `tools/sim-bots.mjs` (run with `node tools/sim-bots.mjs`).
Source of truth for all numbers: `js/upgrades.js`.

---

## TL;DR

- **One P0 gameplay bug:** the boost is effectively **dead** (1 frame of 1.7×
  per 4 s cycle → ~0.4 % duty). This silently disables the **Overdrive** upgrade,
  **Shark's** `boostCdMult 0.85`, and the boost button. Fix is a 5-line `boostDur`
  timer in `js/bot.js`.
- **One upgrade that can *downgrade* a bot:** Turbo Brush sets `brushLevel` to an
  *absolute* value, so a Roomba (starts at `brushLevel 2`) picking up Turbo Brush
  L1 drops to level 1.
- **The real bot asymmetry is the opposite of the obvious read.** On paper Shark
  is the "power" bot, but in the **base** state it is the *slowest* and the most
  likely to stall, because its tiny 70-bin forces ~2 dock trips and ~0.56
  clogs/level. It only becomes the fastest bot *after* a bin upgrade (mid build).
  Mi is the best base bot but the **worst at max** (46 % slower than Roomba)
  because its low base suction (0.9) is the floor under every Suction Core pick.
- **Bin size is the hidden stat.** It dominates base-level pacing (dock trips +
  clogs) more than suction does, yet the bin upgrades are mid-pool.
- **Economy quirk:** the passive shard trickle is *time-based*, so slower clears
  earn *more* shards — inverting the speed incentive.

Concrete, identity-preserving recommendations are in §6.

---

## 1. Method

`tools/sim-bots.mjs` imports the production `Bot`, `DustSystem`, `levelDef`, and
`applyPick` (all pure ES modules, no DOM) and plays each bot with a deterministic
AI:

- 3 seeds per level × 12 sampled levels (L1…L34, step 3) per scenario.
- 240 s cap per level (a "fail" = not cleared in 240 s).
- AI: steer to nearest mote, deflect off the *expanded* obstacle, anti-stall
  skip, and a final "dump at dock" pass when the floor is empty.
- Three upgrade scenarios: **base** (none), **mid** (Suction Core ×2, Speed Coil
  ×1, Extra Hopper ×1, Wide Suction ×1 — a representative ~level-9 build),
  **maxed** (every run upgrade to its max — the 37-pick ceiling build).
- Boost is simulated **off** (it is dead as shipped) and measured separately.

**Caveat — sim AI is not a human.** The AI uses a short (1.5 u) lookahead and
cannot always route *around* a corner to a mote on the far side of an obstacle.
A handful of base runs (mostly Shark, 8/36) time out this way. Confirmed by
tracing one: the bot is translating fine, just oscillating below a desk instead of
committing to a route around it. A human would walk around the desk. So treat
"fails" as an **upper bound on difficulty**, not a game soft-lock (there is no
failure state anyway). The *raw* clear times, dump counts, and clog counts are
still valid and are the primary signal.

---

## 2. Bot stats (base, from `BOTS`)

| stat | Roomba | Mi | Shark |
|---|---|---|---|
| suction | 1.0 | 0.9 | **1.3** |
| suctionRange | 3.4 | 3.0 | **4.2** |
| pickupRadius | **1.7** | 1.5 | **1.9** |
| brushLevel | **2** | 1 | 1 |
| speed | 6.0 | **7.2** | 5.1 |
| turnRate | 5.0 | **6.4** | 4.0 |
| magnetRange | 0 | 0.6 | **1.6** |
| binMax | 100 | **130** | **70** |
| boostCdMult | 1.0 | 1.0 | 0.85 |

Derived reach (from `js/dust.js`):

- **Suction reach** `suckR = max(pickupRadius+0.5, suctionRange·suction)`:
  Roomba **3.4** · Mi **2.7** · Shark **5.46**
- **Magnet active radius** `magnetRange+2`:
  Mi 2.6, Shark 3.6 — *both sit entirely inside their own suction reach*, so the
  base magnet adds nothing beyond suction (see §5.5 / B5).
- **Brush reach** `radius·(1.6+0.12·brushLevel)`:
  Roomba **1.84** (lvl 2) · Mi 1.72 · Shark 1.72.

---

## 3. Simulation results

Mean over 3 runs × 12 levels. "fails" = not cleared in 240 s (AI artifact, §1).

### Base (no upgrades)

| bot | clear (s) | dist (u) | clogs/lvl | dumps/lvl | shards/lvl | fails |
|---|---|---|---|---|---|---|
| Roomba | 65.6 | 381 | 0.03 | 1.61 | 13.6 | 2 |
| Mi | 58.0 | 405 | 0.00 | 1.56 | 13.4 | 1 |
| Shark | 96.8 | 452 | **0.56** | **2.00** | 14.9 | **8** |

Per-level base clear (s), `F` = all 3 runs failed:

| bot | L1 | L4 | L7 | L10 | L13 | L16 | L19 | L22 | L25 | L28 | L31 | L34 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Roomba | 32 | 37 | 39 | 49 | 63 | 62 | 62 | 61 | 67 | 66 | 65 | 64 |
| Mi | 27 | 32 | 36 | 44 | 49 | 60 | 53 | 93 | 58 | 56 | 58 | 59 |
| Shark | 36 | 39 | 39 | 56 | 51 | 67 | 59 | 66 | 65 | 75 | 59 | 67 |

### Mid (Suction×2, Speed×1, Hopper×1, Wide×1)

| bot | clear (s) | clogs/lvl | dumps/lvl | fails |
|---|---|---|---|---|
| Roomba | 49.1 | 0.03 | 1.53 | 2 |
| Mi | 51.9 | 0.00 | 1.42 | 2 |
| **Shark** | **35.4** | 0.39 | 1.81 | **0** |

### Maxed (every run upgrade at max)

| bot | clear (s) | clogs/lvl | dumps/lvl | shards/lvl | fails |
|---|---|---|---|---|---|
| **Roomba** | **14.4** | 0.00 | 1.00 | 18.3 | 0 |
| Shark | 16.6 | 0.00 | 0.97 | 18.5 | 1 |
| Mi | 21.1 | 0.00 | 0.97 | 18.8 | 1 |

### Boost micro-test (real `Bot.update`, boost held 8.0 s)

```
frames with 1.7× speed active: 2 / 480  (0.4%)
→ ~0.03 s of boost over 8 s of holding the button. Boost is dead.
```

---

## 4. What the numbers say

1. **Shark is a two-faced bot.** Base: slowest mean clear, most clogs (0.56),
   most trips (2.00), most fails. Mid (once it has a bin): **fastest** (35.4 s,
   28 % ahead of Roomba). Its tiny 70-bin is the whole story: suction is great,
   but it keeps running full and walking back to a dock that sits at the top of
   a 44 u arena.
2. **Mi is front-loaded.** Best base (58 s), but its 0.9 base suction is the
   floor under every Suction Core, so at max it is the **slowest** (21.1 s, 46 %
   behind Roomba). Its "fast" identity is movement speed, which matters far less
   than suction throughput.
3. **Roomba is the endgame winner.** Balanced base, but its `brushLevel 2` and
   larger `pickupRadius 1.7` compound with maxed upgrades into the fastest maxed
   bot (14.4 s).
4. **Bin is the hidden stat.** Trip/clog tax scales with `binMax`, and the dock
   is far. Base trip thresholds by bin: Shark (70) needs 2 trips from ~L9,
   Roomba (100) from ~L14, Mi (130) from ~L19. This dominates early pacing more
   than any suction difference.
5. **Suction snowballs, bin doesn't get the credit.** Suction upgrades multiply
   `suction` (and add range), the highest-leverage stat — so a high-suction bot
   compounds. The bin upgrades are flat `+25/+20` and mid-pool, so they feel
   weak next to suction even though they remove real trip time.
6. **Economy inverts the speed incentive.** `shardPerSecond` accrues every frame,
   so a level that takes 240 s pays ~12 shards of *time* alone — more than the
   dirt on many early levels. Slower play = more shards.

---

## 5. Bugs & code/design mismatches

### B1 — Boost is effectively dead  **P0, gameplay**

`js/bot.js`:
```js
this.boostCd = Math.max(0, this.boostCd - dt);
const wantBoost = input.boost && this.boostCd === 0;
if (wantBoost && !this.boosting) { this.boosting = true; this.onBoost && this.onBoost(); }
if (!wantBoost) this.boosting = false;
```
`game.js` `onBoost` sets `boostCd = max(floor, boostCd·boostCdMult)` = 4.0 s.
So on the frame the boost fires, `boostCd` becomes 4.0; the **next** frame
`boostCd≈3.98 ≠ 0` → `wantBoost=false` → `boosting=false`. The boost is on for
**exactly 1 frame (~16 ms) per 4 s cycle** → ~0.4 % duty (confirmed: 2/480).

Consequences (all silent no-ops today):
- The boost button does nothing visible.
- **Overdrive** (reduces `boostCdMult`) is worthless.
- **Shark's** identity stat `boostCdMult 0.85` is worthless.

**Fix (minimal, keeps the `onBoost` wiring):** add a burst timer.
```js
// BALANCE.bot.boostDur = 1.0   (new)
this.boostCd  = Math.max(0, this.boostCd - dt);
this.boostDur = Math.max(0, (this.boostDur ?? 0) - dt);
const wantBoost = input.boost && this.boostCd === 0 && this.boostDur === 0;
if (wantBoost && !this.boosting) {
  this.boosting = true;
  this.boostDur = BALANCE.bot.boostDur;
  this.onBoost && this.onBoost();          // still sets boostCd + floor
}
this.boosting = this.boostDur > 0;
```
Result: ~1.0 s burst per 4.0 s period = **25 % duty ≈ +17.5 % mean speed**, and
Overdrive/Shark now do something. *Tune after playtest:* because Overdrive
shrinks the period while the burst stays fixed, it also raises duty (up to
~49 % at L3) — if that's too strong, have Overdrive extend `boostDur` instead of
only cutting cooldown, or cap duty.

### B2 — Dead constant `clogSuctionMult`  **low, code/design mismatch**

`BALANCE.bin.clogSuctionMult: 0.5` is never read. `PLAN.md` and `js/dust.js`
both make suction **fully OFF** when clogged (`suckR = 0` when `bot.full`), and
`clogWeightMult` (1.25, the slow-down) *is* used. Remove the dead constant (or
set it to 0) so the table of truth matches the code.

### B3 — Turbo Brush can *downgrade* the Roomba  **medium, bug**

`js/upgrades.js` `applyPick('brush')` does `s.brushLevel = n` (**absolute**
1…5). Roomba starts at `brushLevel 2`, so its first Turbo Brush sets it to **1**
— a strict loss of brush reach. Mi/Shark (start at 1) get a no-op on L1.

**Fix (additive):**
```js
apply: (s) => {
  const nl = Math.min(5, (s.brushLevel || 0) + 1);
  s.brushLevel = nl;
  if (nl >= 2) s.pickupRadius *= 1.2;      // keep the "≥L2 pickup bonus" intent
}
```

### B5 — Base magnet is redundant  **low, design**

`magnetRange+2` for Mi (2.6) and Shark (3.6) falls entirely inside their own
`suckR` (2.7 / 5.46), so the base magnet adds no extra pull — it only matters
after Magnet Motor upgrades. This makes Shark's blurb ("sticky magnet") slightly
misleading at base. Options: (a) leave the stat and soften the blurb, (b) raise
base `magnetRange` so it actually extends past suction, or (c) give the magnet an
independent pull. Lowest risk: **(a) fix the blurb**.

---

## 6. Recommended changes (prioritized)

All are identity-preserving. Numbers are starting points — re-run the sim (§7)
after applying.

| # | Change | Why | Risk |
|---|---|---|---|
| 1 | **Fix boost** (B1): add `boostDur=1.0`, boost while `boostDur>0`, trigger on `input.boost && boostCd===0 && boostDur===0` | Un-boosts the button, Overdrive, and Shark's 0.85 | Low (isolated) |
| 2 | **Turbo Brush additive** (B3) | Removes a bot-downgrading upgrade | Low |
| 3 | **Remove dead `clogSuctionMult`** (B2) | Table of truth = code | None |
| 4 | **Shark `binMax` 70 → 90** | Fixes the worst base experience (2.00→~1.8 dumps, 0.56→~0.35 clogs); still the smallest bin | Low |
| 5 | **Mi `suction` 0.9 → 1.0** | Closes the 46 % maxed gap; Mi stays distinct via speed/turn/bin/magnet | Low |
| 6 | **Shark `suctionRange` 4.2 → 3.8** *(optional)* | Caps the mid snowball (suckR 9.73 → ~9.0) so the "Shark+bin" build isn't 28 % faster | Low — verify it still *feels* like the power bot |
| 7 | **Shard trickle** — make `shardPerSecond` a flat per-clear bonus (or cut it) | Stops rewarding slow play | Low, economic |
| 8 | **Shark blurb** (B5) — "the magnet really kicks in once upgraded" | Blurb matches the redundant base magnet | None |

**What I would *not* change:** Roomba (it's the correct balanced reference and the
maxed winner), the dirt ramp (fine), the 160 cap (fine), magnet base values
(accept as "unlocks on upgrade" per #8).

**Identity after fixes**
- **Roomba** — balanced all-rounder, endgame-solid. (unchanged)
- **Mi** — fast scout, big hopper, and now a real endgame citizen.
- **Shark** — the power bot that is *playable from level 1* (bigger bin) but
  still the heaviest on trips, with the best suction ceiling (lightly capped).

---

## 7. To verify after changes

```bash
node tools/sim-bots.mjs     # re-run the 3 scenarios; compare §3 tables
node --test test/           # existing upgrade tests must stay green
```
Suggested new assertions in `test/upgrades.test.js`:
- `applyPick('brush')` on a Roomba (`brushLevel 2`) **increases** `brushLevel`
  (guards B3).
- `BALANCE.bot.boostDur` exists and `Bot` sets `boosting=true` for >1 frame when
  boost is held (guards B1).
- No reference to `clogSuctionMult` remains (guards B2).

---

## 8. Files to touch

- `js/bot.js` — B1 boost timer.
- `js/upgrades.js` — B2 constant, B3 brush apply, Shark `binMax`/`suctionRange`,
  Mi `suction`, (optional) `shardPerSecond` → per-clear.
- `js/game.js` — only if the shard trickle moves to a per-clear bonus.
- `BALANCE_REVIEW.md` — this doc.
- `tools/sim-bots.mjs` — keep as a dev balance tool (or delete).
- `test/upgrades.test.js` — new assertions above.

---

## 9. Post-fix verification (applied & re-run)

Applied: B1 boost burst, B2 dead constant removed (incl. the dead `clogMult`
branch in `dust.js`), B3 additive Turbo Brush, Shark `binMax` 70→90, Mi
`suction` 0.9→1.0, Shark blurb. **Not** applied (left as playtest calls):
Shark `suctionRange` 4.2→3.8 and the shard-trickle change.

`npm test` → **9/9 pass** (2 new regression tests: boost duty, additive brush).
Re-ran `node tools/sim-bots.mjs`:

| metric | before | after |
|---|---|---|
| Boost duty (8 s hold, real `Bot.update`) | 2/480 = **0.4 %** | 120/480 = **25.0 %** (~2.0 s of 1.7×) |
| Shark base dumps/level | 2.00 | **1.67** |
| Shark base clogs/level | 0.56 | **0.36** |
| Mi mid-build clear | 51.9 s | **48.1 s** |
| Mi maxed (successful runs) | ~14.9 s | ~13.1 s |
| Roomba (base/mid/maxed) | 65.6 / 49.1 / 14.2 s | 65.6 / 49.1 / 14.2 s (unchanged, as intended) |

**Reading the new tables** (full output in the run above):
- **Boost fixed** — exactly the designed 1.0 s burst / 4.0 s period. Overdrive
  and Shark's `boostCdMult 0.85` now do something.
- **Shark base** is meaningfully better (−36 % clogs, −16 % trips) while staying
  the smallest-bin bot. It remains the slowest base bot — by design of the
  identity, and the 8 base "fails" are the same sim-AI cornering artifact.
- **Mi's endgame gap closed most of the way**: 46 % → ~36 % behind Roomba on
  headline averages; on successful runs it's ~13 s vs Roomba's ~14 s — i.e.
  **on par**.
- **Two headline numbers look like regressions but aren't:** Shark mid (35.4 →
  40.5) and the *old* Shark maxed (16.6) each include **one 240 s AI-fail run**
  in the mean. Per successful run: Shark mid ≈ 34.8 s (unchanged), Shark maxed
  was always ≈ 10.2 s (new run: 10.0 s, 0 fails). At maxed, Shark's suckR ≈
  21.7 u (vs Roomba 14.7, Mi 13.7) is the dominant snowball — that's the
  optional `suctionRange 4.2→3.8` cap to try in playtest.
- Base "fails" (2 Roomba / 3 Mi / 8 Shark) are all the sim-AI deflection
  oscillation (traced in §1), not game soft-locks.
