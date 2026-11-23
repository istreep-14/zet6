// Bundled stacks for managers. A night with no large bills in circulation can
// leave the drawer heavy in $1s / $5s / $10s. Rather than spread them over
// every envelope, whole stacks (say $50 of $1s, $150 of $5s) go to the people
// picked to take them — managers who can trade them up — as part of their
// pay, as long as everyone else still gets exact change. Pure; no DOM.

import { distribute } from './engine.js';

// $ per stack for each small bill; 0 = don't bundle that bill.
export const STACK_DEFAULTS = { 1: 50, 5: 150, 10: 0 };
export const STACK_BILLS = [1, 5, 10];

// The stack sizes in use: settings.stacks over the defaults, each a positive
// whole multiple of its bill (else off).
export function stackSizes(settings) {
  const out = {};
  STACK_BILLS.forEach(d => {
    const raw = settings?.stacks?.[d];
    const v = raw == null || raw === '' ? STACK_DEFAULTS[d] : Number(raw);
    out[d] = Number.isFinite(v) && v > 0 && v % d === 0 ? v : 0;
  });
  return out;
}

const MAX_TRIES = 40;          // distribute() runs — each stack is one check

// people [{ id, final }], bills (drawer counts), leftover (chump), takers
// [ids] in order, sizes { 1: $, 5: $, 10: $ }. Hands out whole stacks to the
// takers ($1s first, then $5s, $10s; each taker as many as their pay holds)
// while the rest still splits exactly, then distributes what's left as
// usual. Returns distribute()'s shape plus `stacks: { id: { d: n } }` (n
// stacks of bill d). Falls back to a plain distribute() when nothing fits.
export function distributeWithStacks(people, bills, leftover, takers, sizes) {
  const plain = () => ({ ...distribute(people, bills, leftover), stacks: {} });
  const ids = (takers || []).filter(id => people.some(p => p.id === id));
  if (!ids.length) return plain();
  const pool = { ...bills };
  const pay = Object.fromEntries(people.map(p => [p.id, p.final]));
  const rest = () => people.map(p => ({ ...p, final: pay[p.id] })).filter(p => p.final > 0);
  const stacks = {};
  let tries = 0;
  for (const d of STACK_BILLS) {
    const size = sizes?.[d] || 0;
    if (!size) continue;
    const n = size / d;
    for (const id of ids) {
      while ((pool[d] || 0) >= n && pay[id] >= size && tries < MAX_TRIES) {
        tries++;
        pool[d] -= n;
        pay[id] -= size;
        if (distribute(rest(), pool, leftover).error) { pool[d] += n; pay[id] += size; break; }
        stacks[id] = stacks[id] || {};
        stacks[id][d] = (stacks[id][d] || 0) + 1;
      }
    }
  }
  if (!Object.keys(stacks).length) return plain();
  const res = distribute(rest(), pool, leftover);
  if (res.error) return plain();
  const byPerson = { ...res.byPerson };
  Object.entries(stacks).forEach(([id, by]) => {
    const env = { ...(byPerson[id] || {}) };
    Object.entries(by).forEach(([d, k]) => { env[d] = (env[d] || 0) + k * (sizes[d] / Number(d)); });
    byPerson[id] = env;
  });
  return { ...res, byPerson, stacks };
}
