// useSwipeNav — swipe a block sideways to step to the next / previous of
// something (Summary's views, Tips' pools). The block follows the finger
// (rubber-banding at the ends); let go past a fifth of its width, or flick,
// and it slides out, the next one slides in from the other side; otherwise
// it springs back. Only clear horizontal swipes count — vertical scrolls,
// sideways scrollers (.overflow-x-auto), a Staff row's swipe, inputs, the
// screen edges (the side panels' drag) and a held box (dragFlags) pass.
//
//   const nav = useSwipeNav({ prev, next })   // prev / next: () => void, or null at an end
//   html`<div ref=${nav.ref} ...${nav.handlers}>…</div>`

import { useRef } from './preact.js';
import { dragFlags } from './dragtime.js';

const EDGE = 24;

export function useSwipeNav({ prev, next }) {
  const ref = useRef(null);
  const g = useRef(null);
  const cb = useRef(null);
  cb.current = { prev, next };
  const set = (x, anim = '') => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = anim;
    el.style.transform = x ? `translateX(${x}px)` : '';
    el.style.opacity = x ? String(Math.max(0.35, 1 - Math.abs(x) / (el.offsetWidth * 1.4))) : '';
  };
  const handlers = {
    onTouchStart: e => {
      g.current = null;
      if (e.touches.length !== 1) return;
      const t = e.target, p = e.touches[0];
      if (t.closest('.overflow-x-auto, [data-swipe-row], input, textarea, .wheel')) return;
      if (p.clientX < EDGE || p.clientX > window.innerWidth - EDGE) return;
      g.current = { x0: p.clientX, y0: p.clientY, t0: Date.now(), on: false, dx: 0 };
    },
    onTouchMove: e => {
      const s = g.current;
      if (!s) return;
      if (dragFlags.lastArmed >= s.t0 && !s.on) { g.current = null; return; }
      const p = e.touches[0];
      const dx = p.clientX - s.x0, dy = p.clientY - s.y0;
      if (!s.on) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) s.on = true;
        else if (Math.abs(dy) > 10) { g.current = null; return; } else return;
      }
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      s.dx = dx;
      const can = dx < 0 ? cb.current.next : cb.current.prev;
      set(can ? dx : dx / 4);
    },
    onTouchEnd: () => {
      const s = g.current;
      g.current = null;
      if (!s?.on) return;
      dragFlags.lastArmed = Date.now();          // not a tap, not a page swipe
      const el = ref.current;
      const w = el?.offsetWidth || 360;
      const fast = Date.now() - s.t0 < 260 && Math.abs(s.dx) > 40;
      const go = s.dx < 0 ? cb.current.next : cb.current.prev;
      if (go && (Math.abs(s.dx) > w / 5 || fast)) {
        const dir = s.dx < 0 ? -1 : 1;
        set(dir * w, 'transform .16s ease-in, opacity .16s');
        setTimeout(() => {
          go();
          set(-dir * w * 0.35);                  // the next one enters from the other side
          requestAnimationFrame(() => requestAnimationFrame(() => set(0, 'transform .22s cubic-bezier(.2,.8,.3,1), opacity .22s')));
        }, 160);
      } else set(0, 'transform .22s cubic-bezier(.2,.8,.3,1), opacity .22s');
    },
  };
  handlers.onTouchCancel = handlers.onTouchEnd;
  return { ref, handlers };
}
