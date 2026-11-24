// Navigation: four pages side by side — Summary (home) · Staff · Tips ·
// Payout — in the one scroller (#mainContent), one shown at a time
// (.panel.active). (The page drawer — swipe up from the bottom — is
// render/pagesheet.js.)
//
// Pages
//   sideways  swipe the page left / right to step to the next / previous one.
//             The page follows the finger; let go past a quarter of the
//             width (or flick) and it slides out, the next slides in from the
//             other side; otherwise it springs back. Past the ends a swipe
//             opens a side panel (right on Summary → left panel, left on
//             Payout → right panel). Each page keeps its own scroll position.
//   also      the bottom tabs, the HUD cells, the page drawer, Next buttons.
//
// Touches that start at a screen edge (the side panels' drag), in a
// sideways scroller (.overflow-x-auto), on a text field, in the wheel, or on
// a box being held (dragFlags) are left alone; so is everything while the
// keypad or the keyboard is up.

import { dragFlags } from './dragtime.js';

const $ = id => document.getElementById(id);
const root = document.documentElement;
export const PAGES = ['summary', 'staff', 'tips', 'payout'];
const EDGE = 24;

let cur = 'summary';
const scrollOf = {};

export const currentPage = () => cur;

// Show one page. dir: 'left' (it came from the right — a left swipe / a
// later page) or 'right'; the page slides in from that side. Each page keeps
// its own scroll position.
export function showPage(name, { dir = null, animate = true } = {}) {
  if (!PAGES.includes(name)) name = 'summary';
  const main = $('mainContent');
  if (name === cur && $('tab-' + name)?.classList.contains('active')) return;
  if (main) scrollOf[cur] = main.scrollTop;
  if (!dir && animate) dir = PAGES.indexOf(name) > PAGES.indexOf(cur) ? 'left' : 'right';
  cur = name;
  document.querySelectorAll('#mainContent > .panel').forEach(p => {
    const on = p.id === 'tab-' + name;
    p.classList.toggle('active', on);
    p.classList.remove('from-left', 'from-right');
    p.style.transform = '';
    p.style.opacity = '';
    p.style.transition = '';
  });
  const el = $('tab-' + name);
  if (el && animate && dir) { void el.offsetWidth; el.classList.add(dir === 'left' ? 'from-right' : 'from-left'); }
  if (main) main.scrollTop = scrollOf[name] || 0;
  document.activeElement?.blur?.();
}

const swallowClick = () => {
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
};

// ── Gestures ────────────────────────────────────────────────────────────────
// go(name, dir) — a swipe stepped to another page (App.tab keeps state in
// step); ends(side) — a swipe past the first / last page (open that panel);
// can() — whether a page gesture may start at all.
export function initPages({ go, ends, can }) {
  const main = $('mainContent');
  let g = null;
  const panel = () => $('tab-' + cur);
  const setX = (x, anim = '') => {
    const el = panel();
    if (!el) return;
    el.style.transition = anim;
    el.style.transform = x ? `translateX(${x}px)` : '';
    el.style.opacity = x ? String(Math.max(0.35, 1 - Math.abs(x) / (main.clientWidth * 1.4))) : '';
  };

  main.addEventListener('touchstart', e => {
    g = null;
    if (e.touches.length !== 1 || !can()) return;
    const t = e.target, p = e.touches[0];
    if (t.closest('.overflow-x-auto, textarea, .wheel, [data-noswipe]')) return;
    if (t.matches('input') && t === document.activeElement && !t.hasAttribute('data-kinput')) return;
    if (root.classList.contains('keypad-open') || document.body.classList.contains('keyboard-open')) return;
    const edge = p.clientX < EDGE || p.clientX > window.innerWidth - EDGE;
    g = { x0: p.clientX, y0: p.clientY, t0: Date.now(), mode: null, dx: 0, dy: 0, edge };
  }, { passive: true });

  main.addEventListener('touchmove', e => {
    if (!g) return;
    const p = e.touches[0];
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (!g.mode) {
      if (dragFlags.lastArmed >= g.t0) { g = null; return; }      // a held box took this touch
      if (!g.edge && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) g.mode = 'x';
      else if (Math.abs(dx) > 12 || Math.abs(dy) > 12) { g = null; return; }
      else return;
    }
    if (dragFlags.lastArmed >= g.t0) { cancel(); return; }
    if (e.cancelable) e.preventDefault();
    g.dx = dx; g.dy = dy;
    const i = PAGES.indexOf(cur);
    const open = dx < 0 ? i < PAGES.length - 1 : i > 0;
    setX(open ? dx : dx / 3);
  }, { passive: false });

  const cancel = () => {
    if (!g) return;
    setX(0, 'transform .2s, opacity .2s');
    g = null;
  };

  const end = () => {
    const s = g;
    g = null;
    if (!s?.mode) return;
    const fast = Date.now() - s.t0 < 260;
    swallowClick();
    dragFlags.lastArmed = Date.now();            // not a tap on what's under it
    const w = main.clientWidth || 360;
    const far = Math.abs(s.dx) > w / 4 || (fast && Math.abs(s.dx) > 40);
    const i = PAGES.indexOf(cur);
    const j = i + (s.dx < 0 ? 1 : -1);
    if (!far) { setX(0, 'transform .22s cubic-bezier(.2,.8,.3,1), opacity .22s'); return; }
    if (j < 0 || j >= PAGES.length) {
      setX(0, 'transform .22s cubic-bezier(.2,.8,.3,1), opacity .22s');
      ends(s.dx > 0 ? 'left' : 'right');
      return;
    }
    const dir = s.dx < 0 ? -1 : 1;
    setX(dir * w, 'transform .15s ease-in, opacity .15s');
    setTimeout(() => go(PAGES[j], s.dx < 0 ? 'left' : 'right'), 150);
  };
  main.addEventListener('touchend', end, { passive: true });
  main.addEventListener('touchcancel', end, { passive: true });

}
