// Bottom sheets: mount every shell once, open / close by id, and let modules
// hook "closed" to drop their per-sheet state.

import { SheetShell } from './kit.js';

const $ = id => document.getElementById(id);

export const SHEETS = {
  'sheet-defaults': { title: 'Default times' },
  'sheet-time': { title: 'Shift time' },
  'sheet-roster': { title: 'Quick add', tall: true, foot: true },
  'sheet-person': { title: 'Payout' },
  'sheet-bonus': { title: 'Closer bonus & chump' },
  'sheet-close': { title: 'Close-time what-if' },
};

const closeHooks = {};

export function mountSheets(host) {
  host.innerHTML = Object.entries(SHEETS)
    .map(([id, o]) => String(SheetShell({ id, ...o })))
    .join('');
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

// Backdrop tap (outside the sheet) closes it.
export function sheetBackdrop(e, id) {
  if (e.target === $(id)) closeSheet(id);
}
