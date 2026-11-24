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
import { fmtTimeAbs, overlapHours, atOrAfterOf, absToEdgeRaw } from '../time.js';
import { focusCell } from '../ui/keypad.js';
import { EDGE_TOKENS } from '../resolve.js';
import { SHIFT_TYPES, SHIFT_LABEL } from '../shifts.js';
import { KeyTime } from '../ui/keytime.js';
import { html, render, useState } from '../ui/preact.js';
import { cx, Card, Seg, Chip, Field, Button, Denom, Alert, Icon, List, Item, Section, NextStep, Table, Money, SwitchRow, INPUT, ROLE_DOT, zebra, holdRepeat } from '../ui/pkit.js';
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

function BillRow({ pool, d }) {
  const v = pool.cash.billCounts[d] ?? '';
  const parsed = parseWholeNumber(v);
  const sub = parsed.valid ? parsed.value * d : 0;
  const step = 'grid size-11 shrink-0 select-none place-items-center rounded-full text-[1.375rem] text-ink-2 active:bg-ink/10 active:text-ink [-webkit-touch-callout:none]';
  return html`<div class=${cx(BILL_GRID, 'min-h-[var(--row-lg)] px-4 py-1')}>
    <${Denom} d=${d} />
    <div class="flex items-center rounded-full bg-surface-2 focus-within:ring-2 focus-within:ring-accent/40">
      <button class=${step} ...${holdRepeat(() => App.billStep(pool.id, String(d), -1))} aria-label=${'One fewer $' + d} tabindex="-1">−</button>
      <input class="h-11 w-full min-w-0 bg-transparent text-center text-[1.125rem] font-semibold text-ink outline-none placeholder:text-ink-3"
        type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint="next" data-bill=${d}
        aria-label=${'$' + d + ' bills'} value=${v} onInput=${e => App.poolBill(pool.id, String(d), e.target.value)}
        onKeyDown=${e => App.billKey(e, pool.id)} />
      <button class=${step} ...${holdRepeat(() => App.billStep(pool.id, String(d), 1))} aria-label=${'One more $' + d} tabindex="-1">+</button>
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

// The bill rows' columns (Bill · Count · Amount), shared with their caption.
const BILL_GRID = 'grid grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 max-[25rem]:grid-cols-[3.125rem_minmax(0,1fr)_4rem] max-[25rem]:gap-2.5';

// One row of the cash form's grid: a full-width switch (the settings switch)
// with a title and a line under it; what it opens follows as more rows.
function OptRow({ on, title, sub, onClick }) {
  return html`<button role="switch" aria-checked=${String(!!on)} onClick=${onClick}
    class="switch-row flex min-h-[var(--row-lg)] w-full items-center gap-3 px-4 py-2 text-left transition active:bg-surface-2">
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="t-body font-medium">${title}</span>
      ${sub && html`<span class="t-small text-ink-3">${sub}</span>`}
    </span>
    <span class="switch"></span>
  </button>`;
}
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
function PoolCard({ pool, vm }) {
  const single = vm.state.pools.length === 1;
  const showChips = vm.state.settings.allRoles || !single;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const counted = vmPool?.counted || 0, adj = vmPool?.adjust || 0;
  const counting = counted > 0 || countOn.has(pool.id);
  const parts = [counted > 0 && fmtMoney(counted) + ' counted', counted > 0 && vmPool.rest > 0 && fmtMoney(vmPool.rest) + ' rest',
    adj !== 0 && fmtMoney(Math.abs(adj)) + (adj < 0 ? ' short' : ' over')].filter(Boolean);
  const row = 'li flex min-h-[var(--row-lg)] w-full items-center gap-3 px-4 py-2 text-left transition active:bg-surface-2';

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
    <div class="px-4 pb-4 pt-3"><${Amount} pool=${pool} vmPool=${vmPool} counting=${counting} /></div>
    <div class="flex flex-col divide-y divide-line border-t border-line">
      <button class=${row} onClick=${() => openCashSheet('count', pool.id)}>
        <span class="flex min-w-0 flex-1 flex-col"><span class="t-body font-medium">Count bills</span>
          <span class="t-small text-ink-3">${counting ? fmtMoney(counted) + ' counted · the amount is the ' + (pool.cash.restMode === 'total' ? 'total' : 'rest') : 'Off — count the bills you can see'}</span></span>
        ${counting && html`<span class="t-body font-semibold tabular-nums">${fmtMoney(counted)}</span>`}
        <${Icon} name="chevR" class="size-4 shrink-0 text-ink-3/70" />
      </button>
      <button class=${row} onClick=${() => openCashSheet('adjust', pool.id)}>
        <span class="flex min-w-0 flex-1 flex-col"><span class="t-body font-medium">Register over / short</span>
          <span class="t-small text-ink-3">${adj ? 'Re-splits the tips' : 'None'}</span></span>
        ${adj !== 0 && html`<span class=${cx('t-body font-semibold tabular-nums', adj < 0 ? 'text-bad' : 'text-good')}>${adj < 0 ? '−' : '+'}${fmtMoney(Math.abs(adj))}</span>`}
        <${Icon} name="chevR" class="size-4 shrink-0 text-ink-3/70" />
      </button>
      ${showChips && html`<${SharedBy} pool=${pool} />`}
      ${pool.includeSupport && html`<${SupportBox} pool=${pool} vm=${vm} vmPool=${vmPool} />`}
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
// Count bills: a switch, the bill rows (Bill · Count · Amount, large −/+ you
// can hold), the Counted total with "the amount is the Total / Rest".
// Over / short: the register adjustment.
const countOn = new Set();          // pools whose Count bills is on with nothing counted yet
let cashSheet = null;               // { which: 'count' | 'adjust', id }
onSheetClose('sheet-count', () => { cashSheet = null; });
onSheetClose('sheet-adjust', () => { cashSheet = null; });
function openCashSheet(which, id) {
  cashSheet = { which, id };
  openSheet('sheet-' + which);
  if (lastVm) renderCashSheet(lastVm);
}
function CountBody({ vm, pool }) {
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const counted = vmPool?.counted || 0;
  const on = counted > 0 || countOn.has(pool.id);
  const flip = () => {
    if (on) { countOn.delete(pool.id); App.poolCounting(pool.id, false); } else { countOn.add(pool.id); App.poolCounting(pool.id, true); }
  };
  return html`<${Card} flush>
    <${OptRow} on=${on} title="Count bills" sub=${on ? 'Off folds the counted bills back into the amount' : 'Count the bills you can see — the rest is picked for you'} onClick=${flip} />
    ${on && html`<div class="flex flex-col border-t border-line">
      <div class=${cx(BILL_GRID, 't-cap px-4 pb-1 pt-2 text-ink-3')}><span>Bill</span><span class="text-center">Count</span><span class="text-right">Amount</span></div>
      ${DENOMS.map((d, i) => html`<div key=${d} class=${zebra(i)}><${BillRow} pool=${pool} d=${d} /></div>`)}
      <div class=${cx(BILL_GRID, 'min-h-[var(--row)] bg-surface-2 px-4 font-semibold')}>
        <span class="t-body">Counted</span>
        <span class="t-small flex items-center justify-center gap-2 font-normal text-ink-3">Amount is the
          <${Seg} size="sm" class="w-28" value=${pool.cash.restMode === 'total' ? 'total' : 'rest'} onChange=${m => App.poolRestMode(pool.id, m)}
            items=${[{ value: 'total', label: 'Total' }, { value: 'rest', label: 'Rest' }]} /></span>
        <span class="t-body text-right tabular-nums">${fmtMoney(counted)}</span>
      </div>
    </div>`}
  <//>`;
}
function AdjustBody({ pool }) {
  return html`<p class="t-small px-1 text-ink-3">After counting the register: what it's over or short comes out of (or goes into) the tips, and the split is redone. Summary shows Was · Now · ±.</p>
    <${Card}><${Adjust} key=${pool.id} pool=${pool} /><//>
    ${String(pool.cash.adjust || '').trim() && html`<${Button} block onClick=${() => App.poolAdjust(pool.id, '')}>Clear — no over / short<//>`}`;
}
function renderCashSheet(vm) {
  if (!cashSheet) return;
  const id = 'sheet-' + cashSheet.which;
  if (!isOpen(id)) return;
  const pool = vm.state.pools.find(p => p.id === cashSheet.id);
  if (!pool) { closeSheet(id); return; }
  setSheetTitle(id, (cashSheet.which === 'count' ? 'Count bills' : 'Register over / short') + (vm.state.pools.length > 1 ? ' · ' + pool.label : ''));
  render(cashSheet.which === 'count' ? html`<${CountBody} vm=${vm} pool=${pool} />` : html`<${AdjustBody} pool=${pool} />`, sheetBody(id));
}

// Which bills to pull for the uncounted rest (all pools together) — a Table
// like Payout's: Bill · Count · Amount, total row.
function Suggested({ vm }) {
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

// Several pools: each pool's card in turn, one under the other (a page swipe
// moves between pages, not pools).
function Pools({ vm }) {
  return html`<div class="flex flex-col gap-5">
    ${vm.state.pools.map(p => html`<${PoolCard} key=${p.id} pool=${p} vm=${vm} />`)}
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
  const state = vm.state;
  const err = vm.inputError && vm.blockedTab === 'tips' ? vm.blocked : '';
  const single = state.pools.length === 1;
  const ready = !vm.blocked && vm.totalCash > 0;
  return html`<div class="flex flex-col gap-3">
    ${err && html`<${Alert}>${err}<//>`}
    ${vm.cashNote && html`<${Alert} tone="warn">${vm.cashNote}<//>`}
    <${ShiftType} vm=${vm} />
    ${state.meta.shiftType === 'day' && html`<p class="t-small px-1 text-ink-3">Day: bar + servers share the floor until the servers are out; then Mid is the bar’s alone. Parties are their own tips, shared by whoever worked inside the party’s window.</p>`}
    ${single ? html`<${PoolCard} pool=${state.pools[0]} vm=${vm} />` : html`<${Pools} vm=${vm} />`}
    ${state.settings.multiPool && html`<${Button} variant="tonal" block icon="plus" onClick=${() => App.addPool()}>Add pool<//>`}
    <${Suggested} vm=${vm} />
    ${ready && html`<${NextStep} tab="summary" label="See who gets what"
      sub=${fmtMoney(vm.totalCash) + ' · $' + vm.shares.rate.toFixed(2) + ' an hour'} />`}
    ${vm.blockedTab === 'staff' && html`<${NextStep} tab="staff" label="Back to Staff" sub=${vm.blocked} />`}
    <${Section} title="This page"><${List}>
      <${SwitchRow} on=${state.settings.multiPool} disabled=${state.pools.length > 1} onClick=${() => App.toggleSetting('multiPool')}
        icon="dollar" label="Several pools" hint=${state.pools.length > 1 ? 'On while there’s more than one pool' : 'Split the night into pools (day · mid · parties)'} />
      <${SwitchRow} on=${state.settings.allRoles} onClick=${() => App.toggleSetting('allRoles')}
        icon="users" label="Roles" hint="Bar · servers · support share pools by role" />
    <//><//>
  </div>`;
}

let lastVm = null;

export function renderTips(vm) {
  lastVm = vm;
  const root = $('tips-root');
  if (root) render(html`<${Tips} vm=${vm} />`, root);
  renderCashSheet(vm);
}

