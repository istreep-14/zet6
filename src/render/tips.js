// Tips tab (Preact). One pool: its card right on the page (Net total / Count
// bills seg, entry, shared-by chips, support). Several pools: a stacked card
// per pool (name, window, who shares it, total) — tap one to open it in a
// sheet with the full editor; "+ Add pool" opens the new pool's sheet.
//
// Inputs show the stored raw strings; Preact diffs each render, so typing
// keeps focus and the totals update around it.

import { DENOMS, parseWholeNumber, fmtHrs, fmtMoney } from '../util.js';
import { fmtTimeAbs, overlapHours } from '../time.js';
import { html, render } from '../ui/preact.js';
import { cx, Card, Seg, Chip, Field, Button, Denom, Alert, Icon, List, Item, INPUT, ROLE_DOT } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));
const SUB = 'flex flex-col gap-2.5';
const EYEBROW = 'text-[0.875rem] font-medium text-ink-2';

function windowSub(pool, vmPool) {
  const start = pool.window.start.trim();
  const end = pool.window.end.trim();
  if (!start && !end) return 'Whole shift';
  const fmt = (raw, abs) => abs != null ? fmtTimeAbs(abs) : (raw || '?');
  return fmt(start, vmPool?.startAbs) + ' – ' + fmt(end, vmPool?.endAbs);
}

function SharedBy({ pool }) {
  return html`<div class=${SUB}>
    <span class=${EYEBROW}>Shared by</span>
    <div class="flex gap-2">
      <${Chip} on=${pool.roles.bartender} role="bartender" onClick=${() => App.poolRole(pool.id, 'bartender')}>Bar<//>
      <${Chip} on=${pool.roles.server} role="server" onClick=${() => App.poolRole(pool.id, 'server')}>Servers<//>
      <${Chip} on=${pool.includeSupport} role="support" onClick=${() => App.poolRole(pool.id, 'support')}>Support<//>
    </div>
  </div>`;
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

  return html`<div class="flex flex-col gap-3 rounded-2xl bg-sup/8 p-4 ring-1 ring-sup/20">
    <div class="flex items-baseline justify-between gap-2">
      <span class=${EYEBROW}>Support tip-out</span>
      <span class="text-right text-[0.8125rem] font-medium text-sup">${cut}</span>
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
        return html`<div key=${p.id} class="grid grid-cols-[minmax(0,1fr)_4rem_0.875rem_4.5rem] items-center gap-2 text-[0.9375rem]">
          <span class="truncate">${p.name}</span>
          <input class=${cx(INPUT, 'h-10 text-center font-semibold')} inputmode="decimal" placeholder=${fmtHrs(auto)}
            aria-label=${p.name + ' hours'} value=${cfg.hours?.[p.id] ?? ''} onInput=${e => App.poolSupportHours(pool.id, p.id, e.target.value)} />
          <span class="text-ink-2">h</span>
          <span class="text-right font-semibold tabular-nums">${part ? '$' + fmtAmt(part.raw) : '—'}</span>
        </div>`;
      })
      : html`<div class="text-[0.875rem] text-ink-3">No support staff named yet.</div>`}
  </div>`;
}

function BillRow({ pool, d }) {
  const v = pool.cash.billCounts[d] ?? '';
  const parsed = parseWholeNumber(v);
  const sub = parsed.valid ? parsed.value * d : 0;
  const step = 'grid size-[2.625rem] shrink-0 place-items-center rounded-full text-[1.375rem] text-ink-2 active:bg-high active:text-ink';
  return html`<div class="grid grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 py-2 max-[25rem]:grid-cols-[3.125rem_minmax(0,1fr)_4rem] max-[25rem]:gap-2.5">
    <${Denom} d=${d} />
    <div class="flex items-center rounded-full bg-fill focus-within:ring-2 focus-within:ring-gold">
      <button class=${step} onClick=${() => App.billStep(pool.id, String(d), -1)} aria-label=${'One fewer $' + d} tabindex="-1">−</button>
      <input class="h-[2.625rem] w-full min-w-0 bg-transparent text-center text-[1.25rem] font-semibold text-ink outline-none placeholder:text-ink-3"
        type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint="next" data-bill=${d}
        aria-label=${'$' + d + ' bills'} value=${v} onInput=${e => App.poolBill(pool.id, String(d), e.target.value)}
        onKeyDown=${e => App.billKey(e, pool.id)} />
      <button class=${step} onClick=${() => App.billStep(pool.id, String(d), 1)} aria-label=${'One more $' + d} tabindex="-1">+</button>
    </div>
    <span class=${cx('text-right text-[1.125rem] font-semibold tabular-nums', !parsed.valid ? 'text-red' : sub > 0 ? 'text-ink' : 'text-ink-3')}>
      ${!parsed.valid ? '!' : sub > 0 ? fmtMoney(sub) : '—'}</span>
  </div>`;
}

function NetTotal({ pool }) {
  return html`<div class="relative">
    <span class="pointer-events-none absolute left-[1.125rem] top-1/2 -translate-y-1/2 font-rounded text-[2rem] font-semibold text-ink-3">$</span>
    <input class=${cx(INPUT, 'h-[5.25rem] rounded-2xl pl-12 font-rounded text-[2.625rem] font-bold tracking-tight')}
      type="number" min="0" step="1" placeholder="0" inputmode="numeric" aria-label="Net total"
      value=${pool.cash.netTotal} onInput=${e => App.poolNet(pool.id, e.target.value)} />
  </div>`;
}

// What a card shows depends on the session's complexity:
//   single pool             → no label or window
//   roles off + single pool → no "Shared by" chips either (everyone shares)
function PoolCard({ pool, vm }) {
  const single = vm.state.pools.length === 1;
  const showChips = vm.state.settings.allRoles || !single;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const mode = pool.cash.entryMode;

  return html`<${Card} flush data-pid=${pool.id}>
    <div class="flex w-full items-center gap-3 px-4 pb-3 pt-4">
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[1.0625rem] font-semibold">${single ? 'Tonight’s tips' : pool.label}</span>
        <span class="text-[0.875rem] text-ink-2">${windowSub(pool, vmPool)}</span>
      </span>
      <span class=${cx('font-rounded text-[1.875rem] font-bold tracking-tight tabular-nums', !total && 'text-ink-3')}>${fmtMoney(total)}</span>
    </div>
    <div class="flex flex-col gap-5 px-4 pb-4 pt-1">
      <div class=${SUB}>
        ${html`<${Seg} items=${[{ value: 'nettotal', label: 'Net total' }, { value: 'perbill', label: 'Count bills' }]}
          value=${mode} onChange=${v => App.poolMode(pool.id, v)} />`}
        ${mode === 'perbill'
          ? html`<div class="flex flex-col divide-y divide-sep">${DENOMS.map(d => html`<${BillRow} key=${d} pool=${pool} d=${d} />`)}</div>`
          : html`<${NetTotal} pool=${pool} />`}
      </div>
      ${showChips && html`<${SharedBy} pool=${pool} />`}
      ${pool.includeSupport && html`<${SupportBox} pool=${pool} vm=${vm} vmPool=${vmPool} />`}
      ${!single && html`<div class=${SUB}>
          <span class=${EYEBROW}>Window <span class="font-normal text-ink-3">· blank = whole shift</span></span>
          <div class="flex gap-3">
            <${Field} label="Start" inputmode="decimal" placeholder="open" value=${pool.window.start} onInput=${e => App.poolWindow(pool.id, 'start', e.target.value)} />
            <${Field} label="End" inputmode="decimal" placeholder="close" value=${pool.window.end} onInput=${e => App.poolWindow(pool.id, 'end', e.target.value)} />
          </div>
        </div>
        <${Field} label="Label" value=${pool.label} onInput=${e => App.poolLabel(pool.id, e.target.value)} />
        <${Button} variant="danger" size="sm" class="self-start" onClick=${() => { closeSheet('sheet-pool'); App.removePool(pool.id); }}>Remove pool<//>`}
    </div>
  <//>`;
}

// Suggested drawer — single-pool net-total sessions: which bills to pull.
function Suggested({ vm }) {
  if (vm.state.pools.length !== 1 || vm.state.pools[0].cash.entryMode !== 'nettotal') return null;
  if (!vm.bills || vm.totalCash <= 0) return null;
  const notes = { 20: 'fill', 10: 'min', 5: 'min', 1: 'min' };
  return html`<${Card}>
    <div class="mb-1 text-[0.875rem] font-medium text-ink-2">Suggested bills for ${fmtMoney(vm.totalCash)}</div>
    <div class="divide-y divide-sep">${[20, 10, 5, 1].filter(d => vm.bills[d]).map(d => html`<div key=${d} class="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2.5">
      <${Denom} d=${d} /><span class="text-[0.9375rem] text-ink-2">× ${vm.bills[d]} <small class="ml-1 text-[0.8125rem] text-ink-3">${notes[d]}</small></span>
      <span class="text-[1.0625rem] font-semibold tabular-nums">${fmtMoney(vm.bills[d] * d)}</span></div>`)}</div>
  <//>`;
}

// Several pools: one compact card per pool → its sheet.
function PoolTile({ pool, vm }) {
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const who = [pool.roles?.bartender && 'bartender', pool.roles?.server && 'server', pool.includeSupport && 'support'].filter(Boolean);
  return html`<${Item} onClick=${() => App.openPool(pool.id)} title=${pool.label}
    sub=${html`<span class="flex items-center gap-2">${windowSub(pool, vmPool)}
      ${vm.state.settings.allRoles && html`<span class="flex items-center gap-1">${who.map(r => html`<span key=${r} class=${cx('size-1.5 rounded-full', ROLE_DOT[r])}></span>`)}</span>`}
      <span class="text-ink-3">· ${pool.cash.entryMode === 'perbill' ? 'bills' : 'net'}</span></span>`}
    value=${fmtMoney(total)} valueTone=${!total ? 'text-ink-3' : ''} />`;
}

function Tips({ vm }) {
  const state = vm.state;
  const err = vm.inputError && /total|count|window|support/i.test(vm.blocked) ? vm.blocked : '';
  const single = state.pools.length === 1;
  return html`<div class="flex flex-col gap-3">
    ${err && html`<${Alert}>${err}<//>`}
    ${single
      ? html`<${PoolCard} pool=${state.pools[0]} vm=${vm} />`
      : html`<${List}>${state.pools.map(pool => html`<${PoolTile} key=${pool.id} pool=${pool} vm=${vm} />`)}<//>`}
    ${(state.settings.multiPool || !single) && html`<${Button} variant="tonal" block icon="plus" onClick=${() => App.addPool()}>Add pool<//>`}
    <${Suggested} vm=${vm} />
  </div>`;
}

// The pool sheet (several pools): the full editor card for one pool.
let sheetPool = null;
let lastVm = null;
onSheetClose('sheet-pool', () => { sheetPool = null; });
export function openPoolSheet(id) {
  sheetPool = id;
  openSheet('sheet-pool');
  if (lastVm) renderPoolSheet(lastVm);
}
function renderPoolSheet(vm) {
  if (!sheetPool || !isOpen('sheet-pool')) return;
  const pool = vm.state.pools.find(p => p.id === sheetPool);
  if (!pool || vm.state.pools.length < 2) { closeSheet('sheet-pool'); return; }
  setSheetTitle('sheet-pool', pool.label || 'Pool');
  render(html`<${PoolCard} key=${pool.id} pool=${pool} vm=${vm} />`, sheetBody('sheet-pool'));
}

export function renderTips(vm) {
  lastVm = vm;
  const root = $('tips-root');
  if (root) render(html`<${Tips} vm=${vm} />`, root);
  renderPoolSheet(vm);
}

// Kept for callers from before the Preact port: Preact always shows the
// stored values, so there is nothing to invalidate.
export function invalidateTips() {}
