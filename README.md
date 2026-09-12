# Dusty Bot

A 2D roguelike robot vacuum. Clear themed levels of dust, pick upgrades,
bank ✦ Dust Shards for permanent meta upgrades. Mobile-first (phone
portrait), no build step, no dependencies.

[Spec & balance tables: PLAN.md](PLAN.md) · [Review/QA log: REVIEW.md](REVIEW.md) · [Idle/endless extension: IDLE_PLAN.md](IDLE_PLAN.md)

## Run it

Any static file server works (it's pure ES modules):

```sh
# from the repo root
python -m http.server 8080
# or: npx serve .
```

Then open http://localhost:8080 — or just push to `main`; GitHub Pages
serves the repo root (see `.github/workflows/pages.yml`).

> Opening `index.html` via `file://` may block `localStorage`/modules in
> some browsers — use a server.

## Controls

| Input | Action |
|---|---|
| Left-half drag | virtual joystick (analog steer) |
| Right-half tap | drive to the tapped point |
| Boost button (hold) | boost (cooldown after release) |
| WASD / arrows | desktop steering |
| Space | desktop boost |
| Mouse click | desktop tap-to-move |

## Idle & endless

- **Endless levels** — no hard cap; dirt per level ramps gently (44 → 150)
  with difficulty stepping up every 12 levels ("gear up" banner).
- **Offline shards** — requires the **Auto-Pilot Sensor** meta upgrade.
  Rate ≈ `1.2/hr × (1 + 0.05·polish) × (1 + 0.12·(bestLevel−1))`, accruing
  proportionally from the second you're away, capped at 8h.
- **Hangar auto-bay** — the **Auto-Bay** meta upgrade (max 3 → ×1/×2/×4)
  keeps a mop bot visibly cleaning a small hangar scene while you're on the
  hangar screen; it banks shards at a flat rate. Motes cleaned there are
  purely cosmetic — the economy is the flat rate, not the sim.
- **Six bots** — SUDS 🧽 (lv5), HOG 🐗 (lv12) and ZIPPY ⚡ (lv20) unlock by
  your lifetime best level. Heavy dust (big motes, debris, gold) drags the
  bot down (🐗 HUD); the mop bot leaves a wet trail that soaks heavy motes
  (half mass, ×1.5 value). Answer drag with **Heavy Motor** (run) and
  **Drivetrain Kit** (meta).
- **New dirt types** — one new dirt behavior per gear boundary, named in the
  level intro: ⚡ **static** (lv 13+, repels suction — brush it in or soak it
  with the mop), 🟫 **tar** (lv 25+, super-heavy and it keeps oozing),
  ☁️ **puff** (lv 37+, splits into 3 motes when vacuumed). Shares ramp with
  the gear and cap at 10/6/6% of non-gold motes.

## Save data

`localStorage` key `dustybot_save_v2`:

```json
{ "shards": 0, "meta": {}, "lastSeen": 0, "bestTime": 0, "runs": 0, "bestShards": 0, "bestLevel": 0, "idle": { "motes": 0, "ms": 0 } }
```

All fields are additive — old saves load fine. Delete the key (DevTools →
Application → Local Storage) to start fresh.

## Layout

```
index.html            screens: menu / select / hangar + HUD
css/style.css         theme
js/main.js            bootstrap, save/load, offline calc, loop
js/game.js            run state machine, shard banking
js/world.js           2D canvas world + rendering (4 themes)
js/levelgen.js        procedural room generator (seeded, guarded, pure)
js/bot.js             bot entity (6 bots), bin/clog, boost, mop wet stamping
js/dust.js            mote system: suction / brush / magnet / pickup / soak / drag / static / tar / puff
js/steer.js           shared steering AI (also drives the hangar sim)
js/hangar.js          hangar idle sim (mop bot in a mini room, own canvas)
js/controls.js        joystick, tap-to-move, keyboard
js/upgrades.js        BOTS, upgrades, themes, levelDef, BALANCE (source of truth)
js/ui.js              screens, HUD, pick panel, toasts, bot portraits
js/audio.js           WebAudio synth SFX
js/palette.js         shared palette
```
