// Roster — names of people who have worked before, for one-tap "quick add" on
// the Staff tab. Lives in its own localStorage key, separate from the shift
// snapshot, so it survives New session and import. Validate-or-discard like
// persist.js: bad data yields an empty roster, never a crash.

import { ROLES } from './store.js';

export const ROSTER_KEY = 'tippool_roster';

let roster = [];

const norm = name => String(name || '').trim().replace(/\s+/g, ' ');
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export function loadRoster(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(ROSTER_KEY) || '[]');
    roster = Array.isArray(raw)
      ? raw.filter(x => x && typeof x.name === 'string' && norm(x.name).length >= 2)
          .map(x => ({ name: norm(x.name), role: ROLES.includes(x.role) ? x.role : 'bartender' }))
      : [];
  } catch {
    roster = [];
  }
  return roster;
}

function save(storage = globalThis.localStorage) {
  try { storage?.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch { /* storage unavailable */ }
}

export function getRoster() {
  return roster;
}

// Add (or update the role of) a name. Returns true if the roster changed.
export function rememberName(name, role = 'bartender', storage) {
  const n = norm(name);
  if (n.length < 2) return false;
  const hit = roster.find(x => same(x.name, n));
  if (hit) {
    if (hit.role === role) return false;
    hit.role = role;
  } else {
    roster.push({ name: n, role });
    roster.sort((a, b) => a.name.localeCompare(b.name));
  }
  save(storage);
  return true;
}

export function forgetName(name, storage) {
  const n = norm(name);
  const before = roster.length;
  roster = roster.filter(x => !same(x.name, n));
  if (roster.length !== before) save(storage);
}
