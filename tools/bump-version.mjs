#!/usr/bin/env node
// Bump the app version in all three places at once:
//   js/version.js  — VERSION constant (the bundled build's own version)
//   version.json   — server truth, fetched no-store on every load
//   index.html     — ?v= cache-busters on the css/script tags
//
// Usage:
//   node tools/bump-version.mjs            # patch bump: 1.1.0 -> 1.1.1
//   node tools/bump-version.mjs 2.0.0      # explicit next version
//
// Then commit the three files; the GitHub Pages deploy does the rest.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const write = (f, s) => writeFileSync(join(root, f), s);

const current = read('js/version.js').match(/VERSION\s*=\s*'([^']+)'/)?.[1];
if (!current) {
  console.error('ERROR: could not find VERSION in js/version.js');
  process.exit(1);
}

const bumpPatch = v => {
  const p = v.split('.').map(Number);
  while (p.length < 3) p.push(0);
  p[p.length - 1] += 1;
  return p.join('.');
};

const next = process.argv[2] || bumpPatch(current);
if (next === current) {
  console.error('ERROR: new version equals current version', next);
  process.exit(1);
}

console.log(`bumping ${current} -> ${next}`);
write('js/version.js', read('js/version.js').replace(`VERSION = '${current}'`, `VERSION = '${next}'`));
write('version.json', read('version.json').replace(/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`));
write('index.html', read('index.html').split(`?v=${current}`).join(`?v=${next}`));
console.log('done — commit js/version.js, version.json, index.html and push');
