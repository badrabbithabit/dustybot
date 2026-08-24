// world.js — 2D top-down canvas scene: floor, grid, tap mapping, render order.
// No three.js. Pure Canvas 2D. World is a fixed square arena that is fit to
// the screen (letterboxed); camera is static.
import { BALANCE } from './upgrades.js';

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
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._computeFit();
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

  render(dt, game) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = window.innerWidth, h = window.innerHeight;
    // letterbox background
    c.fillStyle = '#0d1117';
    c.fillRect(0, 0, w, h);
    // floor
    const tl = this.toScreen(0, 0);
    const br = this.toScreen(this.W, this.H);
    c.fillStyle = '#161c26';
    c.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    this._drawGrid(c);
    // walls (accent border)
    c.strokeStyle = '#2b3a4d';
    c.lineWidth = 4;
    c.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    // entities
    if (game && game.dust) game.dust.draw(c);
    if (game && game.bot) game.bot.draw(c);
    // tap marker
    if (game && game._tapInput) {
      const p = this.toScreen(game._tapInput.x, game._tapInput.y);
      c.strokeStyle = '#4ac3ff';
      c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.y, 10, 0, Math.PI * 2); c.stroke();
    }
  }

  _drawGrid(c) {
    const tl = this.toScreen(0, 0);
    const br = this.toScreen(this.W, this.H);
    const step = 4 * this.scale;
    c.strokeStyle = 'rgba(255,255,255,0.035)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= this.W + 0.01; x += 4) {
      const s = this.toScreen(x, 0);
      c.moveTo(s.x, tl.y); c.lineTo(s.x, br.y);
    }
    for (let y = 0; y <= this.H + 0.01; y += 4) {
      const s = this.toScreen(0, y);
      c.moveTo(tl.x, s.y); c.lineTo(br.x, s.y);
    }
    c.stroke();
  }
}
