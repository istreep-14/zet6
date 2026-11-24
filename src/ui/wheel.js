// The wheel picker: hold a time or the tips total and a narrow wheel opens
// right on it — the box becomes the wheel's band (the value, accent), two
// values above and below fading out, on no background at all (the numbers
// carry a halo of the page colour so they read over anything). A small ✕
// and ✓ sit beside the band. The page stays live: the rows' amounts, the
// times that move with it and the HUD show the effect as it turns; the
// wheel follows its box if the page scrolls.
//
// Keep the thumb down and slide up / down to turn it (the same touch keeps
// going — pointer capture in dragtime.js), or lift and flick it: it's a
// native scroller with scroll-snap, so speed carries it further. A lift
// after sliding carries the thumb's speed too (release()). ✓, a tap outside
// or Enter keeps it (written through App.reviewed → Undo · Apply in the
// HUD); ✕ / Esc puts it back. One wheel at a time.

import { html, render, useState, useRef, useLayoutEffect, useEffect } from './preact.js';
import { cx, Icon } from './pkit.js';

let host = null;
let api = null;               // the open wheel: { nudge, release }
const ROWS = 5;               // visible rows (the band in the middle)
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { /* optional */ } };
const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export const isWheelOpen = () => !!api;
// While the opening touch is still down: move the wheel with the thumb (px,
// finger down = earlier values), then let go with its speed (px / ms).
export const wheelNudge = dy => api?.nudge(dy);
export const wheelRelease = vy => api?.release(vy);

// opts: { values, index (start), title, text(v), onChange(v), onDone(v),
//         onCancel(), anchor (the box being edited — the band sits on it) }
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

function Wheel({ values, index, title, text, onChange, onDone, onCancel, anchor }) {
  const [idx, setIdx] = useState(index);
  const list = useRef(null);
  const box = useRef(null);
  const cur = useRef(index);
  const opened = useRef(Date.now());
  const skipUntil = useRef(0);        // the click that the opening touch's lift makes
  const H = Math.max(2 * rem(), anchor?.offsetHeight || 0);
  const W = Math.max(5.75 * rem(), (anchor?.offsetWidth || 0) + 0.5 * rem());

  const settleTo = i => list.current?.scrollTo({ top: i * H, behavior: 'smooth' });
  const pick = i => {
    i = Math.max(0, Math.min(values.length - 1, i));
    if (i === cur.current) return;
    cur.current = i;
    setIdx(i);
    buzz(3);
    onChange?.(values[i]);
  };
  const finish = keep => {
    const v = values[cur.current];
    closeWheel();
    if (keep) onDone?.(v); else onCancel?.();
  };
  // The band sits on the box: centred on it, kept on screen.
  const placeOn = () => {
    const w = box.current, r = anchor?.getBoundingClientRect?.();
    if (!w || !r) return;
    w.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + r.width / 2 - W / 2)) + 'px';
    w.style.top = (r.top + r.height / 2 - (ROWS * H) / 2) + 'px';
  };

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = index * H;
    placeOn();
    document.documentElement.classList.add('wheel-open');
    return () => document.documentElement.classList.remove('wheel-open');
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
        skipUntil.current = Date.now() + 400;
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
    // No scrim: the page stays live. A tap (a click — a scroll never makes
    // one) outside the wheel keeps the value, and is swallowed so it doesn't
    // also open what's under it. Not the lift of the touch that opened it.
    const outside = e => {
      if (box.current?.contains(e.target) || Date.now() - opened.current < 400 || Date.now() < skipUntil.current) return;
      e.stopPropagation();
      e.preventDefault();
      finish(true);
    };
    // The wheel stays on its box when the page underneath scrolls.
    const follow = e => { if (!box.current?.contains(e.target)) placeOn(); };
    document.addEventListener('keydown', key);
    document.addEventListener('click', outside, true);
    document.addEventListener('scroll', follow, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', outside, true);
      document.removeEventListener('scroll', follow, true);
    };
  }, []);

  const onScroll = () => { const l = list.current; if (l) pick(Math.round(l.scrollTop / H)); };
  // A mouse wheel / trackpad turns it a row per notch (desktop).
  const wheel = e => {
    e.preventDefault();
    const steps = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 60));
    settleTo(cur.current + steps);
  };
  const btn = 'wheel-btn absolute grid size-8 place-items-center rounded-full transition active:scale-90';
  const btnTop = 2 * H + (H - 2 * rem()) / 2 + 'px';
  return html`<div ref=${box} class="wheel" role="dialog" aria-label=${title} style=${{ width: W + 'px', height: ROWS * H + 'px' }}>
    <div class="wheel-band" style=${{ top: 2 * H + 'px', height: H + 'px' }}></div>
    <div ref=${list} class="wheel-list" onScroll=${onScroll} onWheel=${wheel} style=${{ height: ROWS * H + 'px' }}>
      <div style=${{ height: 2 * H + 'px' }}></div>
      ${values.map((val, i) => {
        const d = Math.abs(i - idx);
        return html`<button key=${i} tabindex="-1" class=${cx('wheel-item', d === 0 ? 'is-on' : d === 1 ? 'is-near' : 'is-far')}
          style=${{ height: H + 'px' }} onClick=${() => (i === idx ? finish(true) : settleTo(i))}>${text(val)}</button>`;
      })}
      <div style=${{ height: 2 * H + 'px' }}></div>
    </div>
    <button class=${cx(btn, 'right-full mr-1.5 text-ink-2')} style=${{ top: btnTop }} onClick=${() => finish(false)} aria-label="Cancel"><${Icon} name="x" class="size-4" /></button>
    <button class=${cx(btn, 'left-full ml-1.5 text-accent')} style=${{ top: btnTop }} onClick=${() => finish(true)} aria-label="Done"><${Icon} name="check" class="size-4" /></button>
  </div>`;
}
