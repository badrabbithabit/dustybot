#!/usr/bin/env node
// Bump the app version in every place that has to agree:
//   js/version.js  — VERSION constant (what the running bundle believes)
//   version.json   — server truth, fetched no-store on every load
//   index.html     — ?v= cache-busters on the css/script tags AND the inline
//                    window.__APP_VERSION__ stamp (mixed-build detector)
//   package.json   — npm metadata (kept in sync for release hygiene)
//
// Why the inline stamp: Pages serves js/* with `Cache-Control: max-age=600`,
// and index.html only cache-busts the ENTRY bundle. Modules imported by plain
// relative URL (js/world.js, js/game.js, ...) can therefore come from cache
// while the entry is new — a mixed-version graph. (`_headers` looked like the
// tidy fix; Pages ignores it for this Actions-deployed project page — verified
// live, still max-age=600. Query-string import rewriting WAS tried and is
// reverted: node treats `./x.js?v=1` as a different module, so tests that
// mutate BALANCE were mutating a second copy of it. Don't reintroduce it.)
// main.js compares the inline stamp with the VERSION it imported and shows the
// reload banner when they disagree; the frame loop is also crash-proofed so a
// mixed graph degrades instead of freezing on START.
//
// Usage:
//   node tools/bump-version.mjs            # patch bump: 1.1.0 -> 1.1.1
//   node tools/bump-version.mjs 2.0.0      # explicit next version
//
// Then commit the touched files and push; the Pages deploy does the rest.
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
write('index.html', read('index.html')
  .split(`?v=${current}`).join(`?v=${next}`)
  .replace(/__APP_VERSION__\s*=\s*'[^']*'/, `__APP_VERSION__ = '${next}'`));
write('package.json', read('package.json').replace(/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`));
console.log('done — commit js/version.js, version.json, index.html, package.json and push');
