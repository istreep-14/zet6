// Sheets that aren't owned by a tab (Preact): Person payout and Closer bonus.
// Settings live in the side panels (render/drawer.js, render/shiftpanel.js).
// Each re-renders with the app while it's open.

import { DENOMS, fmtHrs } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { setBonuses, clearBonuses } from '../store.js';
import { html, render } from '../ui/preact.js';
import {
  cx, Button, Stepper, Avatar, Badge, Stat, Field, Label, Money, Denom, LiveStrip, SEP,
} from '../ui/pkit.js';
import { closeSheet, isOpen, openSheet, sheetBody, onSheetClose } from '../ui/sheet.js';

// ── Person ───────────────────────────────────────────────────────────────────

let personId = null;
onSheetClose('sheet-person', () => { personId = null; });

export function openPerson(vm, id) {
  personId = id;
  openSheet('sheet-person');
  renderPerson(vm);
}

function Person({ vm, p }) {
  const raw = vm.state.staff.find(x => x.id === p.id);
  const inStr = fmtTimeAbs(p.inAbs), outStr = fmtTimeAbs(p.outAbs);
  const bills = vm.dist?.byPerson[p.id];
  const hasBills = bills && DENOMS.some(d => (bills[d] || 0) > 0);
  return html`
    <div class="flex items-center gap-3.5 py-1">
      <${Avatar} name=${p.name} role=${p.role} size="xl" />
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2 text-[24px] font-bold tracking-tight">${p.name}
          ${p.closer && html`<${Badge} tone="red">closer<//>`}<${Badge} tone=${p.role}>${p.role}<//></div>
        <div class="mt-0.5 text-[15px] text-ink-2">${fmtHrs(p.shiftHours ?? p.hours)}h · ${inStr} – ${outStr}</div>
      </div>
    </div>
    <div class="flex items-center justify-between rounded-2xl bg-raised px-4 py-3.5">
      <span class="text-[17px] font-semibold">Takes home</span>
      <${Money} value=${p.final} class="font-rounded text-[38px] font-bold tracking-tight text-gold" />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <${Stat} label="Base" value=${'$' + p.base} sub=${'$' + p.exact.toFixed(2) + ' exact'} />
      ${p.bonus > 0
        ? html`<${Stat} label="Closer bonus" value=${'+$' + p.bonus} tone="text-red" />`
        : html`<${Stat} label="Rate" value=${'$' + (vm.shares.rate || 0).toFixed(2)} sub="per hour" />`}
    </div>
    <${Label}>Envelope<//>
    ${hasBills
      ? html`<div class="grid grid-cols-3 gap-1.5">${DENOMS.map(d => html`<div key=${d} class=${cx('flex items-center justify-between rounded-xl bg-raised px-3 py-2.5', !bills[d] && 'opacity-40')}>
          <${Denom} d=${d} /><span class="font-rounded text-[22px] font-bold tabular-nums">${bills[d] || '—'}</span></div>`)}</div>`
      : html`<div class="px-1 text-[14px] text-ink-3">No bill split yet.</div>`}
    <${Label}>Shift<//>
    <div class="flex gap-3">
      <${Field} label="In" value=${raw?.in ?? ''} placeholder=${inStr} inputmode="decimal" onChange=${e => App.staffField(p.id, 'in', e.target.value)} />
      <${Field} label="Out" value=${raw?.out ?? ''} placeholder=${p.usedCloseTime ? 'close' : outStr} inputmode="decimal" onChange=${e => App.staffField(p.id, 'out', e.target.value)} />
    </div>`;
}

function renderPerson(vm) {
  if (!personId || !isOpen('sheet-person')) return;
  const p = vm.shares?.perPerson.find(x => x.id === personId);
  if (!p) { closeSheet('sheet-person'); return; }
  render(html`<${Person} vm=${vm} p=${p} />`, sheetBody('sheet-person'));
}

// ── Closer bonus & chump ─────────────────────────────────────────────────────

export function openBonus(vm) {
  openSheet('sheet-bonus');
  renderBonus(vm);
}

function Bonus({ vm }) {
  if (!vm.shares || !vm.totalCash) {
    return html`<div class="py-10 text-center text-ink-2">Enter cash and staff to see the remainder.</div>`;
  }
  const s = vm.shares;
  const floored = s.perPerson.reduce((t, p) => t + p.base, 0);
  const remainder = s.totalCash - floored;
  const bonusSum = s.perPerson.reduce((t, p) => t + p.bonus, 0);
  const leftover = remainder - bonusSum;
  const manual = s.bonusMode === 'manual';
  const sum = (k, v, cls = '') => html`<div class="flex justify-between text-ink-2"><span>${k}</span><span class=${cx('font-semibold text-ink', cls)}>${v}</span></div>`;

  return html`<${LiveStrip} vm=${vm} />
    <div class="flex items-center justify-between gap-2 rounded-2xl bg-raised px-4 py-3.5 font-semibold">
      <span>$${remainder} left after rounding down</span>
      ${manual ? html`<${Badge} tone="amber">manual<//>` : html`<${Badge} tone="green">auto · closers<//>`}
    </div>
    <div class="overflow-hidden rounded-card bg-raised">
      ${s.perPerson.map(p => html`<div key=${p.id} class=${cx('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5', SEP)}>
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-1.5 text-[17px] font-semibold"><span class="truncate">${p.name}</span>${p.closer && html`<${Badge} tone="red">closer<//>`}</div>
          <div class="mt-0.5 text-[13px] text-ink-3">$${p.exact.toFixed(2)} → $${p.base}</div>
        </div>
        <${Stepper} value=${p.bonus > 0 ? '+' + p.bonus : '0'} on=${p.bonus > 0}
          onDec=${() => App.remBonus(p.id, -1)} onInc=${() => App.remBonus(p.id, 1)}
          decDisabled=${!(p.bonus > 0)} incDisabled=${!(leftover > 0)} />
        <span class="min-w-14 text-right font-rounded text-[22px] font-bold tracking-tight">$${p.final}</span>
      </div>`)}
    </div>
    <div class="flex flex-col gap-2.5 rounded-2xl bg-raised p-4 text-[15px]">
      ${sum('Rounded-down shares', '$' + floored)}
      ${sum('Remainder', '$' + remainder)}
      ${sum('Given as bonus', bonusSum > 0 ? '$' + bonusSum : '—')}
      ${sum('Chump (stays in drawer)', leftover > 0 ? '$' + leftover : '—', 'text-gold')}
    </div>
    ${manual && html`<${Button} block onClick=${() => App.resetRemBonuses()}>↺ Reset to auto (closers split)<//>`}`;
}

function renderBonus(vm) {
  if (isOpen('sheet-bonus')) render(html`<${Bonus} vm=${vm} />`, sheetBody('sheet-bonus'));
}

export function adjustBonus(vm, id, delta) {
  if (!vm.shares) return;
  const s = vm.shares;
  const remainder = s.totalCash - s.perPerson.reduce((t, p) => t + p.base, 0);
  // Seed overrides from the current bonuses so existing closer bonuses aren't
  // zeroed. Zeros are kept — any key present keeps manual mode until reset.
  const bonuses = {};
  s.perPerson.forEach(p => { bonuses[p.id] = p.bonus || 0; });
  const proposed = (bonuses[id] || 0) + delta;
  if (proposed < 0) return;
  const others = Object.entries(bonuses).filter(([pid]) => pid !== id).reduce((t, [, b]) => t + b, 0);
  if (proposed + others > remainder) return;
  bonuses[id] = proposed;
  setBonuses(bonuses);
}

export const resetBonuses = () => clearBonuses();

// Re-render whichever of these sheets is open.
export function renderSheets(vm) {
  renderPerson(vm);
  renderBonus(vm);
}
