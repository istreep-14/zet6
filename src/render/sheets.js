// Sheets that aren't owned by a tab: Person payout, Closer bonus and Default
// times. Settings live in the side drawer (render/drawer.js). Each re-renders
// with the app while it's open.

import { DENOMS, fmtHrs } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { setBonuses, clearBonuses } from '../store.js';
import { html, cx, mount } from '../ui/html.js';
import {
  Card, Button, Stepper, Avatar, Badge, Stat, Field, Label, Money, Denom,
  INPUT, ROLE_TEXT, SEP,
} from '../ui/kit.js';
import { openSheet, closeSheet, isOpen, sheetBody, onSheetClose } from '../ui/sheet.js';
import { liveStrip } from './tabs.js';

const $ = id => document.getElementById(id);

// ── Person ───────────────────────────────────────────────────────────────────

let personId = null;
onSheetClose('sheet-person', () => { personId = null; });

export function openPerson(vm, id) {
  personId = id;
  openSheet('sheet-person');
  renderPerson(vm);
}

function renderPerson(vm) {
  if (!personId || !isOpen('sheet-person')) return;
  const p = vm.shares?.perPerson.find(x => x.id === personId);
  if (!p) { closeSheet('sheet-person'); return; }
  const raw = vm.state.staff.find(x => x.id === personId);
  const inStr = fmtTimeAbs(p.inAbs), outStr = fmtTimeAbs(p.outAbs);
  const bills = vm.dist?.byPerson[personId];
  const hasBills = bills && DENOMS.some(d => (bills[d] || 0) > 0);

  const body = sheetBody('sheet-person');
  // Keep typed shift edits: only rebuild when nothing in the sheet has focus.
  if (body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;

  mount(body, html`
    <div class="flex items-center gap-3.5 py-1">
      ${Avatar(p.name, p.role, 'xl')}
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2 text-[24px] font-bold tracking-tight">${p.name}${p.closer && Badge('closer', 'red')}${Badge(p.role, p.role)}</div>
        <div class="mt-0.5 text-[15px] text-ink-2">${fmtHrs(p.hours)}h · ${inStr} – ${outStr}</div>
      </div>
    </div>
    <div class="flex items-center justify-between rounded-2xl bg-raised px-4 py-3.5">
      <span class="text-[17px] font-semibold">Takes home</span>
      ${Money(p.final, 'font-rounded text-[38px] font-bold tracking-tight text-gold')}
    </div>
    <div class="grid grid-cols-2 gap-2">
      ${Stat({ label: 'Base', value: '$' + p.base, sub: '$' + p.exact.toFixed(2) + ' exact' })}
      ${p.bonus > 0
        ? Stat({ label: 'Closer bonus', value: '+$' + p.bonus, tone: 'text-red' })
        : Stat({ label: 'Rate', value: '$' + (vm.shares.rate || 0).toFixed(2), sub: 'per hour' })}
    </div>
    ${Label('Envelope')}
    ${hasBills
      ? html`<div class="grid grid-cols-3 gap-1.5">${DENOMS.map(d => html`<div class="${cx('flex items-center justify-between rounded-xl bg-raised px-3 py-2.5', !bills[d] && 'opacity-40')}">
          ${Denom(d)}<span class="font-rounded text-[22px] font-bold tabular-nums">${bills[d] || '—'}</span></div>`)}</div>`
      : html`<div class="px-1 text-[14px] text-ink-3">No bill split yet.</div>`}
    ${Label('Shift')}
    <div class="flex gap-3">
      ${Field({ label: 'In', value: raw?.in ?? '', placeholder: inStr, inputmode: 'decimal', onchange: `App.staffField('${p.id}','in',this.value)` })}
      ${Field({ label: 'Out', value: raw?.out ?? '', placeholder: p.usedCloseTime ? 'close' : outStr, inputmode: 'decimal', onchange: `App.staffField('${p.id}','out',this.value)` })}
    </div>`);
}

// ── Closer bonus & chump ─────────────────────────────────────────────────────

export function openBonus(vm) {
  openSheet('sheet-bonus');
  renderBonus(vm);
}

function renderBonus(vm) {
  if (!isOpen('sheet-bonus')) return;
  const body = sheetBody('sheet-bonus');
  if (!vm.shares || !vm.totalCash) {
    mount(body, html`<div class="py-10 text-center text-ink-2">Enter cash and staff to see the remainder.</div>`);
    return;
  }
  const s = vm.shares;
  const floored = s.perPerson.reduce((t, p) => t + p.base, 0);
  const remainder = s.totalCash - floored;
  const bonusSum = s.perPerson.reduce((t, p) => t + p.bonus, 0);
  const leftover = remainder - bonusSum;
  const manual = s.bonusMode === 'manual';
  const sum = (k, v, cls = '') => html`<div class="flex justify-between text-ink-2"><span>${k}</span><span class="${cx('font-semibold text-ink', cls)}">${v}</span></div>`;

  mount(body, html`${liveStrip(vm)}
    <div class="flex items-center justify-between gap-2 rounded-2xl bg-raised px-4 py-3.5 font-semibold">
      <span>$${remainder} left after rounding down</span>${manual ? Badge('manual', 'amber') : Badge('auto · closers', 'green')}
    </div>
    <div class="overflow-hidden rounded-card bg-raised">
      ${s.perPerson.map(p => html`<div class="${cx('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5', SEP)}">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-1.5 text-[17px] font-semibold"><span class="truncate">${p.name}</span>${p.closer && Badge('closer', 'red')}</div>
          <div class="mt-0.5 text-[13px] text-ink-3">$${p.exact.toFixed(2)} → $${p.base}</div>
        </div>
        ${Stepper({ value: p.bonus > 0 ? '+' + p.bonus : '0', on: p.bonus > 0, dec: `App.remBonus('${p.id}',-1)`, inc: `App.remBonus('${p.id}',1)`, decDisabled: !(p.bonus > 0), incDisabled: !(leftover > 0) })}
        <span class="min-w-14 text-right font-rounded text-[22px] font-bold tracking-tight">$${p.final}</span>
      </div>`)}
    </div>
    <div class="flex flex-col gap-2.5 rounded-2xl bg-raised p-4 text-[15px]">
      ${sum('Rounded-down shares', '$' + floored)}
      ${sum('Remainder', '$' + remainder)}
      ${sum('Given as bonus', bonusSum > 0 ? '$' + bonusSum : '—')}
      ${sum('Chump (stays in drawer)', leftover > 0 ? '$' + leftover : '—', 'text-gold')}
    </div>
    ${manual && Button({ variant: 'plain', block: true, onclick: 'App.resetRemBonuses()' }, '↺ Reset to auto (closers split)')}`);
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

// ── Default times ────────────────────────────────────────────────────────────
// Body is built on open; later renders only refresh values of unfocused inputs.

export function openDefaults(vm) {
  const rolesOn = vm.state.settings.allRoles;
  const cell = (id, role, field) => html`<input id="${id}" class="${cx(INPUT, 'text-center font-semibold')}" inputmode="decimal" placeholder="—"
    oninput="App.roleDefault('${role}','${field}',this.value)">`;
  mount(sheetBody('sheet-defaults'), html`
    ${Card({ class: 'flex flex-col gap-3' }, html`
      <div class="text-[14px] font-medium text-ink-2">Whole shift</div>
      <div class="flex gap-3">
        ${Field({ label: 'Open (in)', id: 'gc-in', inputmode: 'decimal', placeholder: '5', oninput: "App.globalDefault('in',this.value)" })}
        ${Field({ label: 'Close (out)', id: 'gc-out', inputmode: 'decimal', placeholder: '2', oninput: "App.globalDefault('out',this.value)" })}
      </div>
      <p class="text-[14px] leading-snug text-ink-3">Fills any blank In/Out. Blank Outs inherit the close time, which also decides the auto closers.</p>`)}
    ${rolesOn && Card({ class: 'flex flex-col gap-3' }, html`
      <div class="text-[14px] font-medium text-ink-2">Per role</div>
      <div class="grid grid-cols-[72px_1fr_1fr] items-center gap-x-3 gap-y-2.5">
        <span></span><span class="text-center text-[13px] font-medium text-ink-2">In</span><span class="text-center text-[13px] font-medium text-ink-2">Out</span>
        ${['bartender', 'server', 'support'].map(r => html`
          <span class="${cx('text-[15px] font-semibold', ROLE_TEXT[r])}">${{ bartender: 'Bar', server: 'Server', support: 'Support' }[r]}</span>
          ${cell('rdef-' + r + '-in', r, 'in')}${cell('rdef-' + r + '-out', r, 'out')}`)}
      </div>
      <p class="text-[14px] leading-snug text-ink-3">Role defaults win over the whole-shift times for that role.</p>`)}
    ${rolesOn && Card({ class: 'flex flex-col gap-3' }, html`
      <div class="text-[14px] font-medium text-ink-2">Support tip-out</div>
      ${Field({ label: '% of each pool', class: 'max-w-[150px]', id: 'gc-sup-pct', inputmode: 'decimal', placeholder: '10', oninput: 'App.supportDefault(this.value)' })}
      <p class="text-[14px] leading-snug text-ink-3">Support $/hr = % × pool tips ÷ pool hours, paid off the top before the bar/server split. Each pool can override % or $/hr.</p>`)}`);
  openSheet('sheet-defaults');
  renderDefaults(vm);
}

function renderDefaults(vm) {
  if (!isOpen('sheet-defaults')) return;
  const d = vm.state.defaults;
  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v ?? ''; };
  set('gc-in', d.global.in);
  set('gc-out', d.global.out);
  set('gc-sup-pct', d.supportPct);
  ['bartender', 'server', 'support'].forEach(r => {
    set('rdef-' + r + '-in', d.byRole[r].in);
    set('rdef-' + r + '-out', d.byRole[r].out);
  });
}

// Re-render whichever of these sheets is open.
export function renderSheets(vm) {
  renderPerson(vm);
  renderBonus(vm);
  renderDefaults(vm);
}
