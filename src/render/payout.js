// Payout tab (Preact) — the cash side (the people side is the Summary tab,
// render/summary.js). Two swipeable sub-tabs:
//   Bills    status (exact change ✓ / fix card with Apply) → envelope table:
//            name · one column per bill size · pay, chump, drawer totals
//            → "Tidy the drawer".
//   Working  how the split was worked out, step by step (single pool), or
//            the pools list (several pools).

import { DENOMS, fmtHrs, fmtMoney, payoutOrder, poolValue } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { planMakeChange, computeTradeUp, distribute } from '../engine.js';
import { updatePool } from '../store.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Card, Button, Alert, Money, Denom, Blocked, Banner, Section, Row, Sentinel, zebra } from '../ui/pkit.js';
import { invalidateTips } from './tips.js';

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
    pool.cash.entryMode = 'perbill';
    DENOMS.forEach(d => { pool.cash.billCounts[d] = (newPool[d] || 0) > 0 ? String(newPool[d]) : ''; });
  });
  invalidateTips();   // the Tips inputs must show the new counts
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

function Envelopes({ vm, byPerson, remBills, note }) {
  const s = vm.shares;
  const ordered = payoutOrder(s.perPerson);
  const rem = s.leftover > 0 ? (remBills || {}) : {};
  const colTotal = d => ordered.reduce((t, p) => t + ((byPerson[p.id] || {})[d] || 0), 0) + (rem[d] || 0);
  const cols = DENOMS.filter(d => colTotal(d) > 0);
  const grand = ordered.reduce((t, p) => t + p.final, 0) + s.leftover;

  const V = 'border-l border-sep';
  const nameTd = 'truncate py-2.5 pl-3 pr-1 text-left';
  const payTd = cx(V, 'py-2.5 pl-0.5 pr-3 text-right');
  const Bill = ({ n }) => html`<td class=${cx(V, 'px-0 py-2.5 text-center font-rounded', n > 0 ? 'font-bold' : 'text-ink-3/40')}>${n > 0 ? n : '–'}</td>`;

  return html`<${Section} title="Envelopes" aside=${note}><${Card} flush>
    <${Sentinel} />
    <table class="w-full table-fixed border-collapse whitespace-nowrap text-[0.9375rem] tabular-nums max-[23.375rem]:text-[0.8125rem]">
      <colgroup><col class="w-[28%]" />${cols.map(d => html`<col key=${d} />`)}<col class="w-[20%]" /></colgroup>
      <thead class="thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--color-sep)] [&_th]:transition-[padding] data-[stuck]:[&_th]:py-0.5"><tr class="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-3">
        <th class=${cx(nameTd, 'py-1.5 font-semibold')}>Name</th>
        ${cols.map(d => html`<th key=${d} class=${cx(V, 'bill-col py-1.5 text-center text-[0.6875rem] normal-case tracking-tight')} data-d=${d}>${d}</th>`)}
        <th class=${cx(payTd, 'py-1.5 font-semibold')}>Pay</th>
      </tr></thead>
      <tbody>
        ${ordered.map((p, i) => {
          const b = byPerson[p.id] || {};
          return html`<tr key=${p.id} class=${cx('cursor-pointer transition active:bg-raised', zebra(i))} onClick=${() => App.personModal(p.id)}>
            <td class=${cx(nameTd, 'font-semibold')}>${p.name}</td>
            ${cols.map(d => html`<${Bill} key=${d} n=${b[d] || 0} />`)}
            <td class=${payTd}><${Money} value=${p.final} class=${cx('font-rounded font-bold', !(p.final > 0) && 'text-ink-3')} /></td>
          </tr>`;
        })}
        ${s.leftover > 0 && html`<tr class=${cx('text-ink-2', zebra(ordered.length))}>
          <td class=${nameTd}>Chump</td>
          ${cols.map(d => html`<${Bill} key=${d} n=${rem[d] || 0} />`)}
          <td class=${payTd}><${Money} value=${s.leftover} class="font-semibold" /></td>
        </tr>`}
      </tbody>
      <tfoot><tr class="border-t border-white/15 bg-raised">
        <td class=${cx(nameTd, 'text-[0.6875rem] font-bold uppercase tracking-wider text-ink-2')}>Total</td>
        ${cols.map(d => html`<td key=${d} class=${cx(V, 'bill-col px-0 py-2.5 text-center')} data-d=${d}>${colTotal(d)}</td>`)}
        <td class=${payTd}><${Money} value=${grand} class="font-rounded text-[0.875rem] font-bold text-gold" /></td>
      </tr></tfoot>
    </table>
  <//><//>`;
}

// ── Status: exact change, or the fix card ────────────────────────────────────

function ExactChange({ vm }) {
  const notes = DENOMS.reduce((t, d) => t + (vm.bills[d] || 0), 0);
  return html`<${Banner} tone="ok" title="Exact change for everyone" sub=${`${notes} bills · ${fmtMoney(poolValue(vm.bills))} in the drawer`} />`;
}

function SmallBills({ req, pool }) {
  const minFives = Math.max(0, (req.minOneFiveValue - req.minOnes) / 5);
  const minTens = Math.max(0, (req.minOneFiveTenValue - req.minOneFiveValue) / 10);
  const Row = ({ d, need, have, short }) => html`<div class="grid grid-cols-[3.5rem_1fr_1fr_auto] items-center gap-2 py-2 text-[0.9375rem]">
    <${Denom} d=${d} /><span class="text-ink-2">need ${Math.ceil(need)}</span><span class="text-ink-2">have ${have}</span>
    <span class="justify-self-end">${short > 0
      ? html`<span class="rounded-full bg-red/15 px-2.5 py-0.5 text-[0.8125rem] font-semibold text-red">short ${Math.ceil(short / d)}</span>`
      : html`<span class="rounded-full bg-green/15 px-2.5 py-0.5 text-[0.8125rem] font-semibold text-green">${have < Math.ceil(need) ? '✓ via smaller' : '✓ ok'}</span>`}</span>
  </div>`;
  return html`<div class="rounded-2xl bg-black/20 px-3.5 py-1.5">
    <div class="pt-1.5 text-[0.8125rem] font-semibold text-ink-2">Small bills needed</div>
    <div class="divide-y divide-sep">
      <${Row} d=${1} need=${req.minOnes} have=${pool[1] || 0} short=${req.onesShort} />
      <${Row} d=${5} need=${minFives} have=${pool[5] || 0} short=${Math.max(0, req.oneFiveShort - req.onesShort)} />
      <${Row} d=${10} need=${minTens} have=${pool[10] || 0} short=${Math.max(0, req.oneFiveTenShort - req.oneFiveShort)} />
    </div>
  </div>`;
}

// Swap preview, one row per bill size: Bill · Now · Swap · After.
function SwapTable({ now, deltas, after }) {
  const rows = DENOMS.filter(d => (now[d] || 0) || (after[d] || 0) || (deltas[d] || 0));
  return html`<div class="rounded-2xl bg-black/20 px-3.5 py-1">
    <div class="grid grid-cols-[1.1fr_1fr_1fr_1fr] pb-1 pt-2 text-center text-[0.8125rem] font-medium text-ink-2"><span class="text-left">Bill</span><span>Now</span><span>Swap</span><span>After</span></div>
    <div class="divide-y divide-sep">${rows.map(d => {
      const v = deltas[d] || 0;
      return html`<div key=${d} class="grid grid-cols-[1.1fr_1fr_1fr_1fr] items-center py-2 text-center text-[1.0625rem] font-semibold tabular-nums">
        <span class="text-left"><${Denom} d=${d} /></span>
        <span class="text-ink-2">${now[d] || 0}</span>
        <span class=${v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-ink-3'}>${v === 0 ? '—' : (v > 0 ? '+' : '−') + Math.abs(v)}</span>
        <span class=${v ? 'text-gold' : ''}>${after[d] || 0}</span>
      </div>`;
    })}</div>
  </div>`;
}

function FixCard({ vm, errMsg, plan }) {
  return html`<${Banner} tone="error" title="Bills don’t work out yet" sub=${errMsg}>
    ${smallBillsShort(vm.req) && html`<${SmallBills} req=${vm.req} pool=${vm.bills} />`}
    ${plan
      ? html`<div class="text-[0.875rem] font-semibold text-ink-2">Fewest bills to swap at the bar:</div>
        ${plan.trades.length > 0 && html`<ul class="flex flex-col gap-1.5">${plan.trades.map(t => html`<li class="rounded-xl bg-black/20 px-3.5 py-2.5 text-[1rem] font-semibold">${t}</li>`)}</ul>`}
        <${SwapTable} now=${vm.bills} deltas=${plan.deltas} after=${plan.pool} />
        <${Button} variant="primary" block icon="swap" onClick=${applyPendingTradeDown}>Apply swap to the cash count<//>`
      : html`<${Button} block onClick=${() => App.tab('tips')}>${vm.state.pools.length > 1 ? 'Edit pool cash' : 'Edit the cash count'}<//>`}
  <//>`;
}

function TidyDrawer({ vm, plan }) {
  return html`<details class="group rounded-card bg-surface">
    <summary class="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
      <span class="grid size-8 place-items-center rounded-lg bg-white/8 text-ink"><${Icon} name="swap" class="size-[1.125rem]" /></span>
      <span class="flex-1"><span class="block font-semibold">Tidy the drawer</span><span class="text-[0.8125rem] text-ink-2">Swap extra small bills for ${plan.new20s} × $20</span></span>
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

  const V = 'text-[0.875rem] leading-snug text-ink-2 [&_b]:font-bold [&_b]:text-ink';
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
    <span class="py-1.5 pl-2 text-right font-bold text-ink">${p.base}${p.bonus > 0 && html`<em class="ml-0.5 text-[0.75rem] not-italic text-red">+${p.bonus}</em>`}</span>`;
  step('Hours × rate, rounded down to whole dollars',
    html`<div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] whitespace-nowrap rounded-xl bg-fill-2 px-2.5 py-0.5 text-[0.8125rem] text-ink-2 max-[23.375rem]:text-[0.75rem]">
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

  return html`<${Section} title="How the split works" aside=${html`<span class="font-rounded text-[0.9375rem] font-bold text-green">$${pool.rate.toFixed(2)}/hr</span>`}>
  <${Card}>
    <ol class="flex flex-col gap-4">
      ${steps.map((st, i) => html`<li key=${i} class="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5">
        <span class="grid size-[1.375rem] place-items-center rounded-full bg-gold text-[0.75rem] font-bold text-gold-ink">${i + 1}</span>
        <div class="flex min-w-0 flex-col gap-1"><div class="text-[0.875rem] font-semibold">${st.label}</div>${st.body}</div>
      </li>`)}
    </ol>
  <//><//>`;
}

function PoolsList({ vm }) {
  return html`<${Section} title="Pools"><${Card} flush>${vm.shares.perPool.map(p => html`<${Row} key=${p.id} title=${p.label}
    sub=${`${fmtTimeAbs(p.startAbs)}–${fmtTimeAbs(p.endAbs)} · ${fmtHrs(p.tippedHours)}h${p.tippedHours > 0 ? ' · $' + p.rate.toFixed(2) + '/hr' : ''}${p.support?.cut > 0 ? ' · −' + fmtMoney(p.support.cut) + ' support' : ''}`}
    trail=${html`<span class="font-rounded text-[1.375rem] font-bold tracking-tight">${fmtMoney(p.total)}</span>`} />`)}<//><//>`;
}

// ── Render ───────────────────────────────────────────────────────────────────

// One page: bills status / fix → envelopes → tidy-up → how the split works
// (or the pools list with several pools).
function Payout({ vm, errMsg, tradeDown, tradeUp }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  const warnings = vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`);
  // Bill columns: the real envelopes, else the swap preview, else none.
  const bills = !errMsg && vm.dist
    ? { ...vm.dist, note: 'tap a name for details' }
    : tradeDown
      ? { ...tradeDown, note: 'shown after the swap' }
      : { byPerson: {}, remainderBills: {}, note: 'bills don’t work out yet' };
  return html`<div class="flex flex-col gap-4">
    ${warnings}
    ${errMsg ? html`<${FixCard} vm=${vm} errMsg=${errMsg} plan=${tradeDown} />` : html`<${ExactChange} vm=${vm} />`}
    <${Envelopes} vm=${vm} byPerson=${bills.byPerson} remBills=${bills.remainderBills} note=${bills.note} />
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
