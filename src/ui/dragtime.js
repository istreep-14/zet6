// DragTime — a time shown as plain text that you can tap, or hold to pick
// from a wheel (ui/wheel.js).
// Shared by the Staff table, Summary rows, pool windows and shift times.

import { html, useState, useRef } from './preact.js';
import { cx, Clock, Money } from './pkit.js';
import { fmtTimeAbs } from '../time.js';
import { openWheel, isWheelOpen, wheelNudge, wheelRelease } from './wheel.js';

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
export const ARROW_BEFORE = gap => `relative before:pointer-events-none before:absolute before:left-[calc(${gap}*-0.5)] before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:text-[0.6875rem] before:font-normal before:text-ink-3/70 before:content-['→']`;
export const TIME_TEXT = 'text-[0.8125rem] tabular-nums [&>span]:relative [&>span]:block [&>span]:h-[1.3125rem] [&>span]:leading-[1.225rem] [&>span>span]:absolute [&>span>span]:left-1/2 [&>span>span]:top-[1.1rem] [&>span>span]:-translate-x-1/2 [&>span>span]:ml-0 [&>span>span]:text-[.62em] [&>span>span]:leading-none [&>span>span]:font-normal [&>span>span]:tracking-wide [&>span>span]:opacity-90 [&>span>span]:after:content-[\'m\']';
// Hold to open the wheel: a box only opens the wheel picker (ui/wheel.js;
// the box fills accent, a tick of haptics) after the finger has rested on it
// for HOLD_MS. Moving more than SLOP px before then lets the gesture go — it
// was a scroll or a tab swipe — so a stray brush never changes a value. A
// plain tap still does the box's tap (keypad, time sheet, Tips).
const HOLD_MS = 280;
const SLOP = 8;
// main.js's page swipe (and SwipeRow) skip a touch that opened a wheel.
export const dragFlags = { lastArmed: 0 };
// A press that slid off before the hold isn't a tap either: swallow the click
// it may still fire (a mouse lands it on the row under the box).
function swallowNextClick() {
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 400);
}
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { /* optional */ } };
// While a finger rests on a box (and while its wheel is open) nothing on the
// page can be selected — iOS's long-press would otherwise select the text and
// paint it blue (html.holding in app.css).
const hold = on => {
  document.documentElement.classList.toggle('holding', on);
  if (on) { try { window.getSelection()?.removeAllRanges(); } catch { /* none */ } }
};

// The gesture, shared by DragTime and DragAmount. Hold → openWheel() with
// wheel(v0) → { values, index, title, text, sub, change }. The same touch
// keeps going: sliding the thumb up / down turns the wheel (wheelNudge) and
// lifting it lets the wheel run on with the thumb's speed (wheelRelease);
// after that the wheel is flicked directly. Each value it settles on calls
// onPreview(v | null, v0) — which returns the preview view model the wheel
// shows under it — and Done / a tap outside calls onSet(v, v0) then
// onPreview(null); Cancel just onPreview(null). (v0 = the value when the
// press began — the box's own value may change under a preview.)
// Returns { held, handlers, consumeClick }: held = 'press' | 'open' | null;
// consumeClick() is true once after a hold (its click is swallowed).
function useHoldWheel({ value, enabled, onSet, onPreview, wheel }) {
  const [held, setHeld] = useState(null);
  const st = useRef(null);
  const timer = useRef(0);
  const swallow = useRef(false);
  const cfg = useRef(null);
  cfg.current = { onSet, onPreview, wheel };
  // Open the wheel on a box (after a hold, or straight from a tap).
  const openOn = (el, v0) => {
    setHeld('open');
    hold(true);
    const k = cfg.current;
    openWheel({
      ...k.wheel(v0), anchor: el,
      onChange: v => k.onPreview?.(v === v0 ? null : v, v0) || null,
      onDone: v => { setHeld(null); hold(false); if (v !== v0) cfg.current.onSet(v, v0); cfg.current.onPreview?.(null); },
      onCancel: () => { setHeld(null); hold(false); cfg.current.onPreview?.(null); },
    });
  };
  const handlers = {
    onPointerDown: e => {
      if (!enabled || value == null || isWheelOpen()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType !== 'mouse') e.currentTarget.blur?.();
      const d = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, v0: value, armed: false, id: e.pointerId, el: e.currentTarget, t: Date.now(), vy: 0, moved: false };
      st.current = d;
      setHeld('press');
      hold(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const c = st.current;
        if (!c || c !== d) return;
        c.armed = true;
        hold(true);
        try { c.el.setPointerCapture?.(c.id); } catch { /* gone */ }
        dragFlags.lastArmed = Date.now();
        buzz(10);
        openOn(c.el, c.v0);
      }, HOLD_MS);
    },
    onPointerMove: e => {
      const d = st.current;
      if (!d) return;
      if (!d.armed) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > SLOP) { clearTimeout(timer.current); st.current = null; setHeld(null); hold(false); swallowNextClick(); }
        else { d.x = e.clientX; d.y = e.clientY; }
        return;
      }
      // The thumb turns the wheel: finger up → later / more.
      const now = Date.now(), dy = e.clientY - d.y;
      d.vy = 0.7 * (dy / Math.max(1, now - d.t)) + 0.3 * d.vy;
      d.y = e.clientY;
      d.t = now;
      d.moved = true;
      dragFlags.lastArmed = now;
      wheelNudge(dy);
    },
    onPointerUp: () => {
      clearTimeout(timer.current);
      const d = st.current;
      st.current = null;
      if (!d) return;
      if (!d.armed) { setHeld(null); hold(false); return; }
      swallow.current = true;
      dragFlags.lastArmed = Date.now();
      wheelRelease(d.moved && Date.now() - d.t < 100 ? d.vy : 0);   // the wheel stays open to flick / Done
    },
    onPointerCancel: () => { clearTimeout(timer.current); const d = st.current; st.current = null; if (!d?.armed) { setHeld(null); hold(false); } },
    // Once the wheel is open the thumb owns it: no page scroll, no long-press menu.
    onTouchMove: e => { if (st.current?.armed && e.cancelable) e.preventDefault(); },
    onContextMenu: e => { if (st.current) e.preventDefault(); },
  };
  const consumeClick = () => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  };
  // A tap that opens the wheel at once (no hold): the wheel's own outside-
  // click guard skips the opening click.
  const openNow = el => { if (enabled && value != null && !isWheelOpen()) openOn(el, value); };
  return { held, handlers, consumeClick, openNow };
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
// `onPreview(abs | null)`: called as the wheel turns (and with null when it
// closes) — returns the preview view model the wheel shows under it.
// A time box. Tap → onTap. Hold (HOLD_MS) → the wheel: 15-min steps from
// min to max, each row with `wheelSub(abs)` beside it (e.g. the hours it
// makes); the box fills accent while it's open; Done writes it via
// onSet(abs). No fill at rest — a faint fill while pressed; set vs
// default shows as bright vs dim text (`tone` overrides that, e.g. Summary's
// quiet times; a function gets `set` and returns the classes). The tap opens on click (not pointerup), so the click can't
// land on the sheet it just opened. `data-drag` marks it for the sheet
// swipe; clicks don't bubble (so a box inside a tappable row doesn't also
// open the row).
export function DragTime({ abs, min, max, onSet, onTap, tapWheel = false, set, bad, label, cls = CELL, tone, full = false, mins = false, bare = false, alt = null, kcell, active = false, preview = null, onPreview, wheelSub, moved: movedKind = null }) {
  const input = useRef(null);                     // keypad cells: the focusable input
  const { held, handlers, consumeClick, openNow } = useHoldWheel({
    value: abs, enabled: abs != null && !bad, onSet, onPreview,
    wheel: v0 => {
      const values = [];
      for (let a = min; a <= max + 1e-9; a += 0.25) values.push(Math.round(a * 4) / 4);
      const index = values.reduce((b, v, i) => (Math.abs(v - v0) < Math.abs(values[b] - v0) ? i : b), 0);
      return { values, index, title: label, text: v => fmtTimeAbs(v).replace(/([ap])$/, ' $1m'), sub: wheelSub, change: moved };
    },
  });
  const shown = preview ?? abs;
  const look = cx(cls, NO_CALLOUT, movedKind && 'live-changed',
    held === 'open' ? LOOK_ARMED
      : active ? cx('bg-accent/12 font-semibold ring-2 ring-inset ring-accent', preview != null ? 'text-accent' : 'text-ink')
      : cx(held && 'bg-ink/10', bad ? 'font-semibold text-bad' : (typeof tone === 'function' ? tone(set) : tone) || (set ? 'font-semibold text-ink' : 'text-ink-2')));
  // `alt`: what to show at rest instead of the time (e.g. "close" for an Out
  // that is the shift's close) — the real time comes back while it's being
  // edited, previewed or held.
  const body = bad && !active ? '?'
    : alt != null && !active && preview == null && !held ? alt
    : shown != null ? html`<${Clock} abs=${shown} full=${full} mins=${mins} bare=${bare} />` : '—';
  const aria = label + (tapWheel ? ' — tap to pick from a wheel' : ' — tap to edit, hold to pick from a wheel');
  if (!kcell) {
    return html`<button data-drag class=${look} ...${handlers}
      onClick=${e => { e.stopPropagation(); if (consumeClick()) return; if (tapWheel) openNow(e.currentTarget); else onTap?.(); }}
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

// A dollar amount you can tap or hold, like DragTime: the hold opens the
// wheel in $1 steps ($300 either way, never under `min`), each row with its
// change. Summary's Total row uses it for the tips total (one pool).
const signedMoney = d => (d > 0 ? '+$' : '−$') + Math.abs(d).toLocaleString('en-US');
export function DragAmount({ value, min = 0, max = 1e7, onSet, onPreview, onTap, cls = '', moneyCls = '', label = 'Amount', plain = false }) {
  const { held, handlers, consumeClick } = useHoldWheel({
    value, enabled: value != null, onSet, onPreview,
    wheel: v0 => {
      const lo = Math.max(min, v0 - 300), hi = Math.min(max, v0 + 300);
      const values = [];
      for (let v = lo; v <= hi; v++) values.push(v);
      return { values, index: v0 - lo, title: label, text: v => '$' + v.toLocaleString('en-US'),
        sub: v => (v === v0 ? '' : signedMoney(v - v0)), change: v => signedMoney(v - v0) };
    },
  });
  return html`<button data-drag class=${cx('rounded-lg px-1.5 py-1 transition', NO_CALLOUT, held === 'open' ? LOOK_ARMED : held ? 'bg-ink/10' : '', cls)}
    ...${handlers} onClick=${e => { e.stopPropagation(); if (consumeClick()) return; onTap?.(); }}
    aria-label=${label + ' — tap to edit, hold to pick from a wheel'}>${plain
      ? html`<span class=${cx(moneyCls, held === 'open' && '!text-on-accent')}>${'$' + Number(value || 0).toLocaleString('en-US')}</span>`
      : html`<${Money} value=${value} class=${cx(moneyCls, held === 'open' && '!text-on-accent')} />`}</button>`;
}
