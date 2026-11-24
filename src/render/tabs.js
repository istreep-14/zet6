// Navigation chrome: which page shows (Summary, or a page in the drawer),
// the drawer's head (page names with their badges), the hub's tiles, and
// the floating live HUD.
//
// Summary is home — the page under everything, where sessions open. Staff ·
// Tips · Payout are the pages drawer (ui/pages.js). The HUD is how you get
// around: Tips → the Tips page, Hours → Staff, Rate → back to Summary, Bills
// → Payout; two small pills on it (the close time, the chump) open their
// tools; swipe up on it for the drawer; pull down on Summary for the hub.

import { poolValue, fmtHrs, fmtMoney, fmtMoneyShort } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Figure, Clock } from '../ui/pkit.js';
import { figDelta, payDelta, isPreview, movedCount } from '../ui/changes.js';
import { PAGES, openPages, closePages } from '../ui/pages.js';

const $ = id => document.getElementById(id);

export const TAB_ORDER = ['summary', 'staff', 'tips', 'payout'];
const TITLES = { staff: 'Staff', tips: 'Tips', payout: 'Payout' };

// Older snapshots stored the five-tab names.
export function normalizeTab(name) {
  const legacy = { bills: 'payout', more: 'payout', cash: 'tips' };
  return legacy[name] || (TAB_ORDER.includes(name) ? name : 'summary');
}

// Summary closes the drawer; the others open it at that page.
export function switchTab(name) {
  if (name === 'summary' || !PAGES.includes(name)) closePages();
  else openPages(name);
}

// True when the computed distribution can't actually pay everyone out.
export function distShort(vm) {
  if (!vm.dist) return false;
  const unpaid = vm.people.reduce((s, p) => s + Math.max(0, p.final - poolValue(vm.dist.byPerson[p.id] || {})), 0);
  const remOk = vm.shares.leftover === 0 || poolValue(vm.dist.remainderBills) === vm.shares.leftover;
  return !!vm.dist.error || unpaid > 0 || !remOk;
}

let last = null;
export function updateTabIndicators(vm, sessionName = '') {
  const total = vm.totalCash;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const short = !vm.blocked && distShort(vm);
  const errOn = tab => vm.inputError && vm.blockedTab === tab;
  const badges = {
    staff: { text: named > 0 ? String(named) : '', tone: named > 0 && errOn('staff') ? 'warn' : '' },
    tips: { text: errOn('tips') ? '!' : total > 0 ? fmtMoneyShort(total) : '', tone: errOn('tips') ? 'warn' : total > 0 ? 'ok' : '' },
    payout: { text: short ? '!' : '', tone: short ? 'warn' : '' },
  };
  sessionName = sessionName || last?.sessionName || '';
  last = { vm, badges, sessionName };
  renderHead(vm, badges);
  renderHub(vm, badges, sessionName);
  updateHud(vm, named, total, short);
}
export const refreshChrome = () => { if (last) updateTabIndicators(last.vm, last.sessionName); };

// ── The drawer's head: a grab bar, then the three page names (tap one;
//    swipe the pages and the indicator follows), a close chevron. ────────────
const BADGE = { ok: 'bg-accent text-on-accent', warn: 'bg-bad text-white', '': 'bg-surface-2 text-ink-2' };
function Head({ vm, badges }) {
  const cur = vm.state.ui.activeTab;
  return html`<div class="mx-auto mb-1 mt-2 h-[0.3125rem] w-10 rounded-full bg-ink/20"></div>
    <div class="flex items-center gap-1 px-3 pb-1">
      <div class="relative grid flex-1 grid-cols-3">
        ${PAGES.map(p => html`<button key=${p} class=${cx('t-body relative flex h-11 items-center justify-center gap-1.5 font-semibold transition', p === cur ? 'text-ink' : 'text-ink-3')}
          onClick=${() => App.tab(p)}>${TITLES[p]}
          ${badges[p].text && html`<span class=${cx('rounded-full px-1.5 text-[0.6875rem] font-semibold leading-[1.0625rem]', BADGE[badges[p].tone])}>${badges[p].text}</span>`}</button>`)}
        <span class="pages-ind pointer-events-none absolute bottom-0 left-0 flex h-0.5 w-1/3 justify-center"><span class="h-full w-10 rounded-full bg-accent"></span></span>
      </div>
      <button class="icon-btn !size-10 shrink-0 !bg-surface-2" onClick=${() => App.tab('summary')} aria-label="Close"><${Icon} name="chevD" class="size-5" /></button>
    </div>`;
}
function renderHead(vm, badges) {
  const el = $('pagesHead');
  if (el) render(html`<${Head} vm=${vm} badges=${badges} />`, el);
}

// ── The hub: every page and tool as a tile, with its figure. ───────────────
function Hub({ vm, badges, sessionName }) {
  const sh = !vm.blocked ? vm.shares : null;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const tile = (icon, label, sub, onClick, tone = '') => html`<button class=${cx('flex min-h-[5.25rem] flex-col items-start justify-between gap-1 rounded-card bg-surface p-3 text-left transition active:scale-[.97]', tone)}
    onClick=${() => { App.hub(false); onClick(); }}>
    <${Icon} name=${icon} class="size-5 text-accent" />
    <span class="flex min-w-0 flex-col leading-tight"><span class="t-small font-semibold text-ink">${label}</span>
      ${sub && html`<span class="t-small truncate text-ink-3">${sub}</span>`}</span>
  </button>`;
  return html`<div class="mb-3 flex items-baseline justify-between px-1">
      <span class="t-head">Go to</span><span class="t-small truncate text-ink-3">${sessionName || 'This shift'}</span></div>
    <div class="grid grid-cols-3 gap-2">
      ${tile('home', 'Summary', sh ? fmtMoney(sh.totalCash) + ' paid out' : 'The checklist', () => App.tab('summary'))}
      ${tile('users', 'Staff', named ? named + ' on shift' : 'Who worked', () => App.tab('staff'), badges.staff.tone === 'warn' && 'ring-1 ring-bad/50')}
      ${tile('cash', 'Tips', vm.totalCash > 0 ? fmtMoney(vm.totalCash) : 'Enter the cash', () => App.tab('tips'), badges.tips.tone === 'warn' && 'ring-1 ring-bad/50')}
      ${tile('envelope', 'Payout', badges.payout.tone === 'warn' ? 'Needs a swap' : 'The envelopes', () => App.tab('payout'), badges.payout.tone === 'warn' && 'ring-1 ring-bad/50')}
      ${tile('clock', 'Close time', vm.resolved?.closeAbs != null ? html`What-if around <${Clock} abs=${vm.resolved.closeAbs} />` : 'What-if', () => App.openCloseTime())}
      ${tile('gift', 'Bonus & chump', sh && sh.leftover > 0 ? 'Chump ' + fmtMoney(sh.leftover) : 'After rounding', () => App.openBonus())}
      ${tile('copy', 'Copy', 'As text', () => App.copySummary())}
      ${tile('calendar', 'This shift', 'Date, times', () => App.panel('right'))}
      ${tile('menu', 'Sessions', 'Settings', () => App.panel('left'))}
    </div>`;
}
function renderHub(vm, badges, sessionName) {
  const el = $('hub');
  if (el) render(html`<${Hub} vm=${vm} badges=${badges} sessionName=${sessionName} />`, el);
}

// ── HUD ────────────────────────────────────────────────────────────────────

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

// The small bills as "1 · 1 · 16" over "$10 · $5 · $1", each count in its
// bill's tint — reference for pulling change.
function BillsFig({ vm }) {
  const need = smallBillsNeeded(vm);
  if (!need) return html`<${Figure} k="Bills" v="—" tone="text-ink-3" />`;
  const dot = html`<span class="mx-0.5 text-ink-3">·</span>`;
  return html`<${Figure} k="$10 · $5 · $1"
    v=${need.map((c, i) => html`${i > 0 && dot}<span class="bill-col !font-semibold" data-d=${c.d}>${c.n}</span>`)} />`;
}

// A drag / keypad / wheel edit just landed (vm.changes.review): a row over
// the figures saying what it was and how many payouts it moved, with Undo
// (put it back) and Apply (keep it — the change marks go).
function Hud(props) {
  const { vm } = props;
  const r = !isPreview(vm) && vm.changes?.review;
  if (!r) return html`<${Pills} vm=${vm} /><${Figures} ...${props} />`;
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

// Two quiet pills riding on the HUD's top edge: the close time (→ Close-time
// what-if) and the chump (→ Closer bonus & chump).
function Pills({ vm }) {
  const sh = !vm.blocked ? vm.shares : null;
  if (!sh) return null;
  const pill = 'hud-pill t-small inline-flex h-8 items-center gap-1 rounded-full px-3 font-semibold transition active:scale-95';
  return html`<div class="hud-pills">
    <button class=${pill} onClick=${() => App.openCloseTime()} aria-label="Close-time what-if">
      <${Icon} name="clock" class="size-3.5 text-ink-3" />Close ${vm.resolved?.closeAbs != null && html`<${Clock} abs=${vm.resolved.closeAbs} />`}<${Icon} name="chevR" class="size-3 text-ink-3" /></button>
    <button class=${pill} onClick=${() => App.openBonus()} aria-label="Closer bonus and chump">
      <${Icon} name="gift" class="size-3.5 text-ink-3" />Chump ${sh.leftover > 0 ? fmtMoney(sh.leftover) : '—'}<${Icon} name="chevR" class="size-3 text-ink-3" /></button>
  </div>`;
}

// Tips · Hours · Rate · Bills — each its own tap target: Tips → the Tips
// page, Hours → Staff, Rate → Summary, Bills → Payout. While an edit is
// previewed the figures are the would-be ones (the change after each label,
// an accent ring) and the person being edited takes the Hours cell; just
// after an edit lands the labels show what moved.
const CELL = 'flex min-w-0 flex-1 items-center self-stretch rounded-xl transition active:bg-surface-2';
function Figures({ vm, short }) {
  const sh = !vm.blocked ? vm.shares : null;
  if (!sh || !(vm.totalCash > 0)) {
    const to = vm.blockedTab || 'staff';
    return html`<button class=${cx(CELL, 'gap-2 px-2')} onClick=${() => App.tab(to)}>
      <span class=${cx('t-small min-w-0 flex-1 truncate text-left font-medium', vm.inputError || short ? 'text-bad' : 'text-ink-2')}>${vm.blocked || 'Enter cash to calculate'}</span>
      <span class="t-small shrink-0 font-semibold text-accent">${TITLES[to] || 'Staff'}</span>
      <${Icon} name="chevR" class="size-4 shrink-0 text-accent" /></button>`;
  }
  const focus = isPreview(vm) && vm.preview.focus ? sh.perPerson.find(p => p.id === vm.preview.focus) : null;
  const tipped = sh.totalHours;
  return html`<span class="flex min-w-0 flex-1 items-stretch divide-x divide-line">
    <button class=${CELL} onClick=${() => App.tab('tips')} aria-label="Tips"><${Figure} k="Tips" v=${fmtMoney(sh.totalCash)} d=${figDelta(vm, 'total')} /></button>
    ${focus
      ? html`<button class=${CELL} onClick=${() => App.tab('staff')}><${Figure} v=${fmtMoney(focus.final)} tone="text-accent" k=${focus.name} d=${payDelta(vm, focus.id, focus.final)} /></button>`
      : html`<button class=${CELL} onClick=${() => App.tab('staff')} aria-label="Hours"><${Figure} k="Hours" v=${fmtHrs(tipped) + 'h'} /></button>`}
    <button class=${CELL} onClick=${() => App.tab('summary')} aria-label="Rate"><${Figure} k="Rate" v=${'$' + sh.rate.toFixed(2)} tone="text-good" d=${figDelta(vm, 'rate')} /></button>
    <button class=${CELL} onClick=${() => App.tab('payout')} aria-label="Small bills — Payout"><${BillsFig} vm=${vm} /></button>
  </span>`;
}

function updateHud(vm, named, total, short) {
  const hud = $('pipHud');
  if (!hud) return;
  hud.classList.remove('is-empty');
  hud.classList.toggle('is-warn', vm.inputError);   // red only for a real input error; a missing step reads plain
  hud.classList.toggle('is-preview', isPreview(vm));
  hud.classList.toggle('is-review', !isPreview(vm) && !!vm.changes?.review);
  render(html`<${Hud} vm=${vm} total=${total} short=${short} />`, hud);
}
