// Tiny WebAudio synth — no assets.
let ctx = null, master = null, muted = false;
function ensure() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}
export function resumeAudio() {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function isMuted() { return muted; }

function blip(freq, dur, type = 'sine', vol = 0.3, slide = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, filterFreq = 800) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

// last-suck sound throttle
let lastSuck = 0;
export const sfx = {
  suck() {
    const now = performance.now();
    if (now - lastSuck < 70) return;
    lastSuck = now;
    blip(180 + Math.random() * 120, 0.08, 'triangle', 0.15, 140);
  },
  bigSuck() { blip(120, 0.16, 'sawtooth', 0.25, 220); noise(0.12, 0.12, 600); },
  gold() { blip(880, 0.12, 'sine', 0.3, 440); setTimeout(() => blip(1320, 0.18, 'sine', 0.25, 220), 80); },
  hurt() { blip(220, 0.25, 'square', 0.3, -140); noise(0.2, 0.2, 300); },
  life() { blip(440, 0.15, 'sine', 0.3, 220); },
  clear() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'triangle', 0.28), i * 90)); },
  buy() { blip(660, 0.1, 'triangle', 0.25, 110); },
  upgrade() { [392, 523, 659].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'triangle', 0.26), i * 70)); },
  click() { blip(520, 0.05, 'square', 0.12); },
  over() { [330, 262, 196, 131].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'triangle', 0.28), i * 160)); },
  boost() { noise(0.25, 0.15, 1200); blip(90, 0.25, 'sawtooth', 0.12, 60); },
  pad() { blip(523, 0.1, 'sine', 0.2); setTimeout(() => blip(784, 0.15, 'sine', 0.2), 90); },
  dump() { noise(0.25, 0.2, 400); blip(150, 0.2, 'triangle', 0.2, -60); },
};
