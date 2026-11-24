// Navigation: Summary is home (the page under everything); Staff · Tips ·
// Payout live in one drawer that rises from the bottom (#pages), and a hub
// drops from the top (#hub).
//
// Pages drawer
//   open      App.tab(name) — a HUD cell, the hub, a Next button — or swipe
//             up on the HUD (the drawer follows the finger)
//   sideways  swipe anywhere on a page (not on a sideways scroller, not
//             leftward on a Staff row — that's the row's Remove) and the
//             pages follow the finger; let go past a quarter, or flick
//   close     swipe down on the head, or on a page scrolled to its top (the
//             drawer follows); tap the strip of Summary above it
// Hub
//   open      pull down at the top of Summary (it follows the finger)
//   close     swipe it up, tap outside, pick something
//
// Every drag shows its result live and springs back if it isn't finished.

import { dragFlags } from './dragtime.js';

const $ = id => document.getElementById(id);
const root = document.documentElement;
export const PAGES = ['staff', 'tips', 'payout'];

let cur = 'staff';
let onPage = () => {};

export const pagesOpen = () => root.classList.contains('pages-open');
export const currentPage = () => cur;
export const hubOpen = () => root.classList.contains('hub-open');

function place(i, dx = 0) {
  const t = $('pagesTrack');
  if (t) t.style.transform = dx ? `translateX(calc(${-i * 100 / 3}% + ${dx}px))` : `translateX(${-i * 100 / 3}%)`;
  // The head's indicator follows (0 … 2, fractional while dragging).
  const w = $('pages')?.offsetWidth || 1;
  root.style.setProperty('--pp', String(i - dx / w));
}

export function openPages(name) {
  if (!PAGES.includes(name)) return;
  cur = name;
  place(PAGES.indexOf(name));
  closeHub();
  if (!pagesOpen()) {
    root.classList.add('pages-open');
    $('pages')?.setAttribute('aria-hidden', 'false');
  }
}

export function closePages() {
  if (!pagesOpen()) return;
  root.classList.remove('pages-open');
  $('pages')?.setAttribute('aria-hidden', 'true');
  document.activeElement?.blur?.();
}

export function openHub() {
  root.classList.add('hub-open');
  $('hub')?.setAttribute('aria-hidden', 'false');
}
export function closeHub() {
  if (!hubOpen()) return;
  root.classList.remove('hub-open');
  $('hub')?.setAttribute('aria-hidden', 'true');
}

const swallowClick = () => {
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
};

// ── Gestures ────────────────────────────────────────────────────────────────
// onChange(name) — the drawer moved to another page (or 'summary' when it
// closed) by a gesture; App.tab keeps state in step.
export function initPages({ onChange, canPull }) {
  onPage = onChange;
  const pages = $('pages'), hud = $('pipHud'), main = $('mainContent'), hub = $('hub');
  let g = null;

  // In the drawer: sideways = pages, down = close.
  pages.addEventListener('touchstart', e => {
    g = null;
    if (e.touches.length !== 1) return;
    const t = e.target, p = e.touches[0];
    const sc = t.closest('.pg-scroll');
    g = {
      x0: p.clientX, y0: p.clientY, t0: Date.now(), dx: 0, dy: 0, mode: null,
      head: !!t.closest('.pages-head'),
      top: !sc || sc.scrollTop <= 0,
      row: !!t.closest('[data-swipe-row]'),
      noX: !!t.closest('.overflow-x-auto, .wheel, input:focus'),
      w: pages.offsetWidth || 360, h: pages.offsetHeight || 600,
    };
  }, { passive: true });
  pages.addEventListener('touchmove', e => {
    if (!g) return;
    const p = e.touches[0];
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (dragFlags.lastArmed >= g.t0) { cancel(); return; }   // a held box (or a row's swipe) took this touch
    if (!g.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        // A Staff row swipes left for Remove; rightward still pages back.
        if (g.noX || (g.row && dx < 0)) { g = null; return; }
        g.mode = 'x';
        root.classList.add('pager-drag');
      } else if (dy > 10 && dy > Math.abs(dx) * 1.3 && (g.head || g.top)) {
        g.mode = 'y';
        root.classList.add('pages-drag');
      } else if (Math.abs(dy) > 10 || Math.abs(dx) > 10) { g = null; return; } else return;
    }
    if (e.cancelable) e.preventDefault();
    g.dx = dx; g.dy = dy;
    if (g.mode === 'x') {
      const i = PAGES.indexOf(cur);
      const edge = (i === 0 && dx > 0) || (i === PAGES.length - 1 && dx < 0);
      place(i, edge ? dx / 3 : dx);
    } else {
      pages.style.transform = `translateY(${Math.max(0, dy)}px)`;
      $('pagesScrim').style.opacity = String(Math.max(0, 1 - dy / g.h));
    }
  }, { passive: false });
  const cancel = () => {
    if (!g) return;
    root.classList.remove('pager-drag', 'pages-drag');
    pages.style.transform = '';
    $('pagesScrim').style.opacity = '';
    place(PAGES.indexOf(cur));
    g = null;
  };
  const end = () => {
    const s = g;
    g = null;
    if (!s?.mode) return;
    const fast = Date.now() - s.t0 < 260;
    root.classList.remove('pager-drag', 'pages-drag');
    pages.style.transform = '';
    $('pagesScrim').style.opacity = '';
    swallowClick();
    if (s.mode === 'x') {
      let i = PAGES.indexOf(cur);
      if ((s.dx < -s.w / 4 || (fast && s.dx < -40)) && i < PAGES.length - 1) i++;
      else if ((s.dx > s.w / 4 || (fast && s.dx > 40)) && i > 0) i--;
      place(i);
      if (PAGES[i] !== cur) { cur = PAGES[i]; onPage(cur); }
    } else if (s.dy > s.h / 4 || (fast && s.dy > 60)) {
      closePages();
      onPage('summary');
    }
  };
  pages.addEventListener('touchend', end, { passive: true });
  pages.addEventListener('touchcancel', end, { passive: true });

  // Swipe up on the HUD: the drawer rises with the finger.
  let u = null;
  hud.addEventListener('touchstart', e => {
    u = null;
    if (e.touches.length !== 1 || pagesOpen()) return;
    const p = e.touches[0];
    u = { y0: p.clientY, x0: p.clientX, t0: Date.now(), on: false, dy: 0, h: pages.offsetHeight || window.innerHeight * 0.85 };
  }, { passive: true });
  hud.addEventListener('touchmove', e => {
    if (!u) return;
    const p = e.touches[0];
    const dy = p.clientY - u.y0, dx = p.clientX - u.x0;
    if (!u.on) {
      if (dy < -12 && -dy > Math.abs(dx) * 1.3) {
        u.on = true;
        place(PAGES.indexOf(cur));
        root.classList.add('pages-drag', 'pages-rise');
      } else if (Math.abs(dx) > 12 || dy > 12) { u = null; return; } else return;
    }
    if (e.cancelable) e.preventDefault();
    u.dy = dy;
    pages.style.transform = `translateY(${Math.max(0, u.h + dy)}px)`;
    $('pagesScrim').style.opacity = String(Math.min(1, -dy / u.h));
  }, { passive: false });
  const hudEnd = () => {
    const s = u;
    u = null;
    if (!s?.on) return;
    root.classList.remove('pages-drag', 'pages-rise');
    pages.style.transform = '';
    $('pagesScrim').style.opacity = '';
    swallowClick();
    if (-s.dy > s.h / 4 || (Date.now() - s.t0 < 260 && s.dy < -40)) onPage(cur, true);
  };
  hud.addEventListener('touchend', hudEnd, { passive: true });
  hud.addEventListener('touchcancel', hudEnd, { passive: true });

  // Pull down at the top of Summary: the hub drops with the finger.
  let h = null;
  main.addEventListener('touchstart', e => {
    h = null;
    if (e.touches.length !== 1 || main.scrollTop > 0 || !canPull()) return;
    const p = e.touches[0];
    h = { y0: p.clientY, x0: p.clientX, t0: Date.now(), on: false, dy: 0, hh: hub.offsetHeight || 320 };
  }, { passive: true });
  main.addEventListener('touchmove', e => {
    if (!h) return;
    const p = e.touches[0];
    const dy = p.clientY - h.y0, dx = p.clientX - h.x0;
    if (!h.on) {
      if (dy > 14 && dy > Math.abs(dx) * 1.4 && main.scrollTop <= 0) {
        h.on = true;
        root.classList.add('hub-drag');
      } else if (Math.abs(dx) > 12 || dy < -8) { h = null; return; } else return;
    }
    if (e.cancelable) e.preventDefault();
    h.dy = dy;
    const shown = Math.min(h.hh, dy * 0.9);
    hub.style.transform = `translateY(${shown - h.hh}px)`;
    $('hubScrim').style.opacity = String(Math.min(1, shown / h.hh));
  }, { passive: false });
  const hubPullEnd = () => {
    const s = h;
    h = null;
    if (!s?.on) return;
    root.classList.remove('hub-drag');
    hub.style.transform = '';
    $('hubScrim').style.opacity = '';
    if (s.dy * 0.9 > s.hh / 3 || (Date.now() - s.t0 < 260 && s.dy > 50)) openHub();
  };
  main.addEventListener('touchend', hubPullEnd, { passive: true });
  main.addEventListener('touchcancel', hubPullEnd, { passive: true });

  // Swipe the hub back up.
  let k = null;
  hub.addEventListener('touchstart', e => {
    k = null;
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    k = { y0: p.clientY, t0: Date.now(), on: false, dy: 0, hh: hub.offsetHeight || 320 };
  }, { passive: true });
  hub.addEventListener('touchmove', e => {
    if (!k) return;
    const dy = e.touches[0].clientY - k.y0;
    if (!k.on) { if (dy < -10) { k.on = true; root.classList.add('hub-drag'); } else if (dy > 10) { k = null; return; } else return; }
    if (e.cancelable) e.preventDefault();
    k.dy = dy;
    hub.style.transform = `translateY(${Math.min(0, dy)}px)`;
    $('hubScrim').style.opacity = String(Math.max(0, 1 + dy / k.hh));
  }, { passive: false });
  const hubEnd = () => {
    const s = k;
    k = null;
    if (!s?.on) return;
    root.classList.remove('hub-drag');
    hub.style.transform = '';
    $('hubScrim').style.opacity = '';
    swallowClick();
    if (-s.dy > s.hh / 4 || (Date.now() - s.t0 < 260 && s.dy < -40)) closeHub();
  };
  hub.addEventListener('touchend', hubEnd, { passive: true });
  hub.addEventListener('touchcancel', hubEnd, { passive: true });

  window.addEventListener('resize', () => place(PAGES.indexOf(cur)));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (hubOpen()) closeHub();
    else if (pagesOpen() && !document.querySelector('.sheet-backdrop.open') && !root.classList.contains('keypad-open')) { closePages(); onPage('summary'); }
  });
}
