// Pay › Bills (Preact) — the cash side of the distribution, where the drawer
// is fixed up alongside the envelope table.
//   status (exact change ✓ / the fix card with Apply) → the best bills for
//   the uncounted cash → tools,
//   each as a back-navigable Pay subpage: envelopes already made (with a
//   register over / short), stacks for a manager, tidy the drawer.
// Worksheet ("How the split works") and EnvelopeTable (the envelopes) are
// Home's.

import { DENOMS, fmtHrs, fmtMoney, payoutOrder, poolValue } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { planMakeChange, computeTradeUp, distribute, drawerBills } from '../engine.js';
import { envelopeFixes, shortFixes } from '../fixups.js';
import { STACK_BILLS, STACK_DEFAULTS } from '../stacks.js';
import { updatePool } from '../store.js';
import { html } from '../ui/preact.js';
import { cx, Icon, Card, Button, Alert, Money, Denom, Blocked, Banner, Section, List, Item, Table, Sentinel, zebra, Delta, SwitchRow, hueVar, hueIndex, Avatar, RowLabel } from '../ui/pkit.js';
import { payDelta } from '../ui/changes.js';
import { pushPage } from '../ui/nav.js';
import { Suggested } from './tips.js';

let currentVm = null;
let pendingTradeUp = null;
let pendingTradeDown = null;

// ── Distribution status ──────────────────────────────────────────────────────

// True when the $1/$5/$10 minimums aren't covered (cumulative: spare $1s
// cover missing $5s, spare $1s+$5s cover $10s).
export function smallBillsShort(req) {
  return !!req && (req.onesShort > 0 || req.oneFiveShort > 0 || req.oneFiveTenShort > 0);
}

// Plain-language reason for a failed distribution ('' when it pays out).
export function distErrorText(vm) {
  const { dist, people, shares, req } = vm;
  if (!dist) return '';
  const unpaid = people.reduce((s, p) => s + Math.max(0, p.final - poolValue(dist.byPerson[p.id] || {})), 0);
  if (dist.error && !smallBillsShort(req)) {
    return 'These bills can’t be split into exact payouts. Small bills are covered — the larger bills don’t divide evenly.';
  }
  if (dist.error) return 'Not enough small bills to make exact change.';
  if (unpaid > 0) return 'Drawer is short $' + unpaid + ' in usable bills.';
  if (shares.leftover > 0 && poolValue(dist.remainderBills) !== shares.leftover) {
    return 'The chump can’t be made from the bills left over.';
  }
  return '';
}

// Trades write real bill counts back into the pool — only with one pool.
// Applying a swap rewrites the cash count; keep checkpoint histories intact.
const tradesEnabled = vm => vm.state.pools.length === 1 && !(vm.state.pools[0].cash.batches || []).length;

const planCache = new WeakMap();
function breakPlan(vm) {
  if (!planCache.has(vm)) planCache.set(vm, planMakeChange(vm.people, vm.bills, vm.shares.leftover));
  return planCache.get(vm);
}

// "Consolidate into $20s" only counts small-bill minimums, so only offer it
// when the consolidated drawer still pays out exactly.
function safeTradeUp(vm) {
  const plan = computeTradeUp(vm.bills, vm.req);
  if (!plan) return null;
  return distribute(vm.people, plan.newPool, vm.shares.leftover).error ? null : plan;
}

function applyBillCountsToPool(vm, newPool) {
  if ((vm.state.pools[0]?.cash.batches || []).length) return;
  updatePool(vm.state.pools[0].id, pool => {
    // The swapped drawer is now fully counted: the rest and any register
    // over / short are folded into these counts.
    pool.cash.entryMode = 'mixed';
    pool.cash.baseMode = 'bills';
    pool.cash.netTotal = '';
    pool.cash.restMode = 'rest';
    pool.cash.adjust = '';
    DENOMS.forEach(d => { pool.cash.billCounts[d] = (newPool[d] || 0) > 0 ? String(newPool[d]) : ''; });
  });
}

export function applyPendingTradeUp() {
  if (currentVm && pendingTradeUp) applyBillCountsToPool(currentVm, pendingTradeUp.newPool);
}

export function applyPendingTradeDown() {
  if (currentVm && pendingTradeDown) applyBillCountsToPool(currentVm, pendingTradeDown.pool);
}

// ── Envelopes table: person · a column per bill size used · take-home ──────
// Only the bill sizes that are actually handed out get a column, so the
// names keep the room they need and nothing scrolls sideways. Names, Chump
// and Total read at the same size (body); counts in their bill's tint;
// hairlines between the columns.
// `order` = the people in row order (default payoutOrder). A person taking
// bundled stacks (vm.stacks) says so under their name.
export function EnvelopeTable({ vm, byPerson, remBills, order, onRow = id => App.personModal(id), quiet = false }) {
  const s = vm.shares;
  const ordered = order || payoutOrder(s.perPerson);
  const rem = s.leftover > 0 ? (remBills || {}) : {};
  const colTotal = d => ordered.reduce((t, p) => t + ((byPerson[p.id] || {})[d] || 0), 0) + (rem[d] || 0);
  const used = DENOMS.filter(d => colTotal(d) > 0);
  const cols = used.length ? used : DENOMS;
  const grand = ordered.reduce((t, p) => t + p.final, 0) + s.leftover;
  const count = (d, v) => v > 0
    ? html`<span data-d=${d} class="bill-col">${v}</span>`
    : html`<span class="text-ink-3/40">–</span>`;
  const head = d => html`<span data-d=${d} class="bill-col tracking-normal" aria-label=${'$' + d}>$${d}</span>`;
  const pay = (v, tone, d) => html`<span class="relative inline-block"><${Money} value=${v} class=${cx('font-semibold', tone)} />${d && html`<${Delta} d=${d} under />`}</span>`;
  const stackNote = id => {
    const st = vm.stacks?.[id];
    if (!st) return '';
    const k = Object.values(st).reduce((t, x) => t + x, 0);
    return html`<span class="t-small block leading-tight text-accent">${k} ${k === 1 ? 'stack' : 'stacks'}</span>`;
  };
  // A person's colour as a dot (not an avatar): the name gets the room.
  const label = (dot, text, sub = '') => html`<span class="flex min-w-0 items-center gap-2">${dot}<span class="flex min-w-0 flex-col"><span class="truncate">${text}</span>${sub}</span></span>`;
  const hue = p => html`<span class="size-2.5 shrink-0 rounded-full" style=${{ background: hueVar(hueIndex(vm.state, p.id)) }}></span>`;
  const blank = html`<span class="size-2.5 shrink-0 rounded-full bg-ink-3/30"></span>`;
  return html`<${Table} fixed firstWide lines
    cols=${[{ label: 'Envelope', w: 'w-[31%]' }, ...cols.map(d => ({ head: head(d), tight: true })), { label: 'Pay', align: 'right', w: 'w-[17%]' }]}
    rows=${[
      ...ordered.map(p => ({ key: p.id, onClick: () => onRow(p.id),
        cells: [label(hue(p), p.name, stackNote(p.id)), ...cols.map(d => count(d, (byPerson[p.id] || {})[d] || 0)),
          pay(p.final, p.final > 0 ? 'text-ink' : 'text-ink-3', !quiet && payDelta(vm, p.id, p.final))] })),
      ...(s.leftover > 0 ? [{ key: 'chump', tone: 'muted', cells: [label(blank, 'Chump'), ...cols.map(d => count(d, rem[d] || 0)), pay(s.leftover, 'text-ink-2')] }] : []),
    ]}
    foot=${[label(html`<span class="size-2.5 shrink-0"></span>`, html`<span class="font-semibold">Total</span>`), ...cols.map(d => count(d, colTotal(d))), pay(grand, 'text-ink')]} />`;
}


// ── Status: exact change, or the fix card ────────────────────────────────────

function ExactChange({ vm }) {
  const notes = DENOMS.reduce((t, d) => t + (vm.bills[d] || 0), 0);
  return html`<${Banner} tone="ok" title="Exact change for everyone" sub=${`${notes} bills · ${fmtMoney(poolValue(vm.bills))} in the drawer`} />`;
}

function SmallBills({ req, pool }) {
  const minFives = Math.max(0, (req.minOneFiveValue - req.minOnes) / 5);
  const minTens = Math.max(0, (req.minOneFiveTenValue - req.minOneFiveValue) / 10);
  const row = (d, need, have, short) => ({ key: d, cells: [html`<${Denom} d=${d} />`, Math.ceil(need), have, short > 0
    ? html`<span class="font-semibold text-bad">short ${Math.ceil(short / d)}</span>`
    : html`<span class="font-semibold text-good">${have < Math.ceil(need) ? '✓ via smaller' : '✓'}</span>`] });
  return html`<${Table} cols=${[{ label: 'Small bills' }, { label: 'Need' }, { label: 'Have' }, { label: '', align: 'right' }]} rows=${[
    row(1, req.minOnes, pool[1] || 0, req.onesShort),
    row(5, minFives, pool[5] || 0, Math.max(0, req.oneFiveShort - req.onesShort)),
    row(10, minTens, pool[10] || 0, Math.max(0, req.oneFiveTenShort - req.oneFiveShort)),
  ]} />`;
}

function SwapTable({ now, deltas, after }) {
  const ds = DENOMS.filter(d => (now[d] || 0) || (after[d] || 0) || (deltas[d] || 0));
  return html`<${Table} cols=${[{ label: 'Bill' }, { label: 'Now' }, { label: 'Swap' }, { label: 'After' }]}
    rows=${ds.map(d => {
      const v = deltas[d] || 0;
      return { key: d, cells: [html`<${Denom} d=${d} />`, html`<span class="text-ink-2">${now[d] || 0}</span>`,
        html`<span class=${cx('font-semibold', v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-ink-3')}>${v === 0 ? '—' : (v > 0 ? '+' : '−') + Math.abs(v)}</span>`,
        html`<span class=${cx('font-semibold', !v && 'text-ink-2')}>${after[d] || 0}</span>`] };
    })} />`;
}

function FixCard({ vm, errMsg, plan }) {
  return html`<${Banner} tone="error" title="Bills don’t work out yet" sub=${errMsg}>
    ${smallBillsShort(vm.req) && html`<${SmallBills} req=${vm.req} pool=${vm.bills} />`}
    ${plan
      ? html`<div class="t-small font-semibold text-ink-2">Fewest bills to swap at the bar:</div>
        ${plan.trades.length > 0 && html`<ul class="flex flex-col gap-1.5">${plan.trades.map(t => html`<li class="t-body rounded-xl bg-surface px-3.5 py-2.5 font-semibold">${t}</li>`)}</ul>`}
        <${SwapTable} now=${vm.bills} deltas=${plan.deltas} after=${plan.pool} />
        <${Button} variant="primary" block icon="swap" onClick=${applyPendingTradeDown}>Apply swap to the cash count<//>`
      : html`${(vm.state.pools[0]?.cash.batches || []).length > 0 && html`<p class="t-small text-ink-2">Edit the checkpoint counts on Tips to keep each batch intact.</p>`}<${Button} block onClick=${() => App.tab('tips')}>${vm.state.pools.length > 1 ? 'Edit pool cash' : 'Edit the cash count'}<//>`}
  <//>`;
}

// ── Working: how the split was worked out (single pool) ──────────────────────

function hoursDecimals(values) {
  const need = values.reduce((m, h) => Math.max(m, (fmtHrs(h).split('.')[1] || '').length), 0);
  return Math.max(1, need);
}
const cents = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Worksheet({ vm }) {
  const s = vm.shares;
  const pool = s.perPool[0];
  if (!pool || vm.state.pools.length !== 1) return null;
  const ordered = payoutOrder(s.perPerson);
  const dp = hoursDecimals([...ordered.map(p => p.hours), s.totalHours]);
  const h = v => v.toFixed(dp);

  const sup = pool.support && pool.support.hours > 0 ? pool.support : null;
  const tipped = ordered.filter(p => p.hours > 0 && !(sup && p.role === 'support'));
  const supPeople = sup ? ordered.filter(p => p.role === 'support' && p.hours > 0) : [];

  const V = '[&_b]:font-semibold [&_b]:text-ink-2';
  const steps = [];
  const step = (label, body) => steps.push({ label, body });

  step(sup ? 'Add up bar & server hours' : 'Add up everyone’s hours',
    html`<div class=${V}>${tipped.map(p => h(p.hours)).join(' + ')} = <b>${h(tipped.reduce((t, p) => t + p.hours, 0))} h</b></div>`);
  if (sup) {
    step('Take out the support tip-out', html`
      <div class=${V}>$${sup.rate.toFixed(4)}/hr × ${h(sup.hours)} h = <b>−$${cents(sup.cut)}</b></div>
      <div class=${V}>$${cents(pool.total)} − $${cents(sup.cut)} = <b>$${cents(pool.tippedTotal)}</b> to share</div>`);
  }
  step('Divide the pool by the hours',
    html`<div class=${V}>$${cents(sup ? pool.tippedTotal : pool.total)} ÷ ${h(pool.tippedHours)} h = <b>$${pool.rate.toFixed(4)}/hr</b></div>`);

  // Each person's line is the Each person table right under this list.
  step('Hours × rate, rounded down to whole dollars',
    html`<div class=${V}>Each person’s hours × <b>$${pool.rate.toFixed(4)}/hr</b>${supPeople.length ? html` (support × $${sup.rate.toFixed(4)}/hr)` : ''} — the table below</div>`);

  const bonusSum = ordered.reduce((t, p) => t + p.bonus, 0);
  if (s.remainder > 0) {
    const closers = ordered.filter(p => p.bonus > 0);
    const where = [
      bonusSum > 0 ? `${fmtMoney(bonusSum)} to ${s.bonusMode === 'manual' ? 'bonuses' : closers.length === 1 ? 'the closer' : `the closers (${fmtMoney(closers[0].bonus)} each)`}` : '',
      s.leftover > 0 ? `${fmtMoney(s.leftover)} stays in the drawer` : '',
    ].filter(Boolean).join(' · ');
    step('Share out the dollars left over', html`
      <div class=${V}>${fmtMoney(s.totalCash)} − ${fmtMoney(ordered.reduce((t, p) => t + p.base, 0))} rounded = <b>${fmtMoney(s.remainder)}</b></div>
      <div class=${V}>${where}</div>`);
  }

  // The same rows as every list: a numbered disc, the step, its sum under it.
  return html`<${Section} title="How the split works" aside=${html`<span class="font-semibold text-good">$${pool.rate.toFixed(2)}/hr</span>`}>
    <${List}>${steps.map((st, i) => html`<${Item} key=${i} chevron=${false}
      lead=${html`<span class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 font-semibold text-ink-2">${i + 1}</span>`}
      title=${st.label} sub=${html`<span class="flex flex-col tabular-nums">${st.body}</span>`} />`)}<//>
  <//>`;
}

// ── Render ───────────────────────────────────────────────────────────────────

// One page: bills status / fix → envelopes → tidy-up → how the split works
// (or the pools list with several pools).
// ── Envelopes already made, then the register over / short ─────────────────
// The envelopes were stuffed from the split before the adjustment; rather
// than start over, each one is fixed:
//   over   the register has the extra cash, and change: each envelope gets
//          what it's due from the register, and one that went down takes
//          out the fewest bills, with change back (envelopeFixes)
//   short  the register has no change to give: everyone who owes puts exact
//          bills in, or they put in together and square up hand to hand —
//          anyone who gained is paid by someone who owes (shortFixes)
const fixCache = new WeakMap();
function fixesFor(vm) {
  if (!vm.sharesBefore) return null;
  if (fixCache.has(vm)) return fixCache.get(vm);
  const b = vm.sharesBefore;
  const people = b.perPerson.filter(p => p.final > 0).map(p => ({ id: p.id, final: p.final }));
  const drawer = drawerBills(vm.pools.map(p => ({ ...p, adjust: 0 })), people, b.leftover);
  const dist = distribute(people, drawer.bills, b.leftover);
  const before = { byPerson: dist.byPerson, pay: Object.fromEntries(people.map(p => [p.id, p.final])) };
  const now = Object.fromEntries(vm.shares.perPerson.filter(p => p.final > 0).map(p => [p.id, p.final]));
  const out = dist.error ? null
    : vm.adjust < 0 ? { short: true, ...shortFixes(before, now), before, now }
    : { short: false, ...envelopeFixes(before, now) };
  fixCache.set(vm, out);
  return out;
}
// "−$10" / "+$1×2" bill pills in the bill's tint.
const BillPills = ({ bills, sign = '' }) => DENOMS.filter(d => bills[d] > 0).map(d => html`<span key=${sign + d} class="billtag" data-d=${d}>${sign}$${d}${bills[d] > 1 && html`<i>×${bills[d]}</i>`}</span>`);
const STEP = 't-small w-20 shrink-0 text-ink-3';

function FixBody({ vm }) {
  const fx = fixesFor(vm);
  if (!fx) return html`<div class="t-body py-8 text-center text-ink-3">Nothing to fix.</div>`;
  const name = id => vm.shares.perPerson.find(p => p.id === id)?.name || vm.sharesBefore?.perPerson.find(p => p.id === id)?.name || '?';
  const a = vm.adjust;
  const head = html`<p class="t-small px-1 text-ink-3">Register ${a < 0 ? 'short' : 'over'} ${fmtMoney(Math.abs(a))} after the envelopes were made. ${fx.short
    ? 'The register has no change to give — everyone squares up with the bills already in their envelopes.'
    : 'The register has the extra cash and can make change.'}</p>`;
  const total = html`<div class="t-body flex justify-between gap-3 rounded-card bg-surface px-4 py-3 font-semibold">
    <span>${fx.register >= 0 ? 'Into the register' : 'Out of the register'}</span><span class="tabular-nums">${fmtMoney(Math.abs(fx.register))}</span></div>`;
  if (!fx.short) {
    return html`${head}<${List}>${fx.rows.map(r => html`<div key=${r.id} class="li flex flex-col gap-1.5 px-4 py-2.5" style=${{ '--inset': '1rem' }}>
      <span class="flex items-baseline justify-between gap-3">
        <span class="t-body truncate">${name(r.id)}</span>
        <span class="t-small shrink-0 tabular-nums text-ink-3">${fmtMoney(r.was)} → <b class="font-semibold text-ink">${fmtMoney(r.now)}</b>
          <span class=${r.d < 0 ? 'text-bad' : 'text-good'}> ${r.d < 0 ? '−' : '+'}$${Math.abs(r.d)}</span></span>
      </span>
      ${Object.keys(r.out).length > 0 && html`<span class="flex flex-wrap items-center gap-1"><span class=${STEP}>Take out</span><${BillPills} bills=${r.out} sign="−" /></span>`}
      ${Object.keys(r.back).length > 0 && html`<span class="flex flex-wrap items-center gap-1"><span class=${STEP}>Get back</span><${BillPills} bills=${r.back} sign="+" /></span>`}
      ${Object.keys(r.add).length > 0 && html`<span class="flex flex-wrap items-center gap-1"><span class=${STEP}>From register</span><${BillPills} bills=${r.add} sign="+" /></span>`}
    </div>`)}<//>${total}`;
  }
  // Short: per person — what they put in the register, what they hand to / get from whom.
  const ids = [...new Set([...Object.keys(fx.before.pay), ...Object.keys(fx.now)])].filter(id => (fx.now[id] || 0) !== (fx.before.pay[id] || 0));
  return html`${head}<${List}>${ids.map(id => {
    const was = fx.before.pay[id] || 0, now = fx.now[id] || 0, d = now - was;
    const mine = fx.moves.filter(m => m.from === id || m.to === id);
    const notes = fx.notes.filter(n => n.id === id);
    return html`<div key=${id} class="li flex flex-col gap-1.5 px-4 py-2.5" style=${{ '--inset': '1rem' }}>
      <span class="flex items-baseline justify-between gap-3">
        <span class="t-body truncate">${name(id)}</span>
        <span class="t-small shrink-0 tabular-nums text-ink-3">${fmtMoney(was)} → <b class="font-semibold text-ink">${fmtMoney(now)}</b>
          <span class=${d < 0 ? 'text-bad' : 'text-good'}> ${d < 0 ? '−' : '+'}$${Math.abs(d)}</span></span>
      </span>
      ${mine.map((m, k) => html`<span key=${k} class="flex flex-wrap items-center gap-1">
        <span class=${STEP}>${m.from === id ? (m.to === 'register' ? 'Put in' : 'Give ' + name(m.to)) : 'Get from ' + name(m.from)}</span>
        <${BillPills} bills=${m.bills} sign=${m.from === id ? '−' : '+'} /></span>`)}
      ${notes.map((n, k) => html`<span key=${'n' + k} class="t-small text-warn">${n.text}</span>`)}
    </div>`;
  })}<//>${total}`;
}

// ── Stacks for managers ──────────────────────────────────────────────────────
// Whole stacks of small bills ($50 of $1s, $150 of $5s by default — sizes
// are an app preference) go to the people picked here, who can trade them
// up; everyone else's envelope still comes out exact (stacks.js).
function stacksSub(vm) {
  const takers = vm.state.overrides.stackTo || [];
  const sizes = vm.stackSizes || STACK_DEFAULTS;
  const name = id => vm.shares.perPerson.find(p => p.id === id)?.name || '?';
  const given = Object.entries(vm.stacks || {});
  const what = by => Object.entries(by).map(([d, k]) => k + ' × ' + fmtMoney(sizes[d]) + ' of $' + d + 's').join(' · ');
  return given.length ? given.map(([id, by]) => name(id) + ': ' + what(by)).join(' · ')
    : takers.length ? 'No stacks fit — the others need these bills for exact change' : 'Whole stacks of $1s / $5s to someone who can trade them up';
}
function StacksBody({ vm }) {
  const takers = vm.state.overrides.stackTo || [];
  const sizes = vm.stackSizes || STACK_DEFAULTS;
  const people = payoutOrder(vm.shares.perPerson).filter(p => p.final > 0);
  const chip = on => cx('t-small inline-flex h-[var(--tap)] items-center gap-1.5 rounded-full px-3.5 font-semibold transition active:scale-95', on ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2');
  return html`<p class="t-small px-1 text-ink-3">${stacksSub(vm)}</p>
    <div class="flex flex-col gap-2">
      <span class="t-small px-1 text-ink-2">Who takes the stacks</span>
      <div class="flex flex-wrap gap-2">${people.map(p => html`<button key=${p.id} class=${chip(takers.includes(p.id))}
        aria-pressed=${String(takers.includes(p.id))} onClick=${() => App.toggleStackTo(p.id)}>
        ${takers.includes(p.id) && html`<${Icon} name="check" class="size-4" />`}${p.name}</button>`)}</div>
    </div>
    <div class="flex flex-col gap-2">
      <span class="t-small px-1 text-ink-2">A stack is <span class="font-normal text-ink-3">· 0 = don’t bundle</span></span>
      <div class="grid grid-cols-3 gap-2">${STACK_BILLS.map(d => html`<label key=${d} class="flex flex-col gap-1">
        <span class="t-small px-1 text-ink-3">$${d}s</span>
        <span class="relative"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
          <input class="h-11 w-full rounded-xl bg-surface pl-7 pr-2 text-[1rem] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-accent/40"
            inputmode="numeric" placeholder=${String(STACK_DEFAULTS[d])} value=${vm.state.settings.stacks?.[d] ?? ''}
            aria-label=${'Stack of $' + d + 's, in dollars'} onInput=${e => App.setStackSize(d, e.target.value)} /></span>
        <span class="t-small px-1 text-ink-3">${sizes[d] > 0 ? sizes[d] / d + ' bills' : 'off'}</span>
      </label>`)}</div>
    </div>`;
}

function TidyBody({ vm, plan }) {
  if (!plan) return html`<div class="t-body py-8 text-center text-ink-3">The drawer is already tidy.</div>`;
  return html`<p class="t-small px-1 text-ink-3">Swap the extra small bills for ${plan.new20s} × $20 — everyone still gets exact change.</p>
    <${SwapTable} now=${vm.bills} deltas=${plan.delta} after=${plan.newPool} />
    <${Button} variant="primary" block onClick=${() => { applyPendingTradeUp(); App.back(); }}>Apply to the cash count<//>`;
}

// The distribution extras are full Pay subpages, so they keep their place in
// the navigation stack and have a proper back affordance.
export function openPayoutPage(which) {
  if (!currentVm || currentVm.blocked) return;
  const pages = {
    fix: { title: 'Envelopes already made', body: vm => html`<${FixBody} vm=${vm} />` },
    stacks: { title: 'Stacks for a manager', body: vm => html`<${StacksBody} vm=${vm} />` },
    tidy: { title: 'Tidy the drawer', body: vm => html`<${TidyBody} vm=${vm} plan=${pendingTradeUp} />` },
  };
  const page = pages[which];
  if (page) pushPage({ key: 'pay:' + which, ...page }, 'pay');
}

function Extras({ vm, tradeUp }) {
  const fx = fixesFor(vm);
  const a = vm.adjust;
  const given = Object.keys(vm.stacks || {}).length > 0;
  return html`<${List}>
    ${fx && (fx.rows?.length || fx.moves?.length) && html`<${Item} icon="envelope" title="Envelopes already made?"
      sub=${'Register ' + (a < 0 ? 'short ' : 'over ') + fmtMoney(Math.abs(a)) + (a < 0 ? ' — square up from the envelopes' : ' — top up from the register')}
      onClick=${() => App.openPayoutPage('fix')} />`}
    <${Item} icon="cash" title="Stacks for a manager" sub=${stacksSub(vm)} tone=${given ? 'active' : ''} onClick=${() => App.openPayoutPage('stacks')} />
    ${tradeUp && html`<${Item} icon="swap" title="Tidy the drawer" sub=${'Swap extra small bills for ' + tradeUp.new20s + ' × $20'} onClick=${() => App.openPayoutPage('tidy')} />`}
  <//>`;
}

function Payout({ vm, errMsg, tradeDown, tradeUp }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  const warnings = vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`);
  return html`<div class="flex flex-col gap-4">
    ${warnings}
    ${errMsg ? html`<${FixCard} vm=${vm} errMsg=${errMsg} plan=${tradeDown} />` : html`<${ExactChange} vm=${vm} />`}
    ${vm.state.settings.show?.bestBills !== false && html`<${Suggested} vm=${vm} />`}
    <${Section} title="Tools"><${Extras} vm=${vm} tradeUp=${tradeUp} /><//>
  </div>`;
}

function prepare(vm) {
  currentVm = vm;
  let errMsg = '';
  pendingTradeUp = pendingTradeDown = null;
  if (!vm.blocked) {
    errMsg = distErrorText(vm);
    const canTrade = tradesEnabled(vm);
    pendingTradeDown = errMsg && canTrade ? breakPlan(vm) : null;
    pendingTradeUp = !errMsg && canTrade ? safeTradeUp(vm) : null;
  }
  return { errMsg, tradeDown: pendingTradeDown, tradeUp: pendingTradeUp };
}

export function DistributionTools({ vm }) {
  const { errMsg, tradeDown, tradeUp } = prepare(vm);
  return html`<${Payout} vm=${vm} errMsg=${errMsg} tradeDown=${tradeDown} tradeUp=${tradeUp} />`;
}

// Kept as a render-loop hook: it refreshes the plans used by an open Pay
// subpage even while the Bills tab itself is not visible.
export function renderPayout(vm) {
  prepare(vm);
}
