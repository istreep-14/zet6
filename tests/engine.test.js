// Regression gate — same scenarios as the v3 engine.test.js, against the
// ported pure distribute() API.
import assert from 'node:assert';
import { distribute, suggestBreaks, planMakeChange, getSmallBillRequirements, drawerBills } from '../src/engine.js';

function totalBills(bills) {
  return [100, 50, 20, 10, 5, 1].reduce((sum, d) => sum + (bills[d] || 0) * d, 0);
}

function runExample(pool) {
  const ids = ['a', 'bc', 'c', 'd', 'aa'];
  const finals = [439, 487, 475, 390, 488];
  const people = finals.map((final, i) => ({ id: ids[i], final }));
  const dist = distribute(people, pool, 1);

  assert.strictEqual(dist.error, '', 'distribution should succeed');
  people.forEach(p => {
    assert.strictEqual(totalBills(dist.byPerson[p.id]), p.final, p.id + ' total');
  });
  assert.strictEqual(totalBills(dist.remainderBills), 1, 'remainder total');

  return dist.byPerson;
}

function highHundredsAndFifties(bills) {
  return (bills[100] || 0) * 100 + (bills[50] || 0) * 50;
}

{
  const by = runExample({ 100: 8, 50: 4, 20: 62, 10: 1, 5: 4, 1: 10 });
  assert.strictEqual(by.aa[100], 2, 'largest payout keeps a proportional $100 share');
  assert.strictEqual(highHundredsAndFifties(by.a), 200, '$439 is not left at $150 progress');
  assert.strictEqual(highHundredsAndFifties(by.bc), 200, '$487 does not jump ahead of $439 on $50 progress');
  assert.strictEqual(highHundredsAndFifties(by.aa), 200, '$488 remains balanced with the adjacent top payouts');
}

{
  const by = runExample({ 100: 7, 50: 6, 20: 62, 10: 1, 5: 4, 1: 10 });
  assert.strictEqual(by.aa[100], 2, '$488 keeps two $100s with extra flippers available');
  assert.strictEqual(by.bc[100], 2, '$487 keeps two $100s with extra flippers available');
  assert.strictEqual(highHundredsAndFifties(by.a), 200, '$439 receives a proportional second $50');
  assert.strictEqual(highHundredsAndFifties(by.bc), 200, '$487 stays balanced after $100s/$50s');
  assert.strictEqual(highHundredsAndFifties(by.aa), 200, '$488 stays balanced after $100s/$50s');
}

{
  const by = runExample({ 100: 7, 50: 6, 20: 60, 10: 5, 5: 4, 1: 10 });
  assert.strictEqual(highHundredsAndFifties(by.a), 200, '$439 should be lifted from $150 to $200');
  assert.strictEqual(highHundredsAndFifties(by.bc), 200, '$487 should not sit at $250 when $439 is $150');
  assert.strictEqual(highHundredsAndFifties(by.aa), 200, '$488 remains proportionally aligned with $487');
}

{
  const ids = ['a', 'bc', 'c', 'd', 'aa'];
  const finals = [438, 485, 473, 388, 486];
  const people = finals.map((final, i) => ({ id: ids[i], final }));
  const dist = distribute(people, { 100: 7, 50: 6, 20: 61, 10: 1, 5: 4, 1: 20 }, 0);

  people.forEach(p => {
    assert.strictEqual(totalBills(dist.byPerson[p.id]), p.final, p.id + ' latest screenshot total');
    assert.strictEqual(
      highHundredsAndFifties(dist.byPerson[p.id]),
      200,
      p.id + ' should share $100+$50 progress evenly when constraints allow',
    );
  });
}

function smallBillCount(bills) {
  return (bills[1] || 0) + (bills[5] || 0) + (bills[10] || 0);
}

function assertSmallSpread(byPerson, ids, maxSpread, label) {
  const counts = ids.map(id => smallBillCount(byPerson[id]));
  assert.ok(
    Math.max(...counts) - Math.min(...counts) <= maxSpread,
    label + ' small bills should be balanced, got ' + counts.join(', '),
  );
}

function assertDenomSpread(byPerson, ids, denom, maxSpread, label) {
  const counts = ids.map(id => byPerson[id][denom] || 0);
  assert.ok(
    Math.max(...counts) - Math.min(...counts) <= maxSpread,
    label + ' $' + denom + 's should be split, got ' + counts.join(', '),
  );
}

{
  const ids = ['a', 'bc', 'c', 'd', 'aa'];
  const finals = [438, 485, 473, 388, 486];
  const people = finals.map((final, i) => ({ id: ids[i], final }));
  const dist = distribute(people, { 100: 7, 50: 4, 20: 62, 10: 0, 5: 2, 1: 120 }, 0);

  people.forEach(p => {
    assert.strictEqual(totalBills(dist.byPerson[p.id]), p.final, p.id + ' no tens extreme total');
  });
  assertSmallSpread(dist.byPerson, ids, 12, 'no tens extreme');
  assertDenomSpread(dist.byPerson, ids, 5, 2, 'no tens extreme');
  assert.ok((dist.byPerson.d[1] || 0) < 40, 'd should not absorb almost all $1s');
}

{
  const ids = ['a', 'bc', 'c', 'd', 'aa'];
  const finals = [438, 485, 473, 388, 486];
  const people = finals.map((final, i) => ({ id: ids[i], final }));
  const dist = distribute(people, { 100: 5, 50: 4, 20: 62, 10: 10, 5: 22, 1: 120 }, 0);

  people.forEach(p => {
    assert.strictEqual(totalBills(dist.byPerson[p.id]), p.final, p.id + ' many small bills extreme total');
  });
  assertSmallSpread(dist.byPerson, ids, 12, 'many small bills extreme');
  assertDenomSpread(dist.byPerson, ids, 10, 3, 'many small bills extreme');
  assertDenomSpread(dist.byPerson, ids, 5, 3, 'many small bills extreme');
  assert.ok((dist.byPerson.d[1] || 0) < 40, 'd should not absorb almost all $1s');
}

// Preflight failure surfaces an error instead of bills
{
  const dist = distribute([{ id: 'a', final: 99 }], { 100: 1 }, 0);
  assert.ok(dist.error.length > 0, 'short on $1s should error');
  assert.deepStrictEqual(dist.byPerson, {});
}

// ── suggestBreaks: fix comes from a large bill, not more $1s ──
// 3 × $316 + $2 chump from 7×100 3×50 4×20 3×5 5×1 is impossible as-is
// (no $10s, and $310 without a $10 needs three $20s each). One swap fixes it.
{
  const people = ['a', 'b', 'c'].map(id => ({ id, final: 316 }));
  const bills = { 100: 7, 50: 3, 20: 4, 10: 0, 5: 3, 1: 5 };
  assert.ok(distribute(people, bills, 2).error, 'drawer should fail as entered');
  const plan = suggestBreaks(people, bills, 2);
  assert.ok(plan, 'a fix should be found');
  assert.strictEqual(plan.trades.length, 1);
  assert.strictEqual(plan.pool[1], 5, 'no extra $1s needed');
  const fixed = distribute(people, plan.pool, 2);
  assert.strictEqual(fixed.error, '');
  people.forEach(p => {
    const v = Object.entries(fixed.byPerson[p.id]).reduce((s, [d, n]) => s + d * n, 0);
    assert.strictEqual(v, 316);
  });
  // already-working drawer → no suggestion
  assert.strictEqual(suggestBreaks(people, plan.pool, 2), null);
}

// ── planMakeChange: all-big-bill drawer → one consolidated exchange ──
// 10×$100 7×$50 and no small bills. ≤3 single breaks can't fix it; the old
// heuristic produced ~20 chained breaks (and 100 × $1). One trade does it.
{
  const people = [315, 284, 197, 270, 284].map((final, i) => ({ id: 'p' + i, final }));
  const bills = { 100: 10, 50: 7, 20: 0, 10: 0, 5: 0, 1: 0 };
  assert.ok(distribute(people, bills, 0).error, 'drawer should fail as entered');
  const plan = planMakeChange(people, bills, 0);
  assert.ok(plan, 'a fix should be found');
  assert.strictEqual(plan.trades.length, 1);
  assert.strictEqual(plan.deltas[50], -3, 'trade only the three spare $50s');
  assert.strictEqual(plan.deltas[100], 0, 'keep every $100');
  assert.strictEqual(plan.pool[1], 10, 'only the $1s the payouts need');
  const fixed = distribute(people, plan.pool, 0);
  assert.strictEqual(fixed.error, '');
  people.forEach(p => {
    const v = Object.entries(fixed.byPerson[p.id]).reduce((s, [d, n]) => s + d * n, 0);
    assert.strictEqual(v, p.final);
  });
}

// ── $10s needed depends on where $100s/$50s can actually go ──
{
  const tens = (people, bills) => {
    const r = getSmallBillRequirements(people, bills, 0);
    return (r.minOneFiveTenValue - r.minOneFiveValue) / 10;
  };
  const two = [270, 130].map((final, i) => ({ id: 'p' + i, final }));
  // 270 = 2×100 + 50 + 20, 130 = 50 + 4×20 — the $50s even out both: no $10s.
  assert.strictEqual(tens(two, { 100: 2, 50: 2, 20: 5 }), 0);
  // Same payouts, no $50s — both odd-tens amounts need a $10.
  assert.strictEqual(tens(two, { 100: 3, 20: 5 }), 2);
  // Screenshot drawer after the fix: the $100s fill $315, so no $50 can even
  // it out — 3 × $10 are really needed (the old count said 0).
  const five = [315, 284, 197, 270, 284].map((final, i) => ({ id: 'p' + i, final }));
  assert.strictEqual(tens(five, { 100: 10, 50: 4, 20: 5, 10: 3, 5: 2, 1: 10 }), 3);
}

// ── make-change plan places $50s to avoid $10s ──
// 140 / 174 / 338 from 3×100 7×50 2×1: $100 of big bills must go. Trade
// 2 × $50, not a $100 (same cash, keeps the $100s); 3×100 on $338 and
// 3+2 $50s leave 38 / 24 / 40 — only the $38 needs a $10.
{
  const people = [140, 174, 338].map((final, i) => ({ id: 'p' + i, final }));
  const plan = planMakeChange(people, { 100: 3, 50: 7, 1: 2 }, 0);
  assert.strictEqual(plan.deltas[100], 0, 'keep the $100s');
  assert.strictEqual(plan.deltas[50], -2, 'trade two $50s instead');
  assert.strictEqual(plan.deltas[10], 1);
  assert.strictEqual(distribute(people, plan.pool, 0).error, '');
}

// ── a swap brings back the fewest bills: a $10, not two $5s ──
// Drawer 5×100 1×50 29×20 2×10 4×5, no $1s: short 10 × $1 and a $10. Trade
// one $20 for 1 × $10 + 10 × $1 (11 bills), not 2 × $5 + 10 × $1 (what
// this payout order used to get).
{
  const people = [141, 137, 113, 135, 121, 151, 125, 145, 102].map((final, i) => ({ id: 'p' + i, final }));
  const plan = planMakeChange(people, { 100: 5, 50: 1, 20: 29, 10: 2, 5: 4, 1: 0 }, 0);
  assert.ok(plan, 'a fix should be found');
  assert.strictEqual(plan.deltas[20], -1, 'trade one $20');
  assert.strictEqual(plan.deltas[10], 1, 'get a $10 back');
  assert.strictEqual(plan.deltas[5], 0, 'not two $5s');
  assert.strictEqual(plan.deltas[1], 10);
  assert.strictEqual(distribute(people, plan.pool, 0).error, '');
}

// ── drawerBills: counted bills + the uncounted rest + a register over / short ──
{
  const bc = o => ({ 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0, ...o });
  const value = b => Object.entries(b).reduce((s, [d, n]) => s + d * n, 0);
  const people = [262, 233, 204, 218, 262].map((final, i) => ({ id: 'p' + i, final }));
  // 4 × $100 and 3 × $50 counted, $629 not: the counted bills stay, the rest
  // is filled so every payout comes out exact.
  const mixed = drawerBills([{ billCounts: bc({ 100: 4, 50: 3 }), rest: 629, adjust: 0 }], people, 0);
  assert.strictEqual(mixed.bills[100], 4);
  assert.strictEqual(mixed.bills[50], 3);
  assert.strictEqual(value(mixed.added), 629);
  assert.strictEqual(value(mixed.bills), 1179);
  assert.strictEqual(distribute(people, mixed.bills, 0).error, '');
  // Nothing counted: all of it is suggested.
  const net = drawerBills([{ billCounts: bc({}), rest: 1179, adjust: 0 }], people, 0);
  assert.strictEqual(net.counted, false);
  assert.strictEqual(distribute(people, net.bills, 0).error, '');
  // Fully counted, register $50 short: a $50 comes off the counted bills.
  const short = drawerBills([{ billCounts: bc({ 100: 4, 50: 4, 20: 22, 10: 9, 5: 12, 1: 39 }), rest: 0, adjust: -50 }], people, 0);
  assert.strictEqual(short.bills[50], 3);
  assert.strictEqual(short.note, '');
  // Short an amount the counted bills can't drop exactly → a note, still the right total.
  const odd = drawerBills([{ billCounts: bc({ 100: 2 }), rest: 0, adjust: -50 }], people.slice(0, 1).map(p => ({ ...p, final: 150 })), 0);
  assert.ok(odd.note);
  assert.strictEqual(value(odd.bills), 150);
}

console.log('engine distribution tests passed');
