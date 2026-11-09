// Tips tab (Preact) — one pool's card at a time. A normal night is one pool;
// its Net total / Count bills choice is the tab's swipeable sub-tab header.
// With several pools, the header lists the pools (swipe between them) and
// each card has its own entry mode, time window, roles and cash.
//
// Inputs show the stored raw strings; Preact diffs each render, so typing
// keeps focus and the totals update around it.

import { DENOMS, parseWholeNumber, fmtHrs, fmtMoney } from '../util.js';
import { fmtTimeAbs, overlapHours } from '../time.js';
import { html, render } from '../ui/preact.js';
import { cx, Card, Seg, Chip, Field, Button, Denom, Alert, INPUT } from '../ui/pkit.js';
import { activeSub } from './tabs.js';

const $ = id => document.getElementById(id);

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));
const SUB = 'flex flex-col gap-2.5';
const EYEBROW = 'text-[14px] font-medium text-ink-2';

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
      <span class="text-right text-[13px] font-medium text-sup">${cut}</span>
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
        return html`<div key=${p.id} class="grid grid-cols-[minmax(0,1fr)_64px_14px_72px] items-center gap-2 text-[15px]">
          <span class="truncate">${p.name}</span>
          <input class=${cx(INPUT, 'h-10 text-center font-semibold')} inputmode="decimal" placeholder=${fmtHrs(auto)}
            aria-label=${p.name + ' hours'} value=${cfg.hours?.[p.id] ?? ''} onInput=${e => App.poolSupportHours(pool.id, p.id, e.target.value)} />
          <span class="text-ink-2">h</span>
          <span class="text-right font-semibold tabular-nums">${part ? '$' + fmtAmt(part.raw) : '—'}</span>
        </div>`;
      })
      : html`<div class="text-[14px] text-ink-3">No support staff named yet.</div>`}
  </div>`;
}

function BillRow({ pool, d }) {
  const v = pool.cash.billCounts[d] ?? '';
  const parsed = parseWholeNumber(v);
  const sub = parsed.valid ? parsed.value * d : 0;
  const step = 'grid size-[46px] shrink-0 place-items-center rounded-full text-[24px] active:bg-fill';
  return html`<div class="grid grid-cols-[56px_minmax(0,1fr)_76px] items-center gap-3 py-1.5 max-[400px]:grid-cols-[50px_minmax(0,1fr)_64px] max-[400px]:gap-2.5">
    <${Denom} d=${d} />
    <div class="flex items-center rounded-full bg-fill focus-within:ring-2 focus-within:ring-gold">
      <button class=${step} onClick=${() => App.billStep(pool.id, String(d), -1)} aria-label=${'One fewer $' + d} tabindex="-1">−</button>
      <input class="h-[46px] w-full min-w-0 bg-transparent text-center text-[20px] font-semibold text-ink outline-none placeholder:text-ink-3"
        type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint="next" data-bill=${d}
        aria-label=${'$' + d + ' bills'} value=${v} onInput=${e => App.poolBill(pool.id, String(d), e.target.value)}
        onKeyDown=${e => App.billKey(e, pool.id)} />
      <button class=${step} onClick=${() => App.billStep(pool.id, String(d), 1)} aria-label=${'One more $' + d} tabindex="-1">+</button>
    </div>
    <span class=${cx('text-right text-[18px] font-semibold tabular-nums', !parsed.valid ? 'text-red' : sub > 0 ? 'text-ink' : 'text-ink-3')}>
      ${!parsed.valid ? '!' : sub > 0 ? fmtMoney(sub) : '—'}</span>
  </div>`;
}

function NetTotal({ pool }) {
  return html`<div class="relative">
    <span class="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 font-rounded text-[32px] font-semibold text-ink-3">$</span>
    <input class=${cx(INPUT, 'h-[84px] rounded-2xl pl-12 font-rounded text-[42px] font-bold tracking-tight')}
      type="number" min="0" step="1" placeholder="0" inputmode="numeric" aria-label="Net total"
      value=${pool.cash.netTotal} onInput=${e => App.poolNet(pool.id, e.target.value)} />
  </div>`;
}

// What a card shows depends on the session's complexity:
//   single pool             → no label, window or mode seg (the header has it)
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
        <span class="truncate text-[17px] font-semibold">${single ? 'Tonight’s tips' : pool.label}</span>
        <span class="text-[14px] text-ink-2">${windowSub(pool, vmPool)}</span>
      </span>
      <span class=${cx('font-rounded text-[30px] font-bold tracking-tight tabular-nums', !total && 'text-ink-3')}>${fmtMoney(total)}</span>
    </div>
    <div class="flex flex-col gap-5 px-4 pb-4 pt-1">
      <div class=${SUB}>
        ${!single && html`<${Seg} items=${[{ value: 'nettotal', label: 'Net total' }, { value: 'perbill', label: 'Count bills' }]}
          value=${mode} onChange=${v => App.poolMode(pool.id, v)} />`}
        ${mode === 'perbill'
          ? html`<div class="flex flex-col divide-y divide-sep rounded-2xl bg-fill-2 px-3.5 py-1">${DENOMS.map(d => html`<${BillRow} key=${d} pool=${pool} d=${d} />`)}</div>`
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
        <${Button} variant="danger" size="sm" class="self-start" onClick=${() => App.removePool(pool.id)}>Remove pool<//>`}
    </div>
  <//>`;
}

// Suggested drawer — single-pool net-total sessions: which bills to pull.
function Suggested({ vm }) {
  if (vm.state.pools.length !== 1 || vm.state.pools[0].cash.entryMode !== 'nettotal') return null;
  if (!vm.bills || vm.totalCash <= 0) return null;
  const notes = { 20: 'fill', 10: 'min', 5: 'min', 1: 'min' };
  return html`<${Card}>
    <div class="mb-1 text-[14px] font-medium text-ink-2">Suggested bills for ${fmtMoney(vm.totalCash)}</div>
    <div class="divide-y divide-sep">${[20, 10, 5, 1].filter(d => vm.bills[d]).map(d => html`<div key=${d} class="grid grid-cols-[56px_1fr_auto] items-center gap-3 py-2.5">
      <${Denom} d=${d} /><span class="text-[15px] text-ink-2">× ${vm.bills[d]} <small class="ml-1 text-[13px] text-ink-3">${notes[d]}</small></span>
      <span class="text-[17px] font-semibold tabular-nums">${fmtMoney(vm.bills[d] * d)}</span></div>`)}</div>
  <//>`;
}

function Tips({ vm }) {
  const state = vm.state;
  const sel = activeSub('tips', state);
  const err = vm.inputError && /total|count|window|support/i.test(vm.blocked) ? vm.blocked : '';
  const pools = state.pools.length === 1 ? state.pools : state.pools.filter(p => p.id === sel);
  return html`<div class="flex flex-col gap-3">
    ${err && html`<${Alert}>${err}<//>`}
    ${pools.map(pool => html`<${PoolCard} key=${pool.id} pool=${pool} vm=${vm} />`)}
    ${(state.settings.multiPool || state.pools.length > 1) && html`<${Button} variant="tonal" block icon="plus" onClick=${() => App.addPool()}>Add pool<//>`}
    <${Suggested} vm=${vm} />
  </div>`;
}

export function renderTips(vm) {
  const root = $('tips-root');
  if (root) render(html`<${Tips} vm=${vm} />`, root);
}

// Kept for callers from before the Preact port: Preact always shows the
// stored values, so there is nothing to invalidate.
export function invalidateTips() {}
