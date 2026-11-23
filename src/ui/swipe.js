// SwipeRow — swipe a row left to reveal an action behind it (Staff:
// Remove), the iOS list gesture. The row follows the finger; let go past
// half the action's width and it stays open, otherwise it springs back. A
// tap anywhere else, or opening another row, closes it. Only clear
// horizontal swipes count (vertical scrolls and pinches pass), and a swipe
// here doesn't also turn the page (dragFlags, like a held drag box).

import { html, useState, useRef } from './preact.js';
import { cx, Icon } from './pkit.js';
import { dragFlags } from './dragtime.js';

const W = 88;                    // px of the revealed action
let closeOpen = null;            // the open row's close()

export function SwipeRow({ action = 'Remove', icon = 'trash', onAction, enabled = true, children, class: cls = '' }) {
  const [x, setX] = useState(0);
  const [live, setLive] = useState(false);
  const g = useRef(null);
  const close = () => { setX(0); if (closeOpen === close) closeOpen = null; };
  const start = e => {
    if (!enabled || e.touches.length !== 1) { g.current = null; return; }
    if (closeOpen && closeOpen !== close) closeOpen();
    const t = e.touches[0];
    g.current = { x0: t.clientX, y0: t.clientY, base: x, on: false };
  };
  const move = e => {
    const s = g.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x0, dy = t.clientY - s.y0;
    if (!s.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5 && (dx < 0 || s.base < 0)) {
        s.on = true;
        setLive(true);
        dragFlags.lastArmed = Date.now();
      } else if (Math.abs(dy) > 10) { g.current = null; return; } else return;
    }
    if (e.cancelable) e.preventDefault();
    dragFlags.lastArmed = Date.now();
    const v = Math.min(0, s.base + dx);
    setX(v < -W ? -W + (v + W) / 3 : v);          // rubber-band past the action
  };
  const end = () => {
    const s = g.current;
    g.current = null;
    if (!s?.on) return;
    setLive(false);
    dragFlags.lastArmed = Date.now();
    if (x < -W / 2) { setX(-W); closeOpen = close; } else close();
  };
  return html`<div class=${cx('relative overflow-hidden', cls)} onTouchStart=${start} onTouchMove=${move} onTouchEnd=${end} onTouchCancel=${end}>
    ${enabled && (x < 0 || live) && html`<button class="absolute inset-y-0 right-0 flex items-center justify-center gap-1.5 bg-bad px-4 font-semibold text-white"
      style=${{ width: W + 'px' }}
      onClick=${() => { close(); onAction?.(); }}><${Icon} name=${icon} class="size-4" /><span class="t-small">${action}</span></button>`}
    <div class=${cx('relative bg-inherit', !live && 'transition-transform duration-200')} style=${{ transform: x ? `translateX(${x}px)` : '' }}
      onClickCapture=${e => { if (x < 0) { e.stopPropagation(); e.preventDefault(); close(); } }}>${children}</div>
  </div>`;
}
