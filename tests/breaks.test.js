// Breaks: a person's hours are Out − In − their break. A placed break
// (brkAt) comes off the pool it falls in; an unplaced one off each pool in
// proportion to the time worked there.
import assert from 'node:assert';
import { resolveStaff, resolvePools } from '../src/resolve.js';
import { computeShares } from '../src/shares.js';

const pool = (id, start, end, total) => ({
  id, label: id, window: { start, end }, roles: { bartender: true, server: true }, includeSupport: false,
  cash: { entryMode: 'nettotal', billCounts: {}, netTotal: String(total) },
});
const state = (staff, pools) => ({
  meta: { date: '' },
  staff,
  defaults: { global: { in: '5', out: '1' }, byRole: { bartender: { in: '', out: '' }, server: { in: '', out: '' }, support: { in: '', out: '' } } },
  pools,
  overrides: { bonuses: {} },
});
const person = (id, over = {}) => ({ id, name: id, role: 'bartender', in: '5', out: '', brk: '', brkAt: '', closerOverride: false, ...over });

function run(s) {
  const r = resolveStaff(s);
  const { pools, errors } = resolvePools(s, r);
  return { r, errors: [...r.errors, ...errors], shares: computeShares(pools, r.staff, s.overrides) };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' ≈ ' + b);

// One pool: a half-hour break takes half an hour off.
{
  const { r, errors, shares } = run(state([person('A', { brk: '0.5' }), person('B')], [pool('p1', '', '', 790)]));
  assert.deepStrictEqual(errors, []);
  near(r.staff[0].hours, 7.5);
  near(r.staff[1].hours, 8);
  near(shares.totalHours, 15.5);
  near(shares.perPerson[0].exact, 790 * 7.5 / 15.5);
}

// Two pools (5–9, 9–1): a placed break at 9:30 comes off the second only.
{
  const s = state([person('A', { brk: '1', brkAt: '9.5' })], [pool('p1', '', '9', 100), pool('p2', '9', '', 100)]);
  const { errors, shares } = run(s);
  assert.deepStrictEqual(errors, []);
  const a = shares.perPerson[0];
  near(a.perPool.p1.hours, 4);
  near(a.perPool.p2.hours, 3);
  near(a.hours, 7);
}

// Unplaced: 1h off an 8h shift split 4 / 4 → half an hour off each.
{
  const { errors, shares } = run(state([person('A', { brk: '1' })], [pool('p1', '', '9', 100), pool('p2', '9', '', 100)]));
  assert.deepStrictEqual(errors, []);
  const a = shares.perPerson[0];
  near(a.perPool.p1.hours, 3.5);
  near(a.perPool.p2.hours, 3.5);
}

// Errors: a break outside the shift, or as long as it.
{
  assert.ok(run(state([person('A', { brk: '0.5', brkAt: '3' })], [pool('p1', '', '', 100)])).errors.some(e => /outside/.test(e)));
  assert.ok(run(state([person('A', { brk: '8' })], [pool('p1', '', '', 100)])).errors.some(e => /as long as/.test(e)));
  assert.ok(run(state([person('A', { brk: 'x' })], [pool('p1', '', '', 100)])).errors.some(e => /break must be/.test(e)));
}

console.log('breaks ok');
