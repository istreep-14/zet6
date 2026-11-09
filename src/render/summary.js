// Summary tab (Preact) — the shift at a glance, no bills:
//   hero (date · session name, total tips, rate / hours / people)
//   → bills status (exact change ✓ / needs a swap) → Payout tab
//   → one roomy row per person: avatar · name · shift · hours · pay,
//     with a thin bar showing each share against the largest
//   → chump + paid out → close time / bonus tools.
// Tap a person → Person sheet.

import { fmtHrs, fmtMoney, payoutOrder } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Alert, Avatar, Money, Blocked, ROLE_DOT } from '../ui/pkit.js';
import { distErrorText } from './payout.js';

const $ = id => document.getElementById(id);

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}

function Stat({ value, label, class: cls = '' }) {
  return html`<div class="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl bg-white/[.06] px-2 py-2.5">
    <span class=${cx('font-rounded text-[20px] font-bold tabular-nums leading-tight', cls)}>${value}</span>
    <span class="text-[12px] font-medium text-ink-2">${label}</span>
  </div>`;
}

function Hero({ vm, name }) {
  const s = vm.shares;
  const d = parseISO(vm.state.meta.date);
  const when = d ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(d) : '';
  const paid = s.perPerson.filter(p => p.final > 0).length;
  // One pool: the bar/server rate (support is paid apart).
  const rate = vm.state.pools.length === 1 && s.perPool[0] ? s.perPool[0].rate : s.rate;
  return html`<section class="summary-hero flex flex-col gap-4 rounded-[28px] p-5">
    <div class="truncate text-[13px] font-semibold uppercase tracking-[.08em] text-ink-2">
      ${when}${name && html` · <span class="normal-case tracking-normal text-ink">${name}</span>`}
    </div>
    <div class="flex flex-col">
      <span class="font-rounded text-[64px] font-extrabold leading-[.95] tracking-[-.045em] max-[374px]:text-[52px]">${fmtMoney(s.totalCash)}</span>
      <span class="mt-1.5 text-[15px] text-ink-2">in tips tonight</span>
    </div>
    <div class="flex gap-2">
      <${Stat} value=${'$' + rate.toFixed(2)} label="per hour" class="text-green" />
      <${Stat} value=${fmtHrs(s.totalHours) + 'h'} label="worked" />
      <${Stat} value=${paid} label=${paid === 1 ? 'person' : 'people'} />
    </div>
  </section>`;
}

function BillsStatus({ vm }) {
  const err = distErrorText(vm);
  const n = vm.bills ? Object.values(vm.bills).reduce((t, c) => t + (c || 0), 0) : 0;
  const [tone, dot, icon, title, sub] = err
    ? ['bg-red/12 ring-red/30 text-red', 'bg-red/20', 'alert', 'Bills need a swap', 'See the fix on Payout']
    : ['bg-green/10 ring-green/25 text-green', 'bg-green/20', 'check', 'Exact change for everyone', `${n} bills · envelopes on Payout`];
  return html`<button class=${cx('flex min-h-[60px] w-full items-center gap-3 rounded-card px-4 text-left ring-1 transition active:scale-[.98]', tone)}
    onClick=${() => App.tab('payout')}>
    <span class=${cx('grid size-9 shrink-0 place-items-center rounded-full', dot)}><${Icon} name=${icon} class="size-[18px]" /></span>
    <span class="min-w-0 flex-1"><span class="block text-[16px] font-semibold text-ink">${title}</span><span class="text-[13px] text-ink-2">${sub}</span></span>
    <${Icon} name="chevR" class="size-5 opacity-70" />
  </button>`;
}

function PersonRow({ p, max }) {
  const pct = max > 0 ? Math.max(4, Math.round((p.final / max) * 100)) : 0;
  const note = p.bonus > 0 ? `+${fmtMoney(p.bonus)} ${p.closer ? 'closer' : 'bonus'}` : p.closer ? 'closer' : '';
  return html`<button class="flex w-full flex-col gap-2.5 px-4 py-3.5 text-left transition active:bg-raised" onClick=${() => App.personModal(p.id)}>
    <span class="flex w-full items-center gap-3.5">
      <${Avatar} name=${p.name} role=${p.role} size="lg" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[18px] font-semibold leading-tight">${p.name}</span>
        <span class="flex flex-wrap items-center gap-x-2 text-[14px] text-ink-2">
          <span class="whitespace-nowrap">${fmtTimeAbs(p.inAbs)} – <span class=${p.closer ? 'text-red' : ''}>${fmtTimeAbs(p.outAbs)}</span></span>
          <span class="text-ink-3">·</span><span class="whitespace-nowrap">${fmtHrs(p.shiftHours ?? p.hours)}h</span>
        </span>
      </span>
      <span class="flex shrink-0 flex-col items-end gap-0.5">
        <${Money} value=${p.final} class=${cx('font-rounded text-[28px] font-bold leading-none tracking-tight', !(p.final > 0) && 'text-ink-3')} />
        ${note && html`<span class="text-[13px] font-semibold text-red">${note}</span>`}
      </span>
    </span>
    <span class="block h-[3px] w-full overflow-hidden rounded-full bg-white/[.06]" aria-hidden="true">
      <span class=${cx('block h-full rounded-full opacity-70', ROLE_DOT[p.role] || 'bg-gold')} style=${{ width: pct + '%' }}></span>
    </span>
  </button>`;
}

function Payouts({ vm }) {
  const s = vm.shares;
  const ordered = payoutOrder(s.perPerson);
  const max = Math.max(0, ...ordered.map(p => p.final));
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  return html`<section class="overflow-hidden rounded-card bg-surface">
    <div class="flex items-baseline justify-between px-4 pb-1 pt-4">
      <span class="text-[20px] font-bold tracking-tight">Payouts</span>
      <span class="text-[13px] text-ink-3">tap a name for details</span>
    </div>
    <div class="divide-y divide-sep">${ordered.map(p => html`<${PersonRow} key=${p.id} p=${p} max=${max} />`)}</div>
    <div class="divide-y divide-sep border-t border-white/12 bg-raised/60">
      ${s.leftover > 0 && html`<div class="flex items-center justify-between gap-3 px-4 py-3">
        <span class="text-[15px] text-ink-2">Chump · stays in the drawer</span>
        <${Money} value=${s.leftover} class="font-rounded text-[18px] font-semibold text-ink-2" />
      </div>`}
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <span class="text-[15px] font-semibold">Paid out</span>
        <${Money} value=${paidOut} class="font-rounded text-[22px] font-bold text-gold" />
      </div>
    </div>
  </section>`;
}

function Tools() {
  const tool = 'flex h-14 items-center justify-center gap-2.5 rounded-card bg-surface text-[16px] font-semibold transition active:scale-[.97] active:bg-raised';
  return html`<div class="grid grid-cols-2 gap-2">
    <button class=${tool} onClick=${() => App.openCloseTime()}><${Icon} name="clock" class="size-5 text-ink-2" />Close time</button>
    <button class=${tool} onClick=${() => App.openBonus()}><${Icon} name="gift" class="size-5 text-ink-2" />Bonus</button>
  </div>`;
}

function Summary({ vm, name }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  return html`<div class="flex flex-col gap-4">
    <${Hero} vm=${vm} name=${name} />
    ${vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`)}
    <${BillsStatus} vm=${vm} />
    <${Payouts} vm=${vm} />
    <${Tools} />
  </div>`;
}

export function renderSummary(vm, sessionName = '') {
  const root = $('summary-root');
  if (root) render(html`<${Summary} vm=${vm} name=${sessionName} />`, root);
}
