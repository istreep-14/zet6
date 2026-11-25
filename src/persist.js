// Persistence — localStorage save/load, JSON export/import.
// Schema v4 stores the state object directly. v1–v3 snapshots (the old
// DOM-serialized shape) are migrated on first load; malformed data is
// discarded, never crashed on.

import { DENOMS, parseWholeNumber } from './util.js';
import { newStaff, newPool, initialState, blankBillStrings, ROLES, normalizeSettings } from './store.js';
import { seedIds } from './ids.js';

export const STORAGE_KEY = 'tippool_v1';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ── v4 validation ─────────────────────────────────────────────────────────────

function assertString(v, label) {
  if (v != null && typeof v !== 'string') throw new Error(label + ' must be a string');
}

export function validateV4(state) {
  if (!isPlainObject(state)) throw new Error('Not a valid TipPool state');
  if (!isPlainObject(state.meta)) throw new Error('meta missing');
  assertString(state.meta.date, 'date');

  if (!Array.isArray(state.staff)) throw new Error('staff must be an array');
  state.staff.forEach(p => {
    if (!isPlainObject(p)) throw new Error('staff entries must be objects');
    if (typeof p.id !== 'string') throw new Error('staff id must be a string');
    ['name', 'in', 'out', 'brk', 'brkAt'].forEach(k => assertString(p[k], 'staff ' + k));
    if (!ROLES.includes(p.role)) throw new Error('staff role is invalid');
    if (p.closerOverride != null && typeof p.closerOverride !== 'boolean') {
      throw new Error('closerOverride must be a boolean');
    }
  });

  if (!isPlainObject(state.defaults) || !isPlainObject(state.defaults.global) || !isPlainObject(state.defaults.byRole)) {
    throw new Error('defaults missing');
  }

  if (!Array.isArray(state.pools) || !state.pools.length) throw new Error('pools must be a non-empty array');
  state.pools.forEach(pool => {
    if (!isPlainObject(pool) || typeof pool.id !== 'string') throw new Error('pool entries are invalid');
    if (!isPlainObject(pool.window) || !isPlainObject(pool.roles) || !isPlainObject(pool.cash)) {
      throw new Error('pool shape is invalid');
    }
    if (!['perbill', 'nettotal', 'mixed'].includes(pool.cash.entryMode)) {
      throw new Error('pool entryMode is invalid');
    }
    assertString(pool.cash.netTotal, 'pool netTotal');
    if (pool.cash.baseMode != null && !['total', 'bills'].includes(pool.cash.baseMode)) throw new Error('pool cash mode is invalid');
    if (pool.cash.adjust != null) assertString(pool.cash.adjust, 'pool adjust');
    if (pool.cash.restMode != null && pool.cash.restMode !== 'rest' && pool.cash.restMode !== 'total') {
      throw new Error('pool restMode is invalid');
    }
    if (!isPlainObject(pool.cash.billCounts)) throw new Error('pool billCounts must be an object');
    DENOMS.forEach(d => {
      const v = pool.cash.billCounts[d];
      if (v == null) return;
      if (typeof v !== 'string' && typeof v !== 'number') throw new Error('pool bill counts are invalid');
      if (!parseWholeNumber(v).valid) throw new Error('pool bill counts must be whole numbers');
    });
    if (pool.cash.batches != null) {
      if (!Array.isArray(pool.cash.batches)) throw new Error('cash checkpoints must be an array');
      const ids = new Set();
      pool.cash.batches.forEach(batch => {
        if (!isPlainObject(batch) || typeof batch.id !== 'string' || !batch.id || ids.has(batch.id) || !['total', 'bills'].includes(batch.mode)) throw new Error('cash checkpoint is invalid');
        ids.add(batch.id);
        assertString(batch.label, 'checkpoint label');
        assertString(batch.amount, 'checkpoint amount');
        if (!isPlainObject(batch.billCounts)) throw new Error('checkpoint bill counts are invalid');
        DENOMS.forEach(d => {
          const v = batch.billCounts[d];
          if (v != null && ((typeof v !== 'string' && typeof v !== 'number') || !parseWholeNumber(v).valid)) throw new Error('checkpoint bill counts must be whole numbers');
        });
      });
    }
  });

  assertString(state.defaults.supportPct, 'supportPct');
  state.pools.forEach(pool => {
    if (pool.support == null) return;
    if (!isPlainObject(pool.support)) throw new Error('pool support must be an object');
    assertString(pool.support.pct, 'pool support pct');
    assertString(pool.support.rate, 'pool support rate');
    if (pool.support.hours != null && !isPlainObject(pool.support.hours)) {
      throw new Error('pool support hours must be an object');
    }
    Object.values(pool.support.hours || {}).forEach(v => assertString(v, 'pool support hours'));
  });

  if (!isPlainObject(state.overrides) || !isPlainObject(state.overrides.bonuses)) {
    throw new Error('overrides missing');
  }
  Object.values(state.overrides.bonuses).forEach(v => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('bonus overrides must be whole dollars');
  });
}

// Older v4 snapshots predate the support tip-out fields — fill them in.
function normalizeV4(state) {
  if (typeof state.defaults.supportPct !== 'string') state.defaults.supportPct = '';
  // Stacks for managers (Payout): ids of the people taking them.
  if (!Array.isArray(state.overrides.stackTo)) state.overrides.stackTo = [];
  state.overrides.stackTo = state.overrides.stackTo.filter(id => typeof id === 'string');
  state.pools.forEach(pool => {
    if (!isPlainObject(pool.support)) pool.support = { pct: '', rate: '', hours: {} };
    if (typeof pool.support.pct !== 'string') pool.support.pct = '';
    if (typeof pool.support.rate !== 'string') pool.support.rate = '';
    if (!isPlainObject(pool.support.hours)) pool.support.hours = {};
    normalizeCash(pool);
  });
  return state;
}

// Older pools were either counted by bill or a net total; now both are one
// form (counted bills + the uncounted rest). Keep only what the old mode used.
function normalizeCash(pool) {
  const c = pool.cash;
  if (c.entryMode === 'perbill') c.netTotal = '';
  else if (c.entryMode === 'nettotal') c.billCounts = blankBillStrings();
  c.entryMode = 'mixed';
  if (typeof c.adjust !== 'string') c.adjust = '';
  if (c.restMode !== 'total') c.restMode = 'rest';
  if (!Array.isArray(c.batches)) c.batches = [];
}

// ── v3 → v4 migration ─────────────────────────────────────────────────────────
// Old snapshot: staff (bartenders) + nightServers + support lists, night cash
// snapshots, gcIn/gcOut, roleDefaults. Day-pool / cut-assignment data is
// dropped (orphaned in the unified model).

export function migrateV3(snap) {
  const state = initialState();
  state.staff = [];

  const addRows = (rows, role) => {
    (rows || []).forEach(r => {
      if (!isPlainObject(r)) return;
      const person = newStaff(role);
      person.name = typeof r.name === 'string' ? r.name : '';
      person.in = typeof r.in === 'string' ? r.in : '';
      person.out = typeof r.out === 'string' ? r.out : '';
      person.closerOverride = !!r.closer;
      state.staff.push(person);
    });
  };

  addRows(snap.staff, 'bartender');
  addRows(snap.nightServers, 'server');
  addRows(snap.support, 'support');
  if (!state.staff.length) state.staff = [newStaff(), newStaff(), newStaff()];

  state.meta.date = typeof snap.date === 'string' ? snap.date : '';
  state.defaults.global.in = typeof snap.gcIn === 'string' && snap.gcIn ? snap.gcIn : '5';
  state.defaults.global.out = typeof snap.gcOut === 'string' && snap.gcOut ? snap.gcOut : '2';
  if (isPlainObject(snap.roleDefaults)) {
    ROLES.forEach(role => {
      const d = snap.roleDefaults[role];
      if (!isPlainObject(d)) return;
      state.defaults.byRole[role].in = typeof d.in === 'string' ? d.in : '';
      state.defaults.byRole[role].out = typeof d.out === 'string' ? d.out : '';
    });
  }

  // One pool from the night cash snapshots.
  const pool = newPool();
  const mode = snap.cashMode === 'perbill' ? 'perbill' : 'nettotal';
  pool.cash.entryMode = mode;
  pool.cash.netTotal = typeof snap.netTotal === 'string' ? snap.netTotal : '';
  const bills = isPlainObject(snap.perBillBills) ? snap.perBillBills
    : (mode === 'perbill' && isPlainObject(snap.bills) ? snap.bills : null);
  if (bills) {
    const counts = blankBillStrings();
    DENOMS.forEach(d => {
      const v = bills[d];
      if ((typeof v === 'string' || typeof v === 'number') && parseWholeNumber(v).valid) {
        counts[d] = String(v ?? '');
      }
    });
    pool.cash.billCounts = counts;
  }
  normalizeCash(pool);
  state.pools = [pool];
  state.ui.selectedPool = pool.id;

  validateV4(state);
  return state;
}

// ── Snapshot round-trip ───────────────────────────────────────────────────────

export function serialize(state) {
  return JSON.stringify({ v: 4, saved: Date.now(), state });
}

export function deserialize(raw) {
  const snap = JSON.parse(raw);
  if (!isPlainObject(snap)) throw new Error('Not a valid TipPool file');

  if (snap.v === 4) {
    validateV4(snap.state);
    seedIds([...snap.state.staff.map(p => p.id), ...snap.state.pools.map(p => p.id), ...snap.state.pools.flatMap(p => (p.cash.batches || []).map(b => b.id))]);
    return normalizeSettings(normalizeV4(snap.state));
  }

  if (snap.v === 1 || snap.v === 2 || snap.v === 3) {
    const migrated = migrateV3(snap);
    delete migrated.settings;          // derive from the migrated staff/pools
    return normalizeSettings(migrated);
  }

  throw new Error('Incompatible file version');
}

// ── Browser storage I/O ───────────────────────────────────────────────────────

export function save(state, storage = globalThis.localStorage, key = STORAGE_KEY) {
  try {
    storage.setItem(key, serialize(state));
  } catch (e) {
    console.warn('TipPool: localStorage unavailable', e);
  }
}

export function load(storage = globalThis.localStorage, key = STORAGE_KEY) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function clear(storage = globalThis.localStorage) {
  storage.removeItem(STORAGE_KEY);
}
