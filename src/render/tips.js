// Tips tab (Preact). One pool: its card right on the page — the bills you
// counted (−/+ rows), the uncounted rest as one amount, a register over /
// short, shared-by chips, support. Several pools: a stacked card per pool
// (name, window, who shares it, total) — tap one to open it in a sheet with
// the full editor; "+ Add pool" opens the new pool's sheet. Under it, the
// best bills to pull for the uncounted rest.
//
// Inputs show the stored raw strings; Preact diffs each render, so typing
// keeps focus and the totals update around it.

import { DENOMS, parseWholeNumber, fmtHrs, fmtMoney } from '../util.js';
import { fmtTimeAbs, overlapHours } from '../time.js';
import { html, render, useState } from '../ui/preact.js';
import { cx, Card, Seg, Chip, Field, Button, Denom, Alert, Icon, List, Item, Section, INPUT, ROLE_DOT } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));
const SUB = 'flex flex-col gap-2.5';
const EYEBROW = 't-small font-medium text-ink-2';

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

  return html`<div class="flex flex-col gap-3 rounded-card bg-sup/8 p-4">
    <div class="flex items-baseline justify-between gap-2">
      <span class=${EYEBROW}>Support tip-out</span>
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

function BillRow({ pool, d }) {
  const v = pool.cash.billCounts[d] ?? '';
  const parsed = parseWholeNumber(v);
  const sub = parsed.valid ? parsed.value * d : 0;
  const step = 'grid size-10 shrink-0 place-items-center rounded-full text-[1.25rem] text-ink-2 active:bg-ink/10 active:text-ink';
  return html`<div class="grid grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 py-1.5 max-[25rem]:grid-cols-[3.125rem_minmax(0,1fr)_4rem] max-[25rem]:gap-2.5">
    <${Denom} d=${d} />
    <div class="flex items-center rounded-full bg-surface-2 focus-within:ring-2 focus-within:ring-accent/40">
      <button class=${step} onClick=${() => App.billStep(pool.id, String(d), -1)} aria-label=${'One fewer $' + d} tabindex="-1">−</button>
      <input class="h-10 w-full min-w-0 bg-transparent text-center text-[1.125rem] font-semibold text-ink outline-none placeholder:text-ink-3"
        type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint="next" data-bill=${d}
        aria-label=${'$' + d + ' bills'} value=${v} onInput=${e => App.poolBill(pool.id, String(d), e.target.value)}
        onKeyDown=${e => App.billKey(e, pool.id)} />
      <button class=${step} onClick=${() => App.billStep(pool.id, String(d), 1)} aria-label=${'One more $' + d} tabindex="-1">+</button>
    </div>
    <span class=${cx('t-body text-right font-semibold tabular-nums', !parsed.valid ? 'text-bad' : sub > 0 ? 'text-ink' : 'text-ink-3')}>
      ${!parsed.valid ? '!' : sub > 0 ? fmtMoney(sub) : '—'}</span>
  </div>`;
}

// The amount box. Meaning: just the cash (nothing counted), or — with Count
// bills open — the total including the counted bills, or only the rest.
function Amount({ pool, vmPool, counting }) {
  const total = counting && pool.cash.restMode === 'total';
  const hint = counting && vmPool && String(pool.cash.netTotal).trim() !== ''
    ? (total ? fmtMoney(vmPool.rest) + ' not counted' : 'not counted') : '';
  return html`<div class="relative">
    <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.5rem] font-medium text-ink-3">$</span>
    <input class=${cx(INPUT, 'h-14 pl-10 text-[1.75rem] font-semibold tracking-tight')}
      type="number" min="0" step="1" placeholder="0" inputmode="numeric" data-rest
      aria-label=${!counting ? 'Cash' : total ? 'Total cash' : 'Uncounted cash'}
      value=${pool.cash.netTotal} onInput=${e => App.poolNet(pool.id, e.target.value)} />
    ${hint && html`<span class="t-small pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-3">${hint}</span>`}
  </div>`;
}

// An option that opens part of the form (Count bills, Over / short).
function Toggle({ on, icon, onClick, children }) {
  return html`<button class=${cx('t-small inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-semibold transition active:scale-95',
    on ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-ink-2')} aria-pressed=${String(!!on)} onClick=${onClick}>
    <${Icon} name=${on ? 'check' : icon} class="size-4" />${children}</button>`;
}

// Register over / short: a Short / Over switch and an amount, stored as one
// signed string ("-50"). iOS number pads have no minus key, hence the switch.
function Adjust({ pool }) {
  const raw = String(pool.cash.adjust || '').trim();
  const neg = raw.startsWith('-') || raw.startsWith('−');
  const [sign, setSign] = useState(neg || !raw ? -1 : 1);
  const amount = raw.replace(/^[-+−]/, '');
  const write = (sg, amt) => App.poolAdjust(pool.id, amt ? (sg < 0 ? '-' : '') + amt : '');
  return html`<div class="flex gap-2">
    <${Seg} class="w-40 shrink-0" value=${raw ? (neg ? -1 : 1) : sign}
      onChange=${v => { setSign(v); write(v, amount); }}
      items=${[{ value: -1, label: 'Short' }, { value: 1, label: 'Over' }]} />
    <div class="relative flex-1">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
      <input class=${cx(INPUT, 'h-9 pl-7 font-semibold')} type="number" min="0" step="1" placeholder="0" inputmode="numeric"
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
function PoolCard({ pool, vm }) {
  const single = vm.state.pools.length === 1;
  const showChips = vm.state.settings.allRoles || !single;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const counted = vmPool?.counted || 0, adj = vmPool?.adjust || 0;
  const [count, setCount] = useState(counted > 0);
  const [over, setOver] = useState(!!String(pool.cash.adjust || '').trim());
  const counting = count || counted > 0;
  const adjusting = over || adj !== 0;
  const parts = [counted > 0 && fmtMoney(counted) + ' counted', counted > 0 && vmPool.rest > 0 && fmtMoney(vmPool.rest) + ' rest',
    adj !== 0 && fmtMoney(Math.abs(adj)) + (adj < 0 ? ' short' : ' over')].filter(Boolean);

  return html`<${Card} flush data-pid=${pool.id}>
    <div class="flex w-full items-start gap-3 px-4 pb-1 pt-4">
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="t-head truncate">${single ? 'Tonight’s tips' : pool.label}</span>
        <span class="t-small text-ink-3">${parts.length ? parts.join(' · ') : windowSub(pool, vmPool)}</span>
      </span>
      <span class="flex shrink-0 flex-col items-end">
        <span class=${cx('text-[1.75rem] font-semibold leading-tight tracking-tight tabular-nums', !total && 'text-ink-3')}>${fmtMoney(total)}</span>
        ${adj !== 0 && html`<span class="t-small text-ink-3 line-through">${fmtMoney(vmPool.totalBefore)}</span>`}
      </span>
    </div>
    <div class="flex flex-col gap-4 px-4 pb-4 pt-3">
      <${Amount} pool=${pool} vmPool=${vmPool} counting=${counting} />
      <div class="flex flex-wrap gap-2">
        <${Toggle} on=${counting} icon="cash" onClick=${() => {
          if (counting) { setCount(false); App.poolCounting(pool.id, false); } else { setCount(true); App.poolCounting(pool.id, true); }
        }}>Count bills<//>
        <${Toggle} on=${adjusting} icon="swap" onClick=${() => {
          if (adjusting) { setOver(false); App.poolAdjust(pool.id, ''); } else setOver(true);
        }}>Over / short<//>
      </div>
      ${counting && html`<div class=${SUB}>
        <span class="flex items-center justify-between gap-3">
          <span class=${EYEBROW}>Bills you counted</span>
          <span class="flex shrink-0 items-center gap-2">
            <span class="t-small text-ink-3">Amount is the</span>
            <${Seg} size="sm" class="w-32" value=${pool.cash.restMode === 'total' ? 'total' : 'rest'} onChange=${m => App.poolRestMode(pool.id, m)}
              items=${[{ value: 'total', label: 'Total' }, { value: 'rest', label: 'Rest' }]} />
          </span>
        </span>
        <div class="flex flex-col divide-y divide-line">${DENOMS.map(d => html`<${BillRow} key=${d} pool=${pool} d=${d} />`)}</div>
      </div>`}
      ${adjusting && html`<div class=${SUB}>
        <span class=${EYEBROW}>Register over / short <span class="font-normal text-ink-3">· re-splits the tips</span></span>
        <${Adjust} key=${pool.id} pool=${pool} />
      </div>`}
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

// Which bills to pull for the uncounted rest (all pools together).
function Suggested({ vm }) {
  const add = vm.looseBills;
  if (!add || !vm.bills || vm.totalCash <= 0) return null;
  const ds = [100, 50, 20, 10, 5, 1].filter(d => add[d] > 0);
  if (!ds.length) return null;
  const sum = ds.reduce((t, d) => t + add[d] * d, 0);
  return html`<${Section} title=${'Best bills for the ' + fmtMoney(sum) + (vm.counted ? ' not counted' : '')}
    footer="Enough $1 / $5 / $10s for every payout to come out exact, the rest in $20s."><${Card}>
    <div class="divide-y divide-line">${ds.map(d => html`<div key=${d} class="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2.5">
      <${Denom} d=${d} /><span class="t-body text-ink-2">× ${add[d]}</span>
      <span class="t-body font-semibold tabular-nums">${fmtMoney(add[d] * d)}</span></div>`)}</div>
  <//><//>`;
}

// Several pools: one compact card per pool → its sheet.
function PoolTile({ pool, vm }) {
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const who = [pool.roles?.bartender && 'bartender', pool.roles?.server && 'server', pool.includeSupport && 'support'].filter(Boolean);
  return html`<${Item} onClick=${() => App.openPool(pool.id)} title=${pool.label}
    sub=${html`<span class="flex items-center gap-2">${windowSub(pool, vmPool)}
      ${vm.state.settings.allRoles && html`<span class="flex items-center gap-1">${who.map(r => html`<span key=${r} class=${cx('size-1.5 rounded-full', ROLE_DOT[r])}></span>`)}</span>`}
      ${vmPool?.adjust ? html`<span class=${vmPool.adjust < 0 ? 'text-bad' : 'text-good'}>· ${vmPool.adjust < 0 ? '−' : '+'}${fmtMoney(Math.abs(vmPool.adjust))}</span>` : null}</span>`}
    value=${fmtMoney(total)} valueTone=${!total ? 'text-ink-3' : ''} />`;
}

function Tips({ vm }) {
  const state = vm.state;
  const err = vm.inputError && /cash|count|window|support|short|holds/i.test(vm.blocked) ? vm.blocked : '';
  const single = state.pools.length === 1;
  return html`<div class="flex flex-col gap-3">
    ${err && html`<${Alert}>${err}<//>`}
    ${vm.cashNote && html`<${Alert} tone="warn">${vm.cashNote}<//>`}
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
