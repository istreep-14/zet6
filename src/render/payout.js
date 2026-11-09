// Payout tab — the answer:
//   tally (total · rate · hours)
//   → a fix card when the drawer can't make exact change (with Apply)
//   → one table, one tight line per person: name · shift · hrs · bills · pay;
//     chump, total (hours, drawer bill counts, grand total)
//   → how the split was worked out → pools (multi-pool) → tools.

import { DENOMS, fmtHrs, fmtMoney, payoutOrder, poolValue } from '../util.js';
import { fmtTimeAbs, timeParts } from '../time.js';
import { planMakeChange, computeTradeUp, distribute } from '../engine.js';
import { updatePool } from '../store.js';
import { html, cx, mount } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { Card, Button, Alert, Empty, Label, Money, Denom, ROLE_DOT, SEP } from '../ui/kit.js';
import { invalidateTips } from './tips.js';

const $ = id => document.getElementById(id);

let currentVm = null;
let pendingTradeUp = null;
let pendingTradeDown = null;
let worksheetOpen = false;

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

// ── Pieces ───────────────────────────────────────────────────────────────────

function dateLabel(state) {
  const [, mo, dy] = state.meta.date ? state.meta.date.split('-') : [];
  return mo && dy ? `${parseInt(mo)}/${parseInt(dy)}` : '';
}

function tallyHTML(vm) {
  const s = vm.shares;
  const date = dateLabel(vm.state);
  const paid = s.perPerson.filter(p => p.final > 0).length;
  // One pool: the bar/server rate the worksheet derives (support is paid apart).
  const rate = vm.state.pools.length === 1 && s.perPool[0] ? s.perPool[0].rate : s.rate;
  return html`<div class="flex items-end justify-between gap-3 px-1">
    <div class="flex min-w-0 flex-col">
      <span class="text-[13px] font-semibold text-ink-2">Total pool${date ? ' · ' + date : ''}</span>
      <span class="mt-1 font-rounded text-[60px] font-extrabold leading-none tracking-[-.045em] max-[374px]:text-[46px]">${fmtMoney(s.totalCash)}</span>
    </div>
    <div class="flex flex-col items-end pb-1.5 text-right">
      <span class="font-rounded text-[22px] font-bold text-green">$${rate.toFixed(2)}<small class="ml-px text-[13px] font-medium text-ink-2">/hr</small></span>
      <span class="mt-0.5 whitespace-nowrap text-[14px] text-ink-2">${fmtHrs(s.totalHours)}h · ${paid} ${paid === 1 ? 'person' : 'people'}</span>
    </div>
  </div>`;
}

// ── Payout table: one tight line per person ──────────────────────────────────
// Name · Shift · Hrs · one equal column per bill size in use · Pay.
// Chump row, then a Total row with hours, the drawer's bill counts and the
// grand total. table-fixed so it always fits the card; no sideways scroll.

// Compact shift, no am/pm: "5–11:45", "5:30–12". Closers' out time in red.
function shiftHTML(p) {
  const t = x => { const q = timeParts(x); return q.h + (q.m ? ':' + q.m : ''); };
  return html`<span aria-label="${fmtTimeAbs(p.inAbs)} to ${fmtTimeAbs(p.outAbs)}">${t(p.inAbs)}–<span class="${p.closer ? 'text-red' : ''}">${t(p.outAbs)}</span></span>`;
}

function payoutTableHTML(vm, byPerson, remBills, note) {
  const s = vm.shares;
  const ordered = payoutOrder(s.perPerson);
  const rem = s.leftover > 0 ? (remBills || {}) : {};
  const colTotal = d => ordered.reduce((t, p) => t + ((byPerson[p.id] || {})[d] || 0), 0) + (rem[d] || 0);
  const cols = DENOMS.filter(d => colTotal(d) > 0);
  const grand = ordered.reduce((t, p) => t + p.final, 0) + s.leftover;

  const V = 'border-l border-sep';
  const C = 'px-0 py-2 text-center';
  const bill = n => html`<td class="${cx(V, C, 'font-rounded', n > 0 ? 'font-bold' : 'text-ink-3/40')}">${n > 0 ? n : '–'}</td>`;
  const nameTd = 'truncate py-2 pl-3 pr-1 text-left';
  const payTd = cx(V, 'py-2 pl-0.5 pr-3 text-right');

  return Card({ flush: true },
    html`<div class="flex items-baseline justify-between gap-2 px-3 pb-2 pt-3">
      <span class="text-[17px] font-bold tracking-tight">Payouts</span>
      <span class="truncate text-[12px] font-medium text-ink-2">${note}</span>
    </div>
    <table class="w-full table-fixed border-collapse whitespace-nowrap text-[14px] tabular-nums max-[374px]:text-[13px]">
      <colgroup>
        <col class="w-[21%]"><col class="w-[16%]"><col class="w-[8%]">
        ${cols.map(() => html`<col>`)}
        <col class="w-[17%]">
      </colgroup>
      <thead><tr class="border-t border-sep text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        <th class="${cx(nameTd, 'py-1.5 font-semibold')}">Name</th>
        <th class="py-1.5 text-left font-semibold">Shift</th>
        <th class="py-1.5 pr-1 text-right font-semibold">Hrs</th>
        ${cols.map(d => html`<th class="${cx(V, 'bill-col py-1.5 text-center text-[11px] normal-case tracking-tight')}" data-d="${d}">${d}</th>`)}
        <th class="${cx(payTd, 'py-1.5 font-semibold')}">Pay</th>
      </tr></thead>
      <tbody>
        ${ordered.map(p => {
          const b = byPerson[p.id] || {};
          return html`<tr class="cursor-pointer border-t border-sep transition active:bg-raised" onclick="App.personModal('${p.id}')">
            <td class="${cx(nameTd, 'font-semibold')}">${p.name}</td>
            <td class="truncate py-2 text-[12px] text-ink-2">${shiftHTML(p)}</td>
            <td class="py-2 pr-1 text-right text-ink-2">${fmtHrs(p.shiftHours ?? p.hours)}</td>
            ${cols.map(d => bill(b[d] || 0))}
            <td class="${payTd}">${Money(p.final, cx('font-rounded font-bold', !(p.final > 0) && 'text-ink-3'))}</td>
          </tr>`;
        })}
        ${s.leftover > 0 && html`<tr class="border-t border-sep text-ink-2">
          <td class="${nameTd}" colspan="3">Chump · in drawer</td>
          ${cols.map(d => bill(rem[d] || 0))}
          <td class="${payTd}">${Money(s.leftover, 'font-semibold')}</td>
        </tr>`}
      </tbody>
      <tfoot><tr class="border-t border-white/15 bg-raised">
        <td class="${cx(nameTd, 'text-[11px] font-bold uppercase tracking-wider text-ink-2')}">Total</td>
        <td></td>
        <td class="py-2 pr-1 text-right font-semibold">${fmtHrs(s.totalHours)}</td>
        ${cols.map(d => html`<td class="${cx(V, C, 'bill-col')}" data-d="${d}">${colTotal(d)}</td>`)}
        <td class="${payTd}">${Money(grand, 'font-rounded text-[13px] font-bold text-gold')}</td>
      </tr></tfoot>
    </table>`);
}

function keyHTML(people) {
  const parts = [];
  const bonuses = people.filter(p => p.bonus > 0);
  if (bonuses.length) {
    const same = bonuses.every(p => p.closer && p.bonus === bonuses[0].bonus);
    parts.push(same ? `closer pay includes +${fmtMoney(bonuses[0].bonus)} bonus` : 'pay includes bonuses');
  }
  if (new Set(people.map(p => p.role)).size > 1) {
    parts.push(html`<span class="inline-flex items-center gap-1">${['bartender', 'server', 'support'].map(r =>
      html`<i class="${cx('ml-1 size-[7px] rounded-full', ROLE_DOT[r])}"></i>${r === 'bartender' ? 'bar' : r === 'server' ? 'srv' : 'sup'} `)}</span>`);
  }
  return parts.length
    ? html`<p class="-mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[12px] text-ink-3">${parts.map((x, i) => html`${i ? ' · ' : ''}${x}`)}</p>`
    : '';
}

// ── Fix card: drawer can't make exact change ─────────────────────────────────

function reqHTML(req, pool) {
  const minFives = Math.max(0, (req.minOneFiveValue - req.minOnes) / 5);
  const minTens = Math.max(0, (req.minOneFiveTenValue - req.minOneFiveValue) / 10);
  const row = (d, need, have, valueShort) => {
    const status = valueShort > 0
      ? html`<span class="rounded-full bg-red/15 px-2.5 py-0.5 text-[13px] font-semibold text-red">short ${Math.ceil(valueShort / d)}</span>`
      : html`<span class="rounded-full bg-green/15 px-2.5 py-0.5 text-[13px] font-semibold text-green">${have < Math.ceil(need) ? '✓ via smaller' : '✓ ok'}</span>`;
    return html`<div class="grid grid-cols-[56px_1fr_1fr_auto] items-center gap-2 py-2 text-[15px]">
      ${Denom(d)}<span class="text-ink-2">need ${Math.ceil(need)}</span><span class="text-ink-2">have ${have}</span><span class="justify-self-end">${status}</span></div>`;
  };
  return html`<div class="rounded-2xl bg-black/20 px-3.5 py-1.5">
    <div class="pt-1.5 text-[13px] font-semibold text-ink-2">Small bills needed</div>
    <div class="divide-y divide-sep">
      ${row(1, req.minOnes, pool[1] || 0, req.onesShort)}
      ${row(5, minFives, pool[5] || 0, Math.max(0, req.oneFiveShort - req.onesShort))}
      ${row(10, minTens, pool[10] || 0, Math.max(0, req.oneFiveTenShort - req.oneFiveShort))}
    </div>
  </div>`;
}

// Swap preview, one row per bill size: Bill · Now · Swap · After.
function swapHTML(nowPool, deltas, afterPool) {
  const rows = DENOMS.filter(d => (nowPool[d] || 0) || (afterPool[d] || 0) || (deltas[d] || 0)).map(d => {
    const v = deltas[d] || 0;
    return html`<div class="grid grid-cols-[1.1fr_1fr_1fr_1fr] items-center py-2 text-center text-[17px] font-semibold tabular-nums">
      <span class="text-left">${Denom(d)}</span>
      <span class="text-ink-2">${nowPool[d] || 0}</span>
      <span class="${v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-ink-3'}">${v === 0 ? '—' : (v > 0 ? '+' : '−') + Math.abs(v)}</span>
      <span class="${v ? 'text-gold' : ''}">${afterPool[d] || 0}</span>
    </div>`;
  });
  return html`<div class="rounded-2xl bg-black/20 px-3.5 py-1">
    <div class="grid grid-cols-[1.1fr_1fr_1fr_1fr] pb-1 pt-2 text-center text-[13px] font-medium text-ink-2"><span class="text-left">Bill</span><span>Now</span><span>Swap</span><span>After</span></div>
    <div class="divide-y divide-sep">${rows}</div>
  </div>`;
}

function fixHTML(vm, errMsg) {
  const plan = pendingTradeDown;
  const showReq = smallBillsShort(vm.req);
  return Card({ tone: 'error', class: 'flex flex-col gap-3' },
    html`<div class="flex items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-red/20 text-red">${icon('alert', 'size-[18px]')}</span>
      <div class="flex-1">
        <div class="text-[17px] font-bold">Bills don’t work out yet</div>
        <div class="mt-0.5 text-[14px] leading-snug text-red-soft">${errMsg}</div>
      </div>
    </div>
    ${showReq && reqHTML(vm.req, vm.bills)}
    ${plan
      ? html`<div class="text-[14px] font-semibold text-ink-2">Fewest bills to swap at the bar:</div>
        ${plan.trades.length > 0 && html`<ul class="flex flex-col gap-1.5">${plan.trades.map(t => html`<li class="rounded-xl bg-black/20 px-3.5 py-2.5 text-[16px] font-semibold">${t}</li>`)}</ul>`}
        ${swapHTML(vm.bills, plan.deltas, plan.pool)}
        ${Button({ variant: 'primary', block: true, icon: 'swap', onclick: 'App.applyTradeDown()' }, 'Apply swap to the cash count')}`
      : Button({ variant: 'plain', block: true, onclick: "App.tab('tips')" }, vm.state.pools.length > 1 ? 'Edit pool cash' : 'Edit the cash count')}`);
}

function tradeUpHTML(vm) {
  const t = pendingTradeUp;
  if (!t) return '';
  return html`<details class="group rounded-card bg-surface">
    <summary class="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
      <span class="grid size-8 place-items-center rounded-lg bg-white/8 text-ink">${icon('swap', 'size-[18px]')}</span>
      <span class="flex-1"><span class="block font-semibold">Tidy the drawer</span><span class="text-[13px] text-ink-2">Swap extra small bills for ${t.new20s} × $20</span></span>
      ${icon('chevD', 'size-5 text-ink-3 transition group-open:rotate-180')}
    </summary>
    <div class="flex flex-col gap-3 px-4 pb-4">
      ${swapHTML(vm.bills, t.delta, t.newPool)}
      ${Button({ variant: 'tonal', block: true, onclick: 'App.applyTradeUp()' }, 'Apply to the cash count')}
    </div>
  </details>`;
}

// ── Worksheet: how the split was worked out (single pool) ────────────────────

function hoursDecimals(values) {
  const need = values.reduce((m, h) => Math.max(m, (fmtHrs(h).split('.')[1] || '').length), 0);
  return Math.max(1, need);
}
const cents = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function worksheetHTML(vm) {
  const s = vm.shares;
  const pool = s.perPool[0];
  if (!pool || vm.state.pools.length !== 1) return '';
  const ordered = payoutOrder(s.perPerson);
  const dp = hoursDecimals([...ordered.map(p => p.hours), s.totalHours]);
  const h = v => v.toFixed(dp);

  const sup = pool.support && pool.support.hours > 0 ? pool.support : null;
  const tipped = ordered.filter(p => p.hours > 0 && !(sup && p.role === 'support'));
  const supPeople = sup ? ordered.filter(p => p.role === 'support' && p.hours > 0) : [];

  const V = 'text-[14px] leading-snug text-ink-2 [&_b]:font-bold [&_b]:text-ink';
  const steps = [];
  const step = (label, body) => steps.push({ label, body });

  step(sup ? 'Add up bar & server hours' : 'Add up everyone’s hours',
    html`<div class="${V}">${tipped.map(p => h(p.hours)).join(' + ')} = <b>${h(tipped.reduce((t, p) => t + p.hours, 0))} h</b></div>`);
  if (sup) {
    step('Take out the support tip-out', html`
      <div class="${V}">$${sup.rate.toFixed(4)}/hr × ${h(sup.hours)} h = <b>−$${cents(sup.cut)}</b></div>
      <div class="${V}">$${cents(pool.total)} − $${cents(sup.cut)} = <b>$${cents(pool.tippedTotal)}</b> to share</div>`);
  }
  step('Divide the pool by the hours',
    html`<div class="${V}">$${cents(sup ? pool.tippedTotal : pool.total)} ÷ ${h(pool.tippedHours)} h = <b>$${pool.rate.toFixed(4)}/hr</b></div>`);

  const line = (p, rate) => html`<span class="truncate py-1.5 text-ink">${p.name}</span>
    <span class="py-1.5 pl-2 text-right">${h(p.hours)} × ${rate.toFixed(4)}</span>
    <span class="py-1.5 pl-2 text-right">= ${cents(p.exact)}</span>
    <span class="py-1.5 pl-2 text-right font-bold text-ink">${p.base}${p.bonus > 0 && html`<em class="ml-0.5 text-[12px] not-italic text-red">+${p.bonus}</em>`}</span>`;
  step('Hours × rate, rounded down to whole dollars',
    html`<div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] whitespace-nowrap rounded-xl bg-fill-2 px-2.5 py-0.5 text-[13px] text-ink-2 max-[374px]:text-[12px]">
      ${tipped.map(p => line(p, pool.rate))}${supPeople.map(p => line(p, sup.rate))}</div>`);

  const bonusSum = ordered.reduce((t, p) => t + p.bonus, 0);
  if (s.remainder > 0) {
    const closers = ordered.filter(p => p.bonus > 0);
    const where = [
      bonusSum > 0 ? `${fmtMoney(bonusSum)} to ${s.bonusMode === 'manual' ? 'bonuses' : closers.length === 1 ? 'the closer' : `the closers (${fmtMoney(closers[0].bonus)} each)`}` : '',
      s.leftover > 0 ? `${fmtMoney(s.leftover)} stays in the drawer` : '',
    ].filter(Boolean).join(' · ');
    step('Share out the dollars left over', html`
      <div class="${V}">${fmtMoney(s.totalCash)} − ${fmtMoney(ordered.reduce((t, p) => t + p.base, 0))} rounded = <b>${fmtMoney(s.remainder)}</b></div>
      <div class="${V}">${where}</div>`);
  }

  return html`<details class="ws group rounded-card bg-surface">
    <summary class="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-4 font-semibold [&::-webkit-details-marker]:hidden">
      <span class="grid size-8 place-items-center rounded-lg bg-white/8 text-ink">${icon('calc', 'size-[18px]')}</span>
      <span class="flex-1">Show the working</span>
      <span class="font-rounded font-bold text-green">$${pool.rate.toFixed(2)}/hr</span>
      ${icon('chevD', 'size-5 text-ink-3 transition group-open:rotate-180')}
    </summary>
    <ol class="flex flex-col gap-4 px-4 pb-4 pt-1">
      ${steps.map((st, i) => html`<li class="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5">
        <span class="grid size-[22px] place-items-center rounded-full bg-gold text-[12px] font-bold text-gold-ink">${i + 1}</span>
        <div class="flex min-w-0 flex-col gap-1"><div class="text-[14px] font-semibold">${st.label}</div>${st.body}</div>
      </li>`)}
    </ol>
  </details>`;
}

// ── Multi-pool ───────────────────────────────────────────────────────────────

function poolsHTML(vm) {
  const pools = vm.shares.perPool;
  return html`${Label('Pools')}
    ${Card({ flush: true }, pools.map(p => html`<div class="${cx('flex items-center gap-3 px-4 py-3.5', SEP)}">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-[17px] font-semibold">${p.label}</span>
        <span class="text-[14px] text-ink-2">${fmtTimeAbs(p.startAbs)}–${fmtTimeAbs(p.endAbs)} · ${fmtHrs(p.hours)}h${p.hours > 0 ? ' · $' + (p.total / p.hours).toFixed(2) + '/hr' : ''}</span>
      </div>
      <span class="font-rounded text-[22px] font-bold tracking-tight">${fmtMoney(p.total)}</span>
    </div>`))}`;
}

function toolsHTML() {
  const tool = 'flex h-16 items-center gap-3 whitespace-nowrap rounded-card bg-surface px-4 text-[16px] font-semibold transition active:scale-[.96] active:bg-raised max-[374px]:h-14 max-[374px]:gap-2 max-[374px]:px-3 max-[374px]:text-[15px]';
  const ic = 'grid size-9 place-items-center rounded-full bg-white/8 text-ink';
  return html`<div class="grid grid-cols-2 gap-2">
    <button class="${tool}" onclick="App.openCloseTime()"><span class="${ic}">${icon('clock')}</span>Close time</button>
    <button class="${tool}" onclick="App.openBonus()"><span class="${ic}">${icon('gift')}</span>Bonus</button>
  </div>`;
}

// ── Render ───────────────────────────────────────────────────────────────────

export function renderPayout(vm) {
  currentVm = vm;
  const root = $('payout-root');
  if (!root) return;

  if (vm.blocked) {
    pendingTradeUp = pendingTradeDown = null;
    const pristine = !vm.hasNamedStaff && vm.totalCash === 0;
    const goTips = /cash|total|count|window|support (%|\$|hours)/i.test(vm.blocked);
    mount(root, pristine
      ? Empty({ title: 'No shift yet', body: 'Add who worked, then enter the tips.', action: { label: 'Add staff', onclick: "App.tab('staff')" } })
      : html`<div class="flex flex-col gap-3">${Alert({ action: { label: 'Fix →', onclick: `App.tab('${goTips ? 'tips' : 'staff'}')` } }, vm.blocked)}</div>`);
    return;
  }

  const errMsg = distErrorText(vm);
  const canTrade = tradesEnabled(vm);
  pendingTradeDown = errMsg && canTrade ? breakPlan(vm) : null;
  pendingTradeUp = !errMsg && canTrade ? safeTradeUp(vm) : null;

  const pools = vm.shares.perPool;
  const multi = vm.state.pools.length > 1;
  // Bill columns: the real envelopes, else the swap preview, else none.
  const bills = !errMsg && vm.dist
    ? { ...vm.dist, note: 'tap a name for details' }
    : pendingTradeDown
      ? { ...pendingTradeDown, note: 'bills shown after the swap' }
      : { byPerson: {}, remainderBills: {}, note: 'bills don’t work out yet' };

  mount(root, html`<div class="flex flex-col gap-4">
    ${tallyHTML(vm)}
    ${pools.map(p => p.warning).filter(Boolean).map(w => Alert({}, w))}
    ${errMsg && fixHTML(vm, errMsg)}
    ${payoutTableHTML(vm, bills.byPerson, bills.remainderBills, bills.note)}
    ${keyHTML(payoutOrder(vm.shares.perPerson))}
    ${worksheetHTML(vm)}
    ${multi && poolsHTML(vm)}
    ${toolsHTML()}
    ${tradeUpHTML(vm)}
  </div>`);

  // Keep the worksheet open across re-renders once someone opens it.
  const ws = root.querySelector('details.ws');
  if (ws) {
    ws.open = worksheetOpen;
    ws.addEventListener('toggle', () => { worksheetOpen = ws.open; });
  }
}
