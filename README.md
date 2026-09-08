# Dusty Bot

A 2D roguelike robot vacuum. Clear themed levels of dust, pick upgrades,
bank ✦ Dust Shards for permanent meta upgrades. Mobile-first (phone
portrait), no build step, no dependencies.

[Spec & balance tables: PLAN.md](PLAN.md) · [Review/QA log: REVIEW.md](REVIEW.md)

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

## Save data

`localStorage` key `dustybot_save_v2`:

```json
{ "shards": 0, "meta": {}, "lastSeen": 0, "bestTime": 0, "runs": 0, "bestShards": 0 }
```

Delete the key (DevTools → Application → Local Storage) to start fresh.
Offline shards require the **Auto-Pilot Sensor** meta upgrade and accrue up
to 8h after 60s+ away.

## Layout

```
index.html            screens: menu / select / hangar + HUD
css/style.css         theme
js/main.js            bootstrap, save/load, offline calc, loop
js/game.js            run state machine, shard banking
js/world.js           2D canvas world + rendering (4 themes, 12 rooms)
js/bot.js             bot entity (3 bots), bin/clog, boost
js/dust.js            mote system: suction / brush / magnet / pickup
js/controls.js        joystick, tap-to-move, keyboard
js/upgrades.js        BOTS, upgrades, themes, layouts, BALANCE (source of truth)
js/ui.js              screens, HUD, pick panel, toasts
js/audio.js           WebAudio synth SFX
js/palette.js         shared palette
```
