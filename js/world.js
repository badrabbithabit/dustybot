// world.js — 2D top-down canvas scene. Static camera, square arena fit to the
// screen (letterboxed). The World owns the CURRENT level: its theme (floor /
// wall / dock palette), its obstacle layout, and collision queries. The floor
// is pre-rendered per level; obstacles are drawn every frame.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';
import { OB_DRAW, drawGenericObstacle, shade, rr } from './obstacles.js';

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
    this.bodies = [];           // moving circular bodies {x,y,r} (visitors) — solid
    this.shakeT = 0;            // screen-shake timer (Sasquatch drop)
    this._floorCv = null;
    this._floorKey = null;     // raster identity of the cached floor canvas
    this._initWet();           // wet-floor layer (mopping bots)

    this._resize();            // safe now: this.theme + this.W/H exist
    addEventListener('resize', () => this._resize());
  }

  // Load a level: swap in its theme + obstacle layout, rebuild the floor.
  setLevel(theme, obstacles, themeKey) {
    this.theme = theme;
    this.theme._floor = themeKey || 'residential';
    this.obstacles = obstacles;
    this._buildFloor();
    this._clearWet();          // fresh level = dry floor
  }

  // ---------------------------------------------------------------------
  // Wet-floor layer (mopping bots). A resolution-independent grid holds the
  // wetness (0..1) per cell; a small canvas is rebuilt from it for drawing.
  // Heavy motes sitting on wet floor (wetAt >= BALANCE.mop.wetThresh) get
  // soaked: lighter to pull and worth more. See dust.js.
  // ---------------------------------------------------------------------
  _initWet() {
    this._wetRes = 6;                      // internal px per world unit
    const gw = Math.ceil(this.W * this._wetRes);
    const gh = Math.ceil(this.H * this._wetRes);
    this._wetW = gw; this._wetH = gh;
    this._wetGrid = new Float32Array(gw * gh);
    this._wetCv = document.createElement('canvas');
    this._wetCv.width = gw; this._wetCv.height = gh;
    this._wetCvCtx = this._wetCv.getContext('2d');
    this._wetImg = this._wetCvCtx.createImageData(gw, gh);   // allocated once, reused
    this._wetCells = new Set();  // indices of cells with wetness > 0 (sparse)
    this._wetPrev = [];          // cells drawn by the previous drawWet()
    this._wetRect = null;        // [x, y, w, h] of that last upload
    this._wetEnergy = 0;
  }

  _clearWet() {
    if (this._wetGrid) this._wetGrid.fill(0);
    this._wetCells.clear();
    this._wetEnergy = 0;         // drawWet() wipes the last rect on the next frame
  }

  // Add wetness in a soft disc of radius `radius` (world units) at (x, y).
  stampWet(x, y, amt, radius = BALANCE.bot.radius) {
    if (amt <= 0) return;
    const res = this._wetRes, gw = this._wetW, gh = this._wetH;
    const cx = x * res, cy = y * res;
    const pr = radius * res;
    const x0 = Math.max(0, Math.floor(cx - pr)), x1 = Math.min(gw - 1, Math.ceil(cx + pr));
    const y0 = Math.max(0, Math.floor(cy - pr)), y1 = Math.min(gh - 1, Math.ceil(cy + pr));
    let g = this._wetGrid;
    for (let yy = y0; yy <= y1; yy++) {
      const dy = (yy + 0.5 - cy) / pr;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx + 0.5 - cx) / pr;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const fall = Math.sqrt(1 - d2);              // soft edge
        const i = yy * gw + xx;
        const nv = Math.min(1, g[i] + amt * fall);
        if (nv > g[i]) { g[i] = nv; this._wetCells.add(i); }
      }
    }
  }

  // Wetness (0..1) at a world point, bilinear-ish (nearest cell).
  wetAt(x, y) {
    if (!this._wetGrid) return 0;
    const res = this._wetRes, gw = this._wetW, gh = this._wetH;
    let ix = Math.round(x * res), iy = Math.round(y * res);
    if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) return 0;
    return this._wetGrid[iy * gw + ix];
  }

  // Fade the wetness over time. O(active cells): only the Set is scanned, and
  // cells that dry out are dropped from it (the visual buffer is refreshed by
  // drawWet() during render, never here).
  updateWet(dt) {
    if (!this._wetGrid || !this._wetCells.size) { this._wetEnergy = 0; return; }
    const g = this._wetGrid;
    const decay = Math.exp(-0.08 * dt);              // ~12s to mostly dry
    let energy = 0;
    for (const i of this._wetCells) {
      const v = g[i] * decay;
      if (v < 0.01) { g[i] = 0; this._wetCells.delete(i); }   // dry -> drop it
      else { g[i] = v; energy += v; }
    }
    this._wetEnergy = energy < 0.5 ? 0 : energy;     // below this it reads as dry
  }

  // Refresh the small RGBA buffer (blue puddle, alpha = wet) from the ACTIVE
  // cells only, then upload just their bounding box. Called once per frame
  // from render(); it also wipes the previous frame's rect so fading trails
  // leave no residue once everything has dried.
  drawWet() {
    if (!this._wetGrid) return;
    const d = this._wetImg.data;
    // (a) undo last frame: stale pixels transparent in the buffer + on the canvas
    if (this._wetPrev.length) {
      for (const i of this._wetPrev) d[i * 4 + 3] = 0;
      const [px, py, pw, ph] = this._wetRect;
      this._wetCvCtx.clearRect(px, py, pw, ph);
      this._wetPrev = []; this._wetRect = null;
    }
    const cells = this._wetCells;
    if (!cells.size) return;                         // dry floor: nothing to draw
    // (b) write the wet cells, tracking their bounding box
    const gw = this._wetW;
    let x0 = this._wetW, y0 = this._wetH, x1 = -1, y1 = -1;
    for (const i of cells) {
      const v = this._wetGrid[i];
      if (v <= 0) continue;
      const yy = (i / gw) | 0, xx = i - yy * gw;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
      const o = i * 4;
      d[o] = 90; d[o + 1] = 165; d[o + 2] = 235;     // water blue
      d[o + 3] = Math.min(200, v * 200 | 0);
    }
    if (x1 < x0) return;
    // (c) upload only the dirty rect instead of the whole grid
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    this._wetCvCtx.putImageData(this._wetImg, 0, 0, x0, y0, w, h);
    this._wetPrev = Array.from(cells);
    this._wetRect = [x0, y0, w, h];
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._computeFit();
    // Cheap: _buildFloor() no-ops when the raster size/dpr/theme are unchanged,
    // so mobile URL-bar resizes just redraw the cached floor.
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

  // Is a point inside any obstacle rect or moving body (with optional padding)?
  // `ignore` skips one specific body: a visitor must not be blocked by its own
  // circle while stepping (Visitors._step passes v._body).
  blocked(x, y, pad = 0, ignore = null) {
    for (const o of this.obstacles) {
      if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
    }
    for (const b of this.bodies) {
      if (b === ignore) continue;
      const dx = x - b.x, dy = y - b.y, rad = b.r + pad;
      if (dx * dx + dy * dy < rad * rad) return true;
    }
    return false;
  }

  // A point the bot (radius r) can occupy: in-bounds and clear of obstacles.
  isFree(x, y, r = BALANCE.bot.radius, ignore = null) {
    if (x < r || y < r || x > this.W - r || y > this.H - r) return false;
    return !this.blocked(x, y, r, ignore);
  }

  // Pre-render the floor with a real per-theme texture, then vignette.
  _buildFloor() {
    const css = Math.max(1, Math.round(this.W * this.scale));
    const key = `${css}x${this.dpr}x${(this.theme && this.theme._floor) || 'residential'}`;
    if (this._floorCv && key === this._floorKey) return;   // raster unchanged: reuse
    const cv = document.createElement('canvas');
    cv.width = cv.height = css;
    const c = cv.getContext('2d');
    const th = this.theme || DEFAULT_THEME; // never throw if theme missing
    const floor = th._floor || 'residential';

    c.fillStyle = th.floorB;
    c.fillRect(0, 0, css, css);
    if (floor === 'residential') this._floorPlanks(c, css, th);
    else if (floor === 'office') this._floorTiles(c, css, th);
    else if (floor === 'store') this._floorCarpet(c, css, th);
    else if (floor === 'space') this._floorPlate(c, css, th);
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
    this._floorKey = key;
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

  render(game) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Screen shake (Sasquatch drop): offset the whole scene by a random +/-3px
    // for THIS frame only (ox/oy restored at the end so toWorld / input mapping
    // stay correct). The timer itself is decayed with dt in game.js.
    let shx = 0, shy = 0;
    if (this.shakeT > 0) {
      shx = Math.random() * 6 - 3;
      shy = Math.random() * 6 - 3;
      this.ox += shx; this.oy += shy;
    }
    const w = window.innerWidth, h = window.innerHeight;
    // letterbox background
    c.fillStyle = PAL.bg;
    c.fillRect(0, 0, w, h);
    // floor (pre-rendered)
    const tl = this.toScreen(0, 0);
    c.imageSmoothingEnabled = true;
    if (this._floorCv) c.drawImage(this._floorCv, tl.x, tl.y, this.W * this.scale, this.H * this.scale);
    // wet trail (mopping bot), on top of the floor, under walls/obstacles.
    // drawWet() runs every frame so the last rect gets cleared when it dries.
    this.drawWet();
    if (this._wetEnergy > 0) {
      c.imageSmoothingEnabled = true;
      c.globalAlpha = 0.9;
      c.drawImage(this._wetCv, tl.x, tl.y, this.W * this.scale, this.H * this.scale);
      c.globalAlpha = 1;
    }
    // walls (pixel-stepped border)
    this._drawWalls(c, tl);
    // obstacles
    this._drawObstacles(c);
    // entities
    this._drawDock(c);
    if (game && game.dust) game.dust.draw(c);
    // Visitors draw after the dirt but BEFORE the bot: a carried bot must
    // render on top of the hands holding it (VISITORS_PLAN §6).
    if (game && game.visitors) game.visitors.draw(c);
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
    if (shx || shy) { this.ox -= shx; this.oy -= shy; }
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
      if (fn) fn(c, x, y, W, H, th, o);
      else drawGenericObstacle(c, x, y, W, H, th, o);
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
