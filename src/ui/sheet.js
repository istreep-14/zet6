// Bottom sheets: mount every shell once, open / close by id, and let modules
// hook "closed" to drop their per-sheet state.

import { html, render } from './preact.js';
import { SheetShell } from './pkit.js';

const $ = id => document.getElementById(id);

export const SHEETS = {
  'sheet-staff': { title: 'Person' },
  'sheet-time': { title: 'Time' },
  'sheet-roster': { title: 'Quick add', tall: true, foot: true },
  'sheet-person': { title: 'Payout' },
  'sheet-bonus': { title: 'Closer bonus & chump' },
  'sheet-close': { title: 'Close-time what-if' },
  'sheet-pool': { title: 'Pool', tall: true },
  'sheet-poolsum': { title: 'Pool' },
};

const closeHooks = {};

// Rendered once; sheet bodies are then rendered into by their own modules.
export function mountSheets(host) {
  render(Object.entries(SHEETS).map(([id, o]) => html`<${SheetShell} key=${id} id=${id} ...${o} />`), host);
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
