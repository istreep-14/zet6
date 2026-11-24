// Navigation chrome: which page shows, the bottom tabs (with their badges),
// and the HUD — the page's action bar over the tabs.
//
// Four pages — Summary (home) · Staff · Tips · Payout — one per bottom tab;
// a sideways swipe steps between them too (ui/pages.js). The HUD is the
// page's actions (Summary: close time, chump, copy · Staff: Add, Times,
// Select, the close · Tips: count, over / short, party · Payout: already
// made?, stacks, tidy) and ⌃ — the page drawer (render/pagesheet.js), which
// also rises with a swipe up from the HUD or the tab bar, or a tap on the
// page's tab. Its figures show only while an edit is previewed or waits for
// Undo · Apply (the Summary page has them always).

import { poolValue, fmtHrs, fmtMoney, fmtMoneyShort } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Figure, Clock } from '../ui/pkit.js';
import { figDelta, payDelta, isPreview, movedCount } from '../ui/changes.js';
import { showPage } from '../ui/pages.js';
import { staffPills, CloseTime } from './staff.js';
import { tipsPills } from './tips.js';
import { payoutPills } from './payout.js';

const $ = id => document.getElementById(id);

export const TAB_ORDER = ['summary', 'staff', 'tips', 'payout'];
const TITLES = { summary: 'Summary', staff: 'Staff', tips: 'Tips', payout: 'Payout' };

// Older snapshots stored the five-tab names.
export function normalizeTab(name) {
  const legacy = { bills: 'payout', more: 'payout', cash: 'tips' };
  return legacy[name] || (TAB_ORDER.includes(name) ? name : 'summary');
}

// Show a page (opts.dir: the side it slides in from, after a swipe).
export function switchTab(name, opts = {}) {
  showPage(name, opts);
  document.documentElement.dataset.page = name;
  document.querySelectorAll('.tabbar .tab').forEach(b => {
    const on = b.id === 'tb-' + name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const title = $('hdrTitle');
  if (title) title.textContent = TITLES[name] || 'Tip Pool';
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
  renderBadges(badges);
  updateHud(vm, named, total, short);
}
export const refreshChrome = () => { if (last) updateTabIndicators(last.vm, last.sessionName); };

// ── Tab bar badges: staff count, tips total, `!` on a problem. ─────────────
function badge(id, b) {
  const el = $(id);
  if (!el) return;
  el.textContent = b.text;
  el.className = cx('tab-sub', b.tone);
}
function renderBadges(badges) {
  ['staff', 'tips', 'payout'].forEach(t => badge('tab-sub-' + t, badges[t]));
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

// The HUD: the page's actions (Pills) and ⌃ — the page drawer. The figures
// show only while a wheel turns (the would-be numbers, with their changes) and
// while an edit waits for a word: then a row over them says what it was and
// how many payouts it moved, with Undo (put it back) and Apply (keep it).
function Hud({ vm }) {
  const pv = isPreview(vm);
  const r = !pv && vm.changes?.review;
  const n = r ? movedCount(vm) : 0;
  const btn = 't-small inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 font-semibold transition active:scale-95';
  return html`<div class="flex min-w-0 flex-1 flex-col gap-1.5">
    ${r && html`<div class="flex min-w-0 items-center gap-2 border-b border-line pb-2 pl-2">
      <span class="flex min-w-0 flex-1 flex-col leading-tight">
        <span class="t-small truncate font-semibold text-ink">${r.label}</span>
        <span class="t-small truncate text-ink-3">${n ? n + (n === 1 ? ' payout changed' : ' payouts changed') : 'No payouts changed'}</span>
      </span>
      <button class=${cx(btn, 'bg-surface-2 text-ink')} onClick=${() => App.reviewUndo()}><${Icon} name="undo" class="size-4" />Undo</button>
      <button class=${cx(btn, 'bg-accent text-on-accent')} onClick=${() => App.reviewApply()}><${Icon} name="check" class="size-4" />Apply</button>
    </div>`}
    ${(pv || r) && html`<${Figures} vm=${vm} />`}
    ${!pv && html`<${Pills} vm=${vm} />`}
  </div>`;
}

// The page's actions in a row, and ⌃ (the page drawer) at the right end —
// all within the thumb's reach.
function Pills({ vm }) {
  const page = vm.state.ui.activeTab;
  const sh = !vm.blocked ? vm.shares : null;
  const items = page === 'staff' ? staffPills(vm)
    : page === 'tips' ? tipsPills(vm)
    : page === 'payout' ? payoutPills(vm)
    : sh ? [
      { icon: 'clock', label: html`Close ${vm.resolved?.closeAbs != null && html`<${Clock} abs=${vm.resolved.closeAbs} />`}`, aria: 'Close-time what-if', onClick: () => App.openCloseTime() },
      { icon: 'gift', label: 'Chump ' + (sh.leftover > 0 ? fmtMoney(sh.leftover) : '—'), aria: 'Closer bonus and chump', onClick: () => App.openBonus() },
      { icon: 'copy', label: 'Copy', aria: 'Copy as text', onClick: () => App.copySummary() },
    ] : [];
  const pill = 't-small inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-3 font-semibold text-ink transition active:scale-95';
  return html`<div class="flex min-w-0 items-center gap-1.5">
    <div class="flex min-w-0 flex-1 flex-wrap gap-1.5">
      ${items.map((it, i) => it.close
        ? html`<span key="close" class=${cx(pill, 'pr-0.5')}><span class="size-1.5 rounded-full bg-bad/70"></span>Close
            <${CloseTime} vm=${vm} cls="h-7 min-w-[2.75rem] rounded-full px-1.5 tabular-nums transition" tone="font-semibold text-ink" /></span>`
        : html`<button key=${i} class=${cx(pill, it.on && '!bg-accent !text-on-accent')} onClick=${it.onClick} aria-label=${it.aria} aria-pressed=${it.on != null ? String(!!it.on) : undefined}>
            <${Icon} name=${it.on ? 'check' : it.icon} class=${cx('size-4', !it.on && 'text-ink-3')} />${it.label}</button>`)}
      ${!items.length && html`<span class="t-small self-center truncate px-2 text-ink-3">${vm.blocked || 'Swipe up for more'}</span>`}
    </div>
    <button class="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2 transition active:scale-95" onClick=${() => App.pageSheet()} aria-label="More for this page"><${Icon} name="chevU" class="size-[1.125rem]" /></button>
  </div>`;
}

// While a wheel turns or an edit waits: Tips · Hours (or the person being
// edited) · Rate · Bills, with their changes. Not buttons — the tabs go places.
function Figures({ vm }) {
  const sh = !vm.blocked ? vm.shares : null;
  if (!sh || !(vm.totalCash > 0)) return null;
  const focus = isPreview(vm) && vm.preview.focus ? sh.perPerson.find(p => p.id === vm.preview.focus) : null;
  return html`<span class="flex min-w-0 items-stretch divide-x divide-line">
    <${Figure} k="Tips" v=${fmtMoney(sh.totalCash)} tone="text-money" d=${figDelta(vm, 'total')} />
    ${focus
      ? html`<${Figure} v=${fmtMoney(focus.final)} tone="text-accent" k=${focus.name} d=${payDelta(vm, focus.id, focus.final)} />`
      : html`<${Figure} k="Hours" v=${fmtHrs(sh.totalHours) + 'h'} />`}
    <${Figure} k="Rate" v=${'$' + sh.rate.toFixed(2)} tone="text-good" d=${figDelta(vm, 'rate')} />
    <${BillsFig} vm=${vm} />
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
