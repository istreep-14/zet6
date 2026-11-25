// Tips (Preact) — for entering the cash and how it's split; three sub-tabs
// (the header):
//   Cash     the pool card(s): the amount, counted bills, checkpoints; the
//            register over / short; checkpoint counts
//   Pools    the shift type (Night / Day) and + Party, + Add pool, who shares
//            the pool, the support tip-out, the closer bonus & chump
//   Drawer   render/payout.js: the fix when the bills don't work out, the
//            best bills for the uncounted cash, envelopes already made,
//            stacks, tidy
//
// Inputs show the stored raw strings; Preact diffs each render, so typing
// keeps focus and the totals update around it.

import { DENOMS, parseWholeNumber, fmtHrs, fmtMoney, countedValue } from '../util.js';
import { fmtTimeAbs, overlapHours, atOrAfterOf, absToEdgeRaw } from '../time.js';
import { focusCell } from '../ui/keypad.js';
import { EDGE_TOKENS } from '../resolve.js';
import { SHIFT_TYPES, SHIFT_LABEL } from '../shifts.js';
import { KeyTime } from '../ui/keytime.js';
import { currentSub } from '../ui/nav.js';
import { SupportDefault } from './settings.js';
import { html, render, useState } from '../ui/preact.js';
import { cx, Card, Seg, Chip, Field, Button, Denom, Alert, Icon, List, Item, Section, NextStep, Table, Money, SwitchRow, INPUT, ROLE_DOT, holdRepeat, revealSelectedTab, subtabKeys } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));
const EYEBROW = 't-small font-medium text-ink-2';

function windowSub(pool, vmPool) {
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

function WindowEdge({ vm, pool, vmPool, which }) {
  const raw = String(pool.window[which] || '').trim();
  const opts = [{ v: '', label: which === 'start' ? 'Open' : 'Close' }, { v: 'srv', label: 'Servers out' }, { v: 'bar', label: 'Bar out' }];
  const chip = on => cx('t-small h-9 shrink-0 rounded-full px-3 font-semibold transition active:scale-95', on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2');
  return html`<div class="flex items-center gap-2">
    <span class="t-small w-10 shrink-0 font-medium text-ink-2">${which === 'start' ? 'From' : 'To'}</span>
    <div class="w-[4.75rem] shrink-0">${edgeCell(vm, pool, vmPool, which, 'h-10 w-full rounded-lg bg-surface-2 text-center text-[1rem] tabular-nums transition')}</div>
    <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      ${opts.map(o => html`<button key=${o.v} class=${chip(raw === o.v)} onClick=${() => App.poolWindow(pool.id, which, o.v, true)}>${o.label}</button>`)}
    </div>
  </div>`;
}


function SharedBy({ pool }) {
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
function SupportBox({ pool, vm, vmPool }) {
  const sPool = vm.shares?.perPool.find(p => p.id === pool.id);
  const sup = sPool?.support;
  const supStaff = (vm.resolved?.staff || []).filter(p => p.role === 'support');
  const cfg = pool.support || { pct: '', rate: '', hours: {} };
  const pctPh = String(vm.state.defaults.supportPct || '').trim() || '10';
  const cut = sup && sup.cut > 0 ? `−$${fmtAmt(sup.cut)} support · $${fmtAmt(sPool.tippedTotal)} bar/srv` : '';

  return html`<div class="flex flex-col gap-3 px-4 py-3">
    <div class="flex items-baseline justify-between gap-2">
      <span class=${cx(EYEBROW, 'inline-flex items-center gap-1.5')}><span class="size-2 rounded-full bg-sup"></span>Support tip-out</span>
      <span class="t-small text-right font-medium text-sup">${cut}</span>
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
  const step = 'grid size-11 shrink-0 select-none place-items-center rounded-full text-[1.375rem] text-ink-2 active:bg-ink/10 active:text-ink [-webkit-touch-callout:none]';
  return html`<div class=${cx(BILL_GRID, 'min-h-[var(--row-lg)] px-4 py-1')}>
    <${Denom} d=${d} />
    <div class="flex items-center rounded-full bg-surface-2 focus-within:ring-2 focus-within:ring-accent/40">
      <button class=${step} ...${holdRepeat(() => batch ? App.cashBatchStep(pool.id, batch.id, String(d), -1) : App.billStep(pool.id, String(d), -1))} aria-label=${'One fewer $' + d} tabindex="-1">−</button>
      <input class="h-11 w-full min-w-0 bg-transparent text-center text-[1.125rem] font-semibold text-ink outline-none placeholder:text-ink-3"
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
    <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.5rem] font-medium text-ink-3">$</span>
    <input class=${cx(INPUT, 'h-14 pl-10 text-[1.75rem] font-semibold tracking-tight')}
      id=${'cash-' + pool.id} type="number" min="0" step="1" placeholder="0" inputmode="numeric" data-rest
      aria-label="Total cash" value=${display} onInput=${e => App.poolTotal(pool.id, e.target.value)} />
  </div>`;
}

function CashBatch({ pool, batch, index }) {
  const counted = countedValue(batch.billCounts);
  const amount = parseWholeNumber(batch.amount);
  const total = batch.mode === 'bills' ? counted : amount.valid ? amount.value : 0;
  return html`<div class="border-t border-line px-4 py-3">
    <div class="mb-2 flex items-center gap-2">
      <input class="t-body min-w-0 flex-1 bg-transparent font-semibold outline-none focus:ring-2 focus:ring-accent/40" aria-label=${'Checkpoint ' + (index + 1) + ' name'} placeholder=${'Checkpoint ' + (index + 1)} value=${batch.label || ''} onInput=${e => App.updateCashBatch(pool.id, batch.id, 'label', e.target.value)} />
      <span class="t-body font-semibold tabular-nums">${fmtMoney(total)}</span>
      <button class="grid size-11 shrink-0 place-items-center rounded-lg text-ink-3 active:bg-surface-2" aria-label=${'Remove ' + (batch.label || 'checkpoint ' + (index + 1))} onClick=${() => App.removeCashBatch(pool.id, batch.id)}><${Icon} name="trash" class="size-4" /></button>
    </div>
    <${Seg} value=${batch.mode} onChange=${v => App.updateCashBatch(pool.id, batch.id, 'mode', v)} items=${[{ value: 'total', label: 'Enter total' }, { value: 'bills', label: 'Count bills' }]} />
    <p class="t-small mt-2 text-ink-3">Only the selected method counts toward this checkpoint. Switching keeps the other entry.</p>
    ${batch.mode === 'total' ? html`<label class="mt-2 block"><span class="t-small text-ink-2">Checkpoint total</span><span class="relative mt-1 block"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span><input class=${cx(INPUT, 'pl-7 font-semibold')} type="number" min="0" step="1" inputmode="numeric" placeholder="0" aria-label=${(batch.label || 'Checkpoint ' + (index + 1)) + ' total'} value=${batch.amount || ''} onInput=${e => App.updateCashBatch(pool.id, batch.id, 'amount', e.target.value)} /></span></label>`
      : html`<div class="mt-2"><div class=${cx(BILL_GRID, 't-cap pb-1 text-ink-3')}><span>Bill</span><span class="text-center">Count</span><span class="text-right">Amount</span></div>${DENOMS.map(d => html`<${BillRow} key=${d} pool=${pool} batch=${batch} d=${d} />`)}</div>`}
  </div>`;
}

// The bill rows' columns (Bill · Count · Amount), shared with their caption.
const BILL_GRID = 'grid grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 max-[25rem]:grid-cols-[3.125rem_minmax(0,1fr)_4rem] max-[25rem]:gap-2.5';

// A labelled row: caption over its control, padded like the others.
const FormRow = ({ label, aside, children, cls = '' }) => html`<div class=${cx('flex flex-col gap-2 px-4 py-3', cls)}>
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

// The cash form, plain by default: one amount. Two options open the rest —
//   Count bills   the bills you can see at a glance (say 5 × $100, 3 × $50);
//                 the amount is then the Total (incl. those) or only the Rest,
//                 and the best bills are picked for whatever wasn't counted.
//   Over / short  after counting the register: re-splits the tips (Summary
//                 shows Was · Now · ±).
// Turning an option off folds it back: counted bills go into the amount, an
// over / short is cleared.
const entrySelection = new Map();
const entriesFor = pool => [{ id: 'base', label: 'Starting cash' }, ...(pool.cash.batches || []).map((b, i) => ({ id: b.id, label: b.label?.trim() || 'Checkpoint ' + (i + 1) }))];
const selectedEntry = pool => entriesFor(pool).some(e => e.id === entrySelection.get(pool.id)) ? entrySelection.get(pool.id) : 'base';
function selectEntry(poolId, entryId) {
  entrySelection.set(poolId, entryId);
  rerender();
  revealSelectedTab('[data-cash-entries]');
}

function PoolCard({ pool, vm }) {
  const single = vm.state.pools.length === 1;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const counted = countedValue(pool.cash.billCounts), adj = vmPool?.adjust || 0;
  const [legacyView, setLegacyView] = useState(counted > 0 ? 'bills' : 'total');
  const entryView = pool.cash.baseMode || legacyView;
  const parts = [vmPool?.counted > 0 && fmtMoney(vmPool.counted) + ' counted', vmPool?.rest > 0 && vmPool?.counted > 0 && fmtMoney(vmPool.rest) + ' entered as totals',
    adj !== 0 && fmtMoney(Math.abs(adj)) + (adj < 0 ? ' short' : ' over')].filter(Boolean);
  const showTotal = !single || counted > 0 || adj !== 0 || (pool.cash.batches || []).length > 0;
  const currentEntry = selectedEntry(pool);

  return html`<${Card} flush class="pool-editor" data-pid=${pool.id}>
    <div class="flex w-full items-start gap-3 px-4 pb-1 pt-4">
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="t-head truncate">${single ? 'Cash tips' : pool.label}</span>
        <span class="t-small text-ink-3">${parts.length ? parts.join(' · ') : windowSub(pool, vmPool)}</span>
      </span>
      ${showTotal && html`<span class="flex shrink-0 flex-col items-end">
        <span class=${cx('text-[1.75rem] font-semibold leading-tight tracking-tight tabular-nums', !total && 'text-ink-3')}>${fmtMoney(total)}</span>
        ${adj !== 0 && html`<span class="t-small text-ink-3 line-through">${fmtMoney(vmPool.totalBefore)}</span>`}
      </span>`}
    </div>
    ${(pool.cash.batches || []).length > 0 && html`<div data-cash-entries class="overflow-x-auto px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label=${pool.label + ' cash entries'} onKeyDown=${subtabKeys}>
      <div class="flex w-max gap-2">${entriesFor(pool).map(e => html`<button key=${e.id} role="tab" aria-selected=${String(e.id === currentEntry)} tabIndex=${e.id === currentEntry ? 0 : -1} class=${cx('t-small h-10 rounded-full px-3 font-semibold transition', e.id === currentEntry ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-ink-2')} onClick=${() => selectEntry(pool.id, e.id)}>${e.label}</button>`)}</div>
    </div>`}
    ${currentEntry === 'base' && html`<div class="px-4 pb-4 pt-3">
      <${Seg} value=${entryView} onChange=${v => { if (App.poolBaseMode(pool.id, v)) setLegacyView(v); }} items=${[{ value: 'total', label: 'Enter total' }, { value: 'bills', label: 'Count bills' }]} />
      <p class="t-small mt-2 text-ink-3">${pool.cash.baseMode ? 'Only the selected method counts. Switching keeps the other entry.' : (String(pool.cash.netTotal || '').trim() || counted > 0) ? 'Existing cash is preserved; choose a method to change how this entry is counted.' : 'Enter a total or count the bills for this entry.'}</p>
      ${entryView === 'total' ? html`<label class="t-small mb-1.5 mt-3 block font-medium text-ink-2" for=${'cash-' + pool.id}>${(pool.cash.batches || []).length ? 'Starting cash total' : 'Total cash'}</label><${Amount} pool=${pool} />
        ${!pool.cash.baseMode && counted > 0 && html`<p class="t-small mt-2 text-ink-3">Existing cash includes ${fmtMoney(counted)} in counted bills.</p>`}`
        : html`<p class="t-small mb-2 mt-3 text-ink-3">Count the bills in this entry.</p>
          <div class=${cx(BILL_GRID, 't-cap pb-1 text-ink-3')}><span>Bill</span><span class="text-center">Count</span><span class="text-right">Amount</span></div>
          ${DENOMS.map(d => html`<${BillRow} key=${d} pool=${pool} d=${d} />`)}
          <div class="t-small pt-2 text-right font-semibold text-ink-2">Counted ${fmtMoney(counted)}</div>`}
    </div>`}
    ${(pool.cash.batches || []).map((batch, i) => batch.id === currentEntry && html`<${CashBatch} key=${batch.id} pool=${pool} batch=${batch} index=${i} />`)}
    <div class="border-t border-line px-4 py-3"><${Button} variant="tonal" size="sm" icon="plus" onClick=${() => { const id = App.addCashBatch(pool.id); if (id) selectEntry(pool.id, id); }}>Add checkpoint<//>
      <${Button} variant="ghost" size="sm" icon="cash" onClick=${() => openCashSheet('ranges', pool.id)}>Bill counts<//></div>
    <div class="flex flex-col divide-y divide-line border-t border-line">
      ${!single && html`<${FormRow} label="Window" aside="tap a time to type it, hold for the wheel">
          ${pool.kind === 'party' && !pool.window.start.trim() && !pool.window.end.trim()
            && html`<span class="t-small text-warn">Set when the party started and ended — only hours inside it share its tips.</span>`}
          <${WindowEdge} vm=${vm} pool=${pool} vmPool=${vmPool} which="start" />
          <${WindowEdge} vm=${vm} pool=${pool} vmPool=${vmPool} which="end" />
        <//>
        <${FormRow} label="Label"><input class=${cx(INPUT, 'h-11')} value=${pool.label} aria-label="Pool label" onInput=${e => App.poolLabel(pool.id, e.target.value)} /><//>
        <div class="px-4 py-3"><${Button} variant="danger" size="sm" onClick=${() => App.removePool(pool.id)}>Remove pool<//></div>`}
    </div>
  <//>`;
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
  return html`<p class="t-small px-1 text-ink-3">After counting the register: what it's over or short comes out of (or goes into) the tips, and the split is redone. Summary shows Was · Now · ±.</p>
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

// Several pools: select a pool from the horizontal tab strip.
function Pools({ vm }) {
  const pool = vm.state.pools.find(p => p.id === vm.state.ui.selectedPool) || vm.state.pools[0];
  return html`<div class="flex flex-col gap-3">
    <div data-pool-tabs class="-mx-[var(--gutter)] overflow-x-auto px-[var(--gutter)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Tip pools" onKeyDown=${subtabKeys}>
      <div class="flex w-max gap-2">${vm.state.pools.map(p => html`<button key=${p.id} role="tab" aria-selected=${String(p.id === pool.id)} tabIndex=${p.id === pool.id ? 0 : -1} class=${cx('t-small h-11 rounded-full px-4 font-semibold transition', p.id === pool.id ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2')} onClick=${() => App.selectPool(p.id)}>${p.label}</button>`)}</div>
    </div>
    <${PoolCard} key=${pool.id} pool=${pool} vm=${vm} />
  </div>`;
}

// Shift type (Night: one pool · Day: Day + Mid pools) and parties.
function ShiftType({ vm }) {
  const type = vm.state.meta.shiftType || 'night';
  return html`<div class="flex items-center gap-2">
    <${Seg} class="flex-1" value=${type} onChange=${t => App.setShiftType(t)}
      items=${SHIFT_TYPES.map(t => ({ value: t, label: SHIFT_LABEL[t] + ' shift' }))} />
    <${Button} size="sm" variant="tonal" icon="plus" onClick=${() => App.addParty()}>Party<//>
  </div>`;
}

function Tips({ vm }) {
  const v = currentSub('tips');
  if (v === 'drawer') return null;              // Tips › Drawer is render/payout.js
  return v === 'pools' ? html`<${PoolSetup} vm=${vm} />` : html`<${Cash} vm=${vm} />`;
}

// Cash: what's in the pool(s), and the register over / short.
function Cash({ vm }) {
  const state = vm.state;
  const err = vm.inputError && vm.blockedTab === 'tips' ? vm.blocked : '';
  const single = state.pools.length === 1;
  const pool = state.pools.find(p => p.id === state.ui.selectedPool) || state.pools[0];
  const ready = !vm.blocked && vm.totalCash > 0;
  return html`<div class="flex flex-col gap-5">
    ${err && html`<${Alert}>${err}<//>`}
    ${vm.cashNote && html`<${Alert} tone="warn">${vm.cashNote}<//>`}
    ${single ? html`<${PoolCard} pool=${state.pools[0]} vm=${vm} />` : html`<${Pools} vm=${vm} />`}
    <${List}>
      <${Item} icon="swap" title="Register over / short" sub="Re-split if the register is off" onClick=${() => openCashSheet('adjust', pool.id)} />
      <${Item} icon="cash" title="Bill counts by checkpoint" sub="Lowest, highest and combined counts" onClick=${() => openCashSheet('ranges', pool.id)} />
    <//>
    ${ready && html`<${NextStep} tab="home" label="See who gets what"
      sub=${fmtMoney(vm.totalCash) + ' · $' + vm.shares.rate.toFixed(2) + ' an hour'} />`}
    ${vm.blockedTab === 'staff' && html`<${NextStep} tab="staff" label="Back to Staff" sub=${vm.blocked} />`}
  </div>`;
}

// Pools: how the tips are split — the shift type and parties, extra pools,
// who shares each, the support tip-out, the closer bonus & chump.
function PoolSetup({ vm }) {
  const state = vm.state;
  const pool = state.pools.find(p => p.id === state.ui.selectedPool) || state.pools[0];
  const single = state.pools.length === 1;
  return html`<div class="flex flex-col gap-5">
    <${Section} title="Shift type" footer=${(state.meta.shiftType || 'night') === 'day'
      ? 'Day: bar + servers share the floor until the servers are out, then Mid is the bar’s.'
      : 'Night: one pool for the whole shift.'}><${ShiftType} vm=${vm} /><//>
    ${state.settings.multiPool && html`<${Button} variant="tonal" block icon="plus" onClick=${() => App.addPool()}>Add pool<//>`}
    ${(state.settings.allRoles || !single) && html`<${Section} title=${'Who shares ' + pool.label}><${Card} flush><${SharedBy} pool=${pool} />${pool.includeSupport && html`<${SupportBox} pool=${pool} vm=${vm} vmPool=${vm.pools.find(p => p.id === pool.id)} />`}<//><//>`}
    <${SupportDefault} vm=${vm} />
    <${List}>
      <${Item} icon="gift" title="Closer bonus & chump" sub="Who gets the dollars left after rounding" onClick=${() => App.openBonus()} />
    <//>
  </div>`;
}

let lastVm = null;

export function renderTips(vm) {
  lastVm = vm;
  const root = $('tips-root');
  if (root) render(html`<${Tips} vm=${vm} />`, root);
  renderCashSheet(vm);
}

