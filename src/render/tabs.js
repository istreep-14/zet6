// Tab bar — panel switching, tab badges, and the floating live HUD
// (rate / pool / chump while editing Staff & Tips).
//
// Summary is home (first tab, where sessions open). Its checklist and the
// Next buttons lead through the inputs in close-out order:
//   Staff (who worked) → Tips (the cash) → Summary (who gets what) → Payout (the bills)

import { poolValue, fmtMoney, fmtMoneyShort } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon } from '../ui/pkit.js';

const $ = id => document.getElementById(id);

export const TAB_ORDER = ['summary', 'staff', 'tips', 'payout'];
const TITLES = { summary: 'Summary', staff: 'Staff', tips: 'Tips', payout: 'Payout' };

// Older snapshots stored the five-tab names.
export function normalizeTab(name) {
  const legacy = { bills: 'payout', more: 'payout', cash: 'tips' };
  return legacy[name] || (TAB_ORDER.includes(name) ? name : 'summary');
}

// opts.swipe = 'left' | 'right' slides the new panel in from that side and
// skips the auto-focus (a swipe shouldn't pop the keyboard).
export function switchTab(name, opts = {}) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active', 'from-left', 'from-right'));
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  const panel = $('tab-' + name);
  panel?.classList.add('active');
  if (opts.swipe) panel?.classList.add(opts.swipe === 'left' ? 'from-right' : 'from-left');
  $('tb-' + name)?.classList.add('active');
  const title = $('hdrTitle');
  if (title) title.textContent = TITLES[name] || 'Tip Pool';
  $('pipHud')?.classList.toggle('is-off', name === 'payout');
  requestAnimationFrame(() => { $('mainContent').scrollTop = 0; });
}

// True when the computed distribution can't actually pay everyone out.
export function distShort(vm) {
  if (!vm.dist) return false;
  const unpaid = vm.people.reduce((s, p) => s + Math.max(0, p.final - poolValue(vm.dist.byPerson[p.id] || {})), 0);
  const remOk = vm.shares.leftover === 0 || poolValue(vm.dist.remainderBills) === vm.shares.leftover;
  return !!vm.dist.error || unpaid > 0 || !remOk;
}

function badge(id, text, tone) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = cx('tab-sub', tone);
}

export function updateTabIndicators(vm) {
  const total = vm.totalCash;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const short = !vm.blocked && distShort(vm);
  const errOn = tab => vm.inputError && vm.blockedTab === tab;
  badge('tab-sub-staff', named > 0 ? String(named) : '', named > 0 && errOn('staff') ? 'warn' : '');
  badge('tab-sub-tips', errOn('tips') ? '!' : total > 0 ? fmtMoneyShort(total) : '', errOn('tips') ? 'warn' : total > 0 ? 'ok' : '');
  badge('tab-sub-payout', short ? '!' : '', short ? 'warn' : '');
  updateHud(vm, named, total, short);
}

// One figure cell: value over a small label (cells are split by hairlines).
const S = ({ k, v, cls }) => html`<span class="flex min-w-0 flex-1 flex-col items-center px-1 leading-tight">
  <span class=${cx('t-head max-w-full truncate tabular-nums', cls)}>${v}</span>
  <span class="t-small max-w-full truncate text-ink-3">${k}</span></span>`;

// The fewest $10 / $5 / $1s that make every payout exact — what the drawer
// should hold, after a swap if one is needed. vm.req places the drawer's
// $100s / $50s first, so a $50 that evens out an odd-tens payout saves a $10.
export function smallBillsNeeded(vm) {
  const r = vm.req;
  if (!r) return null;
  return [
    { d: 10, n: Math.ceil(Math.max(0, r.minOneFiveTenValue - r.minOneFiveValue) / 10) },
    { d: 5, n: Math.ceil(Math.max(0, r.minOneFiveValue - r.minOnes) / 5) },
    { d: 1, n: r.minOnes },
  ];
}

// Fourth cell: the small bills as "1 · 1 · 16" over "$10 · $5 · $1", each
// count in its bill's tint — reference for pulling change.
function BillsCell({ vm }) {
  const need = smallBillsNeeded(vm);
  if (!need) return null;
  const dot = html`<span class="mx-0.5 text-ink-3">·</span>`;
  return html`<${S} k="$10 · $5 · $1"
    v=${need.map((c, i) => html`${i > 0 && dot}<span class="bill-col !font-semibold" data-d=${c.d}>${c.n}</span>`)} />`;
}

// HUD: Rate · Pool · Chump · small bills as one row of figures, the blocking
// reason otherwise. Hidden on a pristine session.
function Hud({ vm, total, short }) {
  const msg = t => html`<span class=${cx('t-small truncate px-2 font-medium', vm.inputError || short ? 'text-bad' : 'text-ink-2')}>${t}</span>`;
  const sh = vm.shares;
  return html`${sh && total > 0 && !vm.blocked
      ? html`<span class="flex min-w-0 flex-1 items-center divide-x divide-line">
          <${S} k="Rate" v=${'$' + sh.rate.toFixed(2)} cls="text-good" />
          <${S} k="Pool" v=${fmtMoney(sh.totalCash)} />
          <${S} k="Chump" v=${sh.leftover > 0 ? fmtMoney(sh.leftover) : '—'} cls=${sh.leftover > 0 ? '' : 'text-ink-3'} />
          <${BillsCell} vm=${vm} />
        </span>`
      : html`<span class="flex min-w-0 flex-1 items-center">${msg(vm.blocked || 'Enter cash to calculate')}</span>`}
    <${Icon} name="chevR" class="size-4 shrink-0 text-ink-3" />`;
}

function updateHud(vm, named, total, short) {
  const hud = $('pipHud');
  if (!hud) return;
  const pristine = named === 0 && total === 0;
  hud.classList.toggle('is-empty', pristine);
  hud.classList.toggle('is-warn', !pristine && vm.inputError);   // red only for a real input error; a missing step reads plain
  render(pristine ? null : html`<${Hud} vm=${vm} total=${total} short=${short} />`, hud);
}
