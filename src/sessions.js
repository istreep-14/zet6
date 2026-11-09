// Saved sessions — one shift per session, switchable from the side drawer.
//
// Storage: an index under `tippool_sessions` ({ v, current, list }) and each
// session's v4 snapshot under `tippool_s_<id>`. The index keeps a small
// summary per session (date, name, total, people) so the drawer can list
// them without parsing every snapshot. On first run the legacy single-session
// key (`tippool_v1`) becomes the first session; it is left in place untouched.

import * as persist from './persist.js';

export const INDEX_KEY = 'tippool_sessions';
export const sessionKey = id => 'tippool_s_' + id;

let index = null;
let storage = null;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

function readIndex() {
  try {
    const ix = JSON.parse(storage.getItem(INDEX_KEY));
    if (!isObj(ix) || typeof ix.current !== 'string' || !Array.isArray(ix.list)) return null;
    ix.list = ix.list.filter(e => isObj(e) && typeof e.id === 'string');
    return ix;
  } catch {
    return null;
  }
}

function writeIndex() {
  try { storage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* storage full / blocked */ }
}

export function newSessionId() {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function todayISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Returns the current session's state, or null for a fresh start.
export function boot(store = globalThis.localStorage) {
  storage = store;
  index = readIndex();
  if (!index) {
    index = { v: 1, current: newSessionId(), list: [] };
    return persist.load(storage);                    // legacy single session (or null)
  }
  const st = persist.load(storage, sessionKey(index.current));
  if (st) return st;
  // Current snapshot missing or corrupt: fall back to the newest one that loads.
  for (const e of list()) {
    const other = persist.load(storage, sessionKey(e.id));
    if (other) { index.current = e.id; writeIndex(); return other; }
  }
  index.list = index.list.filter(e => e.id === index.current);
  return null;
}

export const currentId = () => index.current;

// Newest shift date first; same date → most recently created first.
export function list() {
  const born = e => e.created || e.saved || 0;
  return [...index.list].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || born(b) - born(a));
}

export function saveCurrent(state, summary = {}) {
  persist.save(state, storage, sessionKey(index.current));
  let e = index.list.find(x => x.id === index.current);
  if (!e) { e = { id: index.current, name: '', created: Date.now() }; index.list.push(e); }
  e.date = state.meta.date || '';
  e.saved = Date.now();
  e.total = summary.total || 0;
  e.people = summary.people || 0;
  writeIndex();
}

export function loadSession(id) {
  return persist.load(storage, sessionKey(id));
}

// Point the index at a session (call saveCurrent with its state right after).
export function setCurrent(id) {
  index.current = id;
  writeIndex();
}

export function createId() {
  const id = newSessionId();
  index.current = id;
  return id;
}

export function remove(id) {
  try { storage.removeItem(sessionKey(id)); } catch { /* ignore */ }
  index.list = index.list.filter(e => e.id !== id);
  writeIndex();
}

export function rename(id, name) {
  const e = index.list.find(x => x.id === id);
  if (!e) return;
  e.name = String(name || '').trim().slice(0, 40);
  writeIndex();
}
