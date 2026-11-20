import assert from 'node:assert';
import { summaryText } from '../src/textout.js';

// Rows padded into columns; Total row (paid out), then tips, hours, rate.
{
  const person = (name, role, inAbs, outAbs, hours, final) => ({ name, role, inAbs, outAbs, shiftHours: hours, hours, final });
  const vm = {
    state: { settings: { allRoles: false } },
    shares: {
      totalCash: 470, rate: 26.11,
      perPerson: [person('Maya', 'bartender', 17, 26, 9, 235), person('Leo', 'bartender', 18, 26, 8, 234)],
    },
    adjust: 0,
    dist: { error: '', byPerson: { a: { 100: 2, 20: 1, 10: 1, 5: 1 }, b: { 100: 2, 20: 1, 10: 1, 1: 4 } }, remainderBills: { 1: 1 } },
  };
  vm.shares.perPerson[0].id = 'a';
  vm.shares.perPerson[1].id = 'b';
  vm.shares.leftover = 1;
  const text = summaryText(vm, 'Tips · Fri, Nov 20');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], 'Tips · Fri, Nov 20');
  assert.strictEqual(lines[1], '');
  assert.match(lines[2], /^Tips\s+\$470$/);
  assert.ok(text.indexOf('Rate') < text.indexOf('Name'), 'tips section above the table');
  const maya = lines.find(l => l.startsWith('Maya'));
  const leo = lines.find(l => l.startsWith('Leo'));
  assert.strictEqual(maya.length, leo.length, 'rows line up');
  assert.ok(maya.endsWith('$235'));
  assert.match(text, /Total\s+17\s+\$469/);
  assert.match(text, /\nTips\s+\$470/);
  assert.match(text, /\nHours\s+17/);
  assert.match(text, /\nRate\s+\$26\.11\/h/);
  // Bills per person: a column per size used, chump, drawer totals.
  assert.match(text, /\nBills\s+\$100\s+\$20\s+\$10\s+\$5\s+\$1\n/);
  assert.match(text, /\nMaya\s+2\s+1\s+1\s+1\s+-\n/);
  assert.match(text, /\nChump\s+-\s+-\s+-\s+-\s+1\n/);
  assert.match(text, /\nTotal\s+4\s+2\s+2\s+1\s+5$/);
}

console.log('text summary tests passed');
