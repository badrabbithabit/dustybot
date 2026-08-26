// world.js — 2D top-down canvas scene. Static camera, square arena fit to the
// screen (letterboxed). The World owns the CURRENT level: its theme (floor /
// wall / dock palette), its obstacle layout, and collision queries. The floor
// is pre-rendered per level; obstacles are drawn every frame.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';

const TILE = 2; // world units per floor tile

// Fallback palette used before a level is loaded (and for the menu backdrop).
const DEFAULT_THEME = {
  name: '', icon: '', accent: PAL.accent,
  floorA: PAL.floorA, floorB: PAL.floorB, grid: PAL.grid,
  wall: PAL.wall, wallEdge: PAL.wallEdge, dockRing: PAL.gold,
  dirt: PAL,
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, (window.devicePixelRatio || 1));

    // Set all state BEFORE the first _resize()/_buildFloor() so a theme is
    // always present when the floor is pre-rendered.
    this.W = BALANCE.arena.w;   // world width
    this.H = BALANCE.arena.h;   // world height
    this.scale = 1;             // world units -> css px
    this.ox = 0; this.oy = 0;   // world origin in css px (top-left)
    this.theme = { ...DEFAULT_THEME };
    this.obstacles = [];
    this._floorCv = null;

    this._resize();            // safe now: this.theme + this.W/H exist
    addEventListener('resize', () => this._resize());
  }

  // Load a level: swap in its theme + obstacle layout, rebuild the floor.
  setLevel(theme, obstacles) {
    this.theme = theme;
    this.obstacles = obstacles;
    this._buildFloor();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._computeFit();
    this._buildFloor();
  }

  // Fit the square arena into the viewport, centered, letterboxed.
  _computeFit() {
    const w = window.innerWidth, h = window.innerHeight;
    const size = Math.min(w, h);
    this.scale = size / this.W;
    this.ox = (w - this.W * this.scale) / 2;
    this.oy = (h - this.H * this.scale) / 2;
  }

  toWorld(sx, sy) { return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale }; }
  toScreen(wx, wy) { return { x: this.ox + wx * this.scale, y: this.oy + wy * this.scale }; }

  // screen -> world if inside the arena floor, else null
  screenToFloor(sx, sy) {
    const p = this.toWorld(sx, sy);
    if (p.x < 0 || p.y < 0 || p.x > this.W || p.y > this.H) return null;
    return p;
  }

  // Is a point inside any obstacle (with an optional outer padding)?
  blocked(x, y, pad = 0) {
    for (const o of this.obstacles) {
      if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
    }
    return false;
  }

  // A point the bot (radius r) can occupy: in-bounds and clear of obstacles.
  isFree(x, y, r = BALANCE.bot.radius) {
    if (x < r || y < r || x > this.W - r || y > this.H - r) return false;
    return !this.blocked(x, y, r);
  }

  // Pre-render the floor (checker tiles + seams + vignette) for the current theme.
  _buildFloor() {
    const css = Math.max(1, Math.round(this.W * this.scale));
    const cv = document.createElement('canvas');
    cv.width = cv.height = css;
    const c = cv.getContext('2d');
    const ts = this.scale * TILE;
    const th = this.theme || DEFAULT_THEME; // never throw if theme missing

    // checkerboard tiles
    const nx = Math.ceil(this.W / TILE), ny = Math.ceil(this.H / TILE);
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        c.fillStyle = (tx + ty) % 2 ? th.floorA : th.floorB;
        c.fillRect(tx * ts, ty * ts, Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      }
    }
    // tile seams
    c.strokeStyle = th.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (let tx = 0; tx <= nx; tx++) {
      const x = Math.round(tx * ts) + 0.5;
      c.moveTo(x, 0); c.lineTo(x, css);
    }
    for (let ty = 0; ty <= ny; ty++) {
      const y = Math.round(ty * ts) + 0.5;
      c.moveTo(0, y); c.lineTo(css, y);
    }
    c.stroke();
    // corner rivets
    c.fillStyle = th.wallEdge;
    for (const [rx, ry] of [[0, 0], [css - 1, 0], [0, css - 1], [css - 1, css - 1]]) {
      c.fillRect(rx, ry, 6, 6);
    }
    // vignette
    if (Number.isFinite(css) && css > 4) {
      const vg = c.createRadialGradient(css / 2, css / 2, css * 0.35, css / 2, css / 2, css * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, PAL.fog);
      c.fillStyle = vg;
      c.fillRect(0, 0, css, css);
    }

    this._floorCv = cv;
  }

  render(dt, game) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = window.innerWidth, h = window.innerHeight;
    // letterbox background
    c.fillStyle = PAL.bg;
    c.fillRect(0, 0, w, h);
    // floor (pre-rendered)
    const tl = this.toScreen(0, 0);
    c.imageSmoothingEnabled = true;
    if (this._floorCv) c.drawImage(this._floorCv, tl.x, tl.y, this.W * this.scale, this.H * this.scale);
    // walls (pixel-stepped border)
    this._drawWalls(c, tl);
    // obstacles
    this._drawObstacles(c);
    // entities
    this._drawDock(c);
    if (game && game.dust) game.dust.draw(c);
    if (game && game.bot) game.bot.draw(c);
    // tap marker (blinking)
    if (game && game._tapInput) {
      const p = this.toScreen(game._tapInput.x, game._tapInput.y);
      const blink = Math.floor(performance.now() / 180) % 2 ? PAL.blueHi : PAL.blue;
      c.fillStyle = blink;
      const s = 10;
      c.fillRect(p.x - s, p.y - 2, s * 2, 4);
      c.fillRect(p.x - 2, p.y - s, 4, s * 2);
      c.fillStyle = PAL.blueHi;
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
  }

  _drawWalls(c, tl) {
    const br = this.toScreen(this.W, this.H);
    const t = Math.max(4, 3 * this.scale);
    const x = Math.round(tl.x), y = Math.round(tl.y);
    const W = Math.round(br.x - tl.x), H = Math.round(br.y - tl.y);
    const th = this.theme;
    // outer dark frame
    c.fillStyle = th.wallEdge;
    c.fillRect(x - t, y - t, W + t * 2, H + t * 2);
    c.fillStyle = th.wall;
    c.fillRect(x - t + 3, y - t + 3, W + t * 2 - 6, H + t * 2 - 6);
    // inner lip
    c.strokeStyle = th.grid;
    c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, W - 2, H - 2);
  }

  _drawObstacles(c) {
    const th = this.theme;
    for (const o of this.obstacles) {
      const a = this.toScreen(o.x, o.y);
      const b = this.toScreen(o.x + o.w, o.y + o.h);
      const x = Math.round(a.x), y = Math.round(a.y);
      const W = Math.round(b.x - a.x), H = Math.round(b.y - a.y);
      const body = this._obstacleColor(o.kind, th);
      // drop shadow (gives a bit of height)
      c.fillStyle = PAL.shadow;
      c.fillRect(x + 3, y + 4, W, H);
      // raised top face
      c.fillStyle = body.top;
      c.fillRect(x, y, W, H);
      // front/side faces (lower-right) for a chunky 2.5D look
      c.fillStyle = body.face;
      c.fillRect(x, y + H - Math.max(3, H * 0.18), W, Math.max(3, H * 0.18));
      c.fillRect(x + W - Math.max(3, W * 0.14), y, Math.max(3, W * 0.14), H);
      // top highlight
      c.fillStyle = body.hi;
      c.fillRect(x, y, W, Math.max(2, H * 0.12));
      // outline
      c.strokeStyle = body.out;
      c.lineWidth = 2;
      c.strokeRect(x + 1, y + 1, W - 2, H - 2);
      // small themed detail (a slot / handle) in the center
      c.fillStyle = body.face;
      const dw = W * 0.4, dh = Math.min(H * 0.3, W * 0.3);
      c.fillRect(x + (W - dw) / 2, y + (H - dh) / 2, dw, dh);
    }
  }

  // Per-kind colors derived from the theme accent/walls.
  _obstacleColor(kind, th) {
    const base = {
      sofa:      { top: '#8a4b3c', face: '#5e3227', hi: '#c5826d', out: '#3a1f18' },
      table:     { top: '#7a5238', face: '#4e3221', hi: '#b07c52', out: '#2e1c12' },
      media:     { top: '#4a4058', face: '#2e2739', hi: '#7a6d8f', out: '#1c1725' },
      plant:     { top: '#3f7a4a', face: '#274a2e', hi: '#6fbf78', out: '#152718' },
      bed:       { top: '#b06a7a', face: '#7a3f4c', hi: '#e09aa8', out: '#481f27' },
      dresser:   { top: '#7a5238', face: '#4e3221', hi: '#b07c52', out: '#2e1c12' },
      wardrobe:  { top: '#5a4636', face: '#3a2c21', hi: '#8a6d52', out: '#241a12' },
      island:    { top: '#cfd3d8', face: '#8b9098', hi: '#ffffff', out: '#565b63' },
      counter:   { top: '#9aa0a8', face: '#5f646c', hi: '#c8ccd2', out: '#3a3e44' },
      desk:      { top: '#4a5a72', face: '#2f3a4c', hi: '#7488a6', out: '#1e2531' },
      divider:   { top: '#3a4a66', face: '#232c3e', hi: '#5f7397', out: '#161c28' },
      cabinet:   { top: '#5a6478', face: '#3a4152', hi: '#838da1', out: '#242935' },
      cubicle:   { top: '#3f7a6a', face: '#274a40', hi: '#63b09a', out: '#16271f' },
      shelf:     { top: '#8a6a4a', face: '#5a422c', hi: '#c09a6d', out: '#33230f' },
      stock:     { top: '#c98a3c', face: '#8a5f26', hi: '#f0b56d', out: '#4a3212' },
      pallet:    { top: '#7a5a3a', face: '#4e3820', hi: '#b0855a', out: '#2c1d10' },
      console:   { top: th.accent, face: shade(th.accent, 0.55), hi: shade(th.accent, 1.25), out: '#141826' },
      hatch:     { top: th.accent, face: shade(th.accent, 0.5), hi: shade(th.accent, 1.2), out: '#141826' },
      bench:     { top: '#4a5a72', face: '#2f3a4c', hi: th.accent, out: '#1e2531' },
      core:      { top: th.accent, face: shade(th.accent, 0.6), hi: '#ffffff', out: '#141826' },
    };
    return base[kind] || { top: th.wallEdge, face: th.wall, hi: th.accent, out: '#141826' };
  }

  _drawDock(c) {
    const d = BALANCE.dock;
    const p = this.toScreen(d.x, d.y);
    const r = d.triggerR * this.scale;
    const s = 3.4 * this.scale;
    const ring = this.theme.dockRing || PAL.gold;
    c.save();
    c.translate(p.x, p.y);
    // pad (stepped corners)
    c.fillStyle = this.theme.wall;
    c.fillRect(-s / 2, -s / 2, s, s);
    c.fillStyle = this.theme.wallEdge;
    c.fillRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);
    c.fillStyle = this.theme.wall;
    c.fillRect(-s / 2 + 5, -s / 2 + 5, s - 10, s - 10);
    // pulsing ring (dashed)
    const pulse = 0.45 + 0.25 * Math.sin(performance.now() / 400);
    c.strokeStyle = ring;
    c.globalAlpha = pulse;
    c.lineWidth = 3;
    c.setLineDash([8, 6]);
    c.lineDashOffset = -performance.now() / 60;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    // trash icon
    c.strokeStyle = ring;
    c.lineWidth = Math.max(2, s * 0.05);
    const bw = s * 0.34, bh = s * 0.30;
    c.strokeRect(-bw / 2, -bh / 2 + s * 0.07, bw, bh);
    c.beginPath(); c.moveTo(-bw / 2 - s * 0.07, -bh / 2 + s * 0.07); c.lineTo(bw / 2 + s * 0.07, -bh / 2 + s * 0.07); c.stroke();
    c.beginPath(); c.moveTo(0, -bh / 2 + s * 0.07 - s * 0.09); c.lineTo(0, -bh / 2 + s * 0.07 - s * 0.02); c.stroke();
    c.restore();
  }
}

// Lighten (mult>1) or darken (mult<1) a #rrggbb color by `mult`.
function shade(hex, mult) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * mult)));
  g = Math.max(0, Math.min(255, Math.round(g * mult)));
  b = Math.max(0, Math.min(255, Math.round(b * mult)));
  return `rgb(${r},${g},${b})`;
}
