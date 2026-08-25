// world.js — 2D top-down canvas scene: tiled pixel floor, walls, dock, render order.
// No three.js. Pure Canvas 2D. World is a fixed square arena that is fit to
// the screen (letterboxed); camera is static.
import { BALANCE } from './upgrades.js';
import { PAL } from './palette.js';

const TILE = 2; // world units per floor tile

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, (window.devicePixelRatio || 1));
    this._resize();
    addEventListener('resize', () => this._resize());

    this.W = BALANCE.arena.w;   // world width
    this.H = BALANCE.arena.h;   // world height
    this.scale = 1;             // world units -> css px
    this.ox = 0; this.oy = 0;   // world origin in css px (top-left)
    this._computeFit();
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

  // Pre-render the floor (checker tiles + seams + vignette) once per resize.
  _buildFloor() {
    const css = Math.max(1, Math.round(this.W * this.scale));
    const cv = document.createElement('canvas');
    cv.width = cv.height = css;
    const c = cv.getContext('2d');
    const ts = this.scale * TILE;

    // checkerboard tiles
    const nx = Math.ceil(this.W / TILE), ny = Math.ceil(this.H / TILE);
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        c.fillStyle = (tx + ty) % 2 ? PAL.floorA : PAL.floorB;
        c.fillRect(tx * ts, ty * ts, Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      }
    }
    // tile seams
    c.strokeStyle = PAL.grid;
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
    c.fillStyle = PAL.wallEdge;
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
    c.drawImage(this._floorCv, tl.x, tl.y, this.W * this.scale, this.H * this.scale);
    // walls (pixel-stepped border)
    this._drawWalls(c, tl);
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
    // outer dark frame
    c.fillStyle = PAL.wallEdge;
    c.fillRect(x - t, y - t, W + t * 2, H + t * 2);
    c.fillStyle = PAL.wall;
    c.fillRect(x - t + 3, y - t + 3, W + t * 2 - 6, H + t * 2 - 6);
    // inner lip
    c.strokeStyle = PAL.grid;
    c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, W - 2, H - 2);
  }

  _drawDock(c) {
    const d = BALANCE.dock;
    const p = this.toScreen(d.x, d.y);
    const r = d.triggerR * this.scale;
    const s = 3.4 * this.scale;
    c.save();
    c.translate(p.x, p.y);
    // pad (stepped corners)
    c.fillStyle = PAL.wall;
    c.fillRect(-s / 2, -s / 2, s, s);
    c.fillStyle = PAL.wallEdge;
    c.fillRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4);
    c.fillStyle = PAL.wall;
    c.fillRect(-s / 2 + 5, -s / 2 + 5, s - 10, s - 10);
    // pulsing ring (dashed)
    const pulse = 0.45 + 0.25 * Math.sin(performance.now() / 400);
    c.strokeStyle = PAL.gold;
    c.globalAlpha = pulse;
    c.lineWidth = 3;
    c.setLineDash([8, 6]);
    c.lineDashOffset = -performance.now() / 60;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    // trash icon
    c.strokeStyle = PAL.gold;
    c.lineWidth = Math.max(2, s * 0.05);
    const bw = s * 0.34, bh = s * 0.30;
    c.strokeRect(-bw / 2, -bh / 2 + s * 0.07, bw, bh);
    c.beginPath(); c.moveTo(-bw / 2 - s * 0.07, -bh / 2 + s * 0.07); c.lineTo(bw / 2 + s * 0.07, -bh / 2 + s * 0.07); c.stroke();
    c.beginPath(); c.moveTo(0, -bh / 2 + s * 0.07 - s * 0.09); c.lineTo(0, -bh / 2 + s * 0.07 - s * 0.02); c.stroke();
    c.restore();
  }
}
