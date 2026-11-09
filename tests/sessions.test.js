import assert from 'node:assert';
import * as sessions from '../src/sessions.js';
import { save, load, STORAGE_KEY } from '../src/persist.js';
import { initialState } from '../src/store.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: k => map.delete(k),
    map,
  };
}

// Legacy single-session storage becomes the first session.
{
  const storage = fakeStorage();
  const legacy = initialState();
  legacy.meta.date = '2026-11-01';
  legacy.staff[0].name = 'Ana';
  save(legacy, storage);
  const booted = sessions.boot(storage);
  assert.strictEqual(booted.staff[0].name, 'Ana');
  sessions.saveCurrent(booted, { total: 300, people: 1 });
  const first = sessions.currentId();
  assert.deepStrictEqual(sessions.list().map(e => [e.id, e.date, e.total, e.people]), [[first, '2026-11-01', 300, 1]]);
  assert.ok(storage.getItem(STORAGE_KEY), 'legacy key left in place');

  // A second session, newer date, lists first.
  const second = sessions.createId();
  const s2 = initialState();
  s2.meta.date = '2026-11-08';
  sessions.saveCurrent(s2, {});
  assert.deepStrictEqual(sessions.list().map(e => e.id), [second, first]);

  // Switch back, rename, reboot keeps the current pointer.
  sessions.setCurrent(first);
  sessions.rename(first, '  Brunch  ');
  assert.strictEqual(sessions.boot(storage).staff[0].name, 'Ana');
  assert.strictEqual(sessions.currentId(), first);
  assert.strictEqual(sessions.list().find(e => e.id === first).name, 'Brunch');
  assert.strictEqual(sessions.loadSession(second).meta.date, '2026-11-08');

  // Removing deletes the snapshot; a missing current falls back to another.
  sessions.remove(first);
  assert.strictEqual(load(storage, sessions.sessionKey(first)), null);
  assert.strictEqual(sessions.boot(storage).meta.date, '2026-11-08');
  assert.strictEqual(sessions.currentId(), second);
}

// Fresh storage boots to null (caller starts a new state).
{
  const storage = fakeStorage();
  assert.strictEqual(sessions.boot(storage), null);
  storage.setItem(sessions.INDEX_KEY, '{broken');
  assert.strictEqual(sessions.boot(storage), null);
}

console.log('sessions tests passed');
