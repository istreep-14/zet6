// Bills tab (distribution, small-bill needs, trades) + Close Time sidebar.

import { DENOMS, escapeHTML, poolValue } from '../util.js';
import { parseTime } from '../time.js';
import { planMakeChange, computeTradeUp, distribute } from '../engine.js';
import { buildCloseTimeColumn } from '../viewmodel.js';
import { updatePool, setGlobalDefault } from '../store.js';
import { pipStripHTML } from './tabs.js';
import { invalidatePools } from './pools.js';

const $ = id => document.getElementById(id);

let currentVm = null;
let pendingTradeUp = null;
let pendingTradeDown = null;

// ── Requirement summary ───────────────────────────────────────────────────────

export function renderRequirementSummary(req, pool) {
  if (!req) return '';
  const minFives = Math.max(0, (req.minOneFiveValue - req.minOnes) / 5);
  const minTens = Math.max(0, (req.minOneFiveTenValue - req.minOneFiveValue) / 10);
  // Coverage is cumulative: spare $1s stand in for $5s, spare $1s+$5s for
  // $10s. A denomination is only "short" when the running value is short.
  const row = (label, need, have, valueShort, unit) => {
    let status;
    if (valueShort > 0) status = `<span class="req-short">short ${Math.ceil(valueShort / unit)}</span>`;
    else if (have < Math.ceil(need)) status = '<span class="req-ok">✓ via smaller</span>';
    else status = '<span class="req-ok">✓ ok</span>';
    return `<div class="req-row">
      <span class="d">${label}</span>
      <span class="m">need ${Math.ceil(need)}</span>
      <span class="m">have ${have}</span>
      ${status}
    </div>`;
  };

  return `<div class="req">
    <div class="eyebrow">Small bills needed</div>
    ${row('$1', req.minOnes, pool[1] || 0, req.onesShort, 1)}
    ${row('$5', minFives, pool[5] || 0, Math.max(0, req.oneFiveShort - req.onesShort), 5)}
    ${row('$10', minTens, pool[10] || 0, Math.max(0, req.oneFiveTenShort - req.oneFiveShort), 10)}
  </div>`;
}

// ── Distribution table markup ─────────────────────────────────────────────────

function countCell(count) {
  return count > 0 ? `<td class="has">${count}</td>` : '<td class="z">—</td>';
}

// Bill table: one row per person (their envelope), one column per bill size,
// chump row, then column totals for the whole drawer.
export function renderDistTableMarkup(people, byPerson, options = {}) {
  const leftover = options.leftover || 0;
  const remBills = leftover > 0 ? (options.remainderBills || {}) : {};

  const rows = people.map(p => {
    const bills = byPerson[p.id] || {};
    return `<tr><td class="c-name${p.closer ? ' closer-dot' : ''}">${escapeHTML(p.name)}</td>`
      + DENOMS.map(d => countCell(bills[d] || 0)).join('')
      + `<td class="c-tot">$${poolValue(bills)}</td></tr>`;
  }).join('');

  const remRow = leftover > 0
    ? `<tr class="row-chump"><td class="c-name">Chump</td>`
      + DENOMS.map(d => (remBills[d] || 0) > 0 ? `<td>${remBills[d]}</td>` : '<td class="z">—</td>').join('')
      + `<td class="c-tot">$${leftover}</td></tr>`
    : '';

  const colTotals = DENOMS.map(d => {
    const t = people.reduce((s, p) => s + ((byPerson[p.id] || {})[d] || 0), 0) + (remBills[d] || 0);
    return t > 0 ? `<td>${t}</td>` : '<td class="z">—</td>';
  }).join('');
  const grand = people.reduce((s, p) => s + poolValue(byPerson[p.id] || {}), 0) + poolValue(remBills);

  return `<div class="section-title">${options.preview ? 'After the swap' : 'Envelopes'}</div>
    <div class="tbl-wrap"><table class="tbl tbl--bills">
      <thead><tr><th class="c-name">Name</th>${DENOMS.map(d => `<th>$${d}</th>`).join('')}<th class="c-tot">Total</th></tr></thead>
      <tbody>${rows}${remRow}</tbody>
      <tfoot><tr><td class="c-name">Drawer</td>${colTotals}<td class="c-tot">$${grand}</td></tr></tfoot>
    </table></div>`;
}

// ── Trade cards ───────────────────────────────────────────────────────────────

// Swap preview, one row per bill size (Bill · Now · Swap · After) — four
// readable columns instead of eight squeezed ones.
function tradeTableHTML(nowPool, deltas, afterPool) {
  const rows = DENOMS.filter(d => (nowPool[d] || 0) || (afterPool[d] || 0) || (deltas[d] || 0)).map(d => {
    const v = deltas[d] || 0;
    const delta = v === 0 ? '<span class="z">—</span>' : `<span class="${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : '−'}${Math.abs(v)}</span>`;
    return `<div class="swap-row${v ? ' changed' : ''}"><span class="d">$${d}</span><span>${nowPool[d] || 0}</span>${delta}<span class="a">${afterPool[d] || 0}</span></div>`;
  }).join('');
  return `<div class="swap">
    <div class="swap-row swap-head"><span>Bill</span><span>Now</span><span>Swap</span><span>After</span></div>
    ${rows}
  </div>`;
}

function renderTradeUpCard(tradeUp, pool) {
  return `<div class="card trade trade--up">
    <div class="trade-hdr">
      <div class="trade-info">
        <div class="trade-title">Consolidate into $20s</div>
        <div class="trade-sub">Swap extra small bills for ${tradeUp.new20s} × $20. Updates Cash on apply.</div>
      </div>
      <button class="btn btn--sm btn--primary" onclick="App.applyTradeUp()">Apply</button>
    </div>
    ${tradeTableHTML(pool, tradeUp.delta, tradeUp.newPool)}
  </div>`;
}

function renderTradeDownCard(preview, pool) {
  if (!preview) return '';
  const items = preview.trades.length
    ? `<ul>${preview.trades.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul>`
    : '';
  return `<div class="card trade trade--down">
    <div class="trade-hdr">
      <div class="trade-info">
        <div class="trade-title">Fix: make change</div>
        <div class="trade-sub">Fewest bills to swap for exact change. Apply updates the Cash counts.</div>
      </div>
      <button class="btn btn--sm btn--primary" onclick="App.applyTradeDown()">Apply</button>
    </div>
    ${items}
    ${tradeTableHTML(pool, preview.deltas, preview.pool)}
  </div>`;
}

// Trades write real bill counts back into the pool, so they only make sense
// when there is exactly one pool to write into.
function tradesEnabled(vm) {
  return vm.state.pools.length === 1;
}

// Actionable break-bills card for the Summary warn box — same preview the
// dist modal computes, so the Apply button (wired to pendingTradeDown, set by
// renderDist in the same render pass) resolves to identical counts.
export function tradeSuggestionHTML(vm) {
  if (!vm.dist || !tradesEnabled(vm)) return '';
  const preview = breakPlan(vm);
  return preview ? renderTradeDownCard(preview, vm.bills) : '';
}

// Fewest bill-breaks that make exact change (any denomination), falling back
// to the older small-bill heuristic. Memoized per view model — Summary and the
// dist sheet both ask during the same render.
const planCache = new WeakMap();
function breakPlan(vm) {
  if (!planCache.has(vm)) {
    const { people, bills, shares } = vm;
    planCache.set(vm, planMakeChange(people, bills, shares.leftover));
  }
  return planCache.get(vm);
}

// True when the $1/$5/$10 minimums aren't covered — only then is the
// "small bills needed" card the actual explanation of a failure.
export function smallBillsShort(req, pool) {
  if (!req) return false;
  // Cumulative value checks — extra $1s cover missing $5s, etc.
  return req.onesShort > 0 || req.oneFiveShort > 0 || req.oneFiveTenShort > 0;
}

// Trade-up ("consolidate into $20s") only counts small-bill minimums, which
// can strip bills the real split needs — e.g. undo a just-applied $20 → 2×$10
// break. Only offer it when the consolidated drawer still pays out exactly.
function safeTradeUp(vm) {
  const plan = computeTradeUp(vm.bills, vm.req);
  if (!plan) return null;
  return distribute(vm.people, plan.newPool, vm.shares.leftover).error ? null : plan;
}

// Plain-language reason for a failed distribution.
export function distErrorText(vm) {
  const { dist, people, shares, req, bills } = vm;
  const unpaid = people.reduce((s, p) => s + Math.max(0, p.final - poolValue(dist.byPerson[p.id] || {})), 0);
  if (dist.error && !smallBillsShort(req, bills)) {
    return 'These bills can’t be split into exact payouts. Small bills are covered — the larger bills don’t divide evenly.';
  }
  if (dist.error) return 'Not enough small bills to make exact change.';
  if (unpaid > 0) return 'Drawer is short $' + unpaid + ' in usable bills.';
  if (shares.leftover > 0 && poolValue(dist.remainderBills) !== shares.leftover) {
    return 'The chump can’t be made from the bills left over.';
  }
  return '';
}

function applyBillCountsToPool(vm, newPool) {
  const poolId = vm.state.pools[0].id;
  updatePool(poolId, pool => {
    pool.cash.entryMode = 'perbill';
    DENOMS.forEach(d => {
      pool.cash.billCounts[d] = (newPool[d] || 0) > 0 ? String(newPool[d]) : '';
    });
  });
  // Counts changed outside the inputs — rebuild the Cash card so the boxes
  // show the new values (the keystroke patch path never rewrites input values).
  invalidatePools();
}

export function applyPendingTradeUp() {
  if (currentVm && pendingTradeUp) applyBillCountsToPool(currentVm, pendingTradeUp.newPool);
}

export function applyPendingTradeDown() {
  if (currentVm && pendingTradeDown) applyBillCountsToPool(currentVm, pendingTradeDown.pool);
}

// ── Bills tab content ────────────────────────────────────────────────────────

export function renderDist(vm) {
  currentVm = vm;
  const el = $('dist-content');
  if (!el) return;

  if (vm.blocked || !vm.dist) {
    el.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>
      <div class="empty-title">Nothing to split yet</div>
      ${escapeHTML(vm.blocked || 'Enter staff and cash first.')}
    </div>`;
    pendingTradeUp = pendingTradeDown = null;
    if ($('closeTimeSidebar')?.classList.contains('open')) renderCloseTimeSidebar();
    return;
  }

  const { dist, shares, people, bills, req } = vm;
  const errMsg = distErrorText(vm);
  const hasErr = !!errMsg;

  const reqHTML = renderRequirementSummary(req, bills);
  const canTrade = tradesEnabled(vm);

  pendingTradeDown = hasErr && canTrade ? breakPlan(vm) : null;
  pendingTradeUp = !hasErr && canTrade ? safeTradeUp(vm) : null;

  const ctBtn = '<button class="btn btn--block" onclick="App.openCloseTime()">Close-time what-if</button>';
  // On failure, the small-bill card only shows when it's the actual cause.
  const reqCard = !hasErr || smallBillsShort(req, bills) ? `<div class="card">${reqHTML}</div>` : '';

  if (hasErr) {
    const previewTableHTML = pendingTradeDown
      ? renderDistTableMarkup(people, pendingTradeDown.byPerson, {
          remainderBills: pendingTradeDown.remainderBills,
          leftover: shares.leftover,
          preview: true,
        })
      : '';

    el.innerHTML = pipStripHTML(vm)
      + `<div class="msg msg--error">⚠ ${escapeHTML(errMsg)}`
      + (pendingTradeDown
        ? ''
        : `<button class="link-btn" onclick="App.tab('cash')">Cash →</button>`)
      + `</div>`
      + reqCard
      + renderTradeDownCard(pendingTradeDown, bills)
      + previewTableHTML
      + ctBtn;
  } else {
    el.innerHTML = pipStripHTML(vm)
      + renderDistTableMarkup(people, dist.byPerson, {
          remainderBills: dist.remainderBills,
          leftover: shares.leftover,
        })
      + reqCard
      + (pendingTradeUp ? renderTradeUpCard(pendingTradeUp, bills) : '')
      + ctBtn;
  }

  if ($('closeTimeSidebar')?.classList.contains('open')) renderCloseTimeSidebar();
}

// ── Close Time sidebar ────────────────────────────────────────────────────────

let ctRange = 3;
let ctCenter = 2;

export function openCloseTimeSidebar() {
  if (!currentVm || !currentVm.shares || !currentVm.totalCash) return;

  const gcOut = parseTime(currentVm.state.defaults.global.out);
  ctCenter = (gcOut.valid && !gcOut.empty) ? gcOut.value : 2;

  renderCloseTimeSidebar();
  $('closeTimeSidebar').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeCloseTimeSidebar() {
  $('closeTimeSidebar').classList.remove('open');
  document.body.style.overflow = '';
}

export function selectCloseTime(t) {
  setGlobalDefault('out', String(t));
  ctCenter = t;
}

function fmtCloseTime(t) {
  let hr = Math.floor(t), mn = Math.round((t - hr) * 60);
  if (mn === 60) { hr++; mn = 0; }
  const h12 = hr % 12 || 12;
  return h12 + (mn > 0 ? ':' + (mn < 10 ? '0' : '') + mn : '') + (t <= 5 ? 'a' : 'p');
}

function renderCloseTimeSidebar() {
  const body = $('close-time-body');
  if (!body || !currentVm) return;

  if (!currentVm.shares || !currentVm.bills) {
    body.innerHTML = `<div class="empty">${escapeHTML(currentVm.blocked || 'Enter cash and staff first.')}</div>`;
    return;
  }

  const state = currentVm.state;
  const drawer = currentVm.bills;

  const times = [];
  for (let i = -ctRange; i <= ctRange; i++) {
    const t = Math.round((ctCenter + i * 0.25) * 4) / 4;
    if (t > 0 && t <= 12) times.push(t);
  }

  const cols = times.map(t => buildCloseTimeColumn(state, t, drawer));
  const nowIdx = times.findIndex(t => Math.abs(t - ctCenter) < 0.01);

  body.innerHTML = pipStripHTML(currentVm)
    + '<div class="hint">Tap a time to set it as the close. Pinch the table to widen or narrow the range.</div>'
    + closeTimeTableHTML(times, cols, drawer, nowIdx);

  // Pinch to widen/narrow the time range
  const wrap = body.querySelector('.tbl-wrap');
  if (!wrap) return;
  let pinchStartDist = 0;
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2)
      pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !pinchStartDist) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
    if (d - pinchStartDist > 28) {
      ctRange = Math.min(ctRange + 1, 9);
      pinchStartDist = d;
      renderCloseTimeSidebar();
    } else if (pinchStartDist - d > 28) {
      ctRange = Math.max(ctRange - 1, 1);
      pinchStartDist = d;
      renderCloseTimeSidebar();
    }
  }, { passive: true });
  wrap.addEventListener('touchend', () => { pinchStartDist = 0; }, { passive: true });
}

function closeTimeTableHTML(times, cols, pool, nowIdx) {
  const people = currentVm.shares.perPerson;
  const n = i => i === nowIdx ? ' now' : '';
  const dash = i => `<td class="z${n(i)}">—</td>`;

  const head = times.map((t, i) =>
    `<th class="pick${n(i)}" onclick="App.selectCloseTime(${t})">${fmtCloseTime(t)}</th>`
  ).join('');

  const personRows = people.map(person => {
    const cells = cols.map((col, i) => {
      const p = col?.shares.perPerson.find(x => x.id === person.id);
      if (!p || p.final <= 0) return dash(i);
      return `<td class="${p.closer ? 'closer' : ''}${n(i)}">$${p.final}</td>`;
    }).join('');
    return `<tr><td class="c-name">${escapeHTML(person.name)}</td>${cells}</tr>`;
  }).join('');

  const remRow = `<tr class="row-chump"><td class="c-name">Chump</td>`
    + cols.map((col, i) => col?.shares.leftover ? `<td class="${n(i)}">$${col.shares.leftover}</td>` : dash(i)).join('')
    + '</tr>';

  const avail15 = (pool[1] || 0) + (pool[5] || 0) * 5;
  const avail1510 = avail15 + (pool[10] || 0) * 10;
  const dataRow = (label, get) => `<tr><td class="c-name muted">${label}</td>`
    + cols.map((col, i) => {
      if (!col) return dash(i);
      const { ok, val } = get(col);
      return `<td class="${ok ? 'ok' : 'short'}${n(i)}">${val}</td>`;
    }).join('') + '</tr>';

  return `<div class="tbl-wrap"><table class="tbl ct">
    <thead><tr><th class="c-name">Close</th>${head}</tr></thead>
    <tbody>
      ${personRows}${remRow}
      <tr class="row-sect"><td colspan="${times.length + 1}">Small bills needed</td></tr>
      ${dataRow('$1s', c => ({ ok: c.req.minOnes <= (pool[1] || 0), val: c.req.minOnes }))}
      ${dataRow('$1+5', c => ({ ok: c.req.minOneFiveValue <= avail15, val: '$' + c.req.minOneFiveValue }))}
      ${dataRow('$1+5+10', c => ({ ok: c.req.minOneFiveTenValue <= avail1510, val: '$' + c.req.minOneFiveTenValue }))}
    </tbody>
  </table></div>`;
}
