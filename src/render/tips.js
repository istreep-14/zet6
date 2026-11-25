// Tips (Preact) — only for entering the cash. The sub-tabs (the header) are
// the shift's cash entries, set from the pools (nav setSubs):
//   one per pool ("Night"), and one per extra part of a pool — a later count
//   of the same pool ("Part 2", or "Day 2" with several pools).
// An entry counts bills by default; pull the page down (like refreshing a
// feed) to type a total instead, and back. Under it a big "New part" saves
// this count and starts another. What the pools are (names, windows, who
// shares them, over / short) is the Shift tab (render/shift.js), which uses
// the pool pieces exported here (WindowEdge, SharedBy, SupportBox, FormRow,
// openCashSheet).
//
// Inputs show the stored raw strings; Preact diffs each render, so typing
// keeps focus and the totals update around it.

import { DENOMS, parseWholeNumber, fmtHrs, fmtMoney, countedValue } from '../util.js';
import { fmtTimeAbs, overlapHours, atOrAfterOf, absToEdgeRaw } from '../time.js';
import { focusCell } from '../ui/keypad.js';
import { EDGE_TOKENS } from '../resolve.js';
import { SHIFT_TYPES, SHIFT_LABEL } from '../shifts.js';
import { KeyTime } from '../ui/keytime.js';
import { currentSub, currentTab, setSubs, setSub } from '../ui/nav.js';
import { ShiftContext } from './tabs.js';
import { html, render, useState } from '../ui/preact.js';
import { toast } from '../ui/toast.js';
import { cx, Card, Seg, Chip, Field, Button, Denom, Alert, Icon, List, Item, Section, NextStep, Table, Money, SwitchRow, INPUT, ROLE_DOT, holdRepeat } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));
const EYEBROW = 't-small text-ink-2';

export function windowSub(pool, vmPool) {
  const start = pool.window.start.trim();
  const end = pool.window.end.trim();
  if (!start && !end) return 'Whole shift';
  const fmt = (raw, abs) => abs != null ? fmtTimeAbs(abs) : (raw || '?');
  return fmt(start, vmPool?.startAbs) + ' – ' + fmt(end, vmPool?.endAbs);
}

// ── Pool window edges ─────────────────────────────────────────────────────────
// Each edge is a time (tap → keypad, drag → 15 min) or derived from the
// floor: Open / Close, Servers out, Bar out (resolvePools). A dragged or
// typed time makes it fixed; a chip makes it follow the floor again.
const rerender = () => { if (lastVm) renderTips(lastVm); };

function edgeCell(vm, pool, vmPool, which, cls, tone) {
  const anchor = vm.resolved?.anchorAbs ?? 17;
  const raw = String(pool.window[which] || '').trim();
  const k = 'pool:' + pool.id + ':' + which;
  return html`<${KeyTime} k=${k} title=${pool.label + ' · ' + (which === 'start' ? 'starts' : 'ends')}
    abs=${vmPool ? vmPool[which + 'Abs'] : null} set=${!!raw && !EDGE_TOKENS[raw]} cls=${cls} tone=${tone}
    toAbs=${(v, mer) => atOrAfterOf({ value: v, mer }, anchor)} fromAbs=${a => absToEdgeRaw(a, anchor)} min=${anchor} max=${anchor + 24}
    write=${r => App.poolWindow(pool.id, which, r, true)} rerender=${rerender}
    next=${dir => {
      if (dir === 'next' && which === 'start') return focusCell('pool:' + pool.id + ':end');
      if (dir === 'prev' && which === 'end') return focusCell('pool:' + pool.id + ':start');
      return false;
    }} />`;
}

export function WindowEdge({ vm, pool, vmPool, which }) {
  const raw = String(pool.window[which] || '').trim();
  const opts = [{ v: '', label: which === 'start' ? 'Open' : 'Close' }, { v: 'srv', label: 'Servers out' }, { v: 'bar', label: 'Bar out' }];
  const chip = on => cx('t-small h-9 shrink-0 rounded-full px-3 font-semibold transition active:scale-95', on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2');
  return html`<div class="flex items-center gap-2">
    <span class="t-small w-10 shrink-0 text-ink-2">${which === 'start' ? 'From' : 'To'}</span>
    <div class="w-[4.75rem] shrink-0">${edgeCell(vm, pool, vmPool, which, 'h-10 w-full rounded-lg bg-surface-2 text-center text-[1rem] tabular-nums transition')}</div>
    <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      ${opts.map(o => html`<button key=${o.v} class=${chip(raw === o.v)} onClick=${() => App.poolWindow(pool.id, which, o.v, true)}>${o.label}</button>`)}
    </div>
  </div>`;
}


export function SharedBy({ pool }) {
  return html`<${FormRow} label="Shared by">
    <div class="flex gap-2">
      <${Chip} on=${pool.roles.bartender} role="bartender" onClick=${() => App.poolRole(pool.id, 'bartender')}>Bar<//>
      <${Chip} on=${pool.roles.server} role="server" onClick=${() => App.poolRole(pool.id, 'server')}>Servers<//>
      <${Chip} on=${pool.includeSupport} role="support" onClick=${() => App.poolRole(pool.id, 'support')}>Support<//>
    </div>
  <//>`;
}

// Support tip-out — shown when the Support chip is on. % and $/hr inherit as
// placeholders; per-person hours default to their overlap with the window.
export function SupportBox({ pool, vm, vmPool }) {
  const sPool = vm.shares?.perPool.find(p => p.id === pool.id);
  const sup = sPool?.support;
  const supStaff = (vm.resolved?.staff || []).filter(p => p.role === 'support');
  const cfg = pool.support || { pct: '', rate: '', hours: {} };
  const pctPh = String(vm.state.defaults.supportPct || '').trim() || '10';
  const cut = sup && sup.cut > 0 ? `−$${fmtAmt(sup.cut)} support · $${fmtAmt(sPool.tippedTotal)} bar/srv` : '';

  return html`<div class="flex flex-col gap-3 px-4 py-3">
    <div class="flex items-baseline justify-between gap-2">
      <span class=${cx(EYEBROW, 'inline-flex items-center gap-1.5')}><span class="size-2 rounded-full bg-sup"></span>Support tip-out</span>
      <span class="t-small text-right text-sup">${cut}</span>
    </div>
    <div class="flex gap-3">
      <${Field} label="Percent" inputmode="decimal" placeholder=${pctPh} value=${cfg.pct ?? ''}
        onInput=${e => App.poolSupport(pool.id, 'pct', e.target.value)} />
      <${Field} label="$ / hour" inputmode="decimal" placeholder=${sup ? fmtAmt(sup.derivedRate) : '0'} value=${cfg.rate ?? ''}
        onInput=${e => App.poolSupport(pool.id, 'rate', e.target.value)} />
    </div>
    ${supStaff.length
      ? supStaff.map(p => {
        const auto = vmPool ? overlapHours(p.inAbs, p.outAbs, vmPool.startAbs, vmPool.endAbs) : 0;
        const part = sPool?.participants.find(x => x.id === p.id);
        return html`<div key=${p.id} class="t-body grid grid-cols-[minmax(0,1fr)_4rem_0.875rem_4.5rem] items-center gap-2">
          <span class="truncate">${p.name}</span>
          <input class=${cx(INPUT, 'h-10 text-center font-semibold')} inputmode="decimal" placeholder=${fmtHrs(auto)}
            aria-label=${p.name + ' hours'} value=${cfg.hours?.[p.id] ?? ''} onInput=${e => App.poolSupportHours(pool.id, p.id, e.target.value)} />
          <span class="text-ink-2">h</span>
          <span class="text-right font-semibold tabular-nums">${part ? '$' + fmtAmt(part.raw) : '—'}</span>
        </div>`;
      })
      : html`<div class="t-small text-ink-3">No support staff named yet.</div>`}
  </div>`;
}

function BillRow({ pool, d, batch = null }) {
  const v = (batch ? batch.billCounts : pool.cash.billCounts)[d] ?? '';
  const parsed = parseWholeNumber(v);
  const sub = parsed.valid ? parsed.value * d : 0;
  const step = 'grid size-11 shrink-0 select-none place-items-center rounded-full text-[1.25rem] text-ink-2 active:bg-ink/10 active:text-ink [-webkit-touch-callout:none]';
  return html`<div class=${cx(BILL_GRID, 'min-h-[var(--row-lg)] px-4 py-1')}>
    <${Denom} d=${d} />
    <div class="flex items-center rounded-full bg-surface-2 focus-within:ring-2 focus-within:ring-accent/40">
      <button class=${step} ...${holdRepeat(() => batch ? App.cashBatchStep(pool.id, batch.id, String(d), -1) : App.billStep(pool.id, String(d), -1))} aria-label=${'One fewer $' + d} tabindex="-1">−</button>
      <input class="h-11 w-full min-w-0 bg-transparent text-center text-[1rem] font-semibold text-ink outline-none placeholder:text-ink-3"
        type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint=${batch ? 'done' : 'next'} data-bill=${batch ? undefined : d}
        aria-label=${'$' + d + ' bills' + (batch ? ' in ' + (batch.label || 'checkpoint') : '')} value=${v} onInput=${e => batch ? App.cashBatchBill(pool.id, batch.id, String(d), e.target.value) : App.poolBill(pool.id, String(d), e.target.value)}
        onKeyDown=${batch ? undefined : e => App.billKey(e, pool.id)} />
      <button class=${step} ...${holdRepeat(() => batch ? App.cashBatchStep(pool.id, batch.id, String(d), 1) : App.billStep(pool.id, String(d), 1))} aria-label=${'One more $' + d} tabindex="-1">+</button>
    </div>
    <span class=${cx('t-body text-right font-semibold tabular-nums', !parsed.valid ? 'text-bad' : sub > 0 ? 'text-ink' : 'text-ink-3')}>
      ${!parsed.valid ? '!' : sub > 0 ? fmtMoney(sub) : '—'}</span>
  </div>`;
}

// The amount box. Meaning: just the cash (nothing counted), or — with Count
// bills open — the total including the counted bills, or only the rest.
function Amount({ pool }) {
  const raw = String(pool.cash.netTotal ?? '');
  const parsed = parseWholeNumber(raw);
  const display = !pool.cash.baseMode && pool.cash.restMode !== 'total' && raw.trim() && parsed.valid
    ? String(parsed.value + countedValue(pool.cash.billCounts)) : raw;
  return html`<div class="relative">
    <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-ink-3">$</span>
    <input class=${cx(INPUT, 'h-14 pl-10 text-[1.25rem] font-semibold tracking-tight')}
      id=${'cash-' + pool.id} type="number" min="0" step="1" placeholder="0" inputmode="numeric" data-rest
      aria-label="Total cash" value=${display} onInput=${e => App.poolTotal(pool.id, e.target.value)} />
  </div>`;
}

// The bill rows' columns (Bill · Count · Amount), shared with their caption.
const BILL_GRID = 'grid grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 max-[25rem]:grid-cols-[3.125rem_minmax(0,1fr)_4rem] max-[25rem]:gap-2.5';

// A labelled row: caption over its control, padded like the others.
export const FormRow = ({ label, aside, children, cls = '' }) => html`<div class=${cx('flex flex-col gap-2 px-4 py-3', cls)}>
  ${(label || aside) && html`<span class="flex items-baseline justify-between gap-3"><span class=${EYEBROW}>${label}</span>${aside && html`<span class="t-small text-right text-ink-3">${aside}</span>`}</span>`}
  ${children}</div>`;

// Register over / short: a Short / Over switch and an amount, stored as one
// signed string ("-50"). iOS number pads have no minus key, hence the switch.
function Adjust({ pool }) {
  const raw = String(pool.cash.adjust || '').trim();
  const neg = raw.startsWith('-') || raw.startsWith('−');
  const [sign, setSign] = useState(neg || !raw ? -1 : 1);
  const amount = raw.replace(/^[-+−]/, '');
  const write = (sg, amt) => App.poolAdjust(pool.id, amt ? (sg < 0 ? '-' : '') + amt : '');
  return html`<div class="flex gap-2">
    <${Seg} class="w-40 shrink-0 [&>button]:h-10" value=${raw ? (neg ? -1 : 1) : sign}
      onChange=${v => { setSign(v); write(v, amount); }}
      items=${[{ value: -1, label: 'Short' }, { value: 1, label: 'Over' }]} />
    <div class="relative flex-1">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
      <input class=${cx(INPUT, 'h-11 pl-7 font-semibold')} type="number" min="0" step="1" placeholder="0" inputmode="numeric"
        aria-label="Register over or short" value=${amount}
        onInput=${e => write(raw ? (neg ? -1 : 1) : sign, e.target.value.replace(/[^0-9]/g, ''))} />
    </div>
  </div>`;
}

// ── Cash entries ─────────────────────────────────────────────────────────────
// Every entry the shift has: each pool's main count, then its parts.
export function entriesOf(state) {
  const several = state.pools.length > 1;
  const out = [];
  state.pools.forEach(pool => {
    const parts = pool.cash.batches || [];
    const name = String(pool.label || '').trim() || 'Tips';
    out.push({ value: 'p:' + pool.id, label: !several && parts.length ? 'Part 1' : name, pool, batch: null, n: 1 });
    parts.forEach((b, i) => out.push({ value: 'b:' + pool.id + ':' + b.id, pool, batch: b, n: i + 2,
      label: String(b.label || '').trim() || (several ? name + ' ' + (i + 2) : 'Part ' + (i + 2)) }));
  });
  return out;
}
// How the pool's main count is entered: 'bills' (the default) or 'total'.
// An older pool with only a typed amount reads as a total.
export function entryMode(pool) {
  const c = pool.cash;
  if (c.baseMode) return c.baseMode;
  return String(c.netTotal ?? '').trim() && countedValue(c.billCounts) === 0 ? 'total' : 'bills';
}
const modeOf = e => (e.batch ? (e.batch.mode || 'bills') : entryMode(e.pool));
function entryTotal(e) {
  if (e.batch) {
    if (modeOf(e) === 'bills') return countedValue(e.batch.billCounts);
    const a = parseWholeNumber(e.batch.amount);
    return a.valid ? a.value : 0;
  }
  const c = e.pool.cash, counted = countedValue(c.billCounts), typed = parseWholeNumber(c.netTotal);
  if (c.baseMode === 'bills') return counted;
  if (c.baseMode === 'total' || c.restMode === 'total') return typed.valid ? Math.max(typed.value, c.baseMode === 'total' ? 0 : counted) : 0;
  return counted + (typed.valid ? typed.value : 0);
}
const curEntry = () => (lastEntries || []).find(e => e.value === currentSub('tips')) || null;

// Pull down → the other way of entering this entry.
function flipEntry(e = curEntry()) {
  if (!e) return;
  const next = modeOf(e) === 'bills' ? 'total' : 'bills';
  if (e.batch) App.updateCashBatch(e.pool.id, e.batch.id, 'mode', next);
  else if (!App.poolBaseMode(e.pool.id, next)) return;
  toast(next === 'total' ? 'Typing a total' : 'Counting bills');
}

// A part's typed amount.
function PartAmount({ pool, batch }) {
  return html`<div class="relative">
    <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-ink-3">$</span>
    <input class=${cx(INPUT, 'h-14 pl-10 text-[1.25rem] font-semibold tracking-tight')} type="number" min="0" step="1" placeholder="0" inputmode="numeric"
      aria-label=${'Total cash' + (batch.label ? ' · ' + batch.label : '')} value=${batch.amount || ''} onInput=${ev => App.updateCashBatch(pool.id, batch.id, 'amount', ev.target.value)} />
  </div>`;
}

function Entry({ vm, e }) {
  const { pool, batch } = e;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const mode = modeOf(e);
  const total = entryTotal(e);
  const parts = pool.cash.batches || [];
  const adj = vmPool?.adjust || 0;
  const several = vm.state.pools.length > 1;
  const ready = !vm.blocked && vm.totalCash > 0;
  const err = vm.inputError && vm.blockedTab === 'tips' ? vm.blocked : '';
  const newPart = () => {
    const id = App.addCashBatch(pool.id);
    if (id) requestAnimationFrame(() => setSub('tips', 'b:' + pool.id + ':' + id, { dir: 'left' }));
  };
  const poolLine = [
    several && windowSub(pool, vmPool),
    (parts.length > 0 || adj) && fmtMoney(vmPool?.total || 0) + ' in ' + (several ? pool.label : 'all'),
    parts.length > 0 && (parts.length + 1) + ' parts',
    adj && fmtMoney(Math.abs(adj)) + (adj < 0 ? ' short' : ' over'),
  ].filter(Boolean).join(' · ');
  return html`<div class="flex flex-col gap-5" data-pid=${pool.id}>
    ${err && html`<${Alert}>${err}<//>`}
    ${vm.cashNote && html`<${Alert} tone="warn">${vm.cashNote}<//>`}
    <${Section} title=${e.label + (mode === 'bills' ? ' · bills' : ' · total')} aside=${html`<span class="font-semibold text-ink">${fmtMoney(total)}</span>`}
      footer=${poolLine || null}>
      ${mode === 'bills'
        ? html`<div class="page-table">
            <div class=${cx(BILL_GRID, 't-cap px-4 pb-1 pt-1 text-ink-3')}><span>Bill</span><span class="text-center">Count</span><span class="text-right">Amount</span></div>
            ${DENOMS.map(d => html`<${BillRow} key=${d} pool=${pool} batch=${batch} d=${d} />`)}
          </div>`
        : batch ? html`<${PartAmount} pool=${pool} batch=${batch} />` : html`<${Amount} pool=${pool} />`}
    <//>
    <button class="flex h-16 w-full items-center justify-center gap-2.5 rounded-card bg-accent/12 text-accent transition active:scale-[0.98]" onClick=${newPart}>
      <${Icon} name="plus" class="size-5" /><span class="flex flex-col items-start leading-tight"><span class="t-head">New part</span><span class="t-small text-accent/80">Save this count and start another</span></span>
    </button>
    <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
      <button class="t-small h-9 font-semibold text-accent active:opacity-60" onClick=${() => flipEntry(e)}>${mode === 'bills' ? 'Type a total instead' : 'Count bills instead'}</button>
      ${parts.length > 0 && html`<button class="t-small h-9 font-semibold text-accent active:opacity-60" onClick=${() => openCashSheet('ranges', pool.id)}>Bill counts across parts</button>`}
      ${batch && html`<button class="t-small h-9 font-semibold text-bad active:opacity-60" onClick=${() => App.removeCashBatch(pool.id, batch.id)}>Remove this part</button>`}
    </div>
    ${ready && html`<${NextStep} tab="home" label="See who gets what"
      sub=${fmtMoney(vm.totalCash) + ' · $' + vm.shares.rate.toFixed(2) + ' an hour'} />`}
    ${vm.blockedTab === 'staff' && html`<${NextStep} tab="staff" label="Back to Staff" sub=${vm.blocked} />`}
  </div>`;
}

// ── The cash form's small drawers ───────────────────────────────────────────
// Separate windows for the register adjustment and the counted-bill summary.
let cashSheet = null;               // { which: 'adjust' | 'ranges', id }
onSheetClose('sheet-adjust', () => { cashSheet = null; });
onSheetClose('sheet-bill-ranges', () => { cashSheet = null; });
export function openCashSheet(which, id) {
  cashSheet = { which, id };
  openSheet(which === 'ranges' ? 'sheet-bill-ranges' : 'sheet-' + which);
  if (lastVm) renderCashSheet(lastVm);
}
function AdjustBody({ pool }) {
  return html`<p class="t-small px-1 text-ink-3">After counting the register: what it's over or short comes out of (or goes into) the tips, and the split is redone. Home shows the change.</p>
    <${Card}><${Adjust} key=${pool.id} pool=${pool} /><//>
    ${String(pool.cash.adjust || '').trim() && html`<${Button} block onClick=${() => App.poolAdjust(pool.id, '')}>Clear — no over / short<//>`}`;
}
function BillRanges({ pool }) {
  const batches = [];
  if (pool.cash.baseMode !== 'total' && countedValue(pool.cash.billCounts) > 0) batches.push(pool.cash.billCounts);
  (pool.cash.batches || []).filter(b => b.mode === 'bills').forEach(b => batches.push(b.billCounts));
  if (!batches.length) return html`<p class="t-small px-1 text-ink-3">No bills counted yet. Total-only entries don’t specify denominations.</p>`;
  if (batches.some(b => DENOMS.some(d => !parseWholeNumber(b[d]).valid))) return html`<${Alert} tone="warn">Check the bill counts before viewing their range.<//>`;
  return html`<p class="t-small px-1 text-ink-3">Lowest and highest counts per bill in ${batches.length} counted ${batches.length === 1 ? 'entry' : 'entries'}, plus the combined count. Total-only entries are excluded.</p>
    <${Table} cols=${[{ label: 'Bill' }, { label: 'Min' }, { label: 'Max' }, { label: 'Combined', align: 'right' }]}
      rows=${DENOMS.map(d => {
        const counts = batches.map(b => parseWholeNumber(b[d]).value);
        return { key: d, cells: [html`<${Denom} d=${d} />`, Math.min(...counts), Math.max(...counts), counts.reduce((a, b) => a + b, 0)] };
      })} />`;
}
function renderCashSheet(vm) {
  if (!cashSheet) return;
  const id = cashSheet.which === 'ranges' ? 'sheet-bill-ranges' : 'sheet-' + cashSheet.which;
  if (!isOpen(id)) return;
  const pool = vm.state.pools.find(p => p.id === cashSheet.id);
  if (!pool) { closeSheet(id); return; }
  setSheetTitle(id, ({ adjust: 'Register over / short', ranges: 'Bill counts by checkpoint' }[cashSheet.which]) + (vm.state.pools.length > 1 ? ' · ' + pool.label : ''));
  render(cashSheet.which === 'ranges' ? html`<${BillRanges} pool=${pool} />` : html`<${AdjustBody} pool=${pool} />`, sheetBody(id));
}

// Which bills to pull for the uncounted rest (all pools together) — a Table
// like Payout's: Bill · Count · Amount, total row.
export function Suggested({ vm }) {
  const add = vm.looseBills;
  if (!add || !vm.bills || vm.totalCash <= 0) return null;
  const ds = [100, 50, 20, 10, 5, 1].filter(d => add[d] > 0);
  if (!ds.length) return null;
  const sum = ds.reduce((t, d) => t + add[d] * d, 0);
  return html`<${Section} title=${'Best bills for the ' + fmtMoney(sum) + (vm.counted ? ' not counted' : '')}
    footer="Enough $1 / $5 / $10s for every payout to come out exact, the rest in $20s.">
    <${Table} cols=${[{ label: 'Bill' }, { label: 'Count' }, { label: 'Amount', align: 'right' }]}
      rows=${ds.map(d => ({ key: d, cells: [html`<${Denom} d=${d} />`, html`<span class="font-semibold">× ${add[d]}</span>`, html`<${Money} value=${add[d] * d} class="font-semibold" />`] }))}
      foot=${['Total', ds.reduce((t, d) => t + add[d], 0) + ' bills', html`<${Money} value=${sum} />`]} />
  <//>`;
}

function Tips({ vm }) {
  const e = curEntry() || lastEntries?.[0];
  return e ? html`<div class="flex flex-col gap-5"><${ShiftContext} vm=${vm} /><${Entry} key=${e.value} vm=${vm} e=${e} /></div>` : null;
}

// ── Pull down to change the current view ───────────────────────────────────
// The same refresh-like gesture works across primary pages. Tips retains its
// bills ↔ total switch; Home, Pay, and Shift use it to swap their views.
const PULL = 64;
let pull = null, pullBound = false;
function pullAction() {
  const tab = currentTab();
  if (tab === 'tips') {
    const e = curEntry() || lastEntries?.[0];
    if (!e) return null;
    const to = modeOf(e) === 'bills' ? 'type a total' : 'count bills';
    return { idle: 'Pull to ' + to, armed: 'Release to ' + to, run: () => flipEntry(e) };
  }
  if (tab === 'home') {
    const toShift = currentSub('home') !== 'shift';
    return { idle: 'Pull to show ' + (toShift ? 'timeline' : 'payouts'), armed: 'Release to show ' + (toShift ? 'timeline' : 'payouts'), run: () => setSub('home', toShift ? 'shift' : 'overview') };
  }
  if (tab === 'shift') {
    const toPools = currentSub('shift') !== 'pools';
    return { idle: 'Pull to show ' + (toPools ? 'pools' : 'shift setup'), armed: 'Release to show ' + (toPools ? 'pools' : 'shift setup'), run: () => setSub('shift', toPools ? 'pools' : 'shift') };
  }
  if (tab === 'pay') {
    const views = ['bills', 'split', 'bonus'];
    const at = Math.max(0, views.indexOf(currentSub('pay')));
    const to = views[(at + 1) % views.length];
    return { idle: 'Pull to show ' + to, armed: 'Release to show ' + to, run: () => setSub('pay', to) };
  }
  return null;
}
function pullTo(d, text = '') {
  const panel = $('tab-' + currentTab());
  if (!panel) return;
  panel.style.transition = d ? 'none' : 'transform .25s cubic-bezier(.2,.8,.3,1)';
  panel.style.transform = d ? `translateY(${d}px)` : '';
  panel.classList.toggle('pulling', d > 0);
  panel.classList.toggle('pull-armed', d > PULL);
  if (text) panel.dataset.pullText = text;
  else delete panel.dataset.pullText;
}
function bindPull() {
  const m = $('mainContent');
  if (!m || pullBound) return;
  pullBound = true;
  const calm = () => !document.documentElement.classList.contains('keypad-open') && !document.body.classList.contains('keyboard-open')
    && !document.querySelector('.sheet-backdrop.open') && !document.documentElement.classList.contains('menu-open');
  m.addEventListener('touchstart', ev => {
    pull = null;
    const action = pullAction();
    if (!action || ev.touches.length !== 1 || m.scrollTop > 0 || !calm()) return;
    pull = { x0: ev.touches[0].clientX, y0: ev.touches[0].clientY, on: false, d: 0, action };
  }, { passive: true });
  m.addEventListener('touchmove', ev => {
    if (!pull) return;
    const dx = ev.touches[0].clientX - pull.x0, dy = ev.touches[0].clientY - pull.y0;
    if (!pull.on) {
      if (dy > 10 && dy > Math.abs(dx) * 1.4 && m.scrollTop <= 0) pull.on = true;
      else if (Math.abs(dx) > 10 || dy < -10) { pull = null; return; }
      else return;
    }
    if (ev.cancelable) ev.preventDefault();
    pull.d = Math.min(140, Math.max(0, dy) * 0.5);
    pullTo(pull.d, pull.d > PULL ? pull.action.armed : pull.action.idle);
  }, { passive: false });
  const end = flip => {
    const p = pull;
    pull = null;
    if (!p?.on) return;
    pullTo(0);
    if (flip && p.d > PULL) p.action.run();
  };
  m.addEventListener('touchend', () => end(true), { passive: true });
  m.addEventListener('touchcancel', () => end(false), { passive: true });
}

let lastEntries = null;
let lastVm = null;

export function renderTips(vm) {
  lastVm = vm;
  lastEntries = entriesOf(vm.state);
  setSubs('tips', lastEntries.map(e => ({ value: e.value, label: e.label })));
  bindPull();
  const root = $('tips-root');
  if (root) render(html`<${Tips} vm=${vm} />`, root);
  renderCashSheet(vm);
}

