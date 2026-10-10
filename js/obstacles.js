// js/obstacles.js — Illustrated top-down obstacle and furniture renderers.
// Pure Canvas 2D art: zero external assets, crisp at all DPRs.
// Adapts dynamically to dimensions, orientation (W >= H vs H > W), and room themes.

// ---------------------------------------------------------------------------
// Canvas Drawing Utilities
// ---------------------------------------------------------------------------

// Lighten (mult > 1) or darken (mult < 1) a #rrggbb / #rgb color by `mult`.
export function shade(hex, mult) {
  if (!hex || typeof hex !== 'string') return hex || '#000000';
  if (hex.startsWith('rgb')) return hex;
  if (hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return hex;
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * mult)));
  g = Math.max(0, Math.min(255, Math.round(g * mult)));
  b = Math.max(0, Math.min(255, Math.round(b * mult)));
  return `rgb(${r},${g},${b})`;
}

// Rounded rectangle path helper.
export function rr(c, x, y, w, h, r = 0) {
  if (w <= 0 || h <= 0) return;
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (r <= 0) {
    c.beginPath();
    c.rect(x, y, w, h);
    return;
  }
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Ellipse helper with fill and optional stroke.
export function ell(c, cx, cy, rx, ry, fill, stroke, strokeWidth = 1) {
  rx = Math.max(0.5, Math.abs(rx));
  ry = Math.max(0.5, Math.abs(ry));
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = strokeWidth; c.stroke(); }
}

// Soft ambient drop shadow beneath furniture.
export function dropShadow(c, x, y, w, h, blur = 6, dy = 4, r = 4, color = 'rgba(0,0,0,0.45)') {
  c.save();
  c.shadowColor = color;
  c.shadowBlur = blur;
  c.shadowOffsetY = dy;
  c.fillStyle = color;
  rr(c, x, y, w, h, r);
  c.fill();
  c.restore();
}

// Beveled surface with base fill, top-left highlight edge, and bottom-right shadow edge.
export function bevelRect(c, x, y, w, h, r = 3, base = '#555', hi = 'rgba(255,255,255,0.25)', sh = 'rgba(0,0,0,0.35)') {
  rr(c, x, y, w, h, r);
  c.fillStyle = base;
  c.fill();
  if (hi || sh) {
    c.save();
    rr(c, x, y, w, h, r);
    c.clip();
    if (hi) {
      c.strokeStyle = hi;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, y + h);
      c.lineTo(x, y);
      c.lineTo(x + w, y);
      c.stroke();
    }
    if (sh) {
      c.strokeStyle = sh;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + w, y);
      c.lineTo(x + w, y + h);
      c.lineTo(x, y + h);
      c.stroke();
    }
    c.restore();
  }
}

// Realistic wood planks with subtle color shifts and plank seams.
export function woodPlanks(c, x, y, w, h, count = 4, baseCol = '#9e673a', seamCol = '#5a3818', dir = 'h') {
  c.save();
  const n = Math.max(1, count);
  if (dir === 'h') {
    const ph = h / n;
    for (let i = 0; i < n; i++) {
      const py = y + i * ph;
      const f = 0.94 + ((i * 17) % 5) * 0.03;
      c.fillStyle = shade(baseCol, f);
      c.fillRect(x, py, w, ph);
      if (i > 0) {
        c.strokeStyle = seamCol;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, py);
        c.lineTo(x + w, py);
        c.stroke();
      }
    }
  } else {
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const px = x + i * pw;
      const f = 0.94 + ((i * 17) % 5) * 0.03;
      c.fillStyle = shade(baseCol, f);
      c.fillRect(px, y, pw, h);
      if (i > 0) {
        c.strokeStyle = seamCol;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px, y);
        c.lineTo(px, y + h);
        c.stroke();
      }
    }
  }
  c.restore();
}

// Angled industrial/hazard caution stripes.
export function hazardStripes(c, x, y, w, h, col1 = '#f1c40f', col2 = '#1c1c1c', stripeW = 8) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.fillStyle = col1;
  c.fillRect(x, y, w, h);
  c.fillStyle = col2;
  const diag = w + h + stripeW * 4;
  for (let d = -h - stripeW * 2; d < diag; d += stripeW * 2) {
    c.beginPath();
    c.moveTo(x + d, y);
    c.lineTo(x + d + stripeW, y);
    c.lineTo(x + d + stripeW - h, y + h);
    c.lineTo(x + d - h, y + h);
    c.closePath();
    c.fill();
  }
  c.restore();
}

// Radial illumination for lamps, screens, and energy cores.
export function glowRadial(c, cx, cy, rInner, rOuter, colInner, colOuter = 'rgba(0,0,0,0)') {
  if (rOuter <= 0) return;
  const g = c.createRadialGradient(cx, cy, Math.max(0, rInner), cx, cy, rOuter);
  g.addColorStop(0, colInner);
  g.addColorStop(1, colOuter);
  c.save();
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, rOuter, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// Helper: organic leaf path rotated around (cx, cy).
function drawLeaf(c, cx, cy, len, ang, fill, stroke) {
  c.save();
  c.translate(cx, cy);
  c.rotate(ang);
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(len * 0.35, -len * 0.38, len * 0.75, -len * 0.3, len, 0);
  c.bezierCurveTo(len * 0.75, len * 0.3, len * 0.35, len * 0.38, 0, 0);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = 1;
    c.stroke();
  }
  // Leaf vein (midrib)
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.lineWidth = Math.max(1, len * 0.04);
  c.beginPath();
  c.moveTo(len * 0.1, 0);
  c.lineTo(len * 0.88, 0);
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------------------
// Illustrated Obstacle Renderers (20 Kinds)
// Signature: (c, x, y, W, H, th, o)
// ---------------------------------------------------------------------------

export const OB_DRAW = {
  // -------------------------------------------------------------------------
  // 1. SOFA: Living room couch with backrest, plump armrests, deep cushions,
  // button tufts/seams, and corner throw pillows.
  // -------------------------------------------------------------------------
  sofa(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 8, 5, Math.min(8, Math.min(W, H) * 0.25));

    const isHorizontal = W >= H;
    const baseCol = '#422218';
    const mainCol = '#8e4b38';
    const hiCol = '#a65b47';
    const seamCol = '#56271c';

    // Main frame base
    rr(c, x, y, W, H, Math.min(8, Math.min(W, H) * 0.2));
    c.fillStyle = baseCol; c.fill();
    rr(c, x + 2, y + 2, W - 4, H - 4, Math.min(6, Math.min(W, H) * 0.18));
    c.fillStyle = mainCol; c.fill();

    if (isHorizontal) {
      // Horizontal sofa: backrest along top
      const backH = Math.max(7, Math.min(H * 0.34, 22));
      const armW = Math.max(7, Math.min(W * 0.17, 24));
      const seatX = x + armW + 1;
      const seatW = W - 2 * armW - 2;
      const seatY = y + backH;
      const seatH = H - backH - 3;

      // Backrest
      const bg = c.createLinearGradient(0, y + 2, 0, y + backH);
      bg.addColorStop(0, hiCol); bg.addColorStop(1, seamCol);
      rr(c, x + 3, y + 2, W - 6, backH, 4);
      c.fillStyle = bg; c.fill();
      c.strokeStyle = seamCol; c.lineWidth = 1; c.stroke();

      // Armrests (left and right)
      const ag = c.createLinearGradient(0, y, 0, y + H);
      ag.addColorStop(0, hiCol); ag.addColorStop(1, seamCol);
      rr(c, x + 2, y + 2, armW, H - 4, 5); c.fillStyle = ag; c.fill(); c.stroke();
      rr(c, x + W - armW - 2, y + 2, armW, H - 4, 5); c.fillStyle = ag; c.fill(); c.stroke();

      // Armrest piping highlights
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + armW * 0.5, y + 4); c.lineTo(x + armW * 0.5, y + H - 4); c.stroke();
      c.beginPath(); c.moveTo(x + W - armW * 0.5, y + 4); c.lineTo(x + W - armW * 0.5, y + H - 4); c.stroke();

      // Cushions
      if (seatW > 10 && seatH > 4) {
        const numCushions = seatW > 64 ? 3 : 2;
        const cw = (seatW - (numCushions - 1) * 2) / numCushions;
        for (let i = 0; i < numCushions; i++) {
          const cx = seatX + i * (cw + 2);
          const cg = c.createLinearGradient(0, seatY, 0, seatY + seatH);
          cg.addColorStop(0, hiCol); cg.addColorStop(1, mainCol);
          rr(c, cx, seatY, cw, seatH, 3);
          c.fillStyle = cg; c.fill();
          c.strokeStyle = seamCol; c.lineWidth = 1; c.stroke();

          // Button tufts
          const midX = cx + cw / 2, midY = seatY + seatH * 0.5;
          ell(c, midX, midY, 2, 1.5, seamCol);
          c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1;
          c.beginPath(); c.moveTo(midX - 2, midY); c.lineTo(midX + 2, midY); c.stroke();
        }

        // Throw pillows tucked in corners
        const pSize = Math.min(armW * 0.85, seatH * 0.6);
        if (pSize > 4) {
          c.save();
          c.translate(seatX + pSize * 0.45, seatY + pSize * 0.4);
          c.rotate(-0.25);
          rr(c, -pSize / 2, -pSize / 2, pSize, pSize, 2);
          c.fillStyle = '#d49b43'; c.fill(); // mustard gold
          c.strokeStyle = '#8c5e1c'; c.lineWidth = 1; c.stroke();
          c.restore();

          c.save();
          c.translate(seatX + seatW - pSize * 0.45, seatY + pSize * 0.4);
          c.rotate(0.25);
          rr(c, -pSize / 2, -pSize / 2, pSize, pSize, 2);
          c.fillStyle = '#2f828a'; c.fill(); // teal
          c.strokeStyle = '#1a4e54'; c.lineWidth = 1; c.stroke();
          c.restore();
        }
      }
    } else {
      // Vertical sofa: backrest along left
      const backW = Math.max(7, Math.min(W * 0.34, 22));
      const armH = Math.max(7, Math.min(H * 0.17, 24));
      const seatY = y + armH + 1;
      const seatH = H - 2 * armH - 2;
      const seatX = x + backW;
      const seatW = W - backW - 3;

      // Backrest
      const bg = c.createLinearGradient(x + 2, 0, x + backW, 0);
      bg.addColorStop(0, hiCol); bg.addColorStop(1, seamCol);
      rr(c, x + 2, y + 3, backW, H - 6, 4);
      c.fillStyle = bg; c.fill();
      c.strokeStyle = seamCol; c.lineWidth = 1; c.stroke();

      // Armrests (top and bottom)
      const ag = c.createLinearGradient(x, 0, x + W, 0);
      ag.addColorStop(0, hiCol); ag.addColorStop(1, seamCol);
      rr(c, x + 2, y + 2, W - 4, armH, 5); c.fillStyle = ag; c.fill(); c.stroke();
      rr(c, x + 2, y + H - armH - 2, W - 4, armH, 5); c.fillStyle = ag; c.fill(); c.stroke();

      // Cushions stacked vertically
      if (seatH > 10 && seatW > 4) {
        const numCushions = seatH > 64 ? 3 : 2;
        const ch = (seatH - (numCushions - 1) * 2) / numCushions;
        for (let i = 0; i < numCushions; i++) {
          const cy = seatY + i * (ch + 2);
          const cg = c.createLinearGradient(seatX, 0, seatX + seatW, 0);
          cg.addColorStop(0, hiCol); cg.addColorStop(1, mainCol);
          rr(c, seatX, cy, seatW, ch, 3);
          c.fillStyle = cg; c.fill();
          c.strokeStyle = seamCol; c.lineWidth = 1; c.stroke();

          const midX = seatX + seatW * 0.5, midY = cy + ch / 2;
          ell(c, midX, midY, 1.5, 2, seamCol);
        }

        // Throw pillows
        const pSize = Math.min(armH * 0.85, seatW * 0.6);
        if (pSize > 4) {
          c.save();
          c.translate(seatX + pSize * 0.4, seatY + pSize * 0.45);
          c.rotate(0.25);
          rr(c, -pSize / 2, -pSize / 2, pSize, pSize, 2);
          c.fillStyle = '#d49b43'; c.fill();
          c.strokeStyle = '#8c5e1c'; c.lineWidth = 1; c.stroke();
          c.restore();

          c.save();
          c.translate(seatX + pSize * 0.4, seatY + seatH - pSize * 0.45);
          c.rotate(-0.25);
          rr(c, -pSize / 2, -pSize / 2, pSize, pSize, 2);
          c.fillStyle = '#2f828a'; c.fill();
          c.strokeStyle = '#1a4e54'; c.lineWidth = 1; c.stroke();
          c.restore();
        }
      }
    }

    // Outer perimeter edge
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, Math.min(7, Math.min(W, H) * 0.19)); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 2. TABLE: Adapts by size/aspect:
  // - Nightstand (small square): glowing lamp, book/clock.
  // - Coffee table (wide): wood grain, table runner, coffee mug.
  // - Large dining/conference table: polished wood planks, bevel, leg shadows.
  // -------------------------------------------------------------------------
  table(c, x, y, W, H, th, o) {
    dropShadow(c, x, y, W, H, 7, 5, 4);

    const isNightstand = (o && o.w <= 4.5 && o.h <= 4.5) ||
      (Math.max(W, H) <= 46 && Math.max(W, H) / Math.min(W, H) < 1.6);
    const isWideCoffee = W > H * 1.35 && Math.max(W, H) < 95;

    if (isNightstand) {
      // Bedside Nightstand
      bevelRect(c, x, y, W, H, 4, '#80532e', '#ad784c', '#4a2c14');
      // Bedside lamp on left/top side
      const lx = x + W * 0.35, ly = y + H * 0.38;
      const lr = Math.max(4, Math.min(W, H) * 0.22);
      glowRadial(c, lx, ly, lr * 0.4, lr * 1.8, 'rgba(255,225,140,0.5)', 'rgba(255,225,140,0)');
      ell(c, lx, ly, lr, lr, '#f7e2a3', '#b89445', 1.5);
      ell(c, lx, ly, lr * 0.35, lr * 0.35, '#855b25');
      // Book / clock on right/bottom side
      const bw = Math.max(5, W * 0.32), bh = Math.max(4, H * 0.26);
      const bx = x + W * 0.62, by = y + H * 0.6;
      rr(c, bx - bw / 2, by - bh / 2, bw, bh, 1.5);
      c.fillStyle = '#b33927'; c.fill(); // red book
      c.strokeStyle = '#5a1910'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#ffffff'; c.fillRect(bx - bw / 2 + 1, by - bh / 2 + 1, bw - 2, 1);
    } else if (isWideCoffee) {
      // Coffee Table with runner & mug
      bevelRect(c, x, y, W, H, 4, '#946038', '#bc8558', '#523218');
      // Table runner cloth down the center
      const rw = W * 0.4, rx = x + (W - rw) / 2;
      c.fillStyle = '#f0ece1';
      c.fillRect(rx, y + 2, rw, H - 4);
      c.strokeStyle = '#cfc6b2'; c.lineWidth = 1;
      c.strokeRect(rx, y + 2, rw, H - 4);
      // Fringed ends
      c.strokeStyle = '#a89c82';
      for (let i = 2; i < rw - 2; i += 3) {
        c.beginPath(); c.moveTo(rx + i, y + 2); c.lineTo(rx + i, y + 4); c.stroke();
        c.beginPath(); c.moveTo(rx + i, y + H - 4); c.lineTo(rx + i, y + H - 2); c.stroke();
      }
      // Ceramic coffee mug + saucer
      const mx = rx + rw * 0.68, my = y + H * 0.5;
      const mr = Math.min(rw * 0.22, H * 0.28);
      ell(c, mx, my, mr * 1.15, mr * 1.15, '#e2e8f0', '#94a3b8'); // saucer
      ell(c, mx, my, mr * 0.85, mr * 0.85, '#ffffff', '#64748b'); // mug rim
      ell(c, mx, my, mr * 0.65, mr * 0.65, '#3b2214');            // espresso
      ell(c, mx - mr * 0.2, my - mr * 0.2, mr * 0.2, mr * 0.2, '#f5e6d3'); // crema/foam
      // Coaster / magazine
      const px = rx + rw * 0.28, py = y + H * 0.5, pr = mr * 0.85;
      rr(c, px - pr, py - pr * 0.7, pr * 2, pr * 1.4, 1);
      c.fillStyle = '#3a5f8a'; c.fill();
    } else {
      // Large Dining / Conference Table
      bevelRect(c, x, y, W, H, 5, '#8c5730', '#b57b4f', '#472a14');
      // Wood plank seams
      woodPlanks(c, x + 3, y + 3, W - 6, H - 6, Math.max(3, Math.round((W >= H ? H : W) / 12)), '#966038', '#5a3418', W >= H ? 'h' : 'v');
      // Centerpiece decorative bowl / fruit platter
      const cx = x + W / 2, cy = y + H / 2;
      const cr = Math.min(W, H) * 0.2;
      ell(c, cx, cy, cr * 1.2, cr * 0.8, '#d9d0c1', '#8c7d67', 1.5);
      ell(c, cx - cr * 0.3, cy, cr * 0.35, cr * 0.35, '#c0392b'); // red apple
      ell(c, cx + cr * 0.2, cy - cr * 0.1, cr * 0.3, cr * 0.3, '#27ae60'); // green apple
      ell(c, cx + cr * 0.1, cy + cr * 0.2, cr * 0.32, cr * 0.32, '#f39c12'); // orange
    }

    // Outer table border
    c.strokeStyle = '#382012'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 4); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 3. MEDIA: TV credenza base, ultra-thin top-down OLED TV bar with rectangular
  // pedestal & blue power LED, stereo bookshelf speakers with grilles, game console.
  // -------------------------------------------------------------------------
  media(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 8, 5, 4);

    const isH = W >= H;
    // Credenza base: dark lacquer wood
    bevelRect(c, x, y, W, H, 4, '#231d2c', '#3e344d', '#130f19');

    if (isH) {
      // Stereo speakers flanking credenza
      const spkW = Math.max(6, Math.min(W * 0.15, 20));
      const spkH = H - 6;
      for (const sx of [x + 3, x + W - spkW - 3]) {
        rr(c, sx, y + 3, spkW, spkH, 2);
        c.fillStyle = '#17141f'; c.fill();
        c.strokeStyle = '#433754'; c.lineWidth = 1; c.stroke();
        // Fabric speaker grilles
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        for (let gy = y + 6; gy < y + spkH; gy += 3) {
          c.beginPath(); c.moveTo(sx + 2, gy); c.lineTo(sx + spkW - 2, gy); c.stroke();
        }
        // Speaker cones
        ell(c, sx + spkW / 2, y + 3 + spkH * 0.32, spkW * 0.28, spkW * 0.28, '#2a2238', '#b38f48', 1);
        ell(c, sx + spkW / 2, y + 3 + spkH * 0.72, spkW * 0.34, spkW * 0.34, '#2a2238', '#b38f48', 1);
      }

      // Game console box (e.g. PS5 / Xbox) on left side of center
      const conW = Math.max(8, W * 0.14), conH = Math.max(5, H * 0.42);
      const conX = x + spkW + 6, conY = y + H - conH - 4;
      rr(c, conX, conY, conW, conH, 2);
      c.fillStyle = '#0f1118'; c.fill();
      c.strokeStyle = '#32394a'; c.lineWidth = 1; c.stroke();
      // Glowing console light strip
      c.strokeStyle = '#38bdf8'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(conX + 2, conY + 2); c.lineTo(conX + conW - 2, conY + 2); c.stroke();

      // OLED TV Stand Pedestal
      const standW = Math.max(14, W * 0.32), standD = Math.max(5, H * 0.28);
      const standX = x + (W - standW) / 2, standY = y + H * 0.48;
      rr(c, standX, standY, standW, standD, 2);
      c.fillStyle = '#1e2430'; c.fill();
      c.strokeStyle = '#4b5563'; c.lineWidth = 1; c.stroke();

      // Top-down ultra-thin OLED TV panel bar (very thin glass bar across width)
      const tvW = Math.max(24, W * 0.62);
      const tvThick = Math.max(3, Math.min(5, H * 0.18));
      const tvX = x + (W - tvW) / 2;
      const tvY = y + H * 0.38;

      rr(c, tvX, tvY, tvW, tvThick, 1.5);
      c.fillStyle = '#05070a'; c.fill();
      c.strokeStyle = '#374151'; c.lineWidth = 1; c.stroke();
      // Glass specular reflection highlight line
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(tvX + 3, tvY + 1); c.lineTo(tvX + tvW * 0.5, tvY + 1); c.stroke();

      // Blue / emerald power LED dot
      const ledX = tvX + tvW / 2, ledY = tvY + tvThick;
      glowRadial(c, ledX, ledY, 1, 4, '#38bdf8', 'rgba(56,189,248,0)');
      ell(c, ledX, ledY, 1.5, 1.5, '#38bdf8');
    } else {
      // Vertical TV credenza orientation
      const spkH = Math.max(6, Math.min(H * 0.15, 20));
      const spkW = W - 6;
      for (const sy of [y + 3, y + H - spkH - 3]) {
        rr(c, x + 3, sy, spkW, spkH, 2);
        c.fillStyle = '#17141f'; c.fill();
        c.strokeStyle = '#433754'; c.lineWidth = 1; c.stroke();
      }
      // TV pedestal and vertical panel
      const standH = Math.max(14, H * 0.32), standD = Math.max(5, W * 0.28);
      rr(c, x + W * 0.48, y + (H - standH) / 2, standD, standH, 2);
      c.fillStyle = '#1e2430'; c.fill();
      const tvH = Math.max(24, H * 0.62);
      const tvThick = Math.max(3, Math.min(5, W * 0.18));
      rr(c, x + W * 0.38, y + (H - tvH) / 2, tvThick, tvH, 1.5);
      c.fillStyle = '#05070a'; c.fill();
      ell(c, x + W * 0.38 + tvThick, y + H / 2, 1.5, 1.5, '#38bdf8');
    }

    c.strokeStyle = '#181220'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 4. PLANT: Ceramic/terracotta round pot with beveled rim & shadow, dark
  // rich soil, lush layered organic tropical foliage (Monstera leaves in
  // multiple greens with veins/midribs, central bright sprout fronds).
  // -------------------------------------------------------------------------
  plant(c, x, y, W, H) {
    const cx = x + W / 2, cy = y + H / 2;
    const maxR = Math.min(W, H) / 2;
    const potR = maxR * 0.58;

    // Outer pot shadow
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.48)';
    c.shadowBlur = 8; c.shadowOffsetY = 5;
    ell(c, cx, cy + 2, potR * 1.05, potR * 1.05, '#8c3d1e');
    c.restore();

    // Terracotta pot outer rim
    ell(c, cx, cy, potR, potR, '#b85a30', '#7a3014', 2);
    // Beveled rim highlight
    ell(c, cx, cy - 1, potR * 0.92, potR * 0.88, '#d47144');
    // Dark rich potting soil
    ell(c, cx, cy, potR * 0.78, potR * 0.78, '#2a1a10', '#1c1008', 1.5);

    // Soil organic grains
    c.fillStyle = '#150d06';
    for (let i = 0; i < 8; i++) {
      const sa = (i * 1.3), sr = potR * (0.2 + (i % 4) * 0.12);
      c.fillRect(cx + Math.cos(sa) * sr, cy + Math.sin(sa) * sr, 1.5, 1.5);
    }

    // Layer 1: Broad outer tropical Monstera leaves (radiating outward)
    const n1 = 8;
    for (let i = 0; i < n1; i++) {
      const a = (i / n1) * Math.PI * 2 + 0.2;
      const len = potR * (1.45 + (i % 3) * 0.22);
      const col = i % 2 === 0 ? '#275932' : '#1f4828';
      drawLeaf(c, cx, cy, len, a, col, '#14331b');
    }

    // Layer 2: Mid-tier vibrant foliage
    const n2 = 7;
    for (let i = 0; i < n2; i++) {
      const a = (i / n2) * Math.PI * 2 + 0.65;
      const len = potR * (1.1 + (i % 2) * 0.2);
      const col = i % 2 === 0 ? '#388e3c' : '#43a047';
      drawLeaf(c, cx, cy, len, a, col, '#1b5e20');
    }

    // Layer 3: Central bright young sprout fronds
    const n3 = 4;
    for (let i = 0; i < n3; i++) {
      const a = (i / n3) * Math.PI * 2 + 1.1;
      const len = potR * 0.65;
      drawLeaf(c, cx, cy, len, a, '#8bc34a', '#558b2f');
    }

    // Central bud core
    ell(c, cx, cy, potR * 0.18, potR * 0.18, '#aed581', '#689f38', 1);
  },

  // -------------------------------------------------------------------------
  // 5. BED: Polished headboard with posts, 2 plump pillows with center creases,
  // folded sheet turn-down cuff, quilted duvet with diamond stitching, and
  // contrasting decorative throw blanket runner at foot.
  // -------------------------------------------------------------------------
  bed(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 8, 5, 5);

    const isH = W > H * 1.35; // Headboard at left if wide; at top if vertical/square

    if (!isH) {
      // Standard Bed: Headboard at top
      // Mattress frame
      rr(c, x, y, W, H, 5); c.fillStyle = '#42281b'; c.fill();
      rr(c, x + 3, y + 3, W - 6, H - 6, 4); c.fillStyle = '#efe9df'; c.fill();

      // Polished Headboard with corner posts
      const hbH = Math.max(7, H * 0.14);
      rr(c, x + 1, y + 1, W - 2, hbH, 3);
      c.fillStyle = '#613b24'; c.fill();
      c.strokeStyle = '#382012'; c.lineWidth = 1.5; c.stroke();
      // Headboard corner posts
      rr(c, x, y, 5, hbH + 2, 2); c.fillStyle = '#4a2c1a'; c.fill();
      rr(c, x + W - 5, y, 5, hbH + 2, 2); c.fillStyle = '#4a2c1a'; c.fill();

      // Plump Pillows with center creases
      const pilW = (W - 18) / 2, pilH = Math.max(8, H * 0.22);
      const pilY = y + hbH + 4;
      for (const px of [x + 5, x + W - pilW - 5]) {
        rr(c, px, pilY, pilW, pilH, 4);
        c.fillStyle = '#ffffff'; c.fill();
        c.strokeStyle = '#d9d0c1'; c.lineWidth = 1; c.stroke();
        // Pillow indentation crease
        c.strokeStyle = '#c4b9a5'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(px + pilW * 0.25, pilY + pilH * 0.5);
        c.quadraticCurveTo(px + pilW * 0.5, pilY + pilH * 0.6, px + pilW * 0.75, pilY + pilH * 0.5);
        c.stroke();
      }

      // Sheet Turn-down cuff
      const cuffY = pilY + pilH + 2;
      const cuffH = Math.max(5, H * 0.08);
      rr(c, x + 3, cuffY, W - 6, cuffH, 2);
      c.fillStyle = '#f8f5ee'; c.fill();
      c.strokeStyle = '#cfc6b4'; c.lineWidth = 1; c.stroke();

      // Quilted Duvet with diamond stitching
      const duvetY = cuffY + cuffH;
      const duvetH = H - (duvetY - y) - 3;
      if (duvetH > 6) {
        c.save();
        rr(c, x + 3, duvetY, W - 6, duvetH, 3);
        c.clip();
        c.fillStyle = '#a6596b'; c.fill(); // elegant rose/wine duvet

        // Diamond waffle stitching pattern
        c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1;
        const step = Math.max(8, W / 6);
        for (let d = -H; d < W + H; d += step) {
          c.beginPath(); c.moveTo(x + d, duvetY); c.lineTo(x + d + duvetH, duvetY + duvetH); c.stroke();
          c.beginPath(); c.moveTo(x + d, duvetY + duvetH); c.lineTo(x + d + duvetH, duvetY); c.stroke();
        }
        c.restore();

        // Decorative throw blanket runner at foot of the bed
        const runH = Math.max(7, duvetH * 0.35);
        const runY = y + H - runH - 3;
        rr(c, x + 2, runY, W - 4, runH, 2);
        c.fillStyle = '#c59b48'; c.fill(); // gold accent runner
        c.strokeStyle = '#7d5d1c'; c.lineWidth = 1; c.stroke();
        // Fringe tassels at runner edge
        c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1;
        for (let fx = x + 4; fx < x + W - 4; fx += 4) {
          c.beginPath(); c.moveTo(fx, runY); c.lineTo(fx, runY + 2); c.stroke();
        }
      }
    } else {
      // Horizontal Bed: Headboard at left
      rr(c, x, y, W, H, 5); c.fillStyle = '#42281b'; c.fill();
      rr(c, x + 3, y + 3, W - 6, H - 6, 4); c.fillStyle = '#efe9df'; c.fill();

      const hbW = Math.max(7, W * 0.14);
      rr(c, x + 1, y + 1, hbW, H - 2, 3);
      c.fillStyle = '#613b24'; c.fill();
      c.strokeStyle = '#382012'; c.lineWidth = 1.5; c.stroke();

      const pilH = (H - 18) / 2, pilW = Math.max(8, W * 0.22);
      const pilX = x + hbW + 4;
      for (const py of [y + 5, y + H - pilH - 5]) {
        rr(c, pilX, py, pilW, pilH, 4);
        c.fillStyle = '#ffffff'; c.fill();
        c.strokeStyle = '#d9d0c1'; c.lineWidth = 1; c.stroke();
      }

      const cuffX = pilX + pilW + 2, cuffW = Math.max(5, W * 0.08);
      rr(c, cuffX, y + 3, cuffW, H - 6, 2);
      c.fillStyle = '#f8f5ee'; c.fill();

      const duvetX = cuffX + cuffW, duvetW = W - (duvetX - x) - 3;
      if (duvetW > 6) {
        rr(c, duvetX, y + 3, duvetW, H - 6, 3);
        c.fillStyle = '#a6596b'; c.fill();
        const runW = Math.max(7, duvetW * 0.35);
        rr(c, x + W - runW - 3, y + 2, runW, H - 4, 2);
        c.fillStyle = '#c59b48'; c.fill();
      }
    }

    c.strokeStyle = '#2d1a10'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 4); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 6. DRESSER: Finished hardwood top with decorative beveled perimeter moulding,
  // front drawer overhang lip, tabletop vanity items (jewelry tray, perfume, clock).
  // -------------------------------------------------------------------------
  dresser(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 4);

    // Multi-tier hardwood dresser top
    bevelRect(c, x, y, W, H, 4, '#80532e', '#b87c4a', '#472b14');
    // Inner bevel inlay panel
    rr(c, x + 3, y + 3, W - 6, H - 6, 2);
    c.fillStyle = '#946238'; c.fill();
    c.strokeStyle = '#5c3517'; c.lineWidth = 1; c.stroke();

    // Front drawer overhang lip highlight & shadow
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 3, y + H - 2); c.lineTo(x + W - 3, y + H - 2); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 3, y + H - 3); c.lineTo(x + W - 3, y + H - 3); c.stroke();

    // Tabletop Vanity Items
    // 1. Jewelry Tray on left
    const tw = Math.max(7, W * 0.28), thH = Math.max(5, H * 0.45);
    const tx = x + 6, ty = y + (H - thH) / 2;
    rr(c, tx, ty, tw, thH, 2);
    c.fillStyle = '#1e3d31'; c.fill(); // velvet green tray interior
    c.strokeStyle = '#c5a059'; c.lineWidth = 1.5; c.stroke(); // gold tray rim
    // Sparkle pearl/ring in tray
    ell(c, tx + tw * 0.4, ty + thH * 0.45, 1.5, 1.5, '#ffffff');
    ell(c, tx + tw * 0.7, ty + thH * 0.55, 1.5, 1.5, '#f5d061');

    // 2. Faceted perfume/cologne bottle
    const px = x + W * 0.52, py = y + H * 0.48;
    const pr = Math.min(W * 0.08, H * 0.2);
    ell(c, px, py, pr * 1.2, pr, 'rgba(186,230,253,0.85)', '#38bdf8', 1); // glass flacon
    ell(c, px, py, pr * 0.4, pr * 0.4, '#ffd700'); // gold atomizer cap

    // 3. Bedside round clock / comb on right
    const cx = x + W - Math.max(8, W * 0.18), cy = y + H * 0.5;
    const cr = Math.min(W * 0.12, H * 0.28);
    ell(c, cx, cy, cr, cr, '#f1f5f9', '#64748b', 1.5); // clock dial
    ell(c, cx, cy, 1, 1, '#0f172a'); // center pin
    c.strokeStyle = '#0f172a'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy - cr * 0.6); c.stroke(); // hour hand
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + cr * 0.5, cy); c.stroke(); // minute hand

    c.strokeStyle = '#382012'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 7. WARDROBE: Tall armoire with crowned cornice moulding projecting over
  // rim, central double-door seam, brass top hinges, deeper drop shadow.
  // -------------------------------------------------------------------------
  wardrobe(c, x, y, W, H) {
    // Deep drop shadow representing high armoire height
    dropShadow(c, x, y, W, H, 12, 8, 4, 'rgba(0,0,0,0.55)');

    // Projecting crowned cornice outer moulding
    rr(c, x, y, W, H, 4);
    c.fillStyle = '#452b19'; c.fill();

    // Cornice beveled crown rim
    c.strokeStyle = '#996339'; c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, W - 2, H - 2);

    // Recessed top cabinet roof panel
    rr(c, x + 4, y + 4, W - 8, H - 8, 2);
    c.fillStyle = '#694125'; c.fill();
    c.strokeStyle = '#331d0d'; c.lineWidth = 1; c.stroke();

    const isH = W >= H;
    if (isH) {
      // Double doors with center vertical seam
      const midX = x + W / 2;
      c.strokeStyle = '#241409'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(midX, y + 3); c.lineTo(midX, y + H - 3); c.stroke();

      // Brass door top hinges on left and right outer corners
      c.fillStyle = '#d4af37';
      c.fillRect(x + 4, y + 5, 4, 2);
      c.fillRect(x + 4, y + H - 7, 4, 2);
      c.fillRect(x + W - 8, y + 5, 4, 2);
      c.fillRect(x + W - 8, y + H - 7, 4, 2);

      // Brass door knobs / pulls near center seam
      ell(c, midX - 4, y + H * 0.5, 2, 3, '#d4af37', '#8c6b1c');
      ell(c, midX + 4, y + H * 0.5, 2, 3, '#d4af37', '#8c6b1c');
    } else {
      // Vertical armoire doors with horizontal seam
      const midY = y + H / 2;
      c.strokeStyle = '#241409'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x + 3, midY); c.lineTo(x + W - 3, midY); c.stroke();

      c.fillStyle = '#d4af37';
      c.fillRect(x + 5, y + 4, 2, 4);
      c.fillRect(x + W - 7, y + 4, 2, 4);
      c.fillRect(x + 5, y + H - 8, 2, 4);
      c.fillRect(x + W - 7, y + H - 8, 2, 4);

      ell(c, x + W * 0.5, midY - 4, 3, 2, '#d4af37', '#8c6b1c');
      ell(c, x + W * 0.5, midY + 4, 3, 2, '#d4af37', '#8c6b1c');
    }

    c.strokeStyle = '#26150a'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 8. ISLAND: Luxury marble/quartz or butcher block countertop, undermount
  // stainless double sink with gooseneck faucet, built-in glass induction
  // cooktop with glowing burner rings, prep cutting board, cushioned barstools.
  // -------------------------------------------------------------------------
  island(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 8, 5, 5);

    // Marble countertop base
    bevelRect(c, x, y, W, H, 5, '#eef2f6', '#ffffff', '#9aa2ad');

    // Marble veining lines
    c.save();
    rr(c, x + 2, y + 2, W - 4, H - 4, 4);
    c.clip();
    c.strokeStyle = 'rgba(160,175,195,0.3)'; c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(x + W * 0.1, y + 2);
    c.bezierCurveTo(x + W * 0.25, y + H * 0.4, x + W * 0.35, y + H * 0.6, x + W * 0.5, y + H - 2);
    c.stroke();
    c.beginPath();
    c.moveTo(x + W * 0.6, y + 2);
    c.bezierCurveTo(x + W * 0.7, y + H * 0.3, x + W * 0.8, y + H * 0.7, x + W * 0.95, y + H - 2);
    c.stroke();
    c.restore();

    const isH = W >= H;
    if (isH) {
      // 1. Undermount stainless double sink on left
      const sinkW = Math.max(12, W * 0.28), sinkH = Math.max(8, H * 0.5);
      const sinkX = x + W * 0.08, sinkY = y + (H - sinkH) / 2;
      rr(c, sinkX, sinkY, sinkW, sinkH, 3);
      c.fillStyle = '#b8c0ca'; c.fill();
      c.strokeStyle = '#64748b'; c.lineWidth = 1.5; c.stroke();

      // Double basins
      const bw = (sinkW - 5) / 2;
      rr(c, sinkX + 2, sinkY + 2, bw, sinkH - 4, 2);
      c.fillStyle = '#838e9c'; c.fill();
      ell(c, sinkX + 2 + bw / 2, sinkY + sinkH / 2, 2, 2, '#475569'); // drain

      rr(c, sinkX + 3 + bw, sinkY + 2, bw, sinkH - 4, 2);
      c.fillStyle = '#838e9c'; c.fill();
      ell(c, sinkX + 3 + bw + bw / 2, sinkY + sinkH / 2, 2, 2, '#475569');

      // Chrome gooseneck faucet
      const fcX = sinkX + sinkW / 2, fcY = sinkY - 1;
      ell(c, fcX, fcY, 2.5, 2.5, '#e2e8f0', '#475569');
      c.strokeStyle = '#e2e8f0'; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(fcX, fcY); c.lineTo(fcX, sinkY + 4); c.stroke();

      // 2. Glass induction cooktop on right
      const cookW = Math.max(12, W * 0.28), cookH = Math.max(8, H * 0.5);
      const cookX = x + W * 0.64, cookY = y + (H - cookH) / 2;
      rr(c, cookX, cookY, cookW, cookH, 2);
      c.fillStyle = '#17191e'; c.fill();
      c.strokeStyle = '#374151'; c.lineWidth = 1; c.stroke();

      // Glowing induction burner rings
      const r1 = Math.min(cookW * 0.18, cookH * 0.35);
      ell(c, cookX + cookW * 0.3, cookY + cookH * 0.5, r1, r1, null, '#f97316', 1.5);
      ell(c, cookX + cookW * 0.72, cookY + cookH * 0.5, r1 * 0.85, r1 * 0.85, null, '#f97316', 1.5);

      // 3. Wooden prep cutting board in center
      const boardW = Math.max(8, W * 0.18), boardH = Math.max(6, H * 0.42);
      const boardX = x + (W - boardW) / 2, boardY = y + (H - boardH) / 2;
      rr(c, boardX, boardY, boardW, boardH, 2);
      c.fillStyle = '#c89255'; c.fill();
      c.strokeStyle = '#8a5c28'; c.lineWidth = 1; c.stroke();

      // Round cushioned barstools tucked along bottom overhang edge
      const numStools = Math.max(2, Math.floor(W / 45));
      const stoolR = Math.min(8, Math.min(W * 0.08, H * 0.18));
      for (let i = 0; i < numStools; i++) {
        const sx = x + (W / (numStools + 1)) * (i + 1);
        const sy = y + H - 2;
        ell(c, sx, sy, stoolR, stoolR * 0.8, '#4a3220', '#26180e', 1.5);
        ell(c, sx, sy, stoolR * 0.6, stoolR * 0.45, '#c59b27');
      }
    } else {
      // Vertical island
      const sinkW = W * 0.5, sinkH = H * 0.28;
      rr(c, x + (W - sinkW) / 2, y + H * 0.08, sinkW, sinkH, 3);
      c.fillStyle = '#b8c0ca'; c.fill();
      const cookW = W * 0.5, cookH = H * 0.28;
      rr(c, x + (W - cookW) / 2, y + H * 0.64, cookW, cookH, 2);
      c.fillStyle = '#17191e'; c.fill();
    }

    c.strokeStyle = '#64748b'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 4); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 9. COUNTER: Quartz/granite countertop with wall-edge backsplash, front
  // bullnose edge, built-in sink with chrome tap or 4-burner cooktop, prep items.
  // -------------------------------------------------------------------------
  counter(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 3);

    // Countertop base: durable granite/laminate
    bevelRect(c, x, y, W, H, 3, '#c2c8d0', '#ffffff', '#7c8694');

    // Wall-edge backsplash strip along top edge (3px)
    c.fillStyle = '#475569';
    c.fillRect(x + 2, y + 2, W - 4, 3);

    // Front bullnose edge highlight along bottom
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 2, y + H - 3); c.lineTo(x + W - 2, y + H - 3); c.stroke();

    const isH = W >= H;
    if (isH) {
      // Stainless Sink on left
      const sinkW = Math.max(10, W * 0.28), sinkH = Math.max(6, H * 0.55);
      const sinkX = x + W * 0.15, sinkY = y + 7;
      rr(c, sinkX, sinkY, sinkW, sinkH, 2);
      c.fillStyle = '#94a3b8'; c.fill();
      c.strokeStyle = '#475569'; c.lineWidth = 1.5; c.stroke();
      // Chrome faucet tap
      ell(c, sinkX + sinkW / 2, sinkY - 2, 2, 2, '#e2e8f0', '#64748b');

      // 4-burner cooktop on right
      const cookW = Math.max(10, W * 0.28), cookH = Math.max(6, H * 0.55);
      const cookX = x + W * 0.58, cookY = y + 7;
      rr(c, cookX, cookY, cookW, cookH, 2);
      c.fillStyle = '#1e293b'; c.fill();
      c.strokeStyle = '#334155'; c.lineWidth = 1; c.stroke();
      const br = Math.min(cookW * 0.16, cookH * 0.25);
      for (const [bx, by] of [
        [cookX + cookW * 0.28, cookY + cookH * 0.3],
        [cookX + cookW * 0.72, cookY + cookH * 0.3],
        [cookX + cookW * 0.28, cookY + cookH * 0.7],
        [cookX + cookW * 0.72, cookY + cookH * 0.7]
      ]) {
        ell(c, bx, by, br, br, '#334155', '#94a3b8', 1);
      }
    } else {
      // Vertical counter: sink in middle
      const sinkW = W * 0.6, sinkH = H * 0.35;
      rr(c, x + (W - sinkW) / 2, y + (H - sinkH) / 2, sinkW, sinkH, 2);
      c.fillStyle = '#94a3b8'; c.fill();
    }

    c.strokeStyle = '#546070'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 10. DESK: Clean wood/laminate desk with bevel, tucked-in swivel task chair
  // (seat, lumbar back, armrests), curved/dual widescreen monitor, desk mat,
  // mechanical keyboard, mouse, coffee mug, notepad.
  // -------------------------------------------------------------------------
  desk(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 4);

    const isH = W >= H;
    // Desk surface: rich laminate/oak with bevel
    bevelRect(c, x, y, W, H, 4, '#475569', '#64748b', '#273142');

    if (isH) {
      // Executive desk mat in center
      const matW = Math.max(18, W * 0.6), matH = Math.max(10, H * 0.72);
      const matX = x + (W - matW) / 2, matY = y + (H - matH) / 2;
      rr(c, matX, matY, matW, matH, 2);
      c.fillStyle = '#1e293b'; c.fill();
      c.strokeStyle = '#334155'; c.lineWidth = 1; c.stroke();

      // Ultrawide Curved Widescreen Monitor on arm mount
      const monW = Math.max(16, matW * 0.7), monH = Math.max(3, H * 0.14);
      const monX = matX + (matW - monW) / 2, monY = matY + 3;
      // Curved monitor bar
      c.save();
      c.beginPath();
      c.moveTo(monX, monY);
      c.quadraticCurveTo(monX + monW / 2, monY - 2, monX + monW, monY);
      c.lineTo(monX + monW, monY + monH);
      c.quadraticCurveTo(monX + monW / 2, monY + monH - 2, monX, monY + monH);
      c.closePath();
      c.fillStyle = '#090d16'; c.fill();
      c.strokeStyle = '#475569'; c.lineWidth = 1; c.stroke();
      // Screen glow reflection on desk
      c.strokeStyle = '#38bdf8'; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(monX + 3, monY + monH);
      c.quadraticCurveTo(monX + monW / 2, monY + monH - 2, monX + monW - 3, monY + monH);
      c.stroke();
      c.restore();

      // Monitor Stand Foot
      rr(c, monX + monW / 2 - 4, monY + monH + 1, 8, 3, 1);
      c.fillStyle = '#334155'; c.fill();

      // Mechanical Keyboard
      const kbW = Math.max(10, monW * 0.55), kbH = Math.max(4, matH * 0.32);
      const kbX = matX + (matW - kbW) / 2 - 4, kbY = matY + matH - kbH - 4;
      rr(c, kbX, kbY, kbW, kbH, 1.5);
      c.fillStyle = '#0f172a'; c.fill();
      c.strokeStyle = '#475569'; c.lineWidth = 1; c.stroke();
      // Keycaps grid lines
      c.fillStyle = '#334155';
      c.fillRect(kbX + 2, kbY + 2, kbW - 4, 1.5);
      c.fillRect(kbX + 2, kbY + kbH - 3, kbW - 4, 1.5);

      // Ergonomic Mouse
      const msW = Math.max(3, kbH * 0.5), msH = Math.max(4, kbH * 0.8);
      const msX = kbX + kbW + 4, msY = kbY + (kbH - msH) / 2;
      rr(c, msX, msY, msW, msH, 2);
      c.fillStyle = '#0f172a'; c.fill();
      c.strokeStyle = '#38bdf8'; c.lineWidth = 1; c.stroke();

      // Ceramic coffee mug on side
      const mugX = x + W * 0.88, mugY = y + H * 0.35;
      const mr = Math.min(4, Math.min(W, H) * 0.12);
      ell(c, mugX, mugY, mr * 1.2, mr * 1.2, '#f8fafc', '#64748b');
      ell(c, mugX, mugY, mr * 0.8, mr * 0.8, '#3d2012');

      // Spiral notepad on other side
      const npW = Math.max(6, W * 0.12), npH = Math.max(8, H * 0.38);
      const npX = x + 5, npY = y + (H - npH) / 2;
      rr(c, npX, npY, npW, npH, 1);
      c.fillStyle = '#fef08a'; c.fill(); // yellow legal notepad
      c.strokeStyle = '#ca8a04'; c.lineWidth = 1; c.stroke();

      // Tucked-in ergonomic swivel office task chair
      const chW = Math.max(10, matW * 0.45), chH = Math.max(7, H * 0.35);
      const chX = x + (W - chW) / 2, chY = y + H - chH * 0.4;
      // Seat cushion
      rr(c, chX, chY, chW, chH, 4);
      c.fillStyle = '#1e293b'; c.fill();
      c.strokeStyle = '#0f172a'; c.lineWidth = 1.5; c.stroke();
      // Lumbar curved backrest
      c.beginPath();
      c.moveTo(chX - 1, chY + chH);
      c.quadraticCurveTo(chX + chW / 2, chY + chH + 4, chX + chW + 1, chY + chH);
      c.strokeStyle = '#0f172a'; c.lineWidth = 3; c.stroke();
      // Armrests
      c.fillStyle = '#0f172a';
      c.fillRect(chX - 2, chY + 2, 2.5, chH * 0.6);
      c.fillRect(chX + chW - 0.5, chY + 2, 2.5, chH * 0.6);
    } else {
      // Vertical desk
      const matW = W * 0.7, matH = H * 0.6;
      rr(c, x + (W - matW) / 2, y + (H - matH) / 2, matW, matH, 2);
      c.fillStyle = '#1e293b'; c.fill();
    }

    c.strokeStyle = '#1e293b'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 11. DIVIDER: Acoustic fabric texture, anodized aluminum frame edges,
  // stabilizing T-feet at ends, modular segment seams.
  // -------------------------------------------------------------------------
  divider(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 6, 3, 2);

    const isH = W >= H;
    // Anodized aluminum frame base
    rr(c, x, y, W, H, 2);
    c.fillStyle = '#334155'; c.fill();

    if (isH) {
      // Aluminum top and bottom frame rails
      c.fillStyle = '#64748b';
      c.fillRect(x, y, W, 2);
      c.fillRect(x, y + H - 2, W, 2);

      // Acoustic fabric woven center panel
      c.fillStyle = '#1e293b';
      c.fillRect(x + 2, y + 2, W - 4, H - 4);

      // Modular segment seams
      const numSegments = Math.max(2, Math.round(W / 24));
      const segW = W / numSegments;
      c.strokeStyle = '#475569'; c.lineWidth = 1.5;
      for (let i = 1; i < numSegments; i++) {
        c.beginPath(); c.moveTo(x + i * segW, y); c.lineTo(x + i * segW, y + H); c.stroke();
      }

      // Stabilizing T-feet floor brackets at both ends
      const footH = Math.max(6, H * 1.8);
      const footY = y - (footH - H) / 2;
      rr(c, x - 2, footY, 3, footH, 1); c.fillStyle = '#94a3b8'; c.fill();
      rr(c, x + W - 1, footY, 3, footH, 1); c.fillStyle = '#94a3b8'; c.fill();
    } else {
      // Vertical divider
      c.fillStyle = '#64748b';
      c.fillRect(x, y, 2, H);
      c.fillRect(x + W - 2, y, 2, H);
      c.fillStyle = '#1e293b';
      c.fillRect(x + 2, y + 2, W - 4, H - 4);

      const footW = Math.max(6, W * 1.8);
      const footX = x - (footW - W) / 2;
      rr(c, footX, y - 2, footW, 3, 1); c.fillStyle = '#94a3b8'; c.fill();
      rr(c, footX, y + H - 1, footW, 3, 1); c.fillStyle = '#94a3b8'; c.fill();
    }

    c.strokeStyle = '#0f172a'; c.lineWidth = 1;
    rr(c, x, y, W, H, 2); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 12. CABINET: Filing credenza top, recessed pull lip, lock cylinder,
  // paper inbox tray or printer/phone.
  // -------------------------------------------------------------------------
  cabinet(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 3);

    bevelRect(c, x, y, W, H, 3, '#475569', '#64748b', '#334155');

    const cols = Math.max(1, Math.round(W / 24));
    const cw = (W - 4) / cols;
    for (let i = 0; i < cols; i++) {
      const cx = x + 2 + i * cw;
      rr(c, cx + 1, y + 2, cw - 2, H - 4, 2);
      c.fillStyle = '#334155'; c.fill();
      c.strokeStyle = '#1e293b'; c.lineWidth = 1; c.stroke();

      // Recessed aluminum pull lip
      c.fillStyle = '#cbd5e1';
      c.fillRect(cx + cw / 2 - 4, y + H - 4, 8, 2);

      // Lock cylinder on right drawer
      if (i === cols - 1) {
        ell(c, cx + cw - 5, y + 5, 1.5, 1.5, '#ffd700', '#78350f');
      }
    }

    // Office desktop item: Two-tier paper inbox tray with documents
    const tw = Math.max(8, W * 0.28), thH = Math.max(6, H * 0.55);
    const tx = x + 5, ty = y + (H - thH) / 2;
    rr(c, tx, ty, tw, thH, 1);
    c.fillStyle = '#1e293b'; c.fill();
    c.strokeStyle = '#64748b'; c.lineWidth = 1; c.stroke();
    // Stacked white paper sheets with text lines
    c.fillStyle = '#ffffff';
    c.fillRect(tx + 2, ty + 2, tw - 4, thH - 4);
    c.strokeStyle = '#94a3b8'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(tx + 3, ty + 4); c.lineTo(tx + tw - 3, ty + 4); c.stroke();
    c.beginPath(); c.moveTo(tx + 3, ty + 6); c.lineTo(tx + tw - 5, ty + 6); c.stroke();

    c.strokeStyle = '#1e293b'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 13. CUBICLE: U/L-shaped acoustic fabric partition walls with top rail caps,
  // built-in corner desk, swivel task chair with armrests, monitor on arm,
  // keyboard, mousepad, desk succulent.
  // -------------------------------------------------------------------------
  cubicle(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 3);

    const pad = 4;
    // Outer partition walls footprint
    rr(c, x, y, W, H, 3);
    c.fillStyle = '#1e293b'; c.fill();

    // Top rail cap (aluminum border)
    c.strokeStyle = '#64748b'; c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, W - 2, H - 2);

    // Interior floor / workspace area
    rr(c, x + pad, y + pad, W - pad * 2, H - pad * 2, 2);
    c.fillStyle = '#334155'; c.fill();

    // Built-in corner desk surface (L-shaped)
    const dw = (W - pad * 2) * 0.7, dh = (H - pad * 2) * 0.65;
    const dx = x + pad, dy = y + pad;
    rr(c, dx, dy, dw, dh, 2);
    c.fillStyle = '#f1f5f9'; c.fill();
    c.strokeStyle = '#cbd5e1'; c.lineWidth = 1; c.stroke();

    // Widescreen monitor on articulated arm mount
    const monW = Math.max(10, dw * 0.55), monH = Math.max(3, dh * 0.18);
    const monX = dx + dw * 0.2, monY = dy + 3;
    rr(c, monX, monY, monW, monH, 1);
    c.fillStyle = '#0f172a'; c.fill();
    c.strokeStyle = '#38bdf8'; c.lineWidth = 1; c.stroke();

    // Keyboard & mousepad
    const kbW = monW * 0.6, kbH = dh * 0.3;
    rr(c, monX, dy + dh - kbH - 3, kbW, kbH, 1);
    c.fillStyle = '#1e293b'; c.fill();

    // Miniature potted desk succulent in corner
    ell(c, dx + dw - 5, dy + 5, 2.5, 2.5, '#15803d', '#166534');

    // Ergonomic swivel chair facing the corner desk
    const chX = dx + dw * 0.55, chY = dy + dh + 4;
    const chR = Math.min(6, (W - pad * 2) * 0.16);
    ell(c, chX, chY, chR, chR * 0.85, '#0f172a', '#475569');

    c.strokeStyle = '#0f172a'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 14. SHELF: Retail gondola shelf / bookcase with sturdy uprights, merchandise
  // boxes/goods with price rails (or colorful book spines and bookends).
  // -------------------------------------------------------------------------
  shelf(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 7, 4, 3);

    const isH = W >= H;
    // Frame base
    rr(c, x, y, W, H, 3);
    c.fillStyle = '#3e2716'; c.fill();

    if (isH) {
      // Sturdy upright end frames
      c.fillStyle = '#24150b';
      c.fillRect(x, y, 4, H);
      c.fillRect(x + W - 4, y, 4, H);

      // Central shelves
      const numRows = Math.max(2, Math.round(H / 16));
      const rh = (H - 4) / numRows;
      const numItems = Math.max(3, Math.round((W - 12) / 10));
      const iw = (W - 12) / numItems;
      const pal = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#8e44ad', '#d35400', '#16a085'];

      for (let r = 0; r < numRows; r++) {
        const ry = y + 2 + r * rh;
        // Shelf plank
        c.fillStyle = '#613b20';
        c.fillRect(x + 4, ry + rh - 2, W - 8, 2);

        // Merchandise cartons / colorful book spines
        for (let i = 0; i < numItems; i++) {
          const ix = x + 5 + i * iw;
          const col = pal[(r * 5 + i) % pal.length];
          rr(c, ix, ry + 1, iw - 1.5, rh - 3, 1);
          c.fillStyle = col; c.fill();
          // Book title / packaging highlight
          c.fillStyle = 'rgba(255,255,255,0.3)';
          c.fillRect(ix, ry + 1, iw - 1.5, 1.5);
        }

        // White price tag rail along shelf edge
        c.fillStyle = '#ffffff';
        c.fillRect(x + 5, ry + rh - 1.5, W - 10, 1);
      }
    } else {
      // Vertical shelving
      c.fillStyle = '#24150b';
      c.fillRect(x, y, W, 4);
      c.fillRect(x, y + H - 4, W, 4);
      const cols = Math.max(2, Math.round(W / 14));
      const cw = (W - 4) / cols;
      const pal = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#8e44ad'];
      for (let cI = 0; cI < cols; cI++) {
        c.fillStyle = pal[cI % pal.length];
        rr(c, x + 2 + cI * cw, y + 4, cw - 2, H - 8, 1);
        c.fill();
      }
    }

    c.strokeStyle = '#1b0e06'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 2); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 15. STOCK: Clustered cardboard boxes with taped center seams, scannable
  // white shipping barcode labels, "FRAGILE" stamps, "THIS WAY UP" arrows.
  // -------------------------------------------------------------------------
  stock(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 4);

    // Box cluster parameters (3-4 overlapping cardboard cartons)
    const boxes = [
      { rx: 0.05, ry: 0.08, rw: 0.52, rh: 0.52, col: '#c89a65', tapeH: true },
      { rx: 0.48, ry: 0.05, rw: 0.48, rh: 0.46, col: '#b88954', tapeH: false },
      { rx: 0.18, ry: 0.48, rw: 0.58, rh: 0.48, col: '#d2a673', tapeH: true },
      { rx: 0.68, ry: 0.52, rw: 0.28, rh: 0.42, col: '#a87844', tapeH: false },
    ];

    for (const b of boxes) {
      const bx = x + b.rx * W, by = y + b.ry * H;
      const bw = b.rw * W, bh = b.rh * H;
      if (bw <= 4 || bh <= 4) continue;

      // Cardboard box
      rr(c, bx, by, bw, bh, 2);
      c.fillStyle = b.col; c.fill();
      c.strokeStyle = '#5a3d1c'; c.lineWidth = 1; c.stroke();

      // Packing tape running along center seam
      c.fillStyle = 'rgba(235, 205, 140, 0.45)';
      if (b.tapeH) {
        c.fillRect(bx, by + bh / 2 - 2, bw, 4);
        c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(bx, by + bh / 2); c.lineTo(bx + bw, by + bh / 2); c.stroke();
      } else {
        c.fillRect(bx + bw / 2 - 2, by, 4, bh);
        c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(bx + bw / 2, by); c.lineTo(bx + bw / 2, by + bh); c.stroke();
      }

      // Scannable white shipping label with barcode
      if (bw > 16 && bh > 14) {
        const lw = Math.min(14, bw * 0.45), lh = Math.min(10, bh * 0.4);
        const lx = bx + 3, ly = by + 3;
        rr(c, lx, ly, lw, lh, 1);
        c.fillStyle = '#ffffff'; c.fill();
        c.strokeStyle = '#1e293b'; c.lineWidth = 1;
        for (let i = 2; i < lw - 2; i += 2) {
          c.beginPath(); c.moveTo(lx + i, ly + 2); c.lineTo(lx + i, ly + lh - 2); c.stroke();
        }
      }

      // Red "FRAGILE" warning stamp on largest box
      if (b === boxes[2] && bw > 24) {
        c.fillStyle = '#dc2626';
        c.fillRect(bx + bw - 14, by + 4, 11, 4);
        c.fillStyle = '#ffffff';
        c.fillRect(bx + bw - 13, by + 5, 9, 2);
      }
    }

    c.strokeStyle = '#3e250f'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 16. PALLET: Heavy timber pallet slats, nail indentations, dark gaps showing
  // floor below, shrink-wrapped cargo with plastic sheen and tension strapping.
  // -------------------------------------------------------------------------
  pallet(c, x, y, W, H) {
    dropShadow(c, x, y, W, H, 7, 4, 3);

    // Floor shadow visible between pallet gaps
    c.fillStyle = '#1c140c';
    c.fillRect(x + 2, y + 2, W - 4, H - 4);

    // Timber deck slats
    const numSlats = 6;
    const slatW = W / numSlats;
    for (let i = 0; i < numSlats; i++) {
      const sx = x + i * slatW + 1;
      const sw = slatW - 2;
      c.fillStyle = i % 2 === 0 ? '#a67c4e' : '#b88d5e';
      c.fillRect(sx, y + 2, sw, H - 4);
      // Sunk nail indentations
      ell(c, sx + sw / 2, y + 5, 1, 1, '#4a3219');
      ell(c, sx + sw / 2, y + H - 5, 1, 1, '#4a3219');
    }

    // Stacked shrink-wrapped cargo on the pallet
    const pad = 4;
    const cw = W - pad * 2, ch = H - pad * 2;
    rr(c, x + pad, y + pad, cw, ch, 3);
    c.fillStyle = '#d4af82'; c.fill();

    // Plastic shrink-wrap sheen diagonal reflection
    c.save();
    rr(c, x + pad, y + pad, cw, ch, 3);
    c.clip();
    const sheen = c.createLinearGradient(x + pad, y + pad, x + pad + cw, y + pad + ch);
    sheen.addColorStop(0, 'rgba(255,255,255,0.15)');
    sheen.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.3)');
    c.fillStyle = sheen; c.fill();

    // Heavy black composite tension strapping bands
    c.strokeStyle = '#18181b'; c.lineWidth = 2.5;
    // Horizontal band
    c.beginPath(); c.moveTo(x + pad, y + H * 0.4); c.lineTo(x + pad + cw, y + H * 0.4); c.stroke();
    // Vertical bands
    c.beginPath(); c.moveTo(x + W * 0.35, y + pad); c.lineTo(x + W * 0.35, y + pad + ch); c.stroke();
    c.beginPath(); c.moveTo(x + W * 0.65, y + pad); c.lineTo(x + W * 0.65, y + pad + ch); c.stroke();

    // Steel tensioner buckles
    c.fillStyle = '#e4e4e7';
    c.fillRect(x + W * 0.35 - 3, y + H * 0.4 - 2, 6, 4);
    c.fillRect(x + W * 0.65 - 3, y + H * 0.4 - 2, 6, 4);
    c.restore();

    c.strokeStyle = '#382210'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 17. CONSOLE: Sci-fi starship command console with titanium/carbon chassis,
  // glowing widescreen radar/telemetry tactical HUD, illuminated button matrix
  // & faders, caution edge stripes.
  // -------------------------------------------------------------------------
  console(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 8, 5, 4);

    const accent = (th && th.accent) || '#00f0ff';
    // Dark titanium / carbon composite chassis
    bevelRect(c, x, y, W, H, 4, '#0f172a', '#334155', '#020617');

    // Caution edge striping along top border (3px)
    hazardStripes(c, x + 4, y + 3, W - 8, 3, '#f59e0b', '#0f172a', 4);

    const isH = W >= H;
    if (isH) {
      // Tactical Widescreen HUD on left/center
      const scw = Math.max(16, W * 0.58), sch = Math.max(8, H * 0.68);
      const scx = x + 5, scy = y + 8;
      rr(c, scx, scy, scw, sch, 2);
      c.fillStyle = '#020617'; c.fill();
      c.strokeStyle = '#1e293b'; c.lineWidth = 1.5; c.stroke();

      // Glowing radar grid & telemetry sweep
      c.save();
      rr(c, scx + 1, scy + 1, scw - 2, sch - 2, 1);
      c.clip();
      const rcx = scx + scw * 0.35, rcy = scy + sch * 0.5;
      const rrR = Math.min(scw * 0.3, sch * 0.42);
      // Radar circles
      c.strokeStyle = 'rgba(56,189,248,0.35)'; c.lineWidth = 1;
      ell(c, rcx, rcy, rrR, rrR);
      ell(c, rcx, rcy, rrR * 0.5, rrR * 0.5);
      // Crosshairs
      c.beginPath(); c.moveTo(rcx - rrR, rcy); c.lineTo(rcx + rrR, rcy); c.stroke();
      c.beginPath(); c.moveTo(rcx, rcy - rrR); c.lineTo(rcx, rcy + rrR); c.stroke();
      // Target blips
      ell(c, rcx + rrR * 0.4, rcy - rrR * 0.3, 1.5, 1.5, '#ef4444');
      ell(c, rcx - rrR * 0.5, rcy + rrR * 0.2, 1.5, 1.5, '#22c55e');

      // Waveform / telemetry line on right side of screen
      c.strokeStyle = accent; c.lineWidth = 1.2;
      c.beginPath();
      const wx = scx + scw * 0.72;
      c.moveTo(wx, scy + sch * 0.5);
      c.lineTo(wx + 4, scy + sch * 0.25);
      c.lineTo(wx + 8, scy + sch * 0.75);
      c.lineTo(wx + 12, scy + sch * 0.5);
      c.stroke();
      c.restore();

      // Starship Control Interface on right: button matrix & faders
      const pw = W - scw - 14, px = scx + scw + 4;
      const btns = ['#22c55e', '#eab308', '#ef4444', '#38bdf8'];
      const numB = 4;
      for (let i = 0; i < numB; i++) {
        const bx = px + (i % 2) * (pw * 0.48);
        const by = scy + Math.floor(i / 2) * (sch * 0.35);
        rr(c, bx, by, pw * 0.4, sch * 0.26, 1.5);
        c.fillStyle = btns[i]; c.fill();
        c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.stroke();
      }

      // Vertical slider faders below buttons
      const faderY = scy + sch * 0.72;
      for (let i = 0; i < 2; i++) {
        const fx = px + i * (pw * 0.5) + 3;
        c.strokeStyle = '#475569'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(fx, faderY); c.lineTo(fx + pw * 0.35, faderY); c.stroke();
        c.fillStyle = '#e2e8f0'; c.fillRect(fx + 3, faderY - 2, 4, 4);
      }
    } else {
      // Vertical console
      rr(c, x + 4, y + 8, W - 8, H * 0.5, 2);
      c.fillStyle = '#020617'; c.fill();
    }

    c.strokeStyle = '#020617'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 18. HATCH: Heavy starship airlock blast bulkhead with reinforced hex bolts,
  // diagonal yellow/black hazard stripes, interlocking blast door seam,
  // manual emergency release wheel, pressure status lights.
  // -------------------------------------------------------------------------
  hatch(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 8, 5, 5);

    const cx = x + W / 2, cy = y + H / 2;
    const maxR = Math.min(W, H) / 2 - 2;

    // Bulkhead outer collar
    rr(c, x, y, W, H, 5);
    c.fillStyle = '#1e293b'; c.fill();
    c.strokeStyle = '#475569'; c.lineWidth = 2; c.stroke();

    // Perimeter hex-bolt rivets
    c.fillStyle = '#94a3b8';
    for (const [bx, by] of [
      [x + 4, y + 4], [x + W - 6, y + 4],
      [x + 4, y + H - 6], [x + W - 6, y + H - 6],
      [cx, y + 3], [cx, y + H - 5],
      [x + 3, cy], [x + W - 5, cy]
    ]) {
      c.fillRect(bx, by, 2.5, 2.5);
    }

    // Hazard caution stripes ring
    c.save();
    c.beginPath();
    c.arc(cx, cy, maxR, 0, Math.PI * 2);
    c.clip();
    hazardStripes(c, cx - maxR, cy - maxR, maxR * 2, maxR * 2, '#f59e0b', '#0f172a', 6);
    c.restore();

    // Circular blast door collar
    const doorR = maxR * 0.72;
    ell(c, cx, cy, doorR, doorR, '#334155', '#64748b', 2);

    // Interlocking stepped blast door seam
    c.strokeStyle = '#0f172a'; c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(cx, cy - doorR);
    c.lineTo(cx, cy - doorR * 0.25);
    c.lineTo(cx + 4, cy - doorR * 0.25);
    c.lineTo(cx + 4, cy + doorR * 0.25);
    c.lineTo(cx, cy + doorR * 0.25);
    c.lineTo(cx, cy + doorR);
    c.stroke();

    // Manual Emergency Release Handwheel (Chrome/Red with 4 spokes)
    const whR = doorR * 0.42;
    ell(c, cx, cy, whR, whR, null, '#dc2626', 3);
    c.strokeStyle = '#e2e8f0'; c.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * whR, cy + Math.sin(a) * whR);
      c.stroke();
    }
    ell(c, cx, cy, whR * 0.3, whR * 0.3, '#dc2626', '#ffffff', 1);

    // Atmospheric Pressure Status Indicator LEDs (Green / Red)
    ell(c, cx - doorR * 0.65, cy - doorR * 0.65, 2, 2, '#22c55e', '#15803d');
    ell(c, cx + doorR * 0.65, cy - doorR * 0.65, 2, 2, '#ef4444', '#b91c1c');

    c.strokeStyle = '#0f172a'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 4); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 19. BENCH: Chemical-resistant composite lab surface with containment rim,
  // utility wash sink, illuminated specimen centrifuge, glowing reagent flasks,
  // diagnostic display.
  // -------------------------------------------------------------------------
  bench(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 7, 4, 3);

    const accent = (th && th.accent) || '#38bdf8';
    // Dark chemical-resistant epoxy composite benchtop
    bevelRect(c, x, y, W, H, 3, '#1e293b', '#475569', '#0f172a');

    // Anti-spill containment rim along perimeter
    c.strokeStyle = '#0f172a'; c.lineWidth = 2;
    c.strokeRect(x + 2, y + 2, W - 4, H - 4);

    const isH = W >= H;
    if (isH) {
      // 1. Recessed chemical wash sink on left
      const sinkW = Math.max(10, W * 0.22), sinkH = Math.max(7, H * 0.52);
      const sinkX = x + 5, sinkY = y + (H - sinkH) / 2;
      rr(c, sinkX, sinkY, sinkW, sinkH, 2);
      c.fillStyle = '#0f172a'; c.fill();
      c.strokeStyle = '#334155'; c.lineWidth = 1.5; c.stroke();
      // Chrome gooseneck rinse tap
      ell(c, sinkX + sinkW / 2, sinkY - 1, 2, 2, '#94a3b8');

      // 2. High-speed specimen centrifuge in center-left
      const cfX = x + W * 0.4, cfY = y + H * 0.5;
      const cfR = Math.min(W * 0.12, H * 0.32);
      ell(c, cfX, cfY, cfR, cfR, '#334155', '#64748b', 1.5);
      ell(c, cfX, cfY, cfR * 0.6, cfR * 0.6, '#0f172a', '#22c55e', 1);
      // Glowing green RPM indicator dot
      ell(c, cfX, cfY, 1.5, 1.5, '#22c55e');

      // 3. Glowing reagent flasks on center-right
      const flX = x + W * 0.66, flY = y + H * 0.48;
      const flR = Math.min(W * 0.08, H * 0.24);
      // Flask 1: Fluorescent bio-green
      glowRadial(c, flX, flY, 1, flR * 1.5, 'rgba(74,222,128,0.5)', 'rgba(74,222,128,0)');
      ell(c, flX, flY, flR, flR, '#4ade80', '#16a34a', 1.5);

      // Flask 2: Radiant cyan
      const fl2X = flX + flR * 1.6, fl2Y = flY + 2;
      glowRadial(c, fl2X, fl2Y, 1, flR * 1.3, 'rgba(56,189,248,0.5)', 'rgba(56,189,248,0)');
      ell(c, fl2X, fl2Y, flR * 0.8, flR * 0.8, '#38bdf8', '#0284c7', 1.5);

      // 4. Digital diagnostic display on far right
      const scW = Math.max(8, W * 0.16), scH = Math.max(6, H * 0.45);
      const scX = x + W - scW - 5, scY = y + (H - scH) / 2;
      rr(c, scX, scY, scW, scH, 1.5);
      c.fillStyle = '#020617'; c.fill();
      c.strokeStyle = '#38bdf8'; c.lineWidth = 1; c.stroke();
      // Spectral bars
      c.fillStyle = '#22c55e'; c.fillRect(scX + 2, scY + scH - 4, 2, 2);
      c.fillStyle = '#38bdf8'; c.fillRect(scX + 5, scY + scH - 6, 2, 4);
    } else {
      // Vertical bench
      rr(c, x + 4, y + 4, W - 8, H * 0.3, 2);
      c.fillStyle = '#0f172a'; c.fill();
    }

    c.strokeStyle = '#0f172a'; c.lineWidth = 1.5;
    rr(c, x + 1, y + 1, W - 2, H - 2, 3); c.stroke();
  },

  // -------------------------------------------------------------------------
  // 20. CORE: Heavy radiation-shielded containment housing with 4 magnetic
  // confinement corner pylons, central pulsating plasma vortex sphere, power
  // conduit cables, radiation warning trefoil, cooling vents.
  // -------------------------------------------------------------------------
  core(c, x, y, W, H, th) {
    dropShadow(c, x, y, W, H, 10, 6, 6);

    const accent = (th && th.accent) || '#00f0ff';
    const cx = x + W / 2, cy = y + H / 2;
    const maxR = Math.min(W, H) / 2;

    // Heavy octagonal radiation-shielded containment housing
    bevelRect(c, x, y, W, H, 6, '#0f172a', '#334155', '#020617');

    // Radiator heat-dissipation cooling vents with internal thermal glow
    c.strokeStyle = 'rgba(239,68,68,0.45)'; c.lineWidth = 1;
    for (let i = -1; i <= 1; i += 2) {
      c.strokeRect(cx - W * 0.35, cy + i * (H * 0.38) - 1, W * 0.7, 2);
    }

    // 4 Magnetic Confinement Corner Pylons with copper coils & glow
    const pylonR = Math.min(W, H) * 0.16;
    const offsets = [
      [x + pylonR + 2, y + pylonR + 2],
      [x + W - pylonR - 2, y + pylonR + 2],
      [x + pylonR + 2, y + H - pylonR - 2],
      [x + W - pylonR - 2, y + H - pylonR - 2]
    ];

    for (const [px, py] of offsets) {
      ell(c, px, py, pylonR, pylonR, '#1e293b', '#b45309', 2); // copper coil casing
      ell(c, px, py, pylonR * 0.45, pylonR * 0.45, '#38bdf8'); // magnetic emitter pole
    }

    // Insulated power conduit cables running to the center
    c.strokeStyle = '#475569'; c.lineWidth = 2.5;
    for (const [px, py] of offsets) {
      c.beginPath(); c.moveTo(px, py); c.lineTo(cx, cy); c.stroke();
    }

    // Central Magnetic Containment Chamber with Plasma Vortex
    const chamberR = maxR * 0.58;
    // Outer containment vessel ring
    ell(c, cx, cy, chamberR * 1.15, chamberR * 1.15, '#020617', '#475569', 2);

    // Multi-layer pulsating plasma vortex glow
    glowRadial(c, cx, cy, chamberR * 0.2, chamberR * 1.5, accent, 'rgba(0,0,0,0)');
    ell(c, cx, cy, chamberR, chamberR, accent);

    // Turbulent plasma energy inner core
    glowRadial(c, cx, cy, 1, chamberR * 0.7, '#ffffff', accent);
    ell(c, cx, cy, chamberR * 0.45, chamberR * 0.45, '#ffffff');

    // Radiation trefoil warning emblem / containment field ring
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      c.beginPath();
      c.arc(cx, cy, chamberR * 0.8, a, a + Math.PI / 4);
      c.stroke();
    }

    c.strokeStyle = '#020617'; c.lineWidth = 2;
    rr(c, x + 1, y + 1, W - 2, H - 2, 5); c.stroke();
  },
};

// ---------------------------------------------------------------------------
// Fallback Generic Obstacle Renderer
// Signature: (c, x, y, W, H, th, o)
// ---------------------------------------------------------------------------
export function drawGenericObstacle(c, x, y, W, H, th) {
  const d = Math.min(W, H) * 0.14 + 2;
  dropShadow(c, x, y, W, H, d, d * 0.7, Math.min(6, Math.min(W, H) * 0.2));

  const wallEdge = (th && th.wallEdge) || '#475569';
  const g = c.createLinearGradient(0, y, 0, y + H);
  g.addColorStop(0, shade(wallEdge, 1.25));
  g.addColorStop(1, shade(wallEdge, 0.7));

  rr(c, x, y, W, H, Math.min(6, Math.min(W, H) * 0.2));
  c.fillStyle = g; c.fill();

  // Corner metallic fastening studs
  c.fillStyle = 'rgba(255,255,255,0.4)';
  const s = 4;
  c.fillRect(x + s, y + s, 2, 2);
  c.fillRect(x + W - s - 2, y + s, 2, 2);
  c.fillRect(x + s, y + H - s - 2, 2, 2);
  c.fillRect(x + W - s - 2, y + H - s - 2, 2, 2);

  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5; c.stroke();
}
