// Bottom sheets: mount every shell once, open / close by id, and let modules
// hook "closed" to drop their per-sheet state.

import { html, render } from './preact.js';
import { SheetShell } from './pkit.js';

const $ = id => document.getElementById(id);

export const SHEETS = {
  'sheet-staff': { title: 'Person' },
  'sheet-person': { title: 'Payout' },
  'sheet-bonus': { title: 'Closer bonus & chump' },
  'sheet-close': { title: 'Close-time what-if' },
  'sheet-pool': { title: 'Pool', tall: true },
  'sheet-poolsum': { title: 'Pool' },
  'sheet-fix': { title: 'Envelopes already made' },
  'sheet-stacks': { title: 'Stacks for a manager' },
  'sheet-tidy': { title: 'Tidy the drawer' },
  'sheet-count': { title: 'Count bills', tall: true },
  'sheet-adjust': { title: 'Register over / short' },
};

const closeHooks = {};

// Rendered once; sheet bodies are then rendered into by their own modules.
export function mountSheets(host) {
  render(Object.entries(SHEETS).map(([id, o]) => html`<${SheetShell} key=${id} id=${id} ...${o} />`), host);
  Object.keys(SHEETS).forEach(id => swipeToClose($(id)));
}

// Swipe a sheet down to close it: from the grab bar / title anywhere, or
// from the body once it's scrolled to the top. The sheet follows the finger
// (the backdrop lightens with it); let go past a quarter of its height, or with
// a downward flick, and it closes — otherwise it springs back. Sideways
// drags (tables, drag times), typing and pinches are left alone.
function swipeToClose(backdrop) {
  const sheet = backdrop?.querySelector('.sheet');
  if (!sheet) return;
  const body = sheet.querySelector('.sheet-body');
  let g = null;
  const set = dy => {
    sheet.style.transform = `translateY(${dy > 0 ? dy : dy / 4}px)`;
    // The backdrop's own opacity would fade the sheet too — dim its colour.
    backdrop.style.backgroundColor = `rgb(0 0 0 / ${(0.4 * Math.max(0.1, 1 - Math.max(0, dy) / g.h)).toFixed(3)})`;
  };
  const reset = () => {
    sheet.classList.remove('dragging');
    backdrop.classList.remove('dragging');
    sheet.style.transform = '';
    backdrop.style.backgroundColor = '';
  };
  sheet.addEventListener('touchstart', e => {
    g = null;
    if (e.touches.length !== 1) return;
    const t = e.target;
    if (t.closest('input, textarea, select, [data-drag]')) return;
    if (body?.contains(t) && body.scrollTop > 0) return;
    const p = e.touches[0];
    g = { x0: p.clientX, y0: p.clientY, t0: Date.now(), dy: 0, on: false, h: sheet.offsetHeight || 400 };
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (!g) return;
    if (e.touches.length !== 1) { g = null; reset(); return; }
    const p = e.touches[0];
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (!g.on) {
      if (dy > 8 && dy > Math.abs(dx) * 1.2) {
        g.on = true;
        sheet.classList.add('dragging');
        backdrop.classList.add('dragging');
        document.activeElement?.blur?.();
      } else if (Math.abs(dx) > 10 || dy < -8) { g = null; return; } else return;
    }
    e.preventDefault();
    g.dy = dy;
    set(dy);
  }, { passive: false });
  const end = () => {
    const cur = g;
    g = null;
    if (!cur?.on) return;
    const fast = cur.dy / Math.max(1, Date.now() - cur.t0) > 0.6;
    const close = cur.dy > cur.h * 0.25 || (fast && cur.dy > 24);
    // Drop the inline styles and the no-transition flag together, so the
    // sheet animates from where the finger left it (out, or back up).
    reset();
    if (close) closeSheet(backdrop.id);
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
  };
  sheet.addEventListener('touchend', end, { passive: true });
  sheet.addEventListener('touchcancel', end, { passive: true });
}

export const closeAllSheets = () => Object.keys(SHEETS).forEach(id => closeSheet(id));

export const isOpen = id => !!$(id)?.classList.contains('open');
export const sheetBody = id => $(id + '-body');
export const sheetFoot = id => $(id + '-foot');
export function setSheetTitle(id, text) {
  const el = $(id + '-title');
  if (el && el.textContent !== text) el.textContent = text;
}

export function openSheet(id) {
  $(id)?.classList.add('open');
}

export function closeSheet(id) {
  const el = $(id);
  if (!el?.classList.contains('open')) return;
  el.classList.remove('open');
  document.activeElement?.blur?.();
  closeHooks[id]?.();
}

export function onSheetClose(id, fn) {
  closeHooks[id] = fn;
}
