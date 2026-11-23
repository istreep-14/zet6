// Payout tab (Preact) — the cash side (the people side is the Summary tab,
// render/summary.js). Two swipeable sub-tabs:
//   Bills    status (exact change ✓ / fix card with Apply) → envelope table:
//            name · one column per bill size · pay, chump, drawer totals
//            → "Tidy the drawer".
//   Working  how the split was worked out, step by step (single pool), or
//            the pools list (several pools).

import { DENOMS, fmtHrs, fmtMoney, payoutOrder, poolValue } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { planMakeChange, computeTradeUp, distribute, drawerBills } from '../engine.js';
import { envelopeFixes } from '../fixups.js';
import { STACK_BILLS, STACK_DEFAULTS } from '../stacks.js';
import { updatePool } from '../store.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Card, Button, Alert, Money, Denom, Blocked, Banner, Section, List, Item, Table, Sentinel, zebra, Delta, ToolChips } from '../ui/pkit.js';
import { payDelta } from '../ui/changes.js';

const $ = id => document.getElementById(id);

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
const tradesEnabled = vm => vm.state.pools.length === 1;

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
  updatePool(vm.state.pools[0].id, pool => {
    // The swapped drawer is now fully counted: the rest and any register
    // over / short are folded into these counts.
    pool.cash.entryMode = 'mixed';
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

// ── Envelopes table: name · one equal column per bill size in use · pay ─────
// Chump row, then a Total row with the drawer's bill counts and the grand
// total. table-fixed so it always fits the card; no sideways scroll.

const BILL_HEAD = 'bill-col inline-block min-w-[1.75rem] rounded-md bg-[color-mix(in_srgb,var(--dc)_14%,transparent)] px-1 py-0.5 normal-case tracking-tight';
// The envelope grid on its own (Payout's Envelopes, Summary's Bills view):
// `order` = the people in row order (default payoutOrder). A person taking
// bundled stacks (vm.stacks) says so under their name.
export function EnvelopeTable({ vm, byPerson, remBills, order }) {
  const s = vm.shares;
  const ordered = order || payoutOrder(s.perPerson);
  const rem = s.leftover > 0 ? (remBills || {}) : {};
  const colTotal = d => ordered.reduce((t, p) => t + ((byPerson[p.id] || {})[d] || 0), 0) + (rem[d] || 0);
  const cols = DENOMS.filter(d => colTotal(d) > 0);
  const grand = ordered.reduce((t, p) => t + p.final, 0) + s.leftover;
  const n = v => v > 0 ? html`<span class="font-semibold">${v}</span>` : html`<span class="text-ink-3/40">–</span>`;
  // Bill heads / drawer totals: the bill's tint on a faint wash of it (BILL_HEAD).
  const head = (d, v) => html`<span class=${BILL_HEAD} data-d=${d}>${v}</span>`;
  const pay = p => html`<span class="relative inline-block"><${Money} value=${p.final} class=${cx('font-semibold', !(p.final > 0) && 'text-ink-3')} /><${Delta} d=${payDelta(vm, p.id, p.final)} under /></span>`;
  const stackNote = id => {
    const st = vm.stacks?.[id];
    if (!st) return '';
    const k = Object.values(st).reduce((t, x) => t + x, 0);
    return html`<span class="t-small block font-normal leading-tight text-accent">${k} ${k === 1 ? 'stack' : 'stacks'}</span>`;
  };
  return html`<${Table} fixed lines
    cols=${[{ label: 'Name', w: 'w-[28%]' }, ...cols.map(d => ({ head: head(d, d) })), { label: 'Pay', align: 'right', w: 'w-[22%]' }]}
    rows=${[
      ...ordered.map(p => ({ key: p.id, onClick: () => App.personModal(p.id),
        cells: [html`<span class="block truncate">${p.name}</span>${stackNote(p.id)}`, ...cols.map(d => n((byPerson[p.id] || {})[d] || 0)), pay(p)] })),
      ...(s.leftover > 0 ? [{ key: 'chump', tone: 'muted', cells: ['Chump', ...cols.map(d => n(rem[d] || 0)), html`<${Money} value=${s.leftover} class="font-semibold" />`] }] : []),
    ]}
    foot=${['Total', ...cols.map(d => head(d, colTotal(d))), html`<${Money} value=${grand} />`]} />`;
}

function Envelopes({ vm, byPerson, remBills, note }) {
  return html`<${Section} title="Envelopes" aside=${note}><${EnvelopeTable} vm=${vm} byPerson=${byPerson} remBills=${remBills} /><//>`;
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
      : html`<${Button} block onClick=${() => App.tab('tips')}>${vm.state.pools.length > 1 ? 'Edit pool cash' : 'Edit the cash count'}<//>`}
  <//>`;
}

function TidyDrawer({ vm, plan }) {
  return html`<details class="group overflow-hidden rounded-card bg-surface">
    <summary class="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
      <span class="grid size-8 place-items-center rounded-lg bg-surface-2 text-ink-2"><${Icon} name="swap" class="size-[1.125rem]" /></span>
      <span class="flex-1"><span class="t-body block font-medium">Tidy the drawer</span><span class="t-small text-ink-3">Swap extra small bills for ${plan.new20s} × $20</span></span>
      <${Icon} name="chevD" class="size-5 text-ink-3 transition group-open:rotate-180" />
    </summary>
    <div class="flex flex-col gap-3 px-4 pb-4">
      <${SwapTable} now=${vm.bills} deltas=${plan.delta} after=${plan.newPool} />
      <${Button} variant="tonal" block onClick=${applyPendingTradeUp}>Apply to the cash count<//>
    </div>
  </details>`;
}

// ── Working: how the split was worked out (single pool) ──────────────────────

function hoursDecimals(values) {
  const need = values.reduce((m, h) => Math.max(m, (fmtHrs(h).split('.')[1] || '').length), 0);
  return Math.max(1, need);
}
const cents = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Worksheet({ vm }) {
  const s = vm.shares;
  const pool = s.perPool[0];
  if (!pool || vm.state.pools.length !== 1) return null;
  const ordered = payoutOrder(s.perPerson);
  const dp = hoursDecimals([...ordered.map(p => p.hours), s.totalHours]);
  const h = v => v.toFixed(dp);

  const sup = pool.support && pool.support.hours > 0 ? pool.support : null;
  const tipped = ordered.filter(p => p.hours > 0 && !(sup && p.role === 'support'));
  const supPeople = sup ? ordered.filter(p => p.role === 'support' && p.hours > 0) : [];

  const V = 't-small text-ink-2 [&_b]:font-semibold [&_b]:text-ink';
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

  const line = (p, rate) => html`<span class="truncate py-1.5 text-ink">${p.name}</span>
    <span class="py-1.5 pl-2 text-right">${h(p.hours)} × ${rate.toFixed(4)}</span>
    <span class="py-1.5 pl-2 text-right">= ${cents(p.exact)}</span>
    <span class="py-1.5 pl-2 text-right font-semibold text-ink">${p.base}${p.bonus > 0 && html`<em class="ml-0.5 text-[0.75rem] not-italic text-bad">+${p.bonus}</em>`}</span>`;
  step('Hours × rate, rounded down to whole dollars',
    html`<div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] whitespace-nowrap rounded-xl bg-surface-2 px-2.5 py-0.5 text-[0.8125rem] text-ink-2 max-[23.375rem]:text-[0.75rem]">
      ${tipped.map(p => line(p, pool.rate))}${supPeople.map(p => line(p, sup.rate))}</div>`);

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

  return html`<${Section} title="How the split works" aside=${html`<span class="t-small font-semibold text-good">$${pool.rate.toFixed(2)}/hr</span>`}>
  <${Card}>
    <ol class="flex flex-col gap-4">
      ${steps.map((st, i) => html`<li key=${i} class="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5">
        <span class="grid size-[1.375rem] place-items-center rounded-full bg-surface-2 text-[0.75rem] font-semibold text-ink-2">${i + 1}</span>
        <div class="flex min-w-0 flex-col gap-1"><div class="t-small font-semibold">${st.label}</div>${st.body}</div>
      </li>`)}
    </ol>
  <//><//>`;
}

function PoolsList({ vm }) {
  return html`<${Section} title="Pools"><${List}>${vm.shares.perPool.map(p => html`<${Item} key=${p.id} title=${p.label}
    sub=${`${fmtTimeAbs(p.startAbs)}–${fmtTimeAbs(p.endAbs)} · ${fmtHrs(p.tippedHours)}h${p.tippedHours > 0 ? ' · $' + p.rate.toFixed(2) + '/hr' : ''}${p.support?.cut > 0 ? ' · −' + fmtMoney(p.support.cut) + ' support' : ''}`}
    value=${fmtMoney(p.total)} />`)}<//><//>`;
}

// ── Render ───────────────────────────────────────────────────────────────────

// One page: bills status / fix → envelopes → tidy-up → how the split works
// (or the pools list with several pools).
// ── Envelopes already made, then the register over / short ─────────────────
// The envelopes were stuffed from the split before the adjustment; rather
// than start over, each one is fixed through the register: the fewest bills
// out of an envelope (change back when its bills can't make it exactly) or
// into it. Collapsed — most nights the adjustment comes before the envelopes.
const fixCache = new WeakMap();
function fixesFor(vm) {
  if (!vm.sharesBefore) return null;
  if (fixCache.has(vm)) return fixCache.get(vm);
  const b = vm.sharesBefore;
  const people = b.perPerson.filter(p => p.final > 0).map(p => ({ id: p.id, final: p.final }));
  const drawer = drawerBills(vm.pools.map(p => ({ ...p, adjust: 0 })), people, b.leftover);
  const dist = distribute(people, drawer.bills, b.leftover);
  const out = dist.error ? null : envelopeFixes(
    { byPerson: dist.byPerson, pay: Object.fromEntries(people.map(p => [p.id, p.final])) },
    Object.fromEntries(vm.shares.perPerson.filter(p => p.final > 0).map(p => [p.id, p.final])));
  fixCache.set(vm, out);
  return out;
}
// "−$10" / "+$1×2" bill pills in the bill's tint.
const BillPills = ({ bills, sign }) => DENOMS.filter(d => bills[d] > 0).map(d => html`<span key=${sign + d} class="billtag" data-d=${d}>${sign}$${d}${bills[d] > 1 && html`<i>×${bills[d]}</i>`}</span>`);

// A collapsible card: icon tile · title over a line · chevron; body when open.
function Fold({ icon, iconCls = 'bg-surface-2 text-ink-2', title, sub, children }) {
  return html`<details class="group overflow-hidden rounded-card bg-surface">
    <summary class="flex min-h-[var(--row-lg)] cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
      <span class=${cx('grid size-8 shrink-0 place-items-center rounded-lg', iconCls)}><${Icon} name=${icon} class="size-[1.125rem]" /></span>
      <span class="min-w-0 flex-1"><span class="t-body block font-medium">${title}</span><span class="t-small block text-ink-3">${sub}</span></span>
      <${Icon} name="chevD" class="size-5 shrink-0 text-ink-3 transition group-open:rotate-180" />
    </summary>
    ${children}
  </details>`;
}

function FixEnvelopes({ vm }) {
  const fx = fixesFor(vm);
  if (!fx || !fx.rows.length) return null;
  const name = id => vm.shares.perPerson.find(p => p.id === id)?.name || '?';
  const a = vm.adjust;
  const step = 't-small w-16 shrink-0 text-ink-3';
  return html`<${Fold} icon="envelope" iconCls="bg-warn/14 text-warn" title="Envelopes already made?"
    sub=${'Register ' + (a < 0 ? 'short ' : 'over ') + fmtMoney(Math.abs(a)) + ' — fix ' + fx.rows.length + ' through the register'}>
    <div class="flex flex-col divide-y divide-line border-t border-line">
      ${fx.rows.map(r => html`<div key=${r.id} class="flex flex-col gap-1.5 px-4 py-2.5">
        <span class="flex items-baseline justify-between gap-3">
          <span class="t-body truncate font-medium">${name(r.id)}</span>
          <span class="t-small shrink-0 tabular-nums text-ink-3">${fmtMoney(r.was)} → <b class="font-semibold text-ink">${fmtMoney(r.now)}</b>
            <span class=${r.d < 0 ? 'text-bad' : 'text-good'}> ${r.d < 0 ? '−' : '+'}$${Math.abs(r.d)}</span></span>
        </span>
        ${Object.keys(r.out).length > 0 && html`<span class="flex flex-wrap items-center gap-1"><span class=${step}>Take out</span><${BillPills} bills=${r.out} sign="−" /></span>`}
        ${Object.keys(r.back).length > 0 && html`<span class="flex flex-wrap items-center gap-1"><span class=${step}>Get back</span><${BillPills} bills=${r.back} sign="+" /></span>`}
        ${Object.keys(r.add).length > 0 && html`<span class="flex flex-wrap items-center gap-1"><span class=${step}>Add</span><${BillPills} bills=${r.add} sign="+" /></span>`}
      </div>`)}
      <div class="t-small flex justify-between gap-3 bg-surface-2/60 px-4 py-2.5 font-medium">
        <span>${fx.register >= 0 ? 'Into the register' : 'Out of the register'}</span>
        <span class="tabular-nums">${fmtMoney(Math.abs(fx.register))}</span>
      </div>
    </div>
  <//>`;
}

// ── Stacks for managers ──────────────────────────────────────────────────────
// Whole stacks of small bills ($50 of $1s, $150 of $5s by default — sizes
// are an app preference) go to the people picked here, who can trade them
// up; everyone else's envelope still comes out exact (stacks.js).
function Stacks({ vm }) {
  const takers = vm.state.overrides.stackTo || [];
  const sizes = vm.stackSizes || STACK_DEFAULTS;
  const people = payoutOrder(vm.shares.perPerson).filter(p => p.final > 0);
  const name = id => people.find(p => p.id === id)?.name || '?';
  const given = Object.entries(vm.stacks || {});
  const what = by => Object.entries(by).map(([d, k]) => k + ' × ' + fmtMoney(sizes[d]) + ' of $' + d + 's').join(' · ');
  const sub = given.length ? given.map(([id, by]) => name(id) + ': ' + what(by)).join(' · ')
    : takers.length ? 'No stacks fit — the others need these bills for exact change' : 'Give whole stacks of $1s / $5s to someone who can trade them up';
  const chip = on => cx('t-small inline-flex h-[var(--tap)] items-center gap-1.5 rounded-full px-3.5 font-semibold transition active:scale-95', on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2');
  return html`<${Fold} icon="cash" iconCls=${given.length ? 'bg-accent/12 text-accent' : undefined} title="Stacks for a manager" sub=${sub}>
    <div class="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-3">
      <div class="flex flex-col gap-2">
        <span class="t-small font-medium text-ink-2">Who takes the stacks</span>
        <div class="flex flex-wrap gap-2">${people.map(p => html`<button key=${p.id} class=${chip(takers.includes(p.id))}
          aria-pressed=${String(takers.includes(p.id))} onClick=${() => App.toggleStackTo(p.id)}>
          ${takers.includes(p.id) && html`<${Icon} name="check" class="size-4" />`}${p.name}</button>`)}</div>
      </div>
      <div class="flex flex-col gap-2">
        <span class="t-small font-medium text-ink-2">A stack is <span class="font-normal text-ink-3">· 0 = don’t bundle</span></span>
        <div class="grid grid-cols-3 gap-2">${STACK_BILLS.map(d => html`<label key=${d} class="flex flex-col gap-1">
          <span class="t-small text-ink-3">$${d}s</span>
          <span class="relative"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
            <input class="h-11 w-full rounded-xl bg-surface-2 pl-7 pr-2 text-[1.0625rem] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-accent/40"
              inputmode="numeric" placeholder=${String(STACK_DEFAULTS[d])} value=${vm.state.settings.stacks?.[d] ?? ''}
              aria-label=${'Stack of $' + d + 's, in dollars'} onInput=${e => App.setStackSize(d, e.target.value)} /></span>
          <span class="t-small text-ink-3">${sizes[d] > 0 ? sizes[d] / d + ' bills' : 'off'}</span>
        </label>`)}</div>
      </div>
    </div>
  <//>`;
}

function Payout({ vm, errMsg, tradeDown, tradeUp }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  const warnings = vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`);
  // Bill columns: the real envelopes, else the swap preview, else none.
  const bills = !errMsg && vm.dist
    ? { ...vm.dist, note: 'tap a name for details' }
    : tradeDown
      ? { ...tradeDown, note: 'shown after the swap' }
      : { byPerson: {}, remainderBills: {}, note: 'bills don’t work out yet' };
  const chump = vm.shares.leftover || 0;
  return html`<div class="flex flex-col gap-4">
    ${warnings}
    <${ToolChips} items=${[
      { icon: 'gift', label: 'Bonus & chump', value: chump > 0 ? fmtMoney(chump) : '', onClick: () => App.openBonus() },
      { icon: 'clock', label: 'Close-time what-if', onClick: () => App.openCloseTime() },
    ]} />
    ${errMsg ? html`<${FixCard} vm=${vm} errMsg=${errMsg} plan=${tradeDown} />` : html`<${ExactChange} vm=${vm} />`}
    <${Envelopes} vm=${vm} byPerson=${bills.byPerson} remBills=${bills.remainderBills} note=${bills.note} />
    <${FixEnvelopes} vm=${vm} />
    <${Stacks} vm=${vm} />
    ${tradeUp && html`<${TidyDrawer} vm=${vm} plan=${tradeUp} />`}
    ${vm.state.pools.length > 1 ? html`<${PoolsList} vm=${vm} />` : html`<${Worksheet} vm=${vm} />`}
  </div>`;
}

export function renderPayout(vm) {
  currentVm = vm;
  const root = $('payout-root');
  if (!root) return;
  let errMsg = '';
  pendingTradeUp = pendingTradeDown = null;
  if (!vm.blocked) {
    errMsg = distErrorText(vm);
    const canTrade = tradesEnabled(vm);
    pendingTradeDown = errMsg && canTrade ? breakPlan(vm) : null;
    pendingTradeUp = !errMsg && canTrade ? safeTradeUp(vm) : null;
  }
  render(html`<${Payout} vm=${vm} errMsg=${errMsg}
    tradeDown=${pendingTradeDown} tradeUp=${pendingTradeUp} />`, root);
}
