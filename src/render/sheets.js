// Sheets that aren't owned by a tab (Preact): Person payout and Closer bonus.
// Settings live on the Settings tab (render/settings.js).
// Each re-renders with the app while it's open.

import { DENOMS, fmtHrs, fmtMoney } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { setBonuses, clearBonuses } from '../store.js';
import { html, render } from '../ui/preact.js';
import {
  cx, Button, Stepper, Badge, Stat, Label, Money, Denom, LiveStrip, List, Item,
} from '../ui/pkit.js';
import { closeSheet, isOpen, openSheet, sheetBody, onSheetClose } from '../ui/sheet.js';
import { StaffTime } from './staff.js';

// ── Person ───────────────────────────────────────────────────────────────────

// The shift's In / Out in the Person sheet: the same time box as Staff and
// Summary (tap → quick time sheet, hold → the wheel picker, Undo · Apply).
const SHEET_TIME = 'h-12 w-full rounded-xl bg-surface text-center text-[1.125rem] tabular-nums transition';

let personId = null;
onSheetClose('sheet-person', () => { personId = null; });

export function openPerson(vm, id) {
  personId = id;
  openSheet('sheet-person');
  renderPerson(vm);
}

function Person({ vm, p }) {
  const inStr = fmtTimeAbs(p.inAbs), outStr = fmtTimeAbs(p.outAbs);
  const bills = vm.dist?.byPerson[p.id];
  const hasBills = bills && DENOMS.some(d => (bills[d] || 0) > 0);
  return html`
    <div class="flex items-center gap-3.5 py-1">
      <div class="min-w-0">
        <div class="t-title flex flex-wrap items-center gap-2">${p.name}
          ${p.closer && html`<${Badge} tone="red">closer<//>`}<${Badge} tone=${p.role}>${p.role}<//></div>
        <div class="t-body mt-0.5 text-ink-3">${fmtHrs(p.shiftHours ?? p.hours)}h · ${inStr} – ${outStr}</div>
      </div>
    </div>
    <div class="flex items-center justify-between rounded-card bg-surface px-4 py-4">
      <span class="t-small font-medium text-ink-3">Takes home</span>
      <${Money} value=${p.final} class="t-display text-money" />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <${Stat} label="Base" value=${'$' + p.base} sub=${'$' + p.exact.toFixed(2) + ' exact'} />
      ${p.bonus > 0
        ? html`<${Stat} label="Closer bonus" value=${'+$' + p.bonus} tone="text-bad" />`
        : html`<${Stat} label="Rate" value=${'$' + (vm.shares.rate || 0).toFixed(2)} sub="per hour" />`}
    </div>
    <${Label}>Envelope<//>
    ${hasBills
      ? html`<div class="grid grid-cols-3 gap-1.5">${DENOMS.map(d => html`<div key=${d} class=${cx('flex items-center justify-between rounded-xl bg-surface px-3 py-2.5', !bills[d] && 'opacity-40')}>
          <${Denom} d=${d} /><span class="t-head tabular-nums">${bills[d] || '—'}</span></div>`)}</div>`
      : html`<div class="t-small px-4 text-ink-3">No bill split yet.</div>`}
    <${Label} aside="tap a time for its wheel">Shift<//>
    <div class="grid grid-cols-2 gap-3">
      ${['in', 'out'].map(f => html`<div key=${f} class="flex flex-col gap-1.5">
        <span class="t-small px-1 font-medium text-ink-2">${f === 'in' ? 'In' : 'Out'}</span>
        <${StaffTime} vm=${vm} id=${p.id} field=${f} full cls=${SHEET_TIME} />
      </div>`)}
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

  return html`<${LiveStrip} vm=${vm} />
    <div class="t-body flex items-center justify-between gap-2 rounded-card bg-surface px-4 py-3.5 font-medium">
      <span>$${remainder} left after rounding down</span>
      ${manual ? html`<${Badge} tone="amber">manual<//>` : html`<${Badge} tone="green">auto · closers<//>`}
    </div>
    <${List}>
      ${s.perPerson.map(p => html`<${Item} key=${p.id} chevron=${false}
        title=${html`<span class="truncate">${p.name}</span>${p.closer && html`<${Badge} tone="red">closer<//>`}`}
        sub=${'$' + p.exact.toFixed(2) + ' → $' + p.base}
        trail=${html`<${Stepper} value=${p.bonus > 0 ? '+' + p.bonus : '0'} on=${p.bonus > 0}
          onDec=${() => App.remBonus(p.id, -1)} onInc=${() => App.remBonus(p.id, 1)}
          decDisabled=${!(p.bonus > 0)} incDisabled=${!(leftover > 0)} />`}
        value=${'$' + p.final} valueTone="min-w-12 text-right" />`)}
    <//>
    <${List}>
      <${Item} title="Rounded-down shares" chevron=${false} value=${fmtMoney(floored)}  />
      <${Item} title="Remainder" chevron=${false} value=${fmtMoney(remainder)}  />
      <${Item} title="Given as bonus" chevron=${false} value=${bonusSum > 0 ? fmtMoney(bonusSum) : '—'}  />
      <${Item} title="Chump" sub="Stays in the drawer" chevron=${false} value=${leftover > 0 ? fmtMoney(leftover) : '—'} valueTone="" />
    <//>
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
