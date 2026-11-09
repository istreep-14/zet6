// Summary tab (Preact) — the shift at a glance, no bills. The live HUD
// (rate · pool · chump) floats over it like on Staff / Tips, so there's no
// hero card:
//   bills status (exact change ✓ / needs a swap) → Payout tab
//   → payouts table in a card: name with time range under it · Hours ·
//     Tips (equal columns), chump and total rows
//   → close time / bonus tools.
// Tap a person → Person sheet.

import { fmtHrs, payoutOrder } from '../util.js';
import { timeParts } from '../time.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Alert, Avatar, Money, Blocked, Banner, Card } from '../ui/pkit.js';
import { distErrorText } from './payout.js';

const $ = id => document.getElementById(id);

function BillsStatus({ vm }) {
  const err = distErrorText(vm);
  const n = vm.bills ? Object.values(vm.bills).reduce((t, c) => t + (c || 0), 0) : 0;
  return err
    ? html`<${Banner} tone="error" title="Bills need a swap" sub="See the fix on Payout" onClick=${() => App.tab('payout')} />`
    : html`<${Banner} tone="ok" title="Exact change for everyone" sub=${n + ' bills · envelopes on Payout'} onClick=${() => App.tab('payout')} />`;
}

// Payouts table in a card (same look as the sessions list): name with the
// time range under it, then two equal columns — Hours and Tips. Header row,
// hairline rows, chump + total at the foot.
// One grid on every row: a fixed avatar column, then name · shift · hours ·
// tips at 2 : 1 : 1 : 1, everything after the name centred.
const GRID = 'grid grid-cols-[36px_2fr_1fr_1fr_1fr] items-center gap-x-2 px-3.5 tabular-nums';
const HOURS = 'text-center text-[17px] font-medium leading-none text-ink-2';
const TIPS = 'font-rounded text-[22px] font-bold leading-none tracking-tight';

// Compact clock: no ":00" — "5p", "10:30p". 24-hour mode stays "17:00".
const clock = abs => { const t = timeParts(abs); return t.h + (t.m ? ':' + t.m : '') + t.ap; };

function PersonRow({ p }) {
  return html`<button class=${cx(GRID, 'min-h-[54px] w-full border-t border-sep py-1.5 text-left transition active:bg-raised')}
    onClick=${() => App.personModal(p.id)}>
    <${Avatar} name=${p.name} role=${p.role} />
    <span class="truncate text-[20px] font-semibold">${p.name}</span>
    <span class="flex flex-col items-center text-[13px] leading-[1.25] text-ink-2">
      <span>${clock(p.inAbs)}</span><span>${clock(p.outAbs)}</span>
    </span>
    <span class=${HOURS}>${fmtHrs(p.shiftHours ?? p.hours)}</span>
    <span class="text-center"><${Money} value=${p.final} class=${cx(TIPS, !(p.final > 0) && 'text-ink-3')} /></span>
  </button>`;
}

function Payouts({ vm, name }) {
  const s = vm.shares;
  const ordered = payoutOrder(s.perPerson);
  const hours = ordered.reduce((t, p) => t + (p.shiftHours ?? p.hours), 0);
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  const head = 'text-center text-[11px] font-bold uppercase tracking-[.08em] text-ink-3';
  return html`<${Card} flush>
    <div class=${cx(GRID, 'h-9')}>
      <span class="col-span-2 truncate text-[11px] font-bold uppercase tracking-[.08em] text-ink-3">${name || 'Payouts'}</span>
      <span class=${head}>Shift</span>
      <span class=${head}>Hours</span>
      <span class=${head}>Tips</span>
    </div>
    ${ordered.map(p => html`<${PersonRow} key=${p.id} p=${p} />`)}
    ${s.leftover > 0 && html`<div class=${cx(GRID, 'h-11 border-t border-sep text-ink-2')}>
      <span class="col-span-4 truncate text-[14px]">Chump <span class="text-ink-3">· stays in the drawer</span></span>
      <span class="text-center"><${Money} value=${s.leftover} class="font-rounded text-[17px] font-semibold" /></span>
    </div>`}
    <div class=${cx(GRID, 'h-14 border-t border-white/12 bg-raised/60')}>
      <span class="col-span-3 text-[16px] font-bold">Total</span>
      <span class=${cx(HOURS, 'font-semibold text-ink')}>${fmtHrs(hours)}</span>
      <span class="text-center"><${Money} value=${paidOut} class=${cx(TIPS, 'text-gold')} /></span>
    </div>
  <//>`;
}

function Tools() {
  const tool = 'flex h-12 items-center justify-center gap-2.5 rounded-card bg-surface text-[16px] font-semibold transition active:scale-[.97] active:bg-raised';
  return html`<div class="grid grid-cols-2 gap-2">
    <button class=${tool} onClick=${() => App.openCloseTime()}><${Icon} name="clock" class="size-5 text-ink-2" />Close time</button>
    <button class=${tool} onClick=${() => App.openBonus()}><${Icon} name="gift" class="size-5 text-ink-2" />Bonus</button>
  </div>`;
}

function Summary({ vm, name }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  return html`<div class="flex flex-col gap-4">
    ${vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`)}
    <${BillsStatus} vm=${vm} />
    <${Payouts} vm=${vm} name=${name} />
    <${Tools} />
  </div>`;
}

export function renderSummary(vm, sessionName = '') {
  const root = $('summary-root');
  if (root) render(html`<${Summary} vm=${vm} name=${sessionName} />`, root);
}
