// Navigation: four tabs — Home · Staff · Tips · Settings — changed only by
// tapping the tab bar. Inside a tab:
//
//   sub-tabs   every tab has them, as the segmented control that is the
//              header (Home: Pay · Shift · Bills · Split; Staff: People ·
//              Add · Bulk · Defaults; Tips: Cash · Pools · Drawer; Settings:
//              Shift · Sessions · App). A sideways swipe on the page
//              moves between them; the page follows the finger, past the
//              ends it rubber-bands. Elements in a tab's panel marked
//              data-sub="x" show only while sub-tab x is on.
//   subpages   a row can push a page in from the right (pushPage). A swipe
//              right on it (or Back in the header) pops it. Subpages have no
//              sub-tabs, so a sideways swipe on one only ever means back.
//
// Each tab keeps its own sub-tab, its own stack of subpages and the scroll
// position of each view. onNav(fn) is told after every change (the header,
// the sub-tab row and the pages re-render from it).
//
// Touches in a sideways scroller (.overflow-x-auto), on a text field, in the
// wheel, on a box being held (dragFlags) or marked [data-noswipe] are left
// alone; so is everything while the keypad or the keyboard is up.

import { dragFlags } from './dragtime.js';
import { render } from './preact.js';

const $ = id => document.getElementById(id);
const root = () => document.documentElement;

export const TABS = ['home', 'staff', 'tips', 'settings'];
export const TITLES = { home: 'Home', staff: 'Staff', tips: 'Tips', settings: 'Settings' };
export const SUBS = {
  home: [
    { value: 'pay', label: 'Pay' },
    { value: 'shift', label: 'Shift' },
    { value: 'bills', label: 'Bills' },
    { value: 'split', label: 'Split' },
  ],
  staff: [
    { value: 'people', label: 'People' },
    { value: 'add', label: 'Add' },
    { value: 'bulk', label: 'Bulk' },
    { value: 'defaults', label: 'Defaults' },
  ],
  tips: [
    { value: 'cash', label: 'Cash' },
    { value: 'pools', label: 'Pools' },
    { value: 'drawer', label: 'Drawer' },
  ],
  settings: [
    { value: 'shift', label: 'Shift' },
    { value: 'sessions', label: 'Sessions' },
    { value: 'app', label: 'App' },
  ],
};

// Older saved tab names.
export function normalizeTab(name) {
  const legacy = { summary: 'home', payout: 'tips', bills: 'tips', more: 'tips', cash: 'tips' };
  return legacy[name] || (TABS.includes(name) ? name : 'home');
}

let cur = 'home';
const sub = Object.fromEntries(Object.entries(SUBS).map(([t, l]) => [t, l[0].value]));
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
const changed = () => listeners.forEach(fn => fn());

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

function ignored(e, can) {
  if (e.touches.length !== 1 || !can()) return true;
  const t = e.target;
  if (t.closest?.('.overflow-x-auto, textarea, .wheel, [data-noswipe]')) return true;
  if (t.matches?.('input') && t === document.activeElement && !t.hasAttribute('data-kinput')) return true;
  if (root().classList.contains('keypad-open') || document.body.classList.contains('keyboard-open')) return true;
  return false;
}

// A horizontal drag on `el`. move(dx) while it follows the finger, end(dx,
// fast) on release, cancel() when interrupted.
function sideways(el, can, { move, end, cancel }) {
  let g = null;
  el.addEventListener('touchstart', e => {
    g = null;
    if (ignored(e, can)) return;
    const p = e.touches[0];
    g = { x0: p.clientX, y0: p.clientY, t0: Date.now(), mode: null, dx: 0 };
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!g) return;
    const p = e.touches[0];
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (!g.mode) {
      if (dragFlags.lastArmed >= g.t0) { g = null; return; }     // a held box took this touch
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) g.mode = 'x';
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

export function initNav({ can = () => true } = {}) {
  const m = main();
  const panel = () => $('tab-' + cur);
  const setX = (el, x, anim = '') => {
    if (!el) return;
    el.style.transition = anim;
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  // Root pages: step through the sub-tabs.
  if (m) sideways(m, () => can() && !topPage(), {
    move(dx) {
      const open = stepSub(dx < 0 ? 1 : -1, false);
      const el = panel();
      setX(el, open ? dx : dx / 3);
      if (el) el.style.opacity = open ? String(Math.max(0.35, 1 - Math.abs(dx) / (m.clientWidth * 1.4))) : '';
    },
    end(dx, fast) {
      const el = panel();
      const w = m.clientWidth || 360;
      const far = Math.abs(dx) > w / 4 || (fast && Math.abs(dx) > 40);
      const delta = dx < 0 ? 1 : -1;
      if (!far || !stepSub(delta, false)) { setX(el, 0, SPRING); if (el) el.style.opacity = ''; return; }
      setX(el, Math.sign(dx) * w * 0.5, 'transform .12s ease-in, opacity .12s');
      if (el) el.style.opacity = '0.2';
      setTimeout(() => stepSub(delta, true), 120);
    },
    cancel() { const el = panel(); setX(el, 0, SPRING); if (el) el.style.opacity = ''; },
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
