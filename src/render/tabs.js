// Navigation chrome (ui/nav.js holds the state): the header and the tab
// bar's active tab and badges.
//
//   header     one row. A root page: its sub-tabs (every tab has them) as a
//              full-width segmented control — a sideways swipe on the page
//              steps them too. A subpage: ‹ Back (the page under it) · its
//              title · its actions.

import { poolValue, fmtMoneyShort } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Seg } from '../ui/pkit.js';
import { currentTab, currentSub, subsOf, setSub, stackOf, TITLES } from '../ui/nav.js';

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
}

// ── Header ───────────────────────────────────────────────────────────────────

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
  return subs.length
    ? html`<${Seg} size="md" class="min-w-0 flex-1" value=${currentSub(tab)} items=${subs} onChange=${v => setSub(tab, v)} />`
    : html`<h1 class="hdr-big min-w-0 flex-1 truncate">${TITLES[tab]}</h1>`;
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
