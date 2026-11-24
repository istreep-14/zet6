// KeyTime — a time cell outside the Staff table (pool windows, shift times):
// tap → the time keypad, hold → the wheel picker (15-min steps). The value is stored
// as the decimal reading typed ('5', '10.5'); `toAbs` places a reading on the
// shift's axis for display, `fromAbs` turns a dragged time back into a raw.

import { html } from './preact.js';
import { DragTime, CELL } from './dragtime.js';
import { openKeypad, activeKey, bufferAbs } from './keypad.js';

// toAbs(v, mer): a typed reading (+ explicit 'a' / 'p') → absolute time in
// this cell's context; fromAbs(abs) → the raw string to store (exact: it
// carries a meridiem when the bare reading wouldn't read back the same).
// next(dir) → move to another cell (or return false); rerender() redraws the
// owner so the active cell previews what's typed.
export function openKeyTime({ k, title, abs, toAbs, fromAbs, write, next, rerender, clearable = true }) {
  openKeypad({
    key: k,
    title,
    current: abs,
    toAbs,
    commit: (v, mer) => write(fromAbs(toAbs(v, mer))),
    onClear: clearable ? () => write('') : null,
    nav: dir => (next ? next(dir) : false),
    onChange: rerender,
  });
}

export function KeyTime({ k, title, abs, set = true, toAbs, fromAbs, write, min, max, next, rerender, cls = CELL, tone, full = false, clearable = true }) {
  const active = activeKey() === k;
  return html`<${DragTime} abs=${abs} set=${set} min=${min} max=${max} cls=${cls} tone=${tone} full=${full}
    onSet=${a => write(fromAbs(a))} kcell=${k} active=${active} preview=${active ? bufferAbs() : null}
    onTap=${() => openKeyTime({ k, title, abs: () => abs, toAbs, fromAbs, write, next, rerender, clearable })}
    label=${title} />`;
}
