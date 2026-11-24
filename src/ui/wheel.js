// The wheel picker: hold a time or the tips total and a popup opens beside
// your thumb with the values as an iOS-style wheel — the value in the band,
// its neighbours above and below (with a line of context each, e.g. the
// hours it makes). Keep the thumb down and slide up / down to turn it (the
// same touch keeps going — dragFlags / pointer capture in dragtime.js), or
// lift and flick it: it's a native scroller with scroll-snap, so speed
// carries it further, like the iPhone wheel. A lift after sliding carries the
// thumb's speed too (release()). Every value it settles on is previewed —
// the change at the top, its effect (that person's pay, the rate, how many
// payouts move) under the wheel. Done or a tap outside keeps it (with Undo ·
// Apply in the HUD); Cancel / Esc puts it back. One wheel at a time.

import { html, render, useState, useRef, useLayoutEffect, useEffect } from './preact.js';
import { cx, Figure } from './pkit.js';
import { previewFigures } from './changes.js';

let host = null;
let api = null;               // the open wheel: { nudge, release }
const ROWS = 5;               // visible rows (the band in the middle)
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { /* optional */ } };
const rowPx = () => 2.75 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);

export const isWheelOpen = () => !!api;
// While the opening touch is still down: move the wheel with the thumb (px,
// finger down = earlier values), then let go with its speed (px / ms).
export const wheelNudge = dy => api?.nudge(dy);
export const wheelRelease = vy => api?.release(vy);

// opts: { values, index (start), title, text(v), sub(v)?, change(v, v0),
//         onChange(v) → a preview view model (or null), onDone(v), onCancel(),
//         x, y (the thumb, client px) }
export function openWheel(opts) {
  if (!host) {
    host = document.createElement('div');
    host.id = 'wheelHost';
    document.body.append(host);
  }
  closeWheel();
  render(html`<${Wheel} key=${Date.now()} ...${opts} />`, host);
}

export function closeWheel() {
  api = null;
  if (host) render(null, host);
}

function Wheel({ values, index, title, text, sub, change, onChange, onDone, onCancel, x, y }) {
  const [idx, setIdx] = useState(index);
  const [pv, setPv] = useState(null);
  const list = useRef(null);
  const card = useRef(null);
  const cur = useRef(index);
  const opened = useRef(Date.now());
  const H = rowPx();
  const v0 = values[index];

  const settleTo = i => list.current?.scrollTo({ top: i * H, behavior: 'smooth' });
  const pick = i => {
    i = Math.max(0, Math.min(values.length - 1, i));
    if (i === cur.current) return;
    cur.current = i;
    setIdx(i);
    buzz(3);
    setPv(onChange?.(values[i]) || null);
  };
  const finish = keep => {
    const v = values[cur.current];
    closeWheel();
    if (keep) onDone?.(v); else onCancel?.();
  };

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = index * H;
    // Beside the thumb, clear of the row being edited: under it when the
    // thumb is in the top half of the screen, over it otherwise (kept inside
    // the screen).
    const c = card.current;
    if (c) {
      const h = c.offsetHeight, w = c.offsetWidth;
      const want = y < window.innerHeight / 2 ? y + 36 : y - 36 - h;
      c.style.top = Math.max(12, Math.min(window.innerHeight - h - 12, want)) + 'px';
      c.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, x - w / 2)) + 'px';
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const el = () => list.current;
    api = {
      nudge: dy => {
        const l = el();
        if (!l) return;
        cancelAnimationFrame(raf);
        l.style.scrollSnapType = 'none';
        l.scrollTop -= dy;
      },
      // Carry the thumb's speed, slowing, then snap to the nearest value.
      release: vy => {
        const l = el();
        if (!l) return;
        let v = -vy * 16;                          // px per frame
        const step = () => {
          if (Math.abs(v) < 0.6) {
            l.style.scrollSnapType = '';
            settleTo(Math.round(l.scrollTop / H));
            return;
          }
          l.scrollTop += v;
          v *= 0.94;
          raf = requestAnimationFrame(step);
        };
        step();
      },
    };
    const key = e => {
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter') finish(true);
      else if (e.key === 'ArrowUp') { e.preventDefault(); settleTo(cur.current - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); settleTo(cur.current + 1); }
    };
    document.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', key); };
  }, []);

  const onScroll = () => { const l = list.current; if (l) pick(Math.round(l.scrollTop / H)); };
  const v = values[idx];
  const figs = previewFigures(pv);
  // Rows far from the band fade and shrink a little, like the iOS wheel.
  const look = i => {
    const d = Math.abs(i - idx);
    return d === 0 ? 'text-ink font-semibold' : d === 1 ? 'text-ink-2 opacity-80 scale-[.94]' : 'text-ink-3 opacity-50 scale-[.88]';
  };
  // A tap outside keeps the value — but not the lift of the touch that
  // opened the wheel.
  const outside = e => { if (e.target === e.currentTarget && Date.now() - opened.current > 400) finish(true); };
  return html`<div class="wheel-scrim" onClick=${outside}>
    <div ref=${card} class="wheel" role="dialog" aria-label=${title}>
      <div class="flex items-center gap-2 px-4 pb-2 pt-3">
        <span class="flex min-w-0 flex-1 flex-col leading-tight">
          <span class="t-small truncate font-semibold text-ink-2">${title}</span>
          <span class=${cx('t-small truncate', v === v0 ? 'text-ink-3' : 'font-semibold text-accent')}>${v === v0 ? 'Swipe or flick to change' : change(v, v0)}</span>
        </span>
        <button class="t-small h-9 shrink-0 rounded-full bg-surface-2 px-3 font-semibold text-ink-2 active:scale-95" onClick=${() => finish(false)}>Cancel</button>
        <button class="t-small h-9 shrink-0 rounded-full bg-accent px-3.5 font-semibold text-on-accent active:scale-95" onClick=${() => finish(true)}>Done</button>
      </div>
      <div class="relative" style=${{ height: ROWS * H + 'px' }}>
        <div class="wheel-band" style=${{ top: 2 * H + 'px', height: H + 'px' }}></div>
        <div ref=${list} class="wheel-list" onScroll=${onScroll} style=${{ height: ROWS * H + 'px' }}>
          <div style=${{ height: 2 * H + 'px' }}></div>
          ${values.map((val, i) => html`<button key=${i} tabindex="-1" class=${cx('wheel-item', Math.abs(i - idx) <= 3 && look(i))}
            style=${{ height: H + 'px' }} onClick=${() => (i === idx ? finish(true) : settleTo(i))}>
            <span class="text-[1.375rem] tabular-nums tracking-tight">${text(val)}</span>
            ${sub && html`<span class="t-small w-16 text-right tabular-nums text-ink-3">${sub(val)}</span>`}
          </button>`)}
          <div style=${{ height: 2 * H + 'px' }}></div>
        </div>
      </div>
      ${figs && html`<div class="figures mx-3 mb-3 mt-1 !bg-surface-2 !py-2">${figs.map(f => html`<${Figure} key=${f.k} v=${f.v} k=${f.k} tone=${f.tone} d=${f.d} />`)}</div>`}
    </div>
  </div>`;
}
