// Navigation chrome (ui/nav.js holds the state): the header and the tab
// bar's active tab and badges.
//
//   header     sticky over the page, frosted. A root page: the session
//              avatar (opens the menu) · the tab's title — then the sub-tabs
//              as a text tab row with an accent underline that follows a
//              swipe. Scrolling down slides the title row away (the tabs
//              stay); scrolling up brings it back. A subpage: ‹ · its title
//              over its figures · actions.
//   HUD        the shift's figures (tips · people · hours · rate · the small
//              bills) on a bar floating over the tab bar, on every page. It
//              follows a live preview (a turning wheel, a key typed).

import { poolValue, fmtMoney, fmtMoneyShort, fmtHrs } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Meta, Delta } from '../ui/pkit.js';
import { figDelta, isPreview } from '../ui/changes.js';
import { currentTab, currentSub, subsOf, setSub, stackOf, onSwipe, TITLES } from '../ui/nav.js';

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
  const subs = ['home', 'pay'].includes(tab) && vm.blocked ? [] : subsOf(tab);
  document.documentElement.classList.toggle('no-tabs', !subs.length);
  const hdr = $('hdr');
  if (hdr) render(html`<${Header} vm=${vm} tab=${tab} subs=${subs} />`, hdr);
  const hud = $('hud');
  if (hud) {
    hud.classList.toggle('is-preview', isPreview(vm));
    render(html`<${Hud} vm=${vm} />`, hud);
  }
  requestAnimationFrame(() => placeInk(0, false));
}

// ── Header ───────────────────────────────────────────────────────────────────

const rate2 = r => '$' + (Math.round(r * 100) / 100).toFixed(2);

// Hours actually worked by the tipped staff (support is a tip-out). Not
// shares.totalHours: that sums each pool's hours, so overlapping pools (Day /
// Mid / a party) count the same hour more than once.
export const shiftHours = sh => sh.perPerson.filter(p => p.role !== 'support').reduce((t, p) => t + (p.shiftHours ?? p.hours), 0);

// The session's day, as the round avatar that opens the menu.
export function DayDisc({ iso, size = 'size-9', text = 'text-[1rem]' }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return html`<span class=${cx('grid shrink-0 place-items-center rounded-full bg-accent font-semibold tabular-nums text-on-accent', size, text)}>${m ? +m[3] : '·'}</span>`;
}

// ── HUD: the shift at a glance, over the tab bar ────────────────────────────
// Five figures, each a tap to where it's made: Tips → Tips, People / Hours →
// Staff, Rate → Pay's breakdown, Bills → Pay's envelopes. Before there's a
// split, what's known so far (the rest reads —). The small bills are the
// fewest $10 / $5 / $1s that make every payout exact, each in its tint.
function Hud({ vm }) {
  const sh = !vm.blocked && vm.shares;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const need = sh && smallBillsNeeded(vm);
  const dash = html`<span class="text-ink-3">—</span>`;
  const bills = need
    ? need.map((c, i) => html`${i > 0 && html`<span class="text-ink-3/60">·</span>`}<span key=${c.d} data-d=${c.d} class="bill-col">${c.n}</span>`)
    : dash;
  const cells = [
    { k: 'Tips', v: vm.totalCash > 0 ? fmtMoney(vm.totalCash) : dash, d: figDelta(vm, 'total'), go: () => App.tab('tips') },
    { k: named === 1 ? 'Person' : 'People', v: named || dash, go: () => App.tab('staff') },
    { k: 'Hours', v: sh ? fmtHrs(shiftHours(sh)) : dash, d: figDelta(vm, 'hours'), unit: 'h', go: () => App.tab('staff') },
    { k: 'Per hour', v: sh ? rate2(sh.rate) : dash, d: figDelta(vm, 'rate'), tone: 'text-good', go: () => App.tab('pay', { sub: 'split' }) },
    { k: '$10 · $5 · $1', v: bills, go: () => App.tab('pay', { sub: 'bills' }) },
  ];
  return html`<div class="hud-row" role="group" aria-label="The shift at a glance">
    ${cells.map(c => html`<button key=${c.k} class="hud-cell" onClick=${c.go}>
      <span class=${cx('hud-v', sh && c.tone)}>${c.v}</span>
      <span class="hud-k">${c.d ? html`<${Delta} d=${c.d} unit=${c.unit || '$'} />` : c.k}</span>
    </button>`)}
  </div>`;
}

function Header({ vm, tab, subs }) {
  const stack = stackOf(tab);
  const top = stack[stack.length - 1];
  if (top) {
    const under = stack[stack.length - 2]?.title || TITLES[tab];
    return html`<div class="hdr-bar">
      <button class="hdr-btn" onClick=${() => App.back()} aria-label=${'Back to ' + under}><${Icon} name="chevR" class="size-6 rotate-180" /></button>
      <div class="hdr-text"><h1 class="hdr-title">${top.title}</h1>${top.meta && html`<${Meta} items=${top.meta(vm)} />`}</div>
      <div class="hdr-actions">${top.actions?.(vm)}</div>
    </div>`;
  }
  const sub = currentSub(tab);
  return html`<div class="hdr-bar">
      <button class="hdr-btn" onClick=${() => App.openMenu()} aria-label="Menu: sessions and tools" aria-controls="menu">
        <${DayDisc} iso=${vm.state.meta.date} /></button>
      <div class="hdr-text"><h1 class="hdr-title">${TITLES[tab]}</h1></div>
    </div>
    ${subs.length > 0 && html`<div class="hdr-tabs" role="tablist" aria-label=${TITLES[tab]}>
      ${subs.map(s => html`<button key=${tab + s.value} role="tab" class="hdr-tab" aria-selected=${String(s.value === sub)}
        onClick=${() => setSub(tab, s.value)}><span class="hdr-tab-label">${s.label}</span></button>`)}
      <span class="hdr-ink" aria-hidden="true"></span>
    </div>`}`;
}

// The underline sits under the current sub-tab's label, `progress` sub-tabs
// along (a swipe in progress); `live` = following the finger, no easing.
function placeInk(progress = 0, live = false) {
  const row = document.querySelector('#hdr .hdr-tabs');
  const ink = row?.querySelector('.hdr-ink');
  if (!ink) return;
  const labels = [...row.querySelectorAll('.hdr-tab-label')];
  const idx = labels.findIndex(l => l.parentElement.getAttribute('aria-selected') === 'true');
  if (idx < 0) return;
  const pos = Math.max(-0.35, Math.min(labels.length - 0.65, idx + progress));
  const a = Math.max(0, Math.min(labels.length - 1, Math.floor(pos)));
  const b = Math.min(labels.length - 1, a + 1);
  const f = pos - a;
  const box = row.getBoundingClientRect();
  // The row scrolls sideways when there are many tabs (Tips' pools and parts):
  // positions are in the row's content, and the current tab is kept in view.
  const at = l => { const q = l.getBoundingClientRect(); return { x: q.left - box.left + row.scrollLeft, w: q.width }; };
  if (!live) {
    const tab = labels[idx].parentElement, tb = tab.getBoundingClientRect();
    if (tb.left < box.left) row.scrollLeft -= box.left - tb.left + 8;
    else if (tb.right > box.right) row.scrollLeft += tb.right - box.right + 8;
  }
  const A = at(labels[a]), B = at(labels[b]);
  const first = !ink.style.width;
  ink.style.transition = live || first ? 'none' : '';
  ink.style.width = (A.w + (B.w - A.w) * f) + 'px';
  ink.style.transform = `translateX(${A.x + (B.x - A.x) * f}px)`;
}
onSwipe((progress, live) => placeInk(progress, live));
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => placeInk(0, true));
  document.fonts?.ready?.then(() => placeInk(0, true));
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
    pay: { text: short ? '!' : '', tone: short ? 'warn' : '' },
  };
  ['home', 'staff', 'tips', 'pay', 'shift'].forEach(t => {
    const el = $('tab-sub-' + t), b = badges[t] || { text: '', tone: '' };
    if (!el) return;
    el.textContent = b.text;
    el.className = cx('tab-sub', b.tone);
  });
}
