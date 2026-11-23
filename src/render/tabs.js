// Tab bar — panel switching, tab badges, and the floating live HUD
// (rate / pool / chump while editing Staff & Tips).
//
// Summary is home (first tab, where sessions open). Its checklist and the
// Next buttons lead through the inputs in close-out order:
//   Staff (who worked) → Tips (the cash) → Summary (who gets what) → Payout (the bills)

import { poolValue, fmtMoney, fmtMoneyShort } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Figure } from '../ui/pkit.js';
import { figDelta, payDelta, isPreview, movedCount } from '../ui/changes.js';

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
function BillsFig({ vm }) {
  const need = smallBillsNeeded(vm);
  if (!need) return null;
  const dot = html`<span class="mx-0.5 text-ink-3">·</span>`;
  return html`<${Figure} k="$10 · $5 · $1"
    v=${need.map((c, i) => html`${i > 0 && dot}<span class="bill-col !font-semibold" data-d=${c.d}>${c.n}</span>`)} />`;
}

// HUD: Rate · Pool · Chump · small bills as one row of figures, each its own
// tap target — Chump opens Closer bonus & chump, the rest go on (Staff / Tips
// → Summary, Summary → Payout). The blocking reason otherwise. While an edit
// is previewed (a time being dragged / typed) the figures are the would-be
// ones, with the change after each label, an accent ring,
// and the person being edited in place of Pool; just after an edit lands the
// labels show what moved for a few seconds.
const CELL = 'flex min-w-0 flex-1 items-center self-stretch rounded-xl transition active:bg-surface-2';
// A drag / keypad edit just landed (vm.changes.review): a row over the
// figures saying what it was and how many payouts it moved, with Undo (put
// it back) and Apply (keep it — the change marks go).
function Hud(props) {
  const { vm } = props;
  const r = !isPreview(vm) && vm.changes?.review;
  if (!r) return html`<${Figures} ...${props} />`;
  const n = movedCount(vm);
  const btn = 't-small inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 font-semibold transition active:scale-95';
  return html`<div class="flex min-w-0 flex-1 flex-col gap-1.5">
    <div class="flex min-w-0 items-center gap-2 border-b border-line pb-2 pl-2">
      <span class="flex min-w-0 flex-1 flex-col leading-tight">
        <span class="t-small truncate font-semibold text-ink">${r.label}</span>
        <span class="t-small truncate text-ink-3">${n ? n + (n === 1 ? ' payout changed' : ' payouts changed') : 'No payouts changed'}</span>
      </span>
      <button class=${cx(btn, 'bg-surface-2 text-ink')} onClick=${() => App.reviewUndo()}><${Icon} name="undo" class="size-4" />Undo</button>
      <button class=${cx(btn, 'bg-accent text-on-accent')} onClick=${() => App.reviewApply()}><${Icon} name="check" class="size-4" />Apply</button>
    </div>
    <div class="flex min-w-0 items-stretch"><${Figures} ...${props} /></div>
  </div>`;
}

function Figures({ vm, total, short }) {
  const sh = vm.shares;
  const go = () => App.hudTap();
  if (!(sh && total > 0 && !vm.blocked)) {
    return html`<button class=${cx(CELL, 'gap-2 px-2')} onClick=${go}>
      <span class=${cx('t-small min-w-0 flex-1 truncate text-left font-medium', vm.inputError || short ? 'text-bad' : 'text-ink-2')}>${vm.blocked || 'Enter cash to calculate'}</span>
      <${Icon} name="chevR" class="size-4 shrink-0 text-ink-3" /></button>`;
  }
  const focus = isPreview(vm) && vm.preview.focus ? sh.perPerson.find(p => p.id === vm.preview.focus) : null;
  return html`<span class="flex min-w-0 flex-1 items-stretch divide-x divide-line">
    <button class=${CELL} onClick=${go} aria-label="Rate"><${Figure} k="Rate" v=${'$' + sh.rate.toFixed(2)} tone="text-good" d=${figDelta(vm, 'rate')} /></button>
    ${focus
      ? html`<button class=${CELL} onClick=${go}><${Figure} v=${fmtMoney(focus.final)} tone="text-accent"
        k=${focus.name} d=${payDelta(vm, focus.id, focus.final)} /></button>`
      : html`<button class=${CELL} onClick=${go} aria-label="Pool"><${Figure} k="Pool" v=${fmtMoney(sh.totalCash)} d=${figDelta(vm, 'total')} /></button>`}
    <button class=${CELL} onClick=${() => App.openBonus()} aria-label="Chump — closer bonus and chump">
      <${Figure} k="Chump" v=${sh.leftover > 0 ? fmtMoney(sh.leftover) : '—'} tone=${sh.leftover > 0 ? '' : 'text-ink-3'} d=${figDelta(vm, 'chump')} /></button>
    <button class=${CELL} onClick=${go} aria-label="Small bills needed"><${BillsFig} vm=${vm} /></button>
  </span>
  <button class="grid self-stretch place-items-center px-0.5 text-ink-3" onClick=${go} aria-label="Next"><${Icon} name="chevR" class="size-4" /></button>`;
}

function updateHud(vm, named, total, short) {
  const hud = $('pipHud');
  if (!hud) return;
  const pristine = named === 0 && total === 0;
  hud.classList.toggle('is-empty', pristine);
  hud.classList.toggle('is-warn', !pristine && vm.inputError);   // red only for a real input error; a missing step reads plain
  hud.classList.toggle('is-preview', !pristine && isPreview(vm));
  hud.classList.toggle('is-review', !pristine && !isPreview(vm) && !!vm.changes?.review);
  render(pristine ? null : html`<${Hud} vm=${vm} total=${total} short=${short} />`, hud);
}
