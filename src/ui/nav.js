// Navigation: five tabs — Home · Staff · Tips · Pay · Shift — changed only by
// tapping the tab bar (Settings is a page opened from the menu). Inside a tab:
//
//   sub-tabs   every tab has them, as the tab row under the header's title
//              (Staff: People · Shift; Tips: one cash entry per pool / part;
//              Home: Overview · Shift; Pay: Bills · Split · Bonus;
//              Shift: Shift · Pools).
//              A sideways swipe on the page moves between them; the
//              page and the row's underline follow the finger (onSwipe),
//              past the last one it rubber-bands. A swipe right on the
//              first one pulls the menu in from the left (the `edge`
//              handed to initNav). Elements in a tab's panel marked
//              data-sub="x" show only while sub-tab x is on.
//   header     slides its title row away as the page scrolls down and back
//              on the way up (html.hdr-hide); any navigation brings it back.
//   subpages   a row can push a page in from the right (pushPage). A swipe
//              right on it (or Back in the header) pops it. Subpages have no
//              sub-tabs, so a sideways swipe on one only ever means back.
//
// Each tab keeps its own sub-tab, its own stack of subpages and the scroll
// position of each view. onNav(fn) is told after every change (the header,
// the sub-tab row and the pages re-render from it).
//
// A sideways scroller under the finger (a wide table, a chip row) scrolls
// first: the swipe is left to it while it can still move that way, and the
// page takes the swipe once it's at that end (or when it doesn't overflow at
// all). Touches on a text field, in the wheel, on a box being held
// (dragFlags) or marked [data-noswipe] are left alone; so is everything while
// the keypad or the keyboard is up.

import { dragFlags } from './dragtime.js';
import { render } from './preact.js';

const $ = id => document.getElementById(id);
const root = () => document.documentElement;

export const TABS = ['home', 'staff', 'tips', 'pay', 'shift'];
export const TITLES = { home: 'Home', staff: 'Staff', tips: 'Tips', pay: 'Pay', shift: 'Shift' };
export const SUBS = {
  home: [
    { value: 'overview', label: 'Overview' },
    { value: 'shift', label: 'Shift' },
  ],
  staff: [],
  // Tips' sub-tabs follow the shift: one per pool and per part of a pool.
  tips: [
    { value: 'cash', label: 'Tips' },
  ],
  pay: [
    { value: 'bills', label: 'Bills' },
    { value: 'split', label: 'Split' },
    { value: 'bonus', label: 'Bonus' },
  ],
  shift: [
    { value: 'shift', label: 'Shift' },
    { value: 'pools', label: 'Pools' },
  ],
};

// Replace a tab's sub-tabs (Tips: they follow the pools). Keeps the current
// one when it's still there, else the first.
export function setSubs(tab, list) {
  if (!list?.length) return;
  const same = SUBS[tab] && SUBS[tab].length === list.length && SUBS[tab].every((s, i) => s.value === list[i].value && s.label === list[i].label);
  if (same) return;
  SUBS[tab] = list;
  if (!list.some(s => s.value === sub[tab])) { sub[tab] = list[0].value; applySub(tab); }
}

// Older saved tab names.
export function normalizeTab(name) {
  const legacy = { summary: 'home', payout: 'pay', bills: 'pay', more: 'pay', drawer: 'pay', cash: 'tips', settings: 'shift' };
  return legacy[name] || (TABS.includes(name) ? name : 'home');
}

let cur = 'home';
const sub = Object.fromEntries(Object.entries(SUBS).map(([t, l]) => [t, l[0]?.value ?? null]));
const stacks = Object.fromEntries(TABS.map(t => [t, []]));
const scrollOf = {};
const listeners = [];
let lastVm = null;

export const currentTab = () => cur;
export const currentSub = (tab = cur) => sub[tab] ?? null;
export const subsOf = (tab = cur) => SUBS[tab] || [];
export const stackOf = (tab = cur) => stacks[tab];
export const topPage = (tab = cur) => stacks[tab][stacks[tab].length - 1] || null;
export const onNav = fn => listeners.push(fn);
const changed = () => { revealHeader(); listeners.forEach(fn => fn()); };

// The tab row's underline follows a sub-tab swipe: fn(progress, live) —
// progress in sub-tabs from the current one (−1 … 1), live while the finger
// is down (no easing).
const swipeFns = [];
export const onSwipe = fn => swipeFns.push(fn);
const swipeTo = (progress, live) => swipeFns.forEach(fn => fn(progress, live));

// ── The header hides on the way down, shows on the way up ───────────────────
// Only a scroll the user makes (a finger, its momentum, a mouse wheel)
// hides it — not one the app makes (scrolling a new card into view after a
// tap). A tap has no touchmove, so it never counts.
let lastY = 0, quietUntil = 0, userAt = -1e9;
const byUser = () => performance.now() - userAt < 1500;
export function revealHeader() {
  root().classList.remove('hdr-hide');
  quietUntil = performance.now() + 300;        // a restored scroll position isn't a scroll
  lastY = main()?.scrollTop || 0;
}
function headerOnScroll() {
  const m = main();
  if (!m) return;
  const y = m.scrollTop;
  const r = root();
  if (performance.now() < quietUntil || r.classList.contains('keypad-open') || topPage()) { lastY = y; return; }
  if (!byUser() && y > lastY) { lastY = y; return; }
  const bar = parseFloat(getComputedStyle(r).fontSize) * 3;
  if (y <= bar) { r.classList.remove('hdr-hide'); lastY = y; return; }
  if (y > m.scrollHeight - m.clientHeight - 2) { lastY = y; return; }   // the bounce at the bottom
  const dy = y - lastY;
  if (dy > 8) { r.classList.add('hdr-hide'); lastY = y; }
  else if (dy < -8) { r.classList.remove('hdr-hide'); lastY = y; }
}

const viewKey = () => (topPage() ? 'p:' + topPage().id : cur + ':' + (sub[cur] || ''));
const main = () => $('mainContent');
function saveScroll() {
  const top = topPage();
  if (top) scrollOf['p:' + top.id] = top.el.scrollTop;
  else if (main()) scrollOf[viewKey()] = main().scrollTop;
}

// Show the elements of a tab's panel that belong to its current sub-tab.
function applySub(tab) {
  const panel = $('tab-' + tab);
  if (!panel) return;
  panel.dataset.sub = sub[tab] || '';
  panel.querySelectorAll(':scope > [data-sub]').forEach(el => { el.hidden = el.dataset.sub !== sub[tab]; });
}

function slideIn(el, dir) {
  if (!el || !dir) return;
  el.classList.remove('from-left', 'from-right');
  void el.offsetWidth;
  el.classList.add(dir === 'left' ? 'from-right' : 'from-left');
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function showTab(name) {
  name = normalizeTab(name);
  if (name !== cur) saveScroll();
  cur = name;
  root().dataset.page = name;
  document.querySelectorAll('#mainContent > .panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + name);
    p.classList.remove('from-left', 'from-right');
    p.style.transform = p.style.opacity = p.style.transition = '';
  });
  applySub(name);
  syncPages();
  if (main()) main().scrollTop = scrollOf[name + ':' + (sub[name] || '')] || 0;
  document.activeElement?.blur?.();
  changed();
}

// dir: 'left' = it came from the right (a left swipe / a later sub-tab).
export function setSub(tab, value, { dir = null } = {}) {
  const list = SUBS[tab];
  if (!list || !list.some(s => s.value === value)) return;
  if (sub[tab] === value) return;
  if (tab === cur) saveScroll();
  const from = list.findIndex(s => s.value === sub[tab]);
  sub[tab] = value;
  applySub(tab);
  changed();
  if (tab !== cur) return;
  if (main()) main().scrollTop = scrollOf[tab + ':' + value] || 0;
  const to = list.findIndex(s => s.value === value);
  const panel = $('tab-' + tab);
  if (panel) {
    panel.style.transform = panel.style.opacity = panel.style.transition = '';
    slideIn(panel, dir || (to > from ? 'left' : 'right'));
  }
}

// One step along the sub-tabs (delta ±1); false at the ends / no sub-tabs.
export function stepSub(delta, commit = false) {
  const list = SUBS[cur];
  if (!list) return false;
  const next = list[list.findIndex(s => s.value === sub[cur]) + delta];
  if (!next) return false;
  if (commit) setSub(cur, next.value, { dir: delta > 0 ? 'left' : 'right' });
  return true;
}

// ── Subpages ─────────────────────────────────────────────────────────────────
// page: { key, title, body(vm) → vnode, actions?(vm) → vnode }. The same key
// on top of the stack is replaced rather than pushed twice.
let nextId = 0;
export function pushPage(page, tab = cur) {
  const host = $('subpages');
  if (!host) return;
  const top = topPage(tab);
  if (top && top.key === page.key) { Object.assign(top, page); paint(top); changed(); return; }
  if (tab === cur) saveScroll();
  const el = document.createElement('section');
  el.className = 'subpage';
  el.dataset.tab = tab;
  const p = { ...page, id: ++nextId, tab, el };
  host.append(el);
  stacks[tab].push(p);
  paint(p);
  syncPages();
  if (tab === cur) requestAnimationFrame(() => el.classList.add('in'));
  else el.classList.add('in');
  document.activeElement?.blur?.();
  changed();
}

export function popPage({ tab = cur, animate = true } = {}) {
  const p = stacks[tab].pop();
  if (!p) return false;
  drop(p, animate && tab === cur);
  syncPages();
  changed();
  return true;
}

// Back to the tab's root page.
export function popAll(tab = cur, { animate = false } = {}) {
  const list = stacks[tab].splice(0);
  list.forEach((p, i) => drop(p, animate && tab === cur && i === list.length - 1));
  if (list.length) { syncPages(); changed(); }
}

// Every tab back to its root (a new / switched session).
export function resetNav() {
  TABS.forEach(t => stacks[t].splice(0).forEach(p => drop(p, false)));
  Object.keys(scrollOf).forEach(k => delete scrollOf[k]);
  syncPages();
}

function drop(p, animate) {
  const el = p.el;
  const gone = () => { render(null, el); el.remove(); };
  if (!animate) { gone(); return; }
  el.style.transition = '';
  el.classList.remove('in');
  el.style.transform = '';
  setTimeout(gone, 280);
}

// Only the current tab's pages show; the top one takes touches.
function syncPages() {
  TABS.forEach(t => stacks[t].forEach((p, i, a) => {
    p.el.hidden = t !== cur;
    p.el.classList.toggle('top', i === a.length - 1);
    p.el.classList.toggle('under', i < a.length - 1);
  }));
  root().classList.toggle('sub-open', stacks[cur].length > 0);
}

function paint(p) {
  if (!lastVm) return;
  const vnode = p.body(lastVm);
  render(vnode, p.el);
}

// Every open subpage, with the latest view model (after each app render).
export function renderPages(vm) {
  if (vm) lastVm = vm;
  TABS.forEach(t => stacks[t].forEach(paint));
}
export const refreshPages = () => renderPages();

// ── Gestures ─────────────────────────────────────────────────────────────────

const swallowClick = () => {
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
};

export function ignored(e, can) {
  if (e.touches.length !== 1 || !can()) return true;
  const t = e.target;
  if (t.closest?.('textarea, .wheel, [data-noswipe]')) return true;
  if (t.matches?.('input') && t === document.activeElement && !t.hasAttribute('data-kinput')) return true;
  if (root().classList.contains('keypad-open') || document.body.classList.contains('keyboard-open')) return true;
  return false;
}

// The sideways scroller under the touch that can actually scroll (its content
// is wider than it), from the target up to `el`.
function hScroller(t, el) {
  for (let n = t; n && n !== el && n.nodeType === 1; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return n;
    }
  }
  return null;
}
// Can it scroll further the way the finger moves (dx < 0 reveals the right)?
const canScroll = (sc, dx) => (dx < 0 ? sc.scrollLeft < sc.scrollWidth - sc.clientWidth - 1 : sc.scrollLeft > 1);

// A horizontal drag on `el`. move(dx) while it follows the finger, end(dx,
// fast) on release, cancel() when interrupted.
export function sideways(el, can, { move, end, cancel }) {
  let g = null;
  el.addEventListener('touchstart', e => {
    g = null;
    if (ignored(e, can)) return;
    const p = e.touches[0];
    g = { x0: p.clientX, y0: p.clientY, t0: Date.now(), mode: null, dx: 0, sc: hScroller(e.target, el) };
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!g) return;
    const p = e.touches[0];
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (!g.mode) {
      if (dragFlags.lastArmed >= g.t0) { g = null; return; }     // a held box took this touch
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (g.sc && canScroll(g.sc, dx)) { g = null; return; }      // the table scrolls instead
        g.mode = 'x';
      }
      else if (Math.abs(dx) > 12 || Math.abs(dy) > 12) { g = null; return; }
      else return;
    }
    if (dragFlags.lastArmed >= g.t0) { cancel(); g = null; return; }
    if (e.cancelable) e.preventDefault();
    g.dx = dx;
    move(dx);
  }, { passive: false });
  el.addEventListener('touchend', () => {
    const s = g;
    g = null;
    if (!s?.mode) return;
    swallowClick();
    dragFlags.lastArmed = Date.now();          // not a tap on what's under it
    end(s.dx, Date.now() - s.t0 < 260);
  }, { passive: true });
  el.addEventListener('touchcancel', () => { if (g?.mode) cancel(); g = null; }, { passive: true });
}

const SPRING = 'transform .22s cubic-bezier(.2,.8,.3,1), opacity .22s';

// subsOn(): false while the tab's sub-tabs are hidden (Home's checklist) —
// a sideways swipe then never steps them. edge: { drag(dx), release(dx,
// fast) } — the menu, pulled by a swipe right on the first sub-tab.
export function initNav({ can = () => true, subsOn = () => true, edge = null } = {}) {
  const m = main();
  const panel = () => $('tab-' + cur);
  const setX = (el, x, anim = '') => {
    if (!el) return;
    el.style.transition = anim;
    el.style.transform = x ? `translateX(${x}px)` : '';
  };
  const canStep = delta => subsOn() && stepSub(delta, false);
  const settle = () => { const el = panel(); setX(el, 0, SPRING); if (el) el.style.opacity = ''; swipeTo(0, false); };
  let pulling = false;                         // this swipe is pulling the menu

  if (m) {
    m.addEventListener('scroll', headerOnScroll, { passive: true });
    const mark = () => { userAt = performance.now(); };
    ['touchmove', 'wheel'].forEach(t => m.addEventListener(t, mark, { passive: true }));
  }

  // Root pages: step through the sub-tabs; right off the first = the menu.
  if (m) sideways(m, () => can() && !topPage(), {
    move(dx) {
      const w = m.clientWidth || 360;
      if (edge && dx > 0 && !canStep(-1)) {
        if (!pulling) { pulling = true; setX(panel(), 0); swipeTo(0, true); }
        edge.drag(dx);
        return;
      }
      if (pulling) { pulling = false; edge.drag(0); }
      const open = canStep(dx < 0 ? 1 : -1);
      const el = panel();
      setX(el, open ? dx : dx / 3);
      if (el) el.style.opacity = open ? String(Math.max(0.35, 1 - Math.abs(dx) / (w * 1.4))) : '';
      swipeTo(open ? -dx / w : -dx / w / 4, true);
    },
    end(dx, fast) {
      if (pulling) { pulling = false; edge.release(dx, fast); return; }
      const el = panel();
      const w = m.clientWidth || 360;
      const far = Math.abs(dx) > w / 4 || (fast && Math.abs(dx) > 40);
      const delta = dx < 0 ? 1 : -1;
      if (!far || !canStep(delta)) { settle(); return; }
      setX(el, Math.sign(dx) * w * 0.5, 'transform .12s ease-in, opacity .12s');
      if (el) el.style.opacity = '0.2';
      swipeTo(delta, false);
      setTimeout(() => stepSub(delta, true), 120);
    },
    cancel() {
      if (pulling) { pulling = false; edge.release(0, false); }
      settle();
    },
  });

  // Subpages: a swipe right pops the top one.
  const host = $('subpages');
  if (host) sideways(host, () => can() && !!topPage(), {
    move(dx) {
      const top = topPage();
      if (top) setX(top.el, Math.max(0, dx));
    },
    end(dx, fast) {
      const top = topPage();
      if (!top) return;
      const w = host.clientWidth || 360;
      if (dx > w / 3 || (fast && dx > 40)) {
        setX(top.el, w, 'transform .18s ease-out');
        setTimeout(() => { if (topPage() === top) popPage({ animate: false }); }, 180);
      } else setX(top.el, 0, SPRING);
    },
    cancel() { const top = topPage(); if (top) setX(top.el, 0, SPRING); },
  });
}
