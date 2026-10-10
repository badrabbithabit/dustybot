// Release hygiene: the version must stay in sync across the four places,
// or update detection / cache-busting breaks silently.
// Run: npm test   (or: node --test test/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const vJs = read('js/version.js').match(/VERSION\s*=\s*'([^']+)'/)?.[1] || '';
const vJson = JSON.parse(read('version.json')).version || '';
const vHtml = [...read('index.html').matchAll(/\?v=([^\s"']+)/g)].map(m => m[1]);
const vPkg = JSON.parse(read('package.json')).version || '';

test('version is valid semver', () => {
  assert.match(vJs, /^\d+\.\d+\.\d+$/, `js/version.js: got "${vJs}"`);
});

test('version.json matches js/version.js', () => {
  assert.equal(vJson, vJs);
});

test('index.html cache-busters match js/version.js (css + script)', () => {
  assert.ok(vHtml.length >= 2, `expected ?v= on css and script tags, found ${vHtml.length}`);
  for (const v of vHtml) assert.equal(v, vJs);
});

test('package.json matches js/version.js', () => {
  assert.equal(vPkg, vJs);
});

// Wall-clock assertions are the reason the Pages deploy failed once: a 1 ms
// tick between two Date.now() calls blows a 1e-9 tolerance on CI but not locally.
// Pure functions take `now` — pass a fixed timestamp instead.
test('unit tests use fixed clocks (no Date.now in assertions)', () => {
  const dir = new URL('../test/', import.meta.url);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.test.js') || f === 'version.test.js') continue;
    const src = readFileSync(new URL(f, dir), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(!src.includes('Date.now()'), `${f} uses Date.now() — pass an explicit now`);
  }
});
