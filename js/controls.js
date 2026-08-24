// Controls: virtual joystick (left zone), tap-to-move (floor tap),
// boost touch button, keyboard + mouse fallback for desktop.
import { resumeAudio } from './audio.js';

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.joy = { x: 0, y: 0, active: false };      // -1..1
    this.tapTarget = null;                          // world point {x, z}
    this.boost = false;
    this.onTap = null;                              // callback(worldPoint)
    this.onJoyChange = null;
    this.raycaster = null;
    this._joyTouch = null;
    this._knobHome = null;
    this._knobEl = document.getElementById('joy-knob');
    this._baseEl = document.getElementById('joy-base');

    // joystick zone (bottom-left 42% x 42%)
    const joyZone = document.getElementById('joy');
    joyZone.addEventListener('touchstart', e => this._joyStart(e), { passive: false });
    joyZone.addEventListener('touchmove', e => this._joyMove(e), { passive: false });
    const end = e => this._joyEnd(e);
    joyZone.addEventListener('touchend', end, { passive: false });
    joyZone.addEventListener('touchcancel', end, { passive: false });

    // canvas tap-to-move
    canvas.addEventListener('touchstart', e => this._tap(e), { passive: false });
    canvas.addEventListener('mousedown', e => this._mouse(e));

    // keyboard (desktop)
    this.keys = {};
    addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === ' ') { this.boost = true; }
    });
    addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      if (e.key === ' ') this.boost = false;
    });
  }

  _joyStart(e) {
    e.preventDefault();
    resumeAudio();
    const t = e.changedTouches[0];
    this._joyTouch = t.identifier;
    const r = this._baseEl.getBoundingClientRect();
    this._knobHome = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this._joyMove(e);
  }
  _joyMove(e) {
    e.preventDefault();
    if (this._knobHome) {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joyTouch) continue;
        let dx = t.clientX - this._knobHome.x;
        let dy = t.clientY - this._knobHome.y;
        const max = this._baseEl.getBoundingClientRect().width / 2 - 24;
        const len = Math.hypot(dx, dy);
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        this._knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        this.joy.x = dx / max;
        this.joy.y = dy / max;   // +y = finger up; game maps to -z (forward/away)
        this.joy.active = true;
        this.tapTarget = null;
        this.onJoyChange && this.onJoyChange(this.joy.x, this.joy.y);
      }
    }
  }
  _joyEnd(e) {
    const t = e.changedTouches[0];
    if (t.identifier !== this._joyTouch) return;
    e.preventDefault();
    this._joyTouch = null;
    this.joy.x = 0; this.joy.y = 0; this.joy.active = false;
    this._knobEl.style.transform = '';
    this.onJoyChange && this.onJoyChange(0, 0);
  }

  _screenPointFromTouch(touch) { return { x: touch.clientX, y: touch.clientY }; }
  _screenPointFromMouse(e) { return { x: e.clientX, y: e.clientY }; }

  _tap(e) {
    // only treat as tap if quick and small movement (we handle start only;
    // the game side decides). We just forward the point.
    const t = e.changedTouches[0];
    this._queueTap(this._screenPointFromTouch(t), e);
  }
  _mouse(e) { this._queueTap(this._screenPointFromMouse(e), e); }

  _queueTap(pt, e) {
    resumeAudio();
    // tap-to-move: convert to world via provided callback (world.js registers it)
    if (this.onTap) {
      const world = this.onTap(pt.x, pt.y);
      if (world) {
        this.tapTarget = world;
        if (e.cancelable) e.preventDefault();
      }
    }
  }

  // keyboard vector (for desktop)
  keyVector() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k['w'] || k['arrowup']) z -= 1;
    if (k['s'] || k['arrowdown']) z += 1;
    if (k['a'] || k['arrowleft']) x -= 1;
    if (k['d'] || k['arrowright']) x += 1;
    const l = Math.hypot(x, z);
    if (l > 0) { x /= l; z /= l; }
    return { x, z, active: l > 0 };
  }

  setBoost(v) { this.boost = !!v; }
}
