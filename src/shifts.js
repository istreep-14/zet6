// Shift types — how a session's pools are laid out, plus the default times
// each type starts from. Pure: no DOM, no store.
//
//   night  one pool, the whole shift, bar + servers.
//   day    Day  = open → servers out ('srv'), bar + servers share the floor
//          Mid  = servers out → bar out ('bar'), bartenders only
//          (the edges are derived, so the switch follows when the servers
//          actually leave — see resolvePools).
//   party  an extra pool on top of either: a private event's own tips, split
//          by bar + servers by hours inside the party's window, support
//          tip-out on. Overlaps the floor pools; rarely there are two.

import { newPool } from './store.js';

export const SHIFT_TYPES = ['night', 'day'];
export const SHIFT_LABEL = { night: 'Night', day: 'Day' };

const blankRoles = () => ({ bartender: { in: '', out: '' }, server: { in: '', out: '' }, support: { in: '', out: '' } });

// Starting times per type (decimal 12-hour, as typed). Edits in a session are
// remembered per type in settings.shiftTimes and used from then on.
export const DEFAULT_TIMES = {
  night: { global: { in: '5', out: '2' }, byRole: blankRoles() },
  day: { global: { in: '11', out: '5' }, byRole: { ...blankRoles(), server: { in: '', out: '4' } } },
};

export function timesFor(type, remembered) {
  const t = remembered?.[type] || DEFAULT_TIMES[type] || DEFAULT_TIMES.night;
  return JSON.parse(JSON.stringify({ global: t.global, byRole: { ...blankRoles(), ...t.byRole } }));
}

function pool(label, kind, over = {}) {
  const p = newPool(label);
  p.kind = kind;
  Object.assign(p.window, over.window || {});
  Object.assign(p.roles, over.roles || {});
  if (over.includeSupport) p.includeSupport = true;
  return p;
}

// The floor pools for a shift type (parties are added separately).
export function presetPools(type) {
  if (type === 'day') {
    return [
      pool('Day', 'day', { window: { start: '', end: 'srv' } }),
      pool('Mid', 'mid', { window: { start: 'srv', end: 'bar' }, roles: { server: false } }),
    ];
  }
  return [pool('Night', 'night')];
}

// A private party: its own window (set it on the Tips tab), bar + servers,
// support tip-out on.
export function partyPool(existing = []) {
  const n = existing.filter(p => p.kind === 'party').length;
  return pool(n ? 'Party ' + (n + 1) : 'Party', 'party', { includeSupport: true });
}

// Pools for `type`, keeping what was entered: same-kind pools keep their
// cash; otherwise the old first floor pool's cash moves to the new first
// pool. Party pools are kept as they are.
export function switchPools(oldPools, type) {
  const fresh = presetPools(type);
  const floor = oldPools.filter(p => p.kind !== 'party');
  const parties = oldPools.filter(p => p.kind === 'party');
  let carried = false;
  fresh.forEach(np => {
    const same = floor.find(o => o.kind && o.kind === np.kind);
    if (same) { np.cash = same.cash; np.support = same.support; np.includeSupport = same.includeSupport; carried = true; }
  });
  if (!carried && floor[0]) {
    fresh[0].cash = floor[0].cash;
    fresh[0].support = floor[0].support;
  }
  return [...fresh, ...parties];
}

// Cash that switchPools would drop (floor pools after the first that don't
// carry over) — the UI confirms before throwing it away.
export function cashLostBySwitch(oldPools, type, cashOf) {
  const kinds = new Set(presetPools(type).map(p => p.kind));
  const floor = oldPools.filter(p => p.kind !== 'party');
  const sameKind = floor.some(o => kinds.has(o.kind));
  return floor
    .filter((o, i) => (sameKind ? !kinds.has(o.kind) : i > 0))
    .reduce((t, o) => t + cashOf(o), 0);
}
