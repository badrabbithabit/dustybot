// Release hygiene: the version must stay in sync across the three places,
// or update detection / cache-busting breaks silently.
// Run: npm test   (or: node --test test/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const vJs = read('js/version.js').match(/VERSION\s*=\s*'([^']+)'/)?.[1] || '';
const vJson = JSON.parse(read('version.json')).version || '';
const vHtml = [...read('index.html').matchAll(/\?v=([^\s"']+)/g)].map(m => m[1]);

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
