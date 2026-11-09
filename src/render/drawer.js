// Side drawer — sessions + settings. Opens from the header menu button, a
// swipe in from the left edge, or a right swipe on the first tab. Lists every
// saved session (tap to switch), then the settings switches, tools and data.
// Re-renders with the app while open.

import { fmtMoney } from '../util.js';
import { html, cx, mount } from '../ui/html.js';
import { Card, Button, Label, SwitchRow, ListRow, SEP } from '../ui/kit.js';
import { icon } from '../ui/icons.js';
import { todayISO } from '../sessions.js';

const $ = id => document.getElementById(id);

let editing = false;
let lastArgs = null;

export const isDrawerOpen = () => document.documentElement.classList.contains('drawer-open');

export function openDrawer() {
  document.activeElement?.blur?.();
  editing = false;
  document.documentElement.classList.add('drawer-open');
  $('drawer')?.setAttribute('aria-hidden', 'false');
  if (lastArgs) renderDrawer(...lastArgs, true);
  $('drawer-body')?.scrollTo?.(0, 0);
}

export function closeDrawer() {
  if (!isDrawerOpen()) return;
  document.documentElement.classList.remove('drawer-open');
  $('drawer')?.setAttribute('aria-hidden', 'true');
  editing = false;
}

export function toggleDrawerEdit() {
  editing = !editing;
  if (lastArgs) renderDrawer(...lastArgs, true);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}

function dayLabel(iso) {
  const d = parseISO(iso);
  if (!d) return 'No date';
  const today = todayISO();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === today) return 'Today';
  if (iso === todayISO(y)) return 'Yesterday';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

function DateTile(iso, active) {
  const d = parseISO(iso);
  const wk = d ? new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d) : '—';
  return html`<span class="${cx('flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl leading-none',
    active ? 'bg-gold text-gold-ink' : 'bg-white/8 text-ink')}">
    <span class="${cx('text-[10px] font-bold uppercase tracking-[.08em]', active ? 'text-gold-ink/70' : 'text-ink-3')}">${wk}</span>
    <span class="mt-0.5 font-rounded text-[20px] font-bold tabular-nums">${d ? d.getDate() : '?'}</span>
  </span>`;
}

function SessionRow(e, active) {
  const title = e.name || dayLabel(e.date) + (e.nth ? ' · ' + e.nth : '');
  const sub = [
    e.name ? dayLabel(e.date) : '',
    e.people ? `${e.people} ${e.people === 1 ? 'person' : 'people'}` : 'No staff yet',
  ].filter(Boolean).join(' · ');
  const tail = editing
    ? html`<span class="flex shrink-0 gap-1.5">
        <button class="grid size-10 place-items-center rounded-full bg-fill text-ink-2 active:bg-high" onclick="App.renameSession('${e.id}')" aria-label="Rename">${icon('pencil', 'size-[17px]')}</button>
        <button class="grid size-10 place-items-center rounded-full bg-red/15 text-red active:bg-red/25" onclick="App.deleteSession('${e.id}')" aria-label="Delete">${icon('trash', 'size-[17px]')}</button>
      </span>`
    : html`<span class="shrink-0 text-right">
        <span class="${cx('block font-rounded text-[18px] font-bold tabular-nums', e.total > 0 ? (active ? 'text-gold' : 'text-ink') : 'text-ink-3')}">${e.total > 0 ? fmtMoney(e.total) : '—'}</span>
      </span>`;
  const main = html`<span class="flex min-w-0 flex-1 items-center gap-3">
      ${DateTile(e.date, active)}
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5 text-[17px] font-semibold"><span class="truncate">${title}</span>${active && html`<span class="size-1.5 shrink-0 rounded-full bg-gold"></span>`}</span>
        <span class="mt-0.5 block truncate text-[13px] text-ink-2">${sub}</span>
      </span>
    </span>`;
  const rowCls = cx('flex min-h-[68px] w-full items-center gap-3 px-3 text-left transition', SEP, active && 'bg-gold/[.07]');
  return editing
    ? html`<div class="${rowCls}">${main}${tail}</div>`
    : html`<button class="${cx(rowCls, 'active:bg-raised')}" onclick="App.switchSession('${e.id}')" aria-current="${active ? 'true' : 'false'}">${main}${tail}</button>`;
}

// sessions: [{ id, name, date, total, people }], currentId. The current
// session's numbers come live from the view model, not the saved summary.
export function renderDrawer(vm, sessions, currentId, force = false) {
  lastArgs = [vm, sessions, currentId];
  if (!force && !isDrawerOpen()) return;
  const body = $('drawer-body');
  if (!body) return;
  const s = vm.state;
  const extraPools = s.pools.length > 1;
  const rows = sessions.map(e => e.id === currentId
    ? { ...e, date: s.meta.date, total: vm.totalCash || 0, people: s.staff.filter(p => p.name.trim()).length }
    : { ...e });
  // Unnamed sessions sharing a date read "Today", "Today · 2" … (oldest first).
  const byDate = {};
  [...rows].reverse().forEach(e => {
    if (e.name) return;
    byDate[e.date] = (byDate[e.date] || 0) + 1;
    if (byDate[e.date] > 1) e.nth = byDate[e.date];
  });

  mount(body, html`
    ${Button({ variant: 'primary', block: true, icon: 'plus', onclick: 'App.newSession()' }, 'New session')}

    ${Label('Sessions', rows.length > 1 || editing
      ? html`<button class="font-semibold text-gold" onclick="App.drawerEdit()">${editing ? 'Done' : 'Edit'}</button>` : '')}
    ${Card({ flush: true }, rows.map(e => SessionRow(e, e.id === currentId)))}
    ${editing && html`<p class="px-1 text-[13px] leading-snug text-ink-3">Deleting a session can’t be undone. Export it first to keep a copy.</p>`}

    ${Label('Settings')}
    ${Card({ flush: true }, html`
      ${SwitchRow({ id: 'set-allRoles', on: s.settings.allRoles, onclick: "App.toggleSetting('allRoles')", label: 'Servers & support', hint: 'Role sections, support tip-out, who-shares chips' })}
      ${SwitchRow({ id: 'set-multiPool', on: s.settings.multiPool || extraPools, disabled: extraPools, onclick: "App.toggleSetting('multiPool')", label: 'Multiple pools',
        hint: extraPools ? `On while ${s.pools.length} pools exist — remove extras to turn off` : 'Split tips by time window (e.g. lunch / dinner)' })}
      ${SwitchRow({ id: 'set-clock24', on: s.settings.clock24, onclick: "App.toggleSetting('clock24')", label: '24-hour time', hint: 'Show 17:00 instead of 5:00p' })}`)}

    ${Label('Tools')}
    ${Card({ flush: true }, html`
      ${ListRow({ icon: 'clock', onclick: 'App.openDefaults()' }, 'Default shift times')}
      ${ListRow({ icon: 'gift', onclick: 'App.openBonus()' }, 'Closer bonus & chump')}
      ${ListRow({ icon: 'sliders', onclick: 'App.openCloseTime()' }, 'Close-time what-if')}`)}

    ${Label('This session')}
    ${Card({ flush: true }, html`
      ${ListRow({ icon: 'download', onclick: 'App.exportSession()', chevron: false }, 'Export JSON')}
      ${ListRow({ icon: 'upload', onclick: 'App.triggerImport()', chevron: false }, 'Import as new session')}
      ${ListRow({ icon: 'trash', tone: 'danger', onclick: `App.deleteSession('${currentId}')`, chevron: false }, 'Delete session')}`)}
    <p class="px-1 pt-1 text-center text-[13px] leading-snug text-ink-3">Settings and saved names are shared by every session.</p>`);
}

// ── Gestures ─────────────────────────────────────────────────────────────────
// Drag in from the left edge to open (follows the finger), drag the drawer or
// its scrim left to close. Vertical scrolls inside the drawer are untouched.

export const EDGE = 24;

export function initDrawerGestures({ canOpen }) {
  const drawer = $('drawer');
  const scrim = $('drawerScrim');
  const root = document.documentElement;
  let mode = null, dragging = false, x0 = 0, y0 = 0, t0 = 0, w = 1, p = 0;

  const bodyLeft = () => document.body.getBoundingClientRect().left;
  const set = prog => {
    p = Math.max(0, Math.min(1, prog));
    drawer.style.transform = `translateX(${(p - 1) * 100}%)`;
    scrim.style.opacity = String(p);
  };
  const reset = () => {
    root.classList.remove('drawer-dragging');
    drawer.style.transform = '';
    scrim.style.opacity = '';
  };

  document.addEventListener('touchstart', e => {
    mode = null; dragging = false;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (isDrawerOpen()) {
      if (drawer.contains(e.target) || e.target === scrim) mode = 'close';
    } else if (t.clientX - bodyLeft() < EDGE && canOpen()) {
      mode = 'open';
    }
    if (!mode) return;
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    w = drawer.offsetWidth || 300;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!mode) return;
    const t = e.touches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (!dragging) {
      const wanted = mode === 'open' ? dx > 8 : dx < -8;
      if (wanted && Math.abs(dx) > Math.abs(dy) * 1.2) {
        dragging = true;
        root.classList.add('drawer-dragging');
        if (mode === 'open') {
          document.activeElement?.blur?.();
          if (lastArgs) renderDrawer(...lastArgs, true);
        }
      } else if (Math.abs(dy) > 10 || (mode === 'open' && dx < -8)) {
        mode = null;
        return;
      } else return;
    }
    e.preventDefault();
    set(mode === 'open' ? dx / w : 1 + dx / w);
  }, { passive: false });

  const end = e => {
    if (!mode) return;
    const wasDragging = dragging;
    const m = mode;
    mode = null; dragging = false;
    if (!wasDragging) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? x0) - x0;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.5;
    const open = m === 'open' ? (p > 0.4 || (fast && dx > 0)) : !(p < 0.6 || (fast && dx < 0));
    reset();
    if (open) openDrawer(); else closeDrawer();
    // Swallow the click a finished drag would otherwise fire on a row.
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}
