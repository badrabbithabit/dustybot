# Dusty Bot — 3D Roguelike Robot Vacuum Simulator

Web-based, mobile-first (phone portrait), hosted on GitHub Pages.
You are a little roomba in a room full of dust and detritus. Vacuum it up,
survive the room, pick upgrades, get deeper. Run ends when you run out of
lives. Meta-currency ("Dust Shards") persists between runs for permanent
upgrades.

## 1. Core loop (rooms = levels, life system)

```
[Menu] -> [Room 1] -> (clear room) -> [Pick 1 of 3 upgrades] -> [Room 2] -> ...
                |
                +-- take 3 hits (hazards) or battery dies -> [Run over] -> [Dust Shards kept] -> [Menu]
```

- A **room** is cleared when you vacuum up its **dust budget** (the room's
  total spawnable dust value, e.g. 100 + 20*room).
- **Lives = 3.** Hazards cost a life and grant 2s of invulnerability.
- **Battery:** drains while moving (faster when boosting). Empty battery =
  the bot can't move and slowly takes "overload" damage (half-life per 2s
  until a life is lost). Charging pads on the floor restore battery.
- **Dust economy:** small dust = 1 pt, debris (crumbs, hair, pebbles) = 2-5,
  golden dust = 10. Vacuumed dust is **run currency** (buy in-room powerups)
  and also converts to **Dust Shards** (meta currency, 1 shard per 10 dust,
  banked at run end + per-room bonus).
- **Room clear bonus:** +room number shards, battery refill, short heal (1 life,
  capped at 3).
- Difficulty scales per room: more dust density, more hazards, faster dust
  spawn ("dust comes in" — dust keeps drifting/spawning through the room,
  some from vents on the walls).

### Hazards (things that cost lives)
- **Fan/vent hazards** (spinning floor fans that knock the bot back + damage).
- **Cable tangles** (static, slow + small damage on touch).
- **Hazmat dust piles** (glowing green dust; vacuuming it normally is fine
  but if the bot is "full" — see bin below — it splashes and damages).
- **Battery drain mines** (invisible-ish; instantly drains 20% battery).
- Late rooms add **roomba rivals** (AI bots that eat dust before you — soft
  hazard, steals economy).

### The "dust comes in" flavor
Wall vents spawn drifting dust motes on a timer (rate scales with room).
A **dust bin** fills as you vacuum: at 100% the bot gets a "clogged" debuff
(-50% suction, +25% weight) and you must dump it at a **dump station** (a
trash bin prop in a corner). This creates a nice risk loop: hoard dust for
big shard count, or dump early to stay fast. Dumping gives a small bonus.

## 2. Controls (both, per user request)

- **Virtual joystick** (left thumb zone): drag to steer the bot directly.
- **Tap-to-move** (anywhere on the floor): bot pathfinds straight (with
  obstacle slide) to the tapped point. Joystick input cancels tap-targeting.
- **Boost button** (right side, hold): 2x speed, 3x battery drain, short
  cooldown. Boost also pulls dust from slightly farther (fun button).
- Camera: fixed 3/4 top-down-ish angle (like a tilted roomba-cam), follows
  the bot, locked rotation. No free camera (mobile-friendly).
- Keyboard fallback for desktop testing: WASD/arrows + space (boost),
  mouse click = tap-to-move.

## 3. Upgrade paths

Two layers:

### A. In-run upgrades (roguelike picks — 1 of 3 after each room)
Picked from a weighted pool; each has max levels. Powerups are **additive
stacks within a run** (roguelike "build" feeling).

| Upgrade | Effect per level | Max |
|---|---|---|
| **Suction Core** | +20% suction strength & range; +5 max bin | 5 |
| **Turbo Brush** (side brushes) | +15% pickup radius, brushes spin visibly | 5 |
| **Speed Coil** | +10% move speed, +10% turn rate | 5 |
| **Battery Cell** | +25% max battery, -5% drain | 5 |
| **Magnet Motor** | +15% dust pull-in distance (passive vacuum radius) | 3 |
| **Nano Shield** | +1 max life (up to 5), heals 1 on pickup | 2 |
| **Overdrive** | Boost cooldown -20%, boost pulls 2x harder | 3 |
| **Scrap Merchant** | +15% dust->shard conversion | 3 |
| **Vents** (rare) | A wall vent becomes a **charger** | 1 |
| **Junk Filter** (rare) | Hazmat dust gives +50% value, no splash | 1 |

Weights: common (suction/brush/speed/battery) w=3, uncommon (magnet/overdrive/
merchant) w=2, rare (vents/junk filter/shield) w=1. Never offer a pick at
its max level.

### B. Meta upgrades (Dust Shards, persist forever — the AFK/slow path)
Bought in the hangar (menu) screen. Cost scaling: `cost = base * 1.6^level`.

| Upgrade | Base cost | Effect per level | Max |
|---|---|---|---|
| **Factory Suction** | 20 | +5% suction (multiplicative across levels, capped x3 total) | 10 |
| **Chassis Rollers** | 20 | +4% move speed | 10 |
| **Deep Battery** | 30 | +6% max battery | 10 |
| **Magnet Coil** | 40 | +4% pickup radius | 8 |
| **Reinforced Frame** | 50 | Start each run with +1 shield charge (absorbs 1 hit, up to +2) | 3 |
| **Auto-Pilot Sensor** | 100 | While AFK/idle, bot auto-vacuums (see offline) | 1 (gate) |
| **Shard Polisher** | 60 | +3% shard gains | 10 |
| **Lucky Bristles** | 200 | 5% +15% per level golden dust chance | 5 |
| **Starting Heads** | 150 | +1 starting life (max +1) | 1 |
| **Pre-Cleaned Rooms** | 250 | Rooms start 10% less hazardous (hazard density -10%/lvl) | 5 |

### Balancing model (how numbers stay sane)
- **Shard income curve:** target ~5-15 shards per early room, scaling so a
  full run of 10 rooms yields ~150-400 shards depending on build.
  `shards_per_room ≈ 2 + room * 0.8 + (dust_collected/10)`.
- **Meta cost pacing:** a new meta level should take ~0.5-2 runs early,
  ~2-5 runs late. With `base*1.6^lvl`, level 10 of a base-20 item costs 328
  shards — reachable in ~1-2 mid-game runs.
- **Run difficulty ramp:** hazard count `h = 2 + ceil(room*1.2)`, spawn
  rate `r = 1 + room*0.35` dust/s (capped), dust value per mot `v = 1 +
  0.1*room`.
- **AFK cap:** offline collection = `shards/hour ≈ 0.1 * (1 + metaLevel*0.05)`,
  capped at 8h. ~0.8-1.6 shards/h at low levels → an 8h day ≈ 7-13 shards.
  Deliberately slow: AFK is a drip, active play is ~10x faster. This keeps
  the game about playing, not waiting.
- **Guardrails:** all multipliers have hard caps; battery can never fully
  refill in one pad (75%); boost can't be spammed (cooldown floor 1s);
  dust value per second from vents has a per-room cap so idle-in-room can't
  outpace active play (vents stop spawning when bin is >80% full).

## 4. Tech plan

- **Three.js** (via ES modules, vendored locally in `js/vendor/three.module.js`
  so GitHub Pages needs no CDN) + `three/examples/jsm/controls/...` not needed
  (custom follow cam).
- **No build step, no npm.** Pure static: `index.html`, `css/style.css`,
  `js/*.js` as ES modules. GitHub Pages serves it as-is.
- **Physics:** hand-rolled circle-vs-circle + circle-vs-wall (room is an
  axis-aligned box with a few box obstacles). No physics lib.
- **Particles:** single `THREE.Points` buffer for dust motes (up to ~600),
  pooled. Trash "suck-in" = scale + move toward bot then remove.
- **Audio:** tiny WebAudio synth blips (no assets). Optional mute button.
- **Save:** `localStorage` key `dustybot_save_v1` = { shards, meta{},
  lastSeen, bestRoom, runsWon-ish stats }.
- **Offline calc:** on load, `dt = now - lastSeen`; if dt > 60s and
  Auto-Pilot unlocked: `shards += rate * min(dt, 8h)`. Show a "while you
  were away" toast.
- **Perf targets (phone):** < 30 draw calls, no shadows (fake blob shadow
  under bot via a dark circle mesh), pixel ratio capped at 2, particle cap
  600, no postprocessing. 60fps on mid-range Android is the goal.
- **Mobile viewport:** `viewport-fit=cover`, `user-scalable=no`, touch-action
  none on canvas, safe-area insets for UI, portrait-first (works landscape
  but designed portrait).
- **PWA-lite:** `manifest.webmanifest` + small inline SVG icon so it's
  installable on phone home screen.

### File layout
```
/ (repo root = Pages root)
  index.html
  manifest.webmanifest
  icon.svg
  css/style.css
  js/main.js          # bootstrap, save/load, menu, offline calc
  js/game.js          # run state machine (menu/room/upgrade/over)
  js/world.js         # three scene, room gen, props, lighting
  js/bot.js           # robot entity, battery, bin, movement
  js/dust.js          # dust particle system, vents, hazards
  js/controls.js      # joystick + tap-to-move + keyboard
  js/upgrades.js      # in-run pick UI + meta shop + all balance tables
  js/ui.js            # HUD (lives, battery, dust count, boost btn), toasts
  js/audio.js         # WebAudio blips
  js/vendor/three.module.js
```

### Milestones
1. Scaffold + 3D room + bot you can move with joystick/tap (this proves the
   phone control feel early).
2. Dust spawn + vacuum mechanic + dust counter + room-clear.
3. Hazards + lives + battery + pads + dump station.
4. Room transition + 1-of-3 upgrade UI.
5. Meta shop + localStorage + offline shards.
6. Polish: sounds, toasts, install manifest, GitHub Pages push.

### GitHub Pages
- Repo → Settings → Pages → Deploy from branch `/` (root) or `/gh-pages`.
- Plan: develop in repo root, Pages serves `/` → no base-path issues.
- All relative URLs (`./js/...`), absolute module imports inside vendor
  file are fine since it's one file. No `base` config needed.
