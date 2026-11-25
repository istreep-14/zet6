// What changed, and by how much — for every edit that moves the money.
//
// Two sources, one look (pkit's Delta):
//   preview   an edit still in progress (a time being dragged, a time being
//             typed on the keypad): main.js re-runs the split on a copy of
//             the state and the views show the would-be numbers against the
//             current ones (vm.preview).
//   change    an edit that just landed: each person's pay (and the rate /
//             chump) against what they were before (vm.changes). A burst of
//             edits (typing "1200" into the cash) counts from before the
//             burst; the deltas show for SHOW ms, then main.js clears them.

import { parseTime, inAbsOf, afterAbsOf } from '../time.js';

export const SHOW = 6000;           // how long a landed change stays marked
const SETTLE = 4000;                // edits closer together than this are one burst

// The figures a change is measured on.
export function snapOf(vm) {
  if (!vm?.shares || vm.inputError) return null;
  const pay = {};
  vm.shares.perPerson.forEach(p => { pay[p.id] = p.final; });
  // Everyone's resolved In / Out, so a preview can mark the times that move
  // with an edit (a default close drags everyone who inherits it).
  const times = {};
  (vm.resolved?.staff || []).forEach(p => { times[p.id] = { in: p.inAbs, out: p.outAbs, hours: p.hours }; });
  const start = parseTime(vm.state.defaults.global.in), end = parseTime(vm.state.defaults.global.out);
  const open = start.value == null ? null : inAbsOf(start);
  const close = end.value == null ? null : afterAbsOf(end, open ?? 17);
  return { pay, times, open, close,
    rate: vm.shares.rate, chump: vm.shares.leftover, total: vm.shares.totalCash,
    hours: vm.shares.perPerson.filter(p => p.role !== 'support').reduce((t, p) => t + (p.shiftHours ?? p.hours), 0),
    bills1: vm.req?.minOnes, bills5: vm.req && Math.ceil(Math.max(0, vm.req.minOneFiveValue - vm.req.minOnes) / 5),
    bills10: vm.req && Math.ceil(Math.max(0, vm.req.minOneFiveTenValue - vm.req.minOneFiveValue) / 10) };
}

const sameSnap = (a, b) => a.rate === b.rate && a.chump === b.chump && a.total === b.total && a.open === b.open && a.close === b.close
  && Object.keys(a.pay).length === Object.keys(b.pay).length
  && Object.keys(a.pay).every(k => a.pay[k] === b.pay[k])
  && Object.keys(a.times).every(k => a.times[k]?.in === b.times[k]?.in && a.times[k]?.out === b.times[k]?.out);

let last = null, base = null, at = 0, stamp = 0, session = null;

// Forget the last figures (after an Undo: putting things back isn't a change).
export function resetChanges() { last = null; base = null; }

// Called with every freshly built view model; sets vm.changes while a landed
// change is still fresh. Returns true when this render changed the money.
// `review` (main.js: a drag / keypad edit waiting for Undo / Apply): its marks
// stay, measured from before that edit, until it's resolved.
export function trackChanges(vm, sid, review = null) {
  const cur = snapOf(vm);
  const now = Date.now();
  let moved = false;
  if (sid !== session || !cur || !last) {
    session = sid;
    base = null;
  } else if (!sameSnap(cur, last)) {
    if (!base || now - at > SETTLE) base = last;
    at = now;
    stamp++;
    moved = true;
  }
  last = cur;
  if (review?.base && cur) {
    // The review carries its own marks; once it's resolved nothing lingers.
    base = null;
    vm.changes = { base: review.base, stamp: 'r' + review.stamp, review };
    return false;
  }
  vm.changes = base && now - at < SHOW ? { base, stamp } : null;
  return moved;
}

// The comparison a view should show for this vm: { base, kind, stamp } or null.
function ref(vm) {
  if (vm?.preview) return { base: vm.preview.base, kind: 'preview', stamp: 'p' };
  if (vm?.changes) return { base: vm.changes.base, kind: 'change', stamp: vm.changes.stamp };
  return null;
}

// A person's pay against the reference: { v, kind, stamp } (v ≠ 0) or null.
export function payDelta(vm, id, now) {
  const r = ref(vm);
  if (!r?.base) return null;
  const was = r.base.pay[id];
  if (was == null) return null;
  const v = Math.round((now - was) * 100) / 100;
  return v ? { v, kind: r.kind, stamp: r.stamp } : null;
}

// rate / chump / total against the reference.
export function figDelta(vm, key) {
  const r = ref(vm);
  const cur = snapOf(vm);
  if (!r?.base || !cur || r.base[key] == null || cur[key] == null) return null;
  const v = Math.round((cur[key] - r.base[key]) * 100) / 100;
  return v ? { v, kind: r.kind, stamp: r.stamp } : null;
}

// Total of everyone's pay against the reference.
export function sumDelta(vm, now) {
  const r = ref(vm);
  if (!r?.base) return null;
  const was = Object.values(r.base.pay).reduce((t, x) => t + x, 0);
  const v = Math.round((now - was) * 100) / 100;
  return v ? { v, kind: r.kind, stamp: r.stamp } : null;
}

export const isPreview = vm => !!vm?.preview;

// Did this person's In / Out move against the reference (a preview in
// progress, or an edit waiting for Undo · Apply)? → 'preview' | 'change' | null.
export function timeMoved(vm, id, field) {
  const r = ref(vm);
  if (!r?.base?.times) return null;
  const was = r.base.times[id]?.[field];
  const now = (vm.resolved?.staff || []).find(p => p.id === id)?.[field + 'Abs'];
  return was != null && now != null && Math.abs(was - now) > 1e-6 ? r.kind : null;
}
// The default open / close (field 'in' | 'out').
export function defaultMoved(vm, field) {
  const r = ref(vm);
  if (!r?.base) return null;
  const was = field === 'in' ? r.base.open : r.base.close;
  const now = snapOf(vm)?.[field === 'in' ? 'open' : 'close'];
  return was != null && now != null && Math.abs(was - now) > 1e-6 ? r.kind : null;
}

export function hoursMoved(vm, id) {
  const r = ref(vm);
  const was = r?.base?.times?.[id]?.hours;
  const now = vm.resolved?.staff?.find(p => p.id === id)?.hours;
  return was != null && now != null && Math.abs(now - was) > 1e-6 ? r.kind : null;
}

// How many people's pay moved against the reference.
export function movedCount(vm) {
  const r = ref(vm);
  if (!r?.base || !vm.shares) return 0;
  return vm.shares.perPerson.filter(p => r.base.pay[p.id] != null && r.base.pay[p.id] !== p.final).length;
}

// The figures the wheel picker shows under the wheel for a previewed edit:
// the person being edited (their pay and change) or the pool, the rate,
// and how many payouts move. null when there's nothing to show.
export function previewFigures(pv) {
  if (!pv?.shares || pv.blocked) return null;
  const sh = pv.shares;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const focus = pv.preview?.focus ? sh.perPerson.find(p => p.id === pv.preview.focus) : null;
  const n = movedCount(pv);
  return [
    focus ? { k: focus.name, v: money(focus.final), d: payDelta(pv, focus.id, focus.final), tone: 'text-accent' }
      : { k: 'Pool', v: money(sh.totalCash), d: figDelta(pv, 'total') },
    { k: 'Rate', v: '$' + sh.rate.toFixed(2), d: figDelta(pv, 'rate'), tone: 'text-good' },
    { k: 'changed', v: String(n) },
  ];
}
