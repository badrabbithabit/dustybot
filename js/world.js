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
  setLevel(theme, obstacles, themeKey) {
    this.theme = theme;
    this.theme._floor = themeKey || 'residential';
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

  // Pre-render the floor with a real per-theme texture, then vignette.
  _buildFloor() {
    const css = Math.max(1, Math.round(this.W * this.scale));
    const cv = document.createElement('canvas');
    cv.width = cv.height = css;
    const c = cv.getContext('2d');
    const th = this.theme || DEFAULT_THEME; // never throw if theme missing
    const key = th._floor || 'residential';

    c.fillStyle = th.floorB;
    c.fillRect(0, 0, css, css);
    if (key === 'residential') this._floorPlanks(c, css, th);
    else if (key === 'office') this._floorTiles(c, css, th);
    else if (key === 'store') this._floorCarpet(c, css, th);
    else if (key === 'space') this._floorPlate(c, css, th);
    else this._floorTiles(c, css, th);

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

  // Residential: staggered hardwood planks.
  _floorPlanks(c, css, th) {
    const ph = Math.max(8, css * 0.05);
    let row = 0;
    for (let y = 0; y < css; y += ph, row++) {
      let x = -(row % 3) * (css / 5) * 0.7;
      let col = 0;
      while (x < css) {
        const pw = css / 5;
        const f = 0.9 + (((Math.floor(y) * 73 + Math.floor(x) * 31) % 13) / 13) * 0.2;
        c.fillStyle = shade(row % 2 ? th.floorA : th.floorB, f);
        c.fillRect(x + 0.5, y, pw, ph - 1);
        // wood grain
        c.strokeStyle = 'rgba(0,0,0,0.07)'; c.lineWidth = 1;
        for (let g = 1; g <= 2; g++) {
          const gy = y + ph * (g / 3);
          c.beginPath(); c.moveTo(x + 2, gy); c.lineTo(x + pw - 2, gy + 1); c.stroke();
        }
        x += pw; col++;
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 1;
    for (let y = 0; y < css; y += ph) { c.beginPath(); c.moveTo(0, y); c.lineTo(css, y); c.stroke(); }
  }

  // Office: square ceramic tiles with grout.
  _floorTiles(c, css, th) {
    const t = Math.max(10, css * 0.07);
    for (let y = 0, ry = 0; y < css; y += t, ry++) {
      for (let x = 0; x < css; x += t) {
        const f = 0.92 + (((x * 13 + y * 7) % 11) / 11) * 0.12;
        c.fillStyle = shade(ry % 2 ? th.floorA : th.floorB, f);
        c.fillRect(x + 1, y + 1, t - 2, t - 2);
      }
    }
  }

  // Store: soft carpet with a faint loop texture.
  _floorCarpet(c, css, th) {
    c.fillStyle = th.floorA; c.fillRect(0, 0, css, css);
    for (let i = 0; i < 2600; i++) {
      const x = (i * 73) % css, y = (i * 149) % css;
      c.fillStyle = 'rgba(255,255,255,0.025)'; c.fillRect(x, y, 1, 1);
      c.fillStyle = 'rgba(0,0,0,0.03)'; c.fillRect(x + 2, y + 1, 1, 1);
    }
  }

  // Space: metal deck plating with seams + rivets.
  _floorPlate(c, css, th) {
    const p = Math.max(16, css / 5);
    for (let y = 0, ry = 0; y < css; y += p, ry++) {
      for (let x = 0, cx = 0; x < css; x += p, cx++) {
        const f = 0.9 + (((cx * 7 + ry * 13) % 10) / 10) * 0.18;
        c.fillStyle = shade(ry % 2 ? th.floorA : th.floorB, f);
        rr(c, x + 2, y + 2, p - 4, p - 4, 3); c.fill();
        // diagonal brushed highlight
        c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x + 4, y + p - 6); c.lineTo(x + p - 6, y + 4); c.stroke();
        // corner rivets
        c.fillStyle = 'rgba(255,255,255,0.14)';
        for (const [rx, ry2] of [[x + 4, y + 4], [x + p - 6, y + 4], [x + 4, y + p - 6], [x + p - 6, y + p - 6]]) {
          c.fillRect(rx, ry2, 2, 2);
        }
      }
    }
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
      const x = a.x, y = a.y, W = b.x - a.x, H = b.y - a.y;
      const fn = OB_DRAW[o.kind];
      if (fn) fn(c, x, y, W, H, th);
      else this._drawGeneric(c, x, y, W, H, th);
    }
  }

  // Fallback when a kind has no dedicated art: a soft-raised rounded slab.
  _drawGeneric(c, x, y, W, H, th) {
    const d = Math.min(W, H) * 0.14 + 2;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = d; c.shadowOffsetY = d * 0.7;
    rr(c, x, y, W, H, Math.min(6, W * 0.2)); c.fillStyle = th.wallEdge; c.fill();
    c.restore();
    const g = c.createLinearGradient(0, y, 0, y + H);
    g.addColorStop(0, shade(th.wallEdge, 1.25)); g.addColorStop(1, shade(th.wallEdge, 0.7));
    rr(c, x, y, W, H, Math.min(6, W * 0.2)); c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5; c.stroke();
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

// ---------------------------------------------------------------------------
// Canvas drawing helpers (top-down, +y is "down/away").
// ---------------------------------------------------------------------------
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) { c.rect(x, y, w, h); return; }
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function ell(c, cx, cy, rx, ry, fill, stroke) {
  c.beginPath(); c.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = Math.max(1, rx * 0.08); c.stroke(); }
}
function leaf(c, x, y, len, ang, fill, stroke) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.5, -len * 0.28, len, 0);
  c.quadraticCurveTo(len * 0.5, len * 0.28, 0, 0); c.closePath();
  c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  c.restore();
}
function star(c, x, y, r, fill) {
  c.save(); c.translate(x, y); c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2, rad = i % 2 ? r * 0.45 : r;
    c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  c.closePath(); c.fillStyle = fill; c.fill(); c.restore();
}
function bolt(c, x, y, w, h, fill) {
  c.save(); c.translate(x, y); c.fillStyle = fill;
  c.beginPath();
  c.moveTo(w * 0.45, 0); c.lineTo(w * 0.1, h * 0.55); c.lineTo(w * 0.42, h * 0.55);
  c.lineTo(w * 0.5, h); c.lineTo(w * 0.9, h * 0.4); c.lineTo(w * 0.55, h * 0.4);
  c.lineTo(w * 0.6, 0); c.closePath(); c.fill(); c.restore();
}
function tvScreen(c, x, y, w, h, theme) {
  rr(c, x, y, w, h, 3); c.fillStyle = '#0d1017'; c.fill();
  c.strokeStyle = '#2a3140'; c.lineWidth = 1; c.stroke();
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(theme.accent, 0.55)); g.addColorStop(1, shade(theme.accent, 0.25));
  c.globalAlpha = 0.5; rr(c, x + 2, y + 2, w - 4, h - 4, 2); c.fillStyle = g; c.fill(); c.globalAlpha = 1;
  c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x + 2, y + h * 0.35); c.lineTo(x + w - 2, y + h * 0.12); c.stroke();
}

// ---------------------------------------------------------------------------
// Illustrated obstacle renderers. Each draws a top-down piece of furniture
// into the (x, y, W, H) screen-space rect. They are pure canvas art (no
// external images) so they scale crisply at any resolution.
// ---------------------------------------------------------------------------
const OB_DRAW = {
  sofa(c, x, y, W, H) {
    const arm = Math.min(W * 0.17, H * 0.62);
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 8; c.shadowOffsetY = 5;
    rr(c, x, y, W, H, Math.min(9, W * 0.25)); c.fillStyle = '#4a2a20'; c.fill();
    c.restore();
    rr(c, x + 2, y + 2, W - 4, H - 4, Math.min(7, W * 0.22)); c.fillStyle = '#93503e'; c.fill();
    const nx = Math.max(1, Math.round(W / 42));
    const iw = W - 2 * arm, x0 = x + arm;
    for (let i = 0; i < nx; i++) {
      const cw = (iw - nx * 3) / nx + 3;
      rr(c, x0 + i * cw + 1, y + arm * 0.55, cw - 2, H - arm * 1.1, 4);
      c.fillStyle = '#a85f4b'; c.fill();
      c.strokeStyle = '#5e3227'; c.lineWidth = 1; c.stroke();
    }
    const ag = c.createLinearGradient(0, y, 0, y + H);
    ag.addColorStop(0, '#a85f4b'); ag.addColorStop(1, '#5e3227');
    rr(c, x + 2, y + 2, arm, H - 4, 6); c.fillStyle = ag; c.fill();
    rr(c, x + W - arm - 2, y + 2, arm, H - 4, 6); c.fillStyle = ag; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, Math.min(8, W * 0.24)); c.stroke();
  },

  table(c, x, y, W, H) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 7; c.shadowOffsetY = 5;
    rr(c, x, y, W, H, 5); c.fillStyle = '#3a2415'; c.fill(); c.restore();
    rr(c, x, y, W, H, 5); c.fillStyle = '#a06a3e'; c.fill();
    c.save(); rr(c, x + 2, y + 2, W - 4, H - 4, 3); c.clip();
    c.strokeStyle = 'rgba(90,50,25,0.45)'; c.lineWidth = 1;
    for (let i = 1; i < Math.max(2, W / 14); i++) { const gx = x + (W / (Math.max(2, W / 14) + 1)) * i; c.beginPath(); c.moveTo(gx, y + 3); c.lineTo(gx + 3, y + H - 3); c.stroke(); }
    c.restore();
    rr(c, x + 3, y + 3, W * 0.4, Math.min(8, H * 0.3), 3); c.fillStyle = 'rgba(255,255,255,0.15)'; c.fill();
    c.strokeStyle = '#2e1c12'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 4); c.stroke();
  },

  media(c, x, y, W, H, th) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 8; c.shadowOffsetY = 5;
    rr(c, x, y, W, H, 4); c.fillStyle = '#17121d'; c.fill(); c.restore();
    rr(c, x, y, W, H, 4); c.fillStyle = '#332a40'; c.fill();
    const tvh = H * 0.5, tvw = W * 0.66, tvx = x + (W - tvw) / 2, tvy = y + 2;
    rr(c, tvx, tvy, tvw, tvh, 3); c.fillStyle = '#0b0e14'; c.fill();
    c.strokeStyle = '#3a3448'; c.lineWidth = 1.5; c.stroke();
    tvScreen(c, tvx + 3, tvy + 3, tvw - 6, tvh - 6, th);
    const cy = tvy + tvh + 3, ch = H - tvh - 7;
    if (ch > 4) {
      const cw = (W - 12) / 3;
      for (let i = 0; i < 3; i++) { rr(c, x + 4 + i * (cw + 2), cy, cw, ch, 2); c.fillStyle = '#241d2c'; c.fill(); c.strokeStyle = '#4a4058'; c.lineWidth = 1; c.stroke(); }
    }
    star(c, x + 3, y + H - 5, 2, '#8a7fae'); star(c, x + W - 3, y + H - 5, 2, '#8a7fae');
  },

  plant(c, x, y, W, H) {
    const cx = x + W / 2, cy = y + H / 2, pr = Math.min(W, H) * 0.3;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    ell(c, cx, cy + 2, pr * 1.05, pr * 0.95, '#a8552f'); c.restore();
    ell(c, cx, cy, pr, pr * 0.9, '#b8623a');
    c.strokeStyle = '#6f3a20'; c.lineWidth = 1.5; c.stroke();
    ell(c, cx, cy - 1, pr * 0.78, pr * 0.7, '#5e3320');
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const L = pr * (1.25 + (i % 3) * 0.16);
      leaf(c, cx, cy, L, a, i % 2 ? '#3f7a4a' : '#4f9159', '#274a2e');
    }
    ell(c, cx, cy, pr * 0.4, pr * 0.32, '#6fbf78');
  },

  bed(c, x, y, W, H) {
    const pw = W * 0.34;
    rr(c, x, y, W, H, 5); c.fillStyle = '#5e3a2c'; c.fill();
    rr(c, x + 3, y + 3, W - 6, H - 6, 3); c.fillStyle = '#efe7d8'; c.fill();
    const bh = H * 0.32;
    rr(c, x + 8, y + 7, pw - 8, bh, 4); c.fillStyle = '#ffffff'; c.fill(); c.strokeStyle = '#cfc4b2'; c.lineWidth = 1; c.stroke();
    rr(c, x + W - pw + 8, y + 7, pw - 8, bh, 4); c.fillStyle = '#ffffff'; c.fill(); c.stroke();
    c.fillStyle = '#b06a7a';
    const by = y + H * 0.46;
    rr(c, x + 3, by, W - 6, H - by - 3, 3); c.fill();
    c.strokeStyle = '#7a3f4c'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const fy = by + ((H - by - 3) / 4) * i; c.beginPath(); c.moveTo(x + 5, fy); c.lineTo(x + W - 5, fy); c.stroke(); }
    rr(c, x + 3, y + H * 0.4, W - 6, H * 0.1, 2); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill();
    c.strokeStyle = '#3a2415'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 4); c.stroke();
  },

  dresser(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 4); c.fillStyle = '#4e3221'; c.fill(); c.restore();
    rr(c, x, y, W, H, 4); c.fillStyle = '#a06a3e'; c.fill();
    const rows = Math.max(2, Math.round(H / 16));
    const rh = (H - 6) / rows;
    for (let i = 0; i < rows; i++) {
      const dy = y + 3 + i * rh;
      rr(c, x + 4, dy + 1, W - 8, rh - 2, 2); c.fillStyle = '#b07c52'; c.fill(); c.strokeStyle = '#6e4a2e'; c.lineWidth = 1; c.stroke();
      ell(c, x + W / 2, dy + rh / 2, Math.min(4, W * 0.07), Math.min(3, rh * 0.2), '#3a2415');
    }
    c.strokeStyle = '#2e1c12'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  wardrobe(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 7; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 4); c.fillStyle = '#3a2c21'; c.fill(); c.restore();
    rr(c, x, y, W, H, 4); c.fillStyle = '#6e5238'; c.fill();
    c.strokeStyle = '#2c2015'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + W / 2, y + 3); c.lineTo(x + W / 2, y + H - 3); c.stroke();
    ell(c, x + W / 2 - 6, y + H * 0.5, 2.5, 4, '#c9b48a');
    ell(c, x + W / 2 + 6, y + H * 0.5, 2.5, 4, '#c9b48a');
    rr(c, x + 5, y + 5, W - 10, 4, 2); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fill();
    c.strokeStyle = '#241a12'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  island(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 7; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 5); c.fillStyle = '#8b9098'; c.fill(); c.restore();
    const t = Math.min(8, H * 0.28);
    const g = c.createLinearGradient(0, y, 0, y + t);
    g.addColorStop(0, '#f4f6f8'); g.addColorStop(1, '#c3c8cf');
    rr(c, x, y, W, t, 5); c.fillStyle = g; c.fill();
    c.strokeStyle = '#9aa0a8'; c.lineWidth = 1;
    for (let i = 1; i < 3; i++) { const gx = x + (W / 3) * i; c.beginPath(); c.moveTo(gx, y + 2); c.lineTo(gx, y + t - 2); c.stroke(); }
    const sx = x + W * 0.22, sy = y + t + (H - t) * 0.4, sw = W * 0.28, sh = (H - t) * 0.4;
    rr(c, sx, sy, sw, sh, 3); c.fillStyle = '#aab0b8'; c.fill();
    c.strokeStyle = '#7c828a'; c.lineWidth = 2; c.stroke();
    c.strokeStyle = '#e8ebef'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(sx + sw / 2, sy - 3); c.lineTo(sx + sw / 2, sy + 2); c.stroke();
    ell(c, sx + sw / 2, sy + sh + 4, 3, 2, '#e8ebef');
    ell(c, x + W * 0.68, y + t + (H - t) * 0.25, Math.min(9, W * 0.12), 3.5, '#cfd3d8', '#9aa0a8');
    ell(c, x + W * 0.8, y + t + (H - t) * 0.7, Math.min(7, W * 0.1), 3, '#cfd3d8', '#9aa0a8');
    rr(c, x, y, W, H, 5); c.strokeStyle = '#6f747c'; c.lineWidth = 1.5; c.stroke();
  },

  counter(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#5f646c'; c.fill(); c.restore();
    rr(c, x, y, W, H, 3); c.fillStyle = '#c8ccd2'; c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < Math.max(2, W / 20); i++) c.fillRect(x + 4 + i * 20, y + 2, 2, H - 4);
    ell(c, x + W * 0.5, y + H / 2, Math.min(8, W * 0.12), Math.min(6, H * 0.3), '#e8ebef', '#9aa0a8');
    c.strokeStyle = '#70767d'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  desk(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 4); c.fillStyle = '#2f3a4c'; c.fill(); c.restore();
    const g = c.createLinearGradient(0, y, 0, y + H);
    g.addColorStop(0, '#55677f'); g.addColorStop(1, '#3a465c');
    rr(c, x, y, W, H, 4); c.fillStyle = g; c.fill();
    const lw = W * 0.42, lh = H * 0.5, lx = x + (W - lw) / 2, ly = y + 3;
    rr(c, lx, ly, lw, lh, 2); c.fillStyle = '#15181e'; c.fill();
    const lg = c.createLinearGradient(lx, ly, lx, ly + lh);
    lg.addColorStop(0, '#5cc8ff'); lg.addColorStop(1, '#1f4a6a');
    c.globalAlpha = 0.85; rr(c, lx + 2, ly + 2, lw - 4, lh - 4, 1); c.fillStyle = lg; c.fill(); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(lx + 3, ly + lh * 0.5); c.lineTo(lx + lw - 3, ly + lh * 0.3); c.stroke();
    ell(c, x + W * 0.78, y + H * 0.35, 3, 2.5, '#2b2f38');
    rr(c, x + W * 0.72, y + H * 0.7, W * 0.16, H * 0.12, 2); c.fillStyle = '#2b2f38'; c.fill();
    c.strokeStyle = '#1e2531'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  divider(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 5; c.shadowOffsetY = 3;
    rr(c, x, y, W, H, 3); c.fillStyle = '#232c3e'; c.fill(); c.restore();
    rr(c, x, y, W, H, 3); c.fillStyle = '#3a4a66'; c.fill();
    const g = c.createLinearGradient(x, y, x, y + H);
    g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
    rr(c, x, y, W, H, 3); c.fillStyle = g; c.fill();
    c.strokeStyle = '#161c28'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 2); c.stroke();
  },

  cabinet(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#3a4152'; c.fill(); c.restore();
    rr(c, x, y, W, H, 3); c.fillStyle = '#5a6478'; c.fill();
    const cols = Math.max(1, Math.round(W / 18));
    const cw = (W - 6) / cols;
    for (let i = 0; i < cols; i++) {
      const cx = x + 3 + i * cw;
      rr(c, cx, y + 3, cw - 2, H - 6, 2); c.fillStyle = '#6a7488'; c.fill(); c.strokeStyle = '#2c3242'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#c8cdd6'; c.fillRect(cx + cw / 2 - 3, y + H * 0.5, 6, 2);
    }
    c.strokeStyle = '#242935'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  cubicle(c, x, y, W, H) {
    const pad = 3, iw = W - pad * 2, ih = H - pad * 2;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#274a40'; c.fill(); c.restore();
    rr(c, x + pad, y + pad, iw, ih, 2); c.fillStyle = '#6d7580'; c.fill();
    const fw = iw * 0.52, fh = ih * 0.4, fx = x + pad + (iw - fw) / 2, fy = y + pad + ih * 0.16;
    rr(c, fx, fy, fw, fh, 2); c.fillStyle = '#3a4150'; c.fill();
    const sw = fw * 0.7, sh = fh * 0.62, sx = fx + (fw - sw) / 2, sy = fy + (fh - sh) / 2;
    rr(c, sx, sy, sw, sh, 1); c.fillStyle = '#0f1216'; c.fill();
    c.globalAlpha = 0.8; c.fillStyle = '#7fd8ff'; c.fillRect(sx + 2, sy + 2, sw - 4, sh - 4); c.globalAlpha = 1;
    ell(c, x + W - pad - 5, y + pad + 5, 3, 3, '#274a2e');
    c.strokeStyle = '#16271f'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  shelf(c, x, y, W, H) {
    const pad = 3, iw = W - pad * 2, ih = H - pad * 2;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#4a3420'; c.fill(); c.restore();
    c.fillStyle = '#4a3420'; c.fillRect(x, y + pad, pad, ih); c.fillRect(x + W - pad, y + pad, pad, ih);
    const rows = Math.max(2, Math.round(H / 20));
    const rh = ih / rows;
    const cols = Math.max(1, Math.round(iw / 14));
    const cw = iw / cols;
    const pal = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#8e44ad', '#e74c3c'];
    for (let r = 0; r < rows; r++) {
      const ry = y + pad + r * rh;
      for (let cI = 0; cI < cols; cI++) {
        const bx = x + pad + cI * cw;
        c.fillStyle = pal[(r * 3 + cI) % pal.length];
        rr(c, bx + 1, ry + 2, cw - 2, rh - 4, 1); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(bx + 1, ry + 2, cw - 2, 2);
      }
      c.fillStyle = '#6a4d2c'; c.fillRect(x + pad, ry + rh - 2, iw, 2);
    }
    c.strokeStyle = '#2c1d10'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 2); c.stroke();
  },

  stock(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#7a4a22'; c.fill(); c.restore();
    rr(c, x, y, W, H, 3); c.fillStyle = '#c98a3c'; c.fill();
    c.strokeStyle = '#8a5f26'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + 2, y + 2); c.lineTo(x + W - 2, y + H - 2); c.stroke();
    c.beginPath(); c.moveTo(x + W - 2, y + 2); c.lineTo(x + 2, y + H - 2); c.stroke();
    c.strokeStyle = '#e8c47a'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 3, y + H * 0.3); c.lineTo(x + W * 0.3, y + H * 0.3); c.stroke();
    c.strokeStyle = '#4a3212'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  pallet(c, x, y, W, H) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#5e4426'; c.fill(); c.restore();
    const boards = 6, bw = W / boards;
    for (let i = 0; i < boards; i++) {
      c.fillStyle = i % 2 ? '#a87c4a' : '#b98a55';
      c.fillRect(x + i * bw + 1, y + 3, bw - 2, H - 6);
    }
    c.fillStyle = '#8a6a3a'; c.fillRect(x, y, W, 3); c.fillRect(x, y + H - 3, W, 3);
    c.strokeStyle = '#3a2814'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  console(c, x, y, W, H, th) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 7; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 4); c.fillStyle = shade(th.accent, 0.5); c.fill(); c.restore();
    const g = c.createLinearGradient(0, y, 0, y + H);
    g.addColorStop(0, shade(th.accent, 0.85)); g.addColorStop(1, shade(th.accent, 0.45));
    rr(c, x, y, W, H, 4); c.fillStyle = g; c.fill();
    const sw = W * 0.5, sh = H * 0.5, sx = x + (W - sw) / 2, sy = y + H * 0.16;
    rr(c, sx, sy, sw, sh, 2); c.fillStyle = '#0a0e16'; c.fill();
    const lg = c.createLinearGradient(sx, sy, sx, sy + sh);
    lg.addColorStop(0, shade(th.accent, 1.1)); lg.addColorStop(1, shade(th.accent, 0.4));
    c.globalAlpha = 0.85; rr(c, sx + 2, sy + 2, sw - 4, sh - 4, 1); c.fillStyle = lg; c.fill(); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(sx + 3, sy + sh * 0.6); c.lineTo(sx + sw - 3, sy + sh * 0.3); c.stroke();
    const by = sy + sh + 4, btns = ['#5cffb0', '#ffd24d', '#ff6b6b', '#5cc8ff'];
    for (let i = 0; i < 4; i++) ell(c, x + 6 + i * 10, by + 2, 3, 3, btns[i]);
    c.strokeStyle = shade(th.accent, 0.3); c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  hatch(c, x, y, W, H, th) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 7; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 5); c.fillStyle = shade(th.accent, 0.5); c.fill(); c.restore();
    const r = Math.min(W, H) / 2 - 3;
    c.beginPath(); c.arc(x + W / 2, y + H / 2, r, 0, Math.PI * 2);
    c.fillStyle = shade(th.accent, 0.7); c.fill();
    c.strokeStyle = shade(th.accent, 1.2); c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(x + W / 2, y + H / 2, r * 0.55, 0, Math.PI * 2);
    c.fillStyle = shade(th.accent, 0.35); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      c.beginPath();
      c.moveTo(x + W / 2 + Math.cos(a) * r * 0.55, y + H / 2 + Math.sin(a) * r * 0.55);
      c.lineTo(x + W / 2 + Math.cos(a) * r, y + H / 2 + Math.sin(a) * r);
      c.stroke();
    }
    ell(c, x + W / 2, y + H / 2, 3, 3, shade(th.accent, 1.4));
  },

  bench(c, x, y, W, H, th) {
    c.save(); c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 6; c.shadowOffsetY = 4;
    rr(c, x, y, W, H, 3); c.fillStyle = '#2f3a4c'; c.fill(); c.restore();
    const g = c.createLinearGradient(0, y, 0, y + H);
    g.addColorStop(0, '#55677f'); g.addColorStop(1, '#3a465c');
    rr(c, x, y, W, H, 3); c.fillStyle = g; c.fill();
    const bw = W * 0.24;
    for (let i = 0; i < 3; i++) {
      const bx = x + W * 0.12 + i * (W * 0.26), by = y + H * 0.25;
      c.fillStyle = 'rgba(92,200,255,0.55)';
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw * 0.7, by + H * 0.35); c.lineTo(bx + bw * 0.3, by + H * 0.35); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; c.stroke();
    }
    rr(c, x + W * 0.1, y + H * 0.72, W * 0.8, H * 0.12, 2); c.fillStyle = shade(th.accent, 0.8); c.fill();
    c.strokeStyle = '#1e2531'; c.lineWidth = 1.5; rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  core(c, x, y, W, H, th) {
    const cx = x + W / 2, cy = y + H / 2, r = Math.min(W, H) * 0.42;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 8; c.shadowOffsetY = 5;
    rr(c, x, y, W, H, 6); c.fillStyle = shade(th.accent, 0.4); c.fill(); c.restore();
    const g = c.createLinearGradient(0, y, 0, y + H);
    g.addColorStop(0, shade(th.accent, 0.9)); g.addColorStop(1, shade(th.accent, 0.5));
    rr(c, x, y, W, H, 6); c.fillStyle = g; c.fill();
    c.globalAlpha = 0.5; c.fillStyle = shade(th.accent, 0.3);
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(cx, cy, r * (0.4 + i * 0.25), 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
    ell(c, cx, cy, r * 0.7, r * 0.7, shade(th.accent, 1.3));
    bolt(c, cx - r * 0.35, cy - r * 0.35, r * 0.7, r * 0.7, 'rgba(255,255,255,0.85)');
    c.strokeStyle = shade(th.accent, 0.3); c.lineWidth = 2; rr(c, x + 1, y + 1, W - 2, H - 2, 5); c.stroke();
  },
};

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
