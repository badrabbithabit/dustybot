// Unit tests for the idle systems: offlineGain + hangarRate (pure math, no DOM).
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { BALANCE, offlineGain, hangarRate, levelDef } from '../js/upgrades.js';

test('offlineGain: zero before/after short absence, caps at capHours', () => {
  const base = { lastSeen: Date.now(), meta: {}, bestLevel: 1 };
  // Proportional accrual (main.js filters out sub-1-shard displays).
  const o = BALANCE.offline;
  const oneMin = offlineGain({ ...base, lastSeen: Date.now() - 60_000 });
  assert.ok(Math.abs(oneMin - (1 / 60) * o.basePerHour) < 1e-9, '1 min away -> proportional');
  const far = { ...base, lastSeen: Date.now() - 48 * 3600_000 };
  assert.ok(offlineGain(far) > 0);
  const capped = { ...base, lastSeen: Date.now() - 48 * 3600_000 };
  const maxed = { ...base, lastSeen: Date.now() - 480 * 3600_000 };
  assert.equal(offlineGain(capped), offlineGain(maxed), '48h and 480h give the same (8h cap)');
});

test('offlineGain: scales with polish + best level, floor at level 1', () => {
  const away = Date.now() - 3 * 3600_000;
  const s0 = offlineGain({ lastSeen: away, meta: {}, bestLevel: 0 });
  const s1 = offlineGain({ lastSeen: away, meta: {}, bestLevel: 1 });
  assert.equal(s0, s1, 'bestLevel 0 behaves like level 1');
  const sP = offlineGain({ lastSeen: away, meta: { meta_polish: 5 }, bestLevel: 1 });
  assert.ok(sP > s0, 'polisher raises the rate');
  assert.ok(Math.abs(sP / s0 - 1.25) < 1e-9, '5 polish levels = +25%');
  const sL = offlineGain({ lastSeen: away, meta: {}, bestLevel: 11 });
  assert.ok(Math.abs(sL / s0 - 2.2) < 1e-9, 'bestLevel 11 = 1 + .12*10 = x2.2');
  // formula spot-check
  assert.ok(Math.abs(s0 - 3 * BALANCE.offline.basePerHour) < 1e-9);
});

test('hangarRate: 0 without the bay, x1/x2/x4 by level, scales with best level', () => {
  const mk = m => ({ meta: m, bestLevel: 1 });
  assert.equal(hangarRate(mk({})), 0, 'no bay -> no idle');
  assert.equal(hangarRate(mk({ meta_autobay: 1 })), BALANCE.hangar.basePerHour);
  assert.equal(hangarRate(mk({ meta_autobay: 2 })), 2 * BALANCE.hangar.basePerHour);
  assert.equal(hangarRate(mk({ meta_autobay: 3 })), 4 * BALANCE.hangar.basePerHour);
  assert.ok(hangarRate({ meta: { meta_autobay: 1 }, bestLevel: 11 }) >
            hangarRate({ meta: { meta_autobay: 1 }, bestLevel: 1 }), 'deeper progress -> faster idle');
});

test('levelDef: heavy-mote gears climb per rotation and cap', () => {
  const shares = n => {
    const d = levelDef(n);
    return d.bigShare + d.debrisShare;
  };
  const g1 = shares(1), g2 = shares(13), g3 = shares(25);
  assert.ok(g2 > g1, 'second rotation is heavier than the first');
  assert.ok(g3 > g2, 'third rotation is heavier than the second');
  for (const n of [1, 13, 25, 100, 1000])
    assert.ok(shares(n) <= BALANCE.dirt.heavyCap + 1e-9, `L${n} under heavy cap`);
  assert.equal(levelDef(13).gearUp, true, '13th level (2nd rotation) is a gear-up');
  assert.equal(levelDef(1).gearUp, false, 'level 1 is not a gear-up');
  assert.equal(levelDef(12).gearUp, false, '12th level is not a gear-up (gear at rotation boundary)');
});

test('levelDef: new dirt types appear at their gear boundaries', () => {
  // gear 1 (lv 1–12): no new dirt yet
  assert.equal(levelDef(5).staticShare, 0);
  assert.equal(levelDef(5).tarShare, 0);
  assert.equal(levelDef(5).puffShare, 0);
  // gear 2 (lv 13–24): static 5%
  assert.equal(levelDef(13).staticShare, 0.05);
  assert.equal(levelDef(24).staticShare, 0.05);
  assert.equal(levelDef(13).tarShare, 0);
  assert.equal(levelDef(13).puffShare, 0);
  // gear 3 (lv 25–36): static 8%, tar 5%
  assert.equal(levelDef(25).staticShare, 0.08);
  assert.equal(levelDef(25).tarShare, 0.05);
  assert.equal(levelDef(36).tarShare, 0.05);
  assert.equal(levelDef(25).puffShare, 0);
  // gear 4 (lv 37+): all three, capped for good
  assert.equal(levelDef(37).staticShare, 0.10);
  assert.equal(levelDef(37).tarShare, 0.06);
  assert.equal(levelDef(37).puffShare, 0.06);
  assert.equal(levelDef(100).staticShare, 0.10);
  assert.equal(levelDef(100).tarShare, 0.06);
  assert.equal(levelDef(100).puffShare, 0.06);
  // the gear-up intro names the newcomer (only on the boundary level)
  assert.equal(levelDef(13).newDirt.length, 1, 'lv13 intro names static');
  assert.equal(levelDef(25).newDirt.length, 1, 'lv25 intro names tar');
  assert.equal(levelDef(37).newDirt.length, 1, 'lv37 intro names puff');
  assert.equal(levelDef(49).newDirt.length, 0, 'lv49 (gear 5) names nothing new');
});
