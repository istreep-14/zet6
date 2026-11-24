import assert from 'node:assert/strict';
import { fewestBills, takeOut, envelopeFixes } from '../src/fixups.js';
import { distributeWithStacks, stackSizes } from '../src/stacks.js';

const value = b => Object.entries(b).reduce((t, [d, n]) => t + Number(d) * n, 0);

// fewestBills: greedy is optimal for US bills.
assert.deepEqual(fewestBills(38), { 20: 1, 10: 1, 5: 1, 1: 3 });
assert.deepEqual(fewestBills(0), {});

// takeOut: exact from the envelope's own bills, fewest bills.
assert.deepEqual(takeOut({ 20: 3, 5: 1, 1: 3 }, 25), { out: { 20: 1, 5: 1 }, back: {} });
// not exact: the smallest amount over it, change back.
{
  const r = takeOut({ 20: 2 }, 8);
  assert.deepEqual(r.out, { 20: 1 });
  assert.deepEqual(r.back, { 10: 1, 1: 2 });
}

// envelopeFixes: register short $9 → Ana gives $9 (a $5 + four $1s), Ben unchanged.
{
  const before = { byPerson: { a: { 20: 5, 5: 1, 1: 4 }, b: { 20: 5 } }, pay: { a: 109, b: 100 } };
  const fx = envelopeFixes(before, { a: 100, b: 100 });
  assert.equal(fx.rows.length, 1);
  assert.equal(value(fx.rows[0].out) - value(fx.rows[0].back), 9);
  assert.equal(fx.register, 9);
}
// over: everyone gains — bills come out of the register.
{
  const fx = envelopeFixes({ byPerson: { a: { 20: 1 } }, pay: { a: 20 } }, { a: 26 });
  assert.deepEqual(fx.rows[0].add, { 5: 1, 1: 1 });
  assert.equal(fx.register, -6);
}

// stackSizes: defaults, and a size that isn't a multiple of its bill is off.
assert.deepEqual(stackSizes({}), { 1: 50, 5: 150, 10: 0 });
assert.deepEqual(stackSizes({ stacks: { 1: '40', 5: 152, 10: 100 } }), { 1: 40, 5: 0, 10: 100 });

// distributeWithStacks: a manager takes a $50 stack of $1s; everyone still exact.
{
  const people = [{ id: 'm', final: 120 }, { id: 'x', final: 103 }];
  const bills = { 100: 0, 50: 0, 20: 8, 10: 0, 5: 0, 1: 63 };
  const r = distributeWithStacks(people, bills, 0, ['m'], { 1: 50, 5: 0, 10: 0 });
  assert.equal(r.error, '');
  assert.equal(r.stacks.m[1], 1);
  assert.equal(value(r.byPerson.m), 120);
  assert.equal(value(r.byPerson.x), 103);
  assert.ok(r.byPerson.m[1] >= 50);
}
// no takers → the plain split.
{
  const r = distributeWithStacks([{ id: 'a', final: 20 }], { 20: 1 }, 0, [], { 1: 50 });
  assert.deepEqual(r.stacks, {});
  assert.equal(r.byPerson.a[20], 1);
}

console.log('fixups / stacks ok');

// shortFixes: register short — no change from the register.
import { shortFixes } from '../src/fixups.js';
{
  // Ana owes $9 with a $5 and four $1s: exact on her own.
  const fx = shortFixes({ byPerson: { a: { 20: 5, 5: 1, 1: 4 }, b: { 20: 5 } }, pay: { a: 109, b: 100 } }, { a: 100, b: 100 });
  assert.equal(fx.register, 9);
  assert.equal(fx.moves.length, 1);
  assert.equal(fx.moves[0].from, 'a');
  assert.equal(fx.notes.length, 0);
}
{
  // Ana owes $15 with only $20s — not exact alone. Ben owes $5. Together: Ana's
  // $20 goes in, Ben hands Ana his $5. No change from the register.
  const fx = shortFixes({ byPerson: { a: { 20: 2 }, b: { 10: 1, 5: 1 } }, pay: { a: 40, b: 15 } }, { a: 25, b: 10 });
  assert.equal(fx.register, 20);
  assert.equal(fx.notes.length, 0, JSON.stringify(fx));
  const net = id => fx.moves.reduce((t, m) => t + (m.from === id ? -value(m.bills) : 0) + (m.to === id ? value(m.bills) : 0), 0);
  assert.equal(net('a'), -15);
  assert.equal(net('b'), -5);
}
console.log('shortFixes ok');
{
  // Ana owes $13 with $20s and a $10; Cy owes $7 with only $1s and $20s.
  // Exact alone fails for Ana; together they settle with change hand to hand.
  const fx = shortFixes({ byPerson: { a: { 20: 2, 10: 1 }, c: { 20: 1, 1: 9 } }, pay: { a: 50, c: 29 } }, { a: 37, c: 22 });
  assert.equal(fx.register, 20);
  assert.equal(fx.notes.length, 0, JSON.stringify(fx));
  const net = id => fx.moves.reduce((t, m) => t + (m.from === id ? -value(m.bills) : 0) + (m.to === id ? value(m.bills) : 0), 0);
  assert.equal(net('a'), -13);
  assert.equal(net('c'), -7);
}
console.log('shortFixes change ok');
