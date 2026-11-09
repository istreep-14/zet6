// Side panels — left = sessions + app settings (render/drawer.js), right =
// this shift's settings (render/shiftpanel.js). One scrim, one open at a time.
//
// Open: a button, a drag in from that screen edge (follows the finger), or a
// flick past the first / last sub-tab (main.js). Close: drag the panel back
// toward its edge, tap the scrim, Esc.

const $ = id => document.getElementById(id);
const root = document.documentElement;

const SIDES = {
  left: { id: 'drawer', cls: 'left-open', sign: -1 },
  right: { id: 'shiftPanel', cls: 'right-open', sign: 1 },
};
const hooks = { left: {}, right: {} };

export const EDGE = 24;

export const isPanelOpen = side => root.classList.contains(SIDES[side].cls);
export const openSide = () => (isPanelOpen('left') ? 'left' : isPanelOpen('right') ? 'right' : null);

export function onPanel(side, { open, close } = {}) {
  hooks[side] = { open, close };
}

export function openPanel(side) {
  const other = side === 'left' ? 'right' : 'left';
  if (isPanelOpen(other)) closePanel(other);
  document.activeElement?.blur?.();
  const first = !isPanelOpen(side);
  root.classList.add('panel-open', SIDES[side].cls);
  $(SIDES[side].id)?.setAttribute('aria-hidden', 'false');
  if (first) hooks[side].open?.();
}

export function closePanel(side) {
  if (!isPanelOpen(side)) return;
  root.classList.remove(SIDES[side].cls);
  if (!openSide()) root.classList.remove('panel-open');
  $(SIDES[side].id)?.setAttribute('aria-hidden', 'true');
  hooks[side].close?.();
}

export function closePanels() {
  closePanel('left');
  closePanel('right');
}

export function togglePanel(side) {
  if (isPanelOpen(side)) closePanel(side); else openPanel(side);
}

// ── Gestures ─────────────────────────────────────────────────────────────────

export function initPanelGestures({ canOpen }) {
  const scrim = $('panelScrim');
  let g = null;              // { side, mode: 'open'|'close', x0, y0, t0, w, dragging, p }

  const bodyBox = () => document.body.getBoundingClientRect();
  const el = side => $(SIDES[side].id);

  const set = prog => {
    g.p = Math.max(0, Math.min(1, prog));
    const { sign } = SIDES[g.side];
    el(g.side).style.transform = `translateX(${sign * (1 - g.p) * 100}%)`;
    scrim.style.opacity = String(g.p);
  };
  const reset = () => {
    root.classList.remove('panel-dragging', 'drag-left', 'drag-right');
    Object.keys(SIDES).forEach(s => { el(s).style.transform = ''; });
    scrim.style.opacity = '';
  };

  document.addEventListener('touchstart', e => {
    g = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const open = openSide();
    if (open) {
      if (el(open).contains(e.target) || e.target === scrim) g = { side: open, mode: 'close' };
    } else if (canOpen()) {
      const box = bodyBox();
      if (t.clientX - box.left < EDGE) g = { side: 'left', mode: 'open' };
      else if (box.right - t.clientX < EDGE) g = { side: 'right', mode: 'open' };
    }
    if (!g) return;
    Object.assign(g, { x0: t.clientX, y0: t.clientY, t0: Date.now(), w: el(g.side).offsetWidth || 300, dragging: false, p: 0 });
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    // Direction that moves the panel inward (open) / back out (close).
    const inward = g.side === 'left' ? dx : -dx;
    if (!g.dragging) {
      const wanted = g.mode === 'open' ? inward > 8 : inward < -8;
      if (wanted && Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.dragging = true;
        root.classList.add('panel-dragging', 'drag-' + g.side);
        if (g.mode === 'open') { document.activeElement?.blur?.(); hooks[g.side].open?.(); }
      } else if (Math.abs(dy) > 10 || (g.mode === 'open' && inward < -8)) {
        g = null;
        return;
      } else return;
    }
    e.preventDefault();
    set(g.mode === 'open' ? inward / g.w : 1 + inward / g.w);
  }, { passive: false });

  const end = e => {
    if (!g) return;
    const cur = g;
    g = null;
    if (!cur.dragging) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? cur.x0) - cur.x0;
    const inward = cur.side === 'left' ? dx : -dx;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - cur.t0) > 0.5;
    const open = cur.mode === 'open' ? (cur.p > 0.4 || (fast && inward > 0)) : !(cur.p < 0.6 || (fast && inward < 0));
    reset();
    if (open) openPanel(cur.side); else closePanel(cur.side);
    // Swallow the click a finished drag would otherwise fire on a row.
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanels(); });
}
