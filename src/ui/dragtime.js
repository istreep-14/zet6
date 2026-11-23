// DragTime — a time shown as plain text that you can tap or drag.
// Shared by the Staff table, Summary rows, pool windows and shift times.

import { html, useState, useRef } from './preact.js';
import { cx, Clock } from './pkit.js';

export const CELL = 'h-10 w-full rounded-lg text-center text-[1rem] tabular-nums transition';
// Table time text (Summary payouts, Staff tables): the number at 0.8125rem,
// a step under the row's text, placed so its top lines up with a t-body
// cell's digits beside it (Hrs) — Clock's span becomes a box as tall as a
// t-body line (1.3125rem) with the number on a shorter line (1.225rem) at
// its top — and "am" / "pm" hanging tight under it (Clock's a / p suffix
// lifted out of the flow), small, light, faded.
export const TIME_TEXT = 'text-[0.8125rem] tabular-nums [&>span]:relative [&>span]:block [&>span]:h-[1.3125rem] [&>span]:leading-[1.225rem] [&>span>span]:absolute [&>span>span]:left-1/2 [&>span>span]:top-[1.1rem] [&>span>span]:-translate-x-1/2 [&>span>span]:ml-0 [&>span>span]:text-[.62em] [&>span>span]:leading-none [&>span>span]:font-normal [&>span>span]:tracking-wide [&>span>span]:opacity-70 [&>span>span]:after:content-[\'m\']';
const PX_PER_STEP = 18;        // horizontal drag distance per 15 minutes

// Keypad cells: `kcell` marks it as a keypad cell (taps on it don't close the
// keypad), `active` rings it, `preview` shows the typed value instead. A
// keypad cell carries an invisible keyboard-less input (`data-kinput`,
// inputmode=none) so it takes part in focus order: Tab / Shift-Tab and the
// iPhone keyboard's ‹ › land on it, and focusing it calls onTap (opens the
// keypad on it).
// Draggable time pill. Tap → onTap. Drag sideways → 15-min steps (right =
// later, clamped to min…max), previewed as a filled gold pill and written on
// release via onSet(abs). No fill at rest — it highlights only while pressed
// (faint) or dragged (gold); set vs default shows as bright vs dim text
// (`tone` overrides that, e.g. Summary's quiet times). The tap opens on click (not pointerup), so the
// click can't land on the sheet it just opened. Set times are filled bright, inherited defaults dim.
// `data-drag` keeps page swipes off it; clicks don't bubble (so a pill inside
// a tappable row doesn't also open the row).
export function DragTime({ abs, min, max, onSet, onTap, set, bad, label, cls = CELL, tone, full = false, mins = false, kcell, active = false, preview = null }) {
  const [drag, setDrag] = useState(null);         // { x0, abs0, abs, moved }
  const dragged = useRef(false);                  // swallow the click after a drag
  const input = useRef(null);                     // keypad cells: the focusable input
  const down = e => {
    if (abs == null || bad) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, abs0: abs, abs, moved: false });
  };
  const move = e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 6) return;
    const next = Math.min(max, Math.max(min, drag.abs0 + Math.round(dx / PX_PER_STEP) * 0.25));
    if (next !== drag.abs || !drag.moved) {
      if (next !== drag.abs) try { navigator.vibrate?.(4); } catch { /* optional */ }
      setDrag({ ...drag, abs: next, moved: true });
    }
  };
  const up = () => {
    const d = drag;
    setDrag(null);
    if (!d || !d.moved) return;                   // a tap: handled by onClick
    dragged.current = true;
    if (d.abs !== d.abs0) onSet(d.abs);
  };
  const shown = drag?.moved ? drag.abs : preview ?? abs;
  const look = cx(cls, 'touch-pan-y select-none',
    drag?.moved ? 'scale-105 bg-accent font-semibold text-on-accent'
      : active ? cx('bg-accent/12 font-semibold ring-2 ring-inset ring-accent', preview != null ? 'text-accent' : 'text-ink')
      : cx(drag && 'bg-ink/10', bad ? 'font-semibold text-bad' : tone || (set ? 'font-semibold text-ink' : 'text-ink-2')));
  const body = bad && !active ? '?' : shown != null ? html`<${Clock} abs=${shown} full=${full} mins=${mins} />` : '—';
  const aria = label + ' — tap to edit, drag sideways to adjust';
  if (!kcell) {
    return html`<button data-drag class=${look}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${() => setDrag(null)}
      onClick=${e => { e.stopPropagation(); if (dragged.current) { dragged.current = false; return; } onTap?.(); }}
      aria-label=${aria}>${body}</button>`;
  }
  // Keypad cell: a tap focuses the hidden input; focus opens the keypad.
  return html`<div data-drag data-kcell=${kcell} data-active=${active ? '' : undefined} class=${cx(look, 'relative grid cursor-pointer place-items-center')}
    onPointerDown=${e => { if (e.pointerType === 'mouse') e.preventDefault(); down(e); }}
    onPointerMove=${move} onPointerUp=${up} onPointerCancel=${() => setDrag(null)}
    onClick=${e => {
      e.stopPropagation();
      if (dragged.current) { dragged.current = false; return; }
      if (document.activeElement === input.current) { if (!active) onTap?.(); } else input.current?.focus();
    }}>
    ${body}
    <input ref=${input} data-kinput readonly inputmode="none" tabindex="0" aria-label=${aria}
      class="pointer-events-none absolute inset-0 h-full w-full opacity-0" onFocus=${() => { if (!active) onTap?.(); }} />
  </div>`;
}

