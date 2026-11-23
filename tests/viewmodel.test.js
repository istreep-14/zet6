// buildViewModel — blocker routing: each blocker names the tab that fixes it.
import assert from 'node:assert';
import { initialState } from '../src/store.js';
import { buildViewModel } from '../src/viewmodel.js';

function state(fn) {
  const s = initialState();
  fn(s);
  return s;
}

// Nobody named → Staff.
{
  const vm = buildViewModel(initialState());
  assert.strictEqual(vm.blockedTab, 'staff');
  assert.strictEqual(vm.inputError, false);
}

// Staff in, no cash → Tips.
{
  const vm = buildViewModel(state(s => { s.staff[0].name = 'A'; }));
  assert.strictEqual(vm.blocked, 'Enter cash for at least one pool.');
  assert.strictEqual(vm.blockedTab, 'tips');
}

// A bad staff time → Staff (even with a cash error too: staff comes first).
{
  const vm = buildViewModel(state(s => {
    s.staff[0].name = 'A';
    s.staff[0].in = '5.3';
    s.pools[0].cash.netTotal = 'abc';
  }));
  assert.strictEqual(vm.inputError, true);
  assert.strictEqual(vm.blockedTab, 'staff');
}

// A bad cash entry → Tips.
{
  const vm = buildViewModel(state(s => {
    s.staff[0].name = 'A';
    s.pools[0].cash.netTotal = '12.5';
  }));
  assert.strictEqual(vm.inputError, true);
  assert.strictEqual(vm.blockedTab, 'tips');
}

// Bad support % → Tips (the support box lives there).
{
  const vm = buildViewModel(state(s => {
    s.staff[0].name = 'A';
    s.pools[0].cash.netTotal = '100';
    s.pools[0].support.pct = 'ten';
  }));
  assert.strictEqual(vm.blockedTab, 'tips');
}

// Everything in → not blocked, pays out.
{
  const vm = buildViewModel(state(s => {
    s.staff[0].name = 'A';
    s.staff[1].name = 'B';
    s.pools[0].cash.netTotal = '181';
  }));
  assert.strictEqual(vm.blocked, '');
  assert.strictEqual(vm.blockedTab, '');
  assert.strictEqual(vm.shares.perPerson.reduce((t, p) => t + p.final, 0) + vm.shares.leftover, 181);
}

console.log('viewmodel tests passed');
