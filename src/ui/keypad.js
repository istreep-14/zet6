// Time keypad — an in-app numpad docked at the bottom (in place of the tab
// bar) for typing clock times into table cells, spreadsheet style:
//
//   [ Maya · In          5:30p      [a|p]   ⋯  Done ]
//   [ 1 ][ 2 ][ 3 ][ ⌫  ]
//   [ 4 ][ 5 ][ 6 ][ :15 ]
//   [ 7 ][ 8 ][ 9 ][ :30 ]
//   [ : ][ 0 ][:00][ :45 ]
//   [ Default ][ ← ][ ↑ ][ ↓ ][ Next → ]
//
// What's typed is parsed by parseClockEntry ("530" → 5:30, "1045", "5:3",
// "17" → 5) and previewed in the dock and in the cell; it's written when you
// leave the cell (Next / ← / ↓ / ↑ / Done / tapping elsewhere). The first key
// replaces the cell's value, like a spreadsheet. a / p pins the meridiem
// (any time of day works — 7a, 9p); without it the shift's am/pm rule picks.
// Default clears the cell so it inherits again.
//
// Cells are focusable (DragTime renders a keyboard-less input inside them),
// so Tab / Shift-Tab and the iPhone keyboard's ‹ › arrows walk the table
// too: focusing a cell opens the keypad on it.
//
// Owners call openKeypad({ key, title, current, toAbs, commit, nav, onClear,
// onMore, onChange }):
//   key        which cell is active (owners highlight `activeKey()`)
//   current()  the cell's absolute time now (or null)
//   toAbs(v, mer)   reading (+ 'a' / 'p' or null) → absolute time, in the
//                   cell's own context (the person's In, the shift open …)
//   commit(v, mer)  write it
//   nav(dir)   'next' | 'prev' | 'down' | 'up' → move (return false = none)
//   onClear    Default key; onMore → the ⋯ button (e.g. person editor)
//   onChange   re-render the owner so the active cell shows the buffer

import { html, render } from './preact.js';
import { cx, Icon } from './pkit.js';
import { parseClockEntry, fmtTimeAbs, readingOf, merOf } from '../time.js';

const $ = id => document.getElementById(id);

let cfg = null;
let buf = '';
let mer = null;            // 'a' | 'p' pinned on the keypad, else null (auto)
let error = false;

export const activeKey = () => cfg?.key ?? null;
export const isKeypadOpen = () => !!cfg;
const currentAbs = () => (cfg?.current ? cfg.current() : null);

// The typed reading as { v, mer } (or null), for cells that preview it.
function typed() {
  if (!buf && !mer) return null;
  if (!buf) { const a = currentAbs(); return a == null ? null : { v: readingOf(a), mer }; }
  const p = parseClockEntry(buf);
  return p.valid && !p.empty ? { v: p.value, mer: mer || p.mer } : null;
}
// The absolute time being typed into the active cell (or null).
export function bufferAbs() {
  const t = cfg && typed();
  return t ? cfg.toAbs(t.v, t.mer) : null;
}

export function openKeypad(next) {
  if (cfg && cfg.key === next.key) return;          // already on this cell
  if (cfg) commitBuffer();
  cfg = next;
  buf = '';
  mer = null;
  error = false;
  document.documentElement.classList.add('keypad-open');
  // Drop the system keyboard, but keep focus on a keypad cell's own input.
  const ae = document.activeElement;
  if (ae && !ae.matches?.('[data-kinput]')) ae.blur?.();
  paint();
  cfg.onChange?.();
  scrollToActive();
}

export function closeKeypad({ commit = true } = {}) {
  if (!cfg) return;
  if (commit) commitBuffer();
  const owner = cfg;
  cfg = null;
  buf = '';
  mer = null;
  document.documentElement.classList.remove('keypad-open');
  if (document.activeElement?.matches?.('[data-kinput]')) document.activeElement.blur();
  paint();
  owner.onChange?.();
}

// Write what's typed. Returns false (and flags it) when it isn't a time.
function commitBuffer() {
  if (!cfg || (!buf && !mer)) return true;
  if (buf) {
    const p = parseClockEntry(buf);
    if (!p.valid || p.empty) { error = true; return false; }
  }
  const t = typed();
  if (t) cfg.commit(t.v, t.mer);
  buf = '';
  mer = null;
  return true;
}

function go(dir) {
  if (!commitBuffer()) { paint(); return; }
  const owner = cfg;
  if (owner.nav?.(dir) === false) closeKeypad();
}

// Focus a cell by its key: keypad cells focus their input (which opens the
// keypad there); text cells (names) just take focus.
export function focusCell(key) {
  const el = [...document.querySelectorAll(`[data-kcell="${key}"]`)].find(node => node.offsetParent);
  if (!el) return false;
  const input = el.matches('input') ? el : el.querySelector('[data-kinput]');
  if (input) {
    if (!input.matches('[data-kinput]')) closeKeypad();
    input.focus();
    if (!input.matches('[data-kinput]')) input.select?.();
  } else el.click();
  return true;
}

function press(k) {
  error = false;
  if (k === 'del') buf = buf.slice(0, -1);
  else if (k === 'a' || k === 'p') {
    mer = mer === k ? null : k;
    if (!buf && currentAbs() == null) mer = null;
  } else if (k.startsWith(':') && k.length === 3) {
    // Minute keys: keep the hour typed (or the cell's hour) and set minutes.
    const cur = currentAbs();
    const hour = buf.split(':')[0] || (cur != null ? String(Math.floor(readingOf(cur))) : '');
    if (!hour) return;
    buf = hour + k;
  } else if (k === ':') {
    if (!buf || buf.includes(':')) return;
    buf += ':';
  } else if (buf.replace(':', '').length < 4) buf += k;
  paint();
  cfg.onChange?.();
}

function scrollToActive() {
  requestAnimationFrame(() => {
    // The same cell can be on two pages (Staff and Home's table): the visible one.
    [...document.querySelectorAll('[data-kcell][data-active]')].find(el => el.offsetParent)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// Tapping anywhere outside the keypad and the cells commits and closes.
document.addEventListener('pointerdown', e => {
  if (!cfg) return;
  if (e.target.closest?.('#keypad, [data-kcell]')) return;
  closeKeypad();
}, true);
// Hardware keys (desktop / a keyboard case): digits, ':' / '.', a / p,
// Backspace, Tab / Enter = Next, Shift-Tab = back, arrows = up / down, Esc =
// cancel. Keys a text field already handled (a name's Enter that opened this
// keypad) are ignored; the keypad cells' own inputs are ours.
document.addEventListener('keydown', e => {
  if (!cfg || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea') && !e.target.matches('[data-kinput]')) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) press(k);
  else if (k === ':' || k === '.') press(':');
  else if (k === 'a' || k === 'p' || k === 'A' || k === 'P') press(k.toLowerCase());
  else if (k === 'Backspace') press('del');
  else if (k === 'Tab') { e.preventDefault(); go(e.shiftKey ? 'prev' : 'next'); }
  else if (k === 'Enter') { e.preventDefault(); go('next'); }
  else if (k === 'ArrowDown') { e.preventDefault(); go('down'); }
  else if (k === 'ArrowUp') { e.preventDefault(); go('up'); }
  else if (k === 'ArrowLeft' && !buf) { e.preventDefault(); go('prev'); }
  else if (k === 'ArrowRight' && !buf) { e.preventDefault(); go('next'); }
  else if (k === 'Escape') closeKeypad({ commit: false });
});

const KEY = 'grid h-12 place-items-center rounded-xl bg-surface text-[1.25rem] tabular-nums text-ink shadow-[0_1px_0_rgb(0_0_0/.12)] transition select-none active:scale-95 active:bg-surface-2 max-[400px]:h-11';
const FN = 'flex h-12 items-center justify-center gap-0.5 rounded-xl text-[1rem] font-semibold transition select-none active:scale-95 max-[400px]:h-11';

function Pad() {
  if (!cfg) return null;
  const t = typed();
  const cur = currentAbs();
  const abs = t ? cfg.toAbs(t.v, t.mer) : cur;
  const shown = buf && !t ? buf : abs != null ? fmtTimeAbs(abs) : '—';
  const am = abs != null ? merOf(abs) : null;
  const k = (label, v = label, cls = KEY) => html`<button type="button" class=${cls} onClick=${() => press(v)}>${label}</button>`;
  const ap = v => html`<button type="button" aria-pressed=${String(am === v)} onClick=${() => press(v)}
    class=${cx('h-8 w-9 rounded-lg text-[1rem] font-semibold transition', am === v ? (mer === v ? 'bg-accent text-on-accent' : 'bg-raised text-ink shadow-[0_1px_3px_rgb(0_0_0/.14)]') : 'text-ink-3')}>${v}</button>`;
  return html`<div class="flex flex-col gap-2 px-2 pb-2 pt-2">
    <div class="flex items-center gap-2 px-1">
      <span class="t-small min-w-0 flex-1 truncate text-ink-2">${cfg.title}</span>
      <span class=${cx('min-w-[5.5rem] text-center text-[1.25rem] font-semibold tabular-nums tracking-tight',
        error ? 'text-bad' : buf || mer ? 'text-accent' : 'text-ink-3')}>${error ? 'Not a time' : shown}</span>
      <span class="flex flex-1 items-center justify-end gap-1">
        <span class="flex rounded-[0.625rem] bg-surface-2 p-0.5" role="group" aria-label="am or pm">${ap('a')}${ap('p')}</span>
        ${cfg.onMore && html`<button type="button" class="grid size-9 place-items-center rounded-full text-ink-2 active:bg-surface" aria-label="More" onClick=${() => { const m = cfg.onMore; closeKeypad(); m(); }}><${Icon} name="more" class="size-5" /></button>`}
        <button type="button" class="t-body h-9 rounded-full px-2.5 font-semibold text-accent active:bg-surface" onClick=${() => closeKeypad()}>Done</button>
      </span>
    </div>
    <div class="grid grid-cols-4 gap-1.5">
      ${k('1')}${k('2')}${k('3')}
      <button type="button" class=${cx(FN, 'bg-surface-2 text-ink')} aria-label="Delete" onClick=${() => press('del')}><${Icon} name="back" class="size-6" /></button>
      ${k('4')}${k('5')}${k('6')}${k(':15', ':15', cx(FN, 'bg-surface-2 text-ink-2'))}
      ${k('7')}${k('8')}${k('9')}${k(':30', ':30', cx(FN, 'bg-surface-2 text-ink-2'))}
      ${k(':', ':', cx(KEY, 'text-ink-2'))}${k('0')}${k(':00', ':00', cx(FN, 'bg-surface-2 text-ink-2'))}${k(':45', ':45', cx(FN, 'bg-surface-2 text-ink-2'))}
    </div>
    <div class="grid grid-cols-[1.25fr_1fr_1fr_1fr_1.75fr] gap-1.5">
      <button type="button" class=${cx(FN, 'bg-surface-2 text-ink-2')} disabled=${!cfg.onClear}
        onClick=${() => { buf = ''; mer = null; error = false; cfg.onClear?.(); paint(); cfg.onChange?.(); }}>Default</button>
      <button type="button" class=${cx(FN, 'bg-surface-2 text-ink')} aria-label="Back a cell" onClick=${() => go('prev')}><${Icon} name="chevR" class="size-5 rotate-180" /></button>
      <button type="button" class=${cx(FN, 'bg-surface-2 text-ink')} aria-label="Up a row" onClick=${() => go('up')}><${Icon} name="chevU" class="size-5" /></button>
      <button type="button" class=${cx(FN, 'bg-surface-2 text-ink')} aria-label="Down a row" onClick=${() => go('down')}><${Icon} name="chevD" class="size-5" /></button>
      <button type="button" class=${cx(FN, 'bg-accent text-on-accent')} onClick=${() => go('next')}>Next<${Icon} name="chevR" class="size-4" /></button>
    </div>
  </div>`;
}

function paint() {
  const host = $('keypad');
  if (!host) return;
  render(html`<${Pad} />`, host);
  host.classList.toggle('open', !!cfg);
  document.documentElement.style.setProperty('--kp-h', cfg ? host.offsetHeight + 'px' : '0px');
}
