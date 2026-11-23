// DragTime — a time shown as plain text that you can tap or drag.
// Shared by the Staff table, Summary rows, pool windows and shift times.

import { html, useState, useRef } from './preact.js';
import { cx, Clock, Money } from './pkit.js';
import { fmtTimeAbs } from '../time.js';
import { showScrub, hideScrub } from './scrub.js';

export const CELL = 'h-10 w-full rounded-lg text-center text-[1rem] tabular-nums transition';
// Table time text (Summary payouts, Staff tables): the number at 0.8125rem,
// a step under the row's text, placed so its top lines up with a t-body
// cell's digits beside it (Hrs) — Clock's span becomes a box as tall as a
// t-body line (1.3125rem) with the number on a shorter line (1.225rem) at
// its top — and "am" / "pm" hanging tight under it (Clock's a / p suffix
// lifted out of the flow), small, light, faded.
// An arrow between a table's In and Out: drawn by the Out cell's ::before,
// centred in the column gap to its left (`gap` = that gap's width), so it
// adds no margin between the boxes.
export const ARROW_BEFORE = gap => `relative before:pointer-events-none before:absolute before:left-[calc(${gap}*-0.5)] before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:text-[0.75rem] before:font-normal before:text-ink-3/70 before:content-['→']`;
export const TIME_TEXT = 'text-[0.8125rem] tabular-nums [&>span]:relative [&>span]:block [&>span]:h-[1.3125rem] [&>span]:leading-[1.225rem] [&>span>span]:absolute [&>span>span]:left-1/2 [&>span>span]:top-[1.1rem] [&>span>span]:-translate-x-1/2 [&>span>span]:ml-0 [&>span>span]:text-[.62em] [&>span>span]:leading-none [&>span>span]:font-normal [&>span>span]:tracking-wide [&>span>span]:opacity-70 [&>span>span]:after:content-[\'m\']';
const PX_PER_STEP = 18;        // horizontal drag distance per 15 minutes
// Hold before a drag starts: a box only turns into a drag (accent fill, the
// scrub bubble, a tick of haptics) after the finger has rested on it for
// HOLD_MS. Moving more than SLOP px before then lets the gesture go — it was
// a scroll or a tab swipe, not a drag — so a stray brush never moves a value.
const HOLD_MS = 280;
const SLOP = 8;
// main.js's page swipe skips a touch that armed a drag (lastArmed ≥ its start).
export const dragFlags = { lastArmed: 0 };
// A press that slid off before the hold isn't a tap either: swallow the click
// it may still fire (a mouse lands it on the row under the box).
function swallowNextClick() {
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 400);
}
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { /* optional */ } };

// The gesture, shared by DragTime and DragAmount. value → value + n × step
// per `px` dragged sideways (right = more), clamped to min…max. While armed
// the scrub bubble (ui/scrub.js) floats above the finger with bubble(v, v0)
// → { text, sub }; onPreview(v | null, v0) as it moves, onSet(v, v0) on
// release (v0 = the value when the press began — the box's own value may
// change under a preview).
// Returns { drag, handlers, consumeClick }: drag = { v, armed } | null;
// consumeClick() is true once after a drag (the click that follows it is
// swallowed).
function useHoldDrag({ value, min, max, step, px, enabled, onSet, onPreview, bubble }) {
  const [drag, setDrag] = useState(null);
  const st = useRef(null);
  const timer = useRef(0);
  const swallow = useRef(false);
  const cfg = useRef(null);
  cfg.current = { value, min, max, step, px, onSet, onPreview, bubble };
  const put = d => { st.current = d; setDrag(d); };
  const scrub = (d, x, y) => {
    const b = cfg.current.bubble(d.v, d.v0);
    showScrub({ x, y, text: b.text, sub: b.sub, dx: x - d.x0, tick: cfg.current.px });
  };
  const finish = commit => {
    clearTimeout(timer.current);
    const d = st.current;
    put(null);
    if (!d?.armed) return;
    hideScrub();
    swallow.current = true;
    dragFlags.lastArmed = Date.now();
    if (commit && d.v !== d.v0) cfg.current.onSet(d.v, d.v0);
    if (d.previewed) cfg.current.onPreview?.(null);   // after the write, so the views don't flash the old numbers
  };
  const handlers = {
    onPointerDown: e => {
      if (!enabled || value == null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // min / max fixed at the press: a preview re-render may move them.
      const d = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, v0: value, v: value, min, max, armed: false, id: e.pointerId, el: e.currentTarget };
      put(d);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const c = st.current;
        if (!c || c !== d) return;
        const armed = { ...c, armed: true };
        try { c.el.setPointerCapture?.(c.id); } catch { /* gone */ }
        dragFlags.lastArmed = Date.now();
        buzz(10);
        put(armed);
        scrub(armed, c.x, c.y);
      }, HOLD_MS);
    },
    onPointerMove: e => {
      const d = st.current;
      if (!d) return;
      if (!d.armed) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > SLOP) { clearTimeout(timer.current); put(null); swallowNextClick(); }
        else st.current = { ...d, x: e.clientX, y: e.clientY };
        return;
      }
      const c = cfg.current;
      const next = Math.min(d.max, Math.max(d.min, d.v0 + Math.round((e.clientX - d.x0) / c.px) * c.step));
      let nd = d;
      if (next !== d.v) {
        buzz(4);
        c.onPreview?.(next === d.v0 ? null : next, d.v0);
        nd = { ...d, v: next, previewed: true };
        put(nd);
      }
      scrub(nd, e.clientX, e.clientY);
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    // Once armed, the finger owns the box: no page scroll, no long-press menu.
    onTouchMove: e => { if (st.current?.armed && e.cancelable) e.preventDefault(); },
    onContextMenu: e => { if (st.current) e.preventDefault(); },
  };
  const consumeClick = () => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  };
  return { drag, handlers, consumeClick };
}

const NO_CALLOUT = 'touch-pan-y select-none [-webkit-touch-callout:none]';
const LOOK_ARMED = 'scale-105 bg-accent font-semibold text-on-accent shadow-[0_0.25rem_0.75rem_-0.25rem_rgb(0_0_0/.35)]';

// "+45m" / "−1h 15m" — how far a dragged time has moved.
function moved(v, v0) {
  const m = Math.round((v - v0) * 60);
  if (!m) return 'no change';
  const a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
  return (m > 0 ? '+' : '−') + (h ? h + 'h' : '') + (h && mm ? ' ' : '') + (mm ? mm + 'm' : '');
}

// Keypad cells: `kcell` marks it as a keypad cell (taps on it don't close the
// keypad), `active` rings it, `preview` shows the typed value instead. A
// keypad cell carries an invisible keyboard-less input (`data-kinput`,
// inputmode=none) so it takes part in focus order: Tab / Shift-Tab and the
// iPhone keyboard's ‹ › land on it, and focusing it calls onTap (opens the
// keypad on it).
// `onPreview(abs | null)`: called as a drag moves (and with null when it
// ends), so the owner can show what the change would do before it's written.
// Draggable time. Tap → onTap. Hold (HOLD_MS), then drag sideways → 15-min
// steps (right = later, clamped to min…max): the box fills accent, the
// scrub bubble shows the time above the finger, and it's written on release
// via onSet(abs). No fill at rest — a faint fill while pressed; set vs
// default shows as bright vs dim text (`tone` overrides that, e.g. Summary's
// quiet times; a function gets `set` and returns the classes). The tap opens on click (not pointerup), so the click can't
// land on the sheet it just opened. `data-drag` marks it for the sheet
// swipe; clicks don't bubble (so a box inside a tappable row doesn't also
// open the row).
export function DragTime({ abs, min, max, onSet, onTap, set, bad, label, cls = CELL, tone, full = false, mins = false, kcell, active = false, preview = null, onPreview }) {
  const input = useRef(null);                     // keypad cells: the focusable input
  const { drag, handlers, consumeClick } = useHoldDrag({
    value: abs, min, max, step: 0.25, px: PX_PER_STEP, enabled: abs != null && !bad, onSet, onPreview,
    bubble: (v, v0) => ({ text: fmtTimeAbs(v), sub: moved(v, v0) }),
  });
  const shown = drag?.armed ? drag.v : preview ?? abs;
  const look = cx(cls, NO_CALLOUT,
    drag?.armed ? LOOK_ARMED
      : active ? cx('bg-accent/12 font-semibold ring-2 ring-inset ring-accent', preview != null ? 'text-accent' : 'text-ink')
      : cx(drag && 'bg-ink/10', bad ? 'font-semibold text-bad' : (typeof tone === 'function' ? tone(set) : tone) || (set ? 'font-semibold text-ink' : 'text-ink-2')));
  const body = bad && !active ? '?' : shown != null ? html`<${Clock} abs=${shown} full=${full} mins=${mins} />` : '—';
  const aria = label + ' — tap to edit, hold and drag sideways to adjust';
  if (!kcell) {
    return html`<button data-drag class=${look} ...${handlers}
      onClick=${e => { e.stopPropagation(); if (consumeClick()) return; onTap?.(); }}
      aria-label=${aria}>${body}</button>`;
  }
  // Keypad cell: a tap focuses the hidden input; focus opens the keypad.
  return html`<div data-drag data-kcell=${kcell} data-active=${active ? '' : undefined} class=${cx(look, 'relative grid cursor-pointer place-items-center')}
    ...${handlers}
    onPointerDown=${e => { if (e.pointerType === 'mouse') e.preventDefault(); handlers.onPointerDown(e); }}
    onClick=${e => {
      e.stopPropagation();
      if (consumeClick()) return;
      if (document.activeElement === input.current) { if (!active) onTap?.(); } else input.current?.focus();
    }}>
    ${body}
    <input ref=${input} data-kinput readonly inputmode="none" tabindex="0" aria-label=${aria}
      class="pointer-events-none absolute inset-0 h-full w-full opacity-0" onFocus=${() => { if (!active) onTap?.(); }} />
  </div>`;
}

// A dollar amount you can tap or hold-and-drag, like DragTime: $1 per
// `px` (6px) sideways, the bubble shows the new amount and the change.
// Summary's Total row uses it for the tips total (one pool). `shownCls`
// styles the Money inside.
export function DragAmount({ value, min = 0, max = 1e7, step = 1, px = 6, onSet, onPreview, onTap, cls = '', moneyCls = '', label = 'Amount' }) {
  const { drag, handlers, consumeClick } = useHoldDrag({
    value, min, max, step, px, enabled: value != null, onSet, onPreview,
    bubble: (v, v0) => {
      const d = v - v0;
      return { text: '$' + v.toLocaleString('en-US'), sub: d ? (d > 0 ? '+$' : '−$') + Math.abs(d).toLocaleString('en-US') : 'no change' };
    },
  });
  const v = drag?.armed ? drag.v : value;
  return html`<button data-drag class=${cx('rounded-lg px-1.5 py-1 transition', NO_CALLOUT, drag?.armed ? LOOK_ARMED : drag ? 'bg-ink/10' : '', cls)}
    ...${handlers} onClick=${e => { e.stopPropagation(); if (consumeClick()) return; onTap?.(); }}
    aria-label=${label + ' — tap to edit, hold and drag sideways to adjust'}><${Money} value=${v} class=${cx(moneyCls, drag?.armed && '!text-on-accent')} /></button>`;
}
