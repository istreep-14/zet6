// Navigation chrome (ui/nav.js holds the state): the header, the sub-tab
// row, the tab bar's active tab and badges, and the totals strip.
//
//   header     one compact row. A root page: its sub-tabs (Home, Tips) or
//              its title, and its actions (Home: Copy; Staff: Select).
//              A subpage: ‹ Back (the page under it) · its title · its
//              actions.
//   strip      Staff and Tips only: Tips · Hours · Rate in one quiet line —
//              the would-be numbers while an edit is previewed, and a row
//              with Undo · Apply after a wheel / keypad edit.

import { poolValue, fmtHrs, fmtMoney, fmtMoneyShort } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Seg, Delta } from '../ui/pkit.js';
import { figDelta, isPreview, movedCount, payDelta } from '../ui/changes.js';
import { currentTab, currentSub, subsOf, setSub, stackOf, TITLES } from '../ui/nav.js';
import { staffMode, toggleSelect } from './staff.js';

const $ = id => document.getElementById(id);

// "Sat, Nov 8" (local noon, so DST never moves the day).
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return 'Today';
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
}

// True when the computed distribution can't actually pay everyone out.
export function distShort(vm) {
  if (!vm.dist) return false;
  const unpaid = vm.people.reduce((s, p) => s + Math.max(0, p.final - poolValue(vm.dist.byPerson[p.id] || {})), 0);
  const remOk = vm.shares.leftover === 0 || poolValue(vm.dist.remainderBills) === vm.shares.leftover;
  return !!vm.dist.error || unpaid > 0 || !remOk;
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

let last = null;
export function renderChrome(vm = last?.vm, sessionName = last?.sessionName || '') {
  if (!vm) return;
  last = { vm, sessionName };
  const tab = currentTab();
  document.querySelectorAll('.tabbar .tab').forEach(b => {
    const on = b.id === 'tb-' + tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  renderBadges(vm);
  // Home's views mean nothing until there's a split (it shows the checklist).
  const subs = tab === 'home' && vm.blocked ? [] : subsOf(tab);
  const hdr = $('hdr');
  if (hdr) render(html`<${Header} vm=${vm} tab=${tab} subs=${subs} />`, hdr);
  renderStrip(vm);
}

// ── Header ───────────────────────────────────────────────────────────────────

// One compact row. A page with sub-tabs puts them in the header in place of
// its title (the tab bar already says which page it is); a page without
// shows its title. A subpage: ‹ Back · its title · its actions.
function Header({ vm, tab, subs }) {
  const stack = stackOf(tab);
  const top = stack[stack.length - 1];
  if (top) {
    const under = stack[stack.length - 2]?.title || TITLES[tab];
    return html`<button class="hdr-back" onClick=${() => App.back()} aria-label=${'Back to ' + under}>
        <${Icon} name="chevR" class="size-5 shrink-0 rotate-180" /><span class="truncate">${under}</span></button>
      <h1 class="hdr-mid">${top.title}</h1>
      <div class="hdr-actions">${top.actions?.(vm)}</div>`;
  }
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const selecting = tab === 'staff' && staffMode() === 'select';
  const text = 't-small h-9 rounded-full px-3.5 font-semibold transition active:scale-95';
  const actions = html`
    ${tab === 'home' && !vm.blocked && html`<button class="icon-btn" onClick=${() => App.copySummary()} aria-label="Copy as text"><${Icon} name="copy" class="size-[1.0625rem]" /></button>`}
    ${tab === 'staff' && named > 0 && html`<button class=${cx(text, selecting ? 'bg-accent text-on-accent' : 'bg-surface text-accent')} onClick=${toggleSelect}>${selecting ? 'Done' : 'Select'}</button>`}`;
  return html`${subs.length
      ? html`<${Seg} size="md" class="min-w-0 flex-1" value=${currentSub(tab)} items=${subs} onChange=${v => setSub(tab, v)} />`
      : html`<h1 class="hdr-big min-w-0 flex-1 truncate">${TITLES[tab]}</h1>`}
    <div class="hdr-actions">${actions}</div>`;
}

// ── Tab bar badges: staff count, tips total, `!` on a problem. ─────────────
function renderBadges(vm) {
  const total = vm.totalCash;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const short = !vm.blocked && distShort(vm);
  const errOn = tab => vm.inputError && vm.blockedTab === tab;
  const badges = {
    staff: { text: named > 0 ? String(named) : '', tone: named > 0 && errOn('staff') ? 'warn' : '' },
    tips: { text: errOn('tips') || short ? '!' : total > 0 ? fmtMoneyShort(total) : '', tone: errOn('tips') || short ? 'warn' : total > 0 ? 'ok' : '' },
  };
  ['home', 'staff', 'tips', 'settings'].forEach(t => {
    const el = $('tab-sub-' + t), b = badges[t] || { text: '', tone: '' };
    if (!el) return;
    el.textContent = b.text;
    el.className = cx('tab-sub', b.tone);
  });
}

// ── The totals strip ─────────────────────────────────────────────────────────

function Strip({ vm }) {
  const pv = isPreview(vm);
  const r = !pv && vm.changes?.review;
  const n = r ? movedCount(vm) : 0;
  const btn = 't-small inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 font-semibold transition active:scale-95';
  return html`<div class="flex min-w-0 flex-1 flex-col gap-1.5">
    ${r && html`<div class="flex min-w-0 items-center gap-2 border-b border-line pb-1.5">
      <span class="flex min-w-0 flex-1 flex-col leading-tight">
        <span class="t-small truncate font-semibold text-ink">${r.label}</span>
        <span class="t-small truncate text-ink-3">${n ? n + (n === 1 ? ' payout changed' : ' payouts changed') : 'No payouts changed'}</span>
      </span>
      <button class=${cx(btn, 'bg-surface-2 text-ink')} onClick=${() => App.reviewUndo()}><${Icon} name="undo" class="size-4" />Undo</button>
      <button class=${cx(btn, 'bg-accent text-on-accent')} onClick=${() => App.reviewApply()}><${Icon} name="check" class="size-4" />Apply</button>
    </div>`}
    <${Totals} vm=${vm} />
  </div>`;
}

// Tips · Hours (or the person being edited) · Rate on one line.
function Totals({ vm }) {
  const sh = !vm.blocked ? vm.shares : null;
  if (!sh || !(vm.totalCash > 0)) {
    return html`<span class=${cx('t-small truncate', vm.inputError ? 'text-bad' : 'text-ink-3')}>${vm.blocked || 'Enter the tips to see the split'}</span>`;
  }
  const pv = isPreview(vm);
  const focus = pv && vm.preview.focus ? sh.perPerson.find(p => p.id === vm.preview.focus) : null;
  const k = 'text-ink-3', v = cx('font-semibold tabular-nums', pv ? 'text-accent' : 'text-ink');
  const dot = html`<span class="text-ink-3/60">·</span>`;
  return html`<span class="t-small flex min-w-0 items-baseline gap-x-2 whitespace-nowrap">
    <span><span class=${k}>Tips </span><span class=${v}>${fmtMoney(sh.totalCash)}</span> <${Delta} d=${figDelta(vm, 'total')} /></span>${dot}
    ${focus
      ? html`<span class="min-w-0 truncate"><span class=${k}>${focus.name} </span><span class=${v}>${fmtMoney(focus.final)}</span> <${Delta} d=${payDelta(vm, focus.id, focus.final)} /></span>`
      : html`<span><span class=${v}>${fmtHrs(sh.totalHours)}</span><span class=${k}> hours</span></span>`}${dot}
    <span><span class=${v}>$${sh.rate.toFixed(2)}</span><span class=${k}>/h</span> <${Delta} d=${figDelta(vm, 'rate')} /></span>
  </span>`;
}

// Painted with the real view model after a render, or a preview one while a
// wheel turns / a time is typed.
export function renderStrip(vm) {
  const hud = $('pipHud');
  if (!hud || !vm) return;
  hud.classList.remove('is-empty');
  hud.classList.toggle('is-warn', !!vm.inputError);
  hud.classList.toggle('is-preview', isPreview(vm));
  hud.classList.toggle('is-review', !isPreview(vm) && !!vm.changes?.review);
  render(html`<${Strip} vm=${vm} />`, hud);
}
