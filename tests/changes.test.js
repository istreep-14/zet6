import assert from 'node:assert/strict';
import { initialState } from '../src/store.js';
import { buildViewModel } from '../src/viewmodel.js';
import { snapOf, timeMoved, defaultMoved, hoursMoved, figDelta } from '../src/ui/changes.js';

const state = initialState();
state.staff[0].name = 'Alex';
state.staff[1].name = 'Bea';
state.pools[0].cash.netTotal = '181';
const original = buildViewModel(state);
const next = structuredClone(state);
next.defaults.global.out = '3a';
const preview = buildViewModel(next);
preview.preview = { base: snapOf(original) };
for (const person of state.staff.slice(0, 2)) {
  assert.equal(timeMoved(preview, person.id, 'out'), 'preview');
  assert.equal(hoursMoved(preview, person.id), 'preview');
}
assert.equal(defaultMoved(preview, 'out'), 'preview');
assert.ok(figDelta(preview, 'hours'));

const noCash = structuredClone(state);
noCash.pools[0].cash.netTotal = '';
const noCashVm = buildViewModel(noCash);
assert.ok(snapOf(noCashVm), 'default times can be previewed before cash is entered');
console.log('live changes ok');
