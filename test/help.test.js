// Unit tests for the shared help/instructions content (no DOM).
// The on-load instructions screen and the pause-screen help page both render
// from helpSections(); these tests pin the content so neither screen can
// silently lose its sections.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { helpSections, helpHtml } from '../js/help.js';

test('helpSections: covers goal, controls, dust, and shards', () => {
  const sections = helpSections();
  const titles = sections.map(s => s.title);
  for (const t of ['GOAL', 'CONTROLS', 'DUST', 'SHARDS'])
    assert.ok(titles.includes(t), `has a ${t} section`);
  for (const s of sections) {
    assert.ok(s.lines.length >= 1, `${s.title} has at least one line`);
    for (const l of s.lines) assert.ok(l.length > 0, `${s.title} lines are non-empty`);
  }
});

test('helpHtml: renders sections and mentions the key facts', () => {
  const html = helpHtml();
  for (const t of ['GOAL', 'CONTROLS', 'DUST', 'SHARDS'])
    assert.match(html, new RegExp(t), `renders the ${t} title`);
  assert.match(html, /DOCK/i, 'mentions emptying the bin at the dock');
  assert.match(html, /worth 5/, 'gold value stays in the manual');
  assert.match(html, /HANGAR/i, 'mentions the hangar');
  assert.match(html, /Auto-Bay/i, 'mentions the idle Auto-Bay');
  assert.ok(html.includes('help-sec'), 'uses the help-sec markup the CSS styles');
});

test('help: pause keys are documented for desktop', () => {
  const text = helpHtml().toUpperCase();
  assert.match(text, /ESC/, 'documents ESC as a pause key');
  assert.match(text, /P/, 'documents P as a pause key');
});
