// Shift types (Day / Mid / Party pools with derived edges) + keypad time entry.
import assert from 'node:assert';
import { initialState } from '../src/store.js';
import { parseClockEntry } from '../src/time.js';
import { presetPools, partyPool, switchPools, cashLostBySwitch, timesFor } from '../src/shifts.js';
import { buildViewModel } from '../src/viewmodel.js';

// ── Keypad entry ──
{
  const v = s => parseClockEntry(s).value;
  assert.strictEqual(v('5'), 5);
  assert.strictEqual(v('530'), 5.5);
  assert.strictEqual(v('1045'), 10.75);
  assert.strictEqual(v('1730'), 5.5);
  assert.strictEqual(v('5:3'), 5.5);
  assert.strictEqual(v('5:20'), 5.25);     // snaps to the quarter
  assert.strictEqual(v('5:55'), 6);
  assert.strictEqual(v('12:45'), 12.75);
  assert.strictEqual(parseClockEntry('99').valid, false);
  assert.strictEqual(parseClockEntry('5:75').valid, false);
  assert.strictEqual(parseClockEntry('').empty, true);
}

// A day shift: open 11a, close 5p, servers out at 4p by default.
function dayState(fn) {
  const s = initialState();
  s.meta.shiftType = 'day';
  const t = timesFor('day');
  s.defaults.global = t.global;
  s.defaults.byRole = t.byRole;
  s.pools = presetPools('day');
  s.staff = [
    { id: 'b1', name: 'Bar', role: 'bartender', in: '', out: '', closerOverride: false },
    { id: 'v1', name: 'Srv', role: 'server', in: '', out: '', closerOverride: false },
  ];
  fn?.(s);
  return s;
}

// ── Day = open → servers out (bar + servers), Mid = servers out → bar out (bar) ──
{
  const vm = buildViewModel(dayState(s => {
    s.pools[0].cash.netTotal = '200';    // Day
    s.pools[1].cash.netTotal = '30';     // Mid
  }));
  assert.strictEqual(vm.blocked, '');
  const [day, mid] = vm.pools;
  assert.strictEqual(day.startAbs, 11);
  assert.strictEqual(day.endAbs, 16);    // 4p — the server's default Out
  assert.strictEqual(mid.startAbs, 16);
  assert.strictEqual(mid.endAbs, 17);    // 5p — the bartender's Out (close)
  const bar = vm.shares.perPerson.find(p => p.id === 'b1');
  const srv = vm.shares.perPerson.find(p => p.id === 'v1');
  assert.strictEqual(bar.exact, 100 + 30);   // half of Day, all of Mid
  assert.strictEqual(srv.exact, 100);
}

// The switch follows the floor: a server staying to 4:30 moves it.
{
  const vm = buildViewModel(dayState(s => {
    s.staff.push({ id: 'v2', name: 'Late', role: 'server', in: '12', out: '4.5', closerOverride: false });
    s.pools[0].cash.netTotal = '100';
  }));
  assert.strictEqual(vm.pools[0].endAbs, 16.5);
  assert.strictEqual(vm.pools[1].startAbs, 16.5);
}

// Servers to close → Mid collapses to nothing (not an error).
{
  const vm = buildViewModel(dayState(s => {
    s.defaults.byRole.server.out = '';
    s.pools[0].cash.netTotal = '100';
  }));
  assert.strictEqual(vm.inputError, false);
  assert.strictEqual(vm.pools[1].endAbs - vm.pools[1].startAbs, 0);
}

// ── Party: overlapping window, its own tips, support tip-out ──
{
  const vm = buildViewModel(dayState(s => {
    s.settings.allRoles = true;
    s.staff.push({ id: 'u1', name: 'Bus', role: 'support', in: '1', out: '3', closerOverride: false });
    const party = partyPool(s.pools);
    party.window = { start: '1', end: '3' };
    party.cash.netTotal = '100';
    s.pools.push(party);
  }));
  assert.strictEqual(vm.inputError, false);
  const party = vm.shares.perPool[2];
  assert.strictEqual(party.label, 'Party');
  assert.strictEqual(party.support.cut, 10);          // 10% default
  const bar = vm.shares.perPerson.find(p => p.id === 'b1');
  assert.strictEqual(bar.perPool[party.id].hours, 2);
  assert.strictEqual(bar.perPool[party.id].raw, 45);   // (100 − 10) ÷ 4h × 2h
  assert.strictEqual(partyPool(vm.state.pools).label, 'Party 2');
}

// ── Switching type keeps what was entered ──
{
  const night = presetPools('night');
  night[0].cash.netTotal = '500';
  const party = partyPool(night);
  const day = switchPools([...night, party], 'day');
  assert.deepStrictEqual(day.map(p => p.kind), ['day', 'mid', 'party']);
  assert.strictEqual(day[0].cash.netTotal, '500');   // first floor pool's cash moves over
  assert.strictEqual(day[2], party);

  day[1].cash.netTotal = '40';
  const cash = p => Number(p.cash.netTotal) || 0;
  assert.strictEqual(cashLostBySwitch(day, 'night', cash), 40);   // Mid's cash would go
  const back = switchPools(day, 'night');
  assert.strictEqual(back[0].cash.netTotal, '500');
}

console.log('shift tests passed');
