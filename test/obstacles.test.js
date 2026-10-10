// test/obstacles.test.js — Unit test suite for top-down obstacle art renderers.
import test from 'node:test';
import assert from 'node:assert/strict';

import { KINDS } from '../js/levelgen.js';
import {
  OB_DRAW,
  drawGenericObstacle,
  shade,
  rr,
  ell,
  bevelRect,
  woodPlanks,
  hazardStripes,
  glowRadial,
  dropShadow,
} from '../js/obstacles.js';

// Mock Canvas 2D Rendering Context
function createMockContext() {
  const noop = () => {};
  const gradientMock = {
    addColorStop: noop,
  };

  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1.0,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    lineDashOffset: 0,

    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    resetTransform: noop,
    setLineDash: noop,
    getLineDash: () => [],

    createLinearGradient: () => gradientMock,
    createRadialGradient: () => gradientMock,
  };
}

const SAMPLE_THEMES = [
  {
    name: 'Residential',
    accent: '#e74c3c',
    wall: '#2c3e50',
    wallEdge: '#34495e',
    floorA: '#f5efe6',
    floorB: '#e8dfd1',
    _floor: 'residential',
  },
  {
    name: 'Office',
    accent: '#3498db',
    wall: '#1e293b',
    wallEdge: '#334155',
    floorA: '#e2e8f0',
    floorB: '#cbd5e1',
    _floor: 'office',
  },
  {
    name: 'Store',
    accent: '#f39c12',
    wall: '#3e2723',
    wallEdge: '#4e342e',
    floorA: '#d7ccc8',
    floorB: '#bcaaa4',
    _floor: 'store',
  },
  {
    name: 'Space',
    accent: '#00f0ff',
    wall: '#0f172a',
    wallEdge: '#1e293b',
    floorA: '#334155',
    floorB: '#1e293b',
    _floor: 'space',
  },
];

test('KINDS coverage: every kind in levelgen.js exists in OB_DRAW', () => {
  assert.equal(KINDS.length, 20);
  for (const kind of KINDS) {
    assert.equal(
      typeof OB_DRAW[kind],
      'function',
      `Expected OB_DRAW to have a renderer for kind '${kind}'`
    );
  }
  assert.equal(Object.keys(OB_DRAW).length, 20);
});

test('Obstacle renderers: all 20 kinds render without throwing across aspect ratios', () => {
  const ctx = createMockContext();
  const testDimensions = [
    { W: 120, H: 40, desc: 'wide rect' },
    { W: 40, H: 120, desc: 'tall rect' },
    { W: 60, H: 60, desc: 'square rect' },
    { W: 16, H: 16, desc: 'small square' },
    { W: 240, H: 160, desc: 'large rect' },
  ];

  for (const kind of KINDS) {
    const fn = OB_DRAW[kind];
    for (const dim of testDimensions) {
      for (const th of SAMPLE_THEMES) {
        assert.doesNotThrow(() => {
          fn(ctx, 10, 10, dim.W, dim.H, th, { x: 5, y: 5, w: dim.W / 10, h: dim.H / 10, kind });
        }, `OB_DRAW.${kind} failed with ${dim.desc} in ${th.name} theme`);
      }
    }
  }
});

test('Fallback generic renderer: executes safely without errors', () => {
  const ctx = createMockContext();
  for (const th of SAMPLE_THEMES) {
    assert.doesNotThrow(() => {
      drawGenericObstacle(ctx, 10, 10, 80, 50, th, { kind: 'unknown' });
    });
  }
});

test('Drawing helper shade: correctly computes hex lightness and darkens', () => {
  assert.equal(shade('#000000', 1.5), 'rgb(0,0,0)');
  assert.equal(shade('#ffffff', 0.5), 'rgb(128,128,128)');
  assert.equal(shade('#ffffff', 1.0), 'rgb(255,255,255)');
  assert.equal(shade('#808080', 2.0), 'rgb(255,255,255)');
  assert.equal(shade('#fff', 0.5), 'rgb(128,128,128)');
  // Pass-through for invalid or rgb
  assert.equal(shade('rgb(10,20,30)', 1.2), 'rgb(10,20,30)');
  assert.equal(shade(null, 1.2), '#000000');
});

test('Drawing helpers rr & ell: safely handle edge cases and zero/negative dimensions', () => {
  const ctx = createMockContext();
  assert.doesNotThrow(() => {
    rr(ctx, 0, 0, 0, 0, 5);
    rr(ctx, 0, 0, -10, 20, 5);
    rr(ctx, 10, 10, 50, 50, 0);
    rr(ctx, 10, 10, 50, 50, 100);
    ell(ctx, 10, 10, 0, 0, '#fff');
    ell(ctx, 10, 10, -5, -5, '#fff', '#000', 1);
  });
});

test('Bevel, woodPlanks, hazardStripes, glowRadial & dropShadow: execute without errors', () => {
  const ctx = createMockContext();
  assert.doesNotThrow(() => {
    bevelRect(ctx, 10, 10, 50, 50, 4, '#555', '#fff', '#000');
    woodPlanks(ctx, 10, 10, 60, 40, 4, '#9e673a', '#5a3818', 'h');
    woodPlanks(ctx, 10, 10, 60, 40, 4, '#9e673a', '#5a3818', 'v');
    hazardStripes(ctx, 10, 10, 60, 20, '#f1c40f', '#000', 8);
    glowRadial(ctx, 30, 30, 5, 25, '#fff', 'rgba(0,0,0,0)');
    glowRadial(ctx, 30, 30, 0, 0, '#fff', 'rgba(0,0,0,0)');
    dropShadow(ctx, 10, 10, 50, 50, 6, 4, 3, 'rgba(0,0,0,0.5)');
  });
});
