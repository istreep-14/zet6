// The menu: a drawer from the left. The session you're in (its day, name and
// figures), the others to switch to, and the app's tools. Opens from the
// session avatar in the header or a swipe right on a tab's first sub-tab
// (ui/nav.js hands the drag over: menuEdge); a swipe left on it, a tap on the
// scrim or Esc closes it. Every row closes it as it acts.

import { fmtMoney, fmtHrs } from '../util.js';
import { SHIFT_LABEL } from '../shifts.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Meta } from '../ui/pkit.js';
import { sideways } from '../ui/nav.js';
import { DateTile, rowsOf, titleOf, peopleOf, dayLabel } from './settings.js';
import { DayDisc, fmtDay, shiftHours } from './tabs.js';

const $ = id => document.getElementById(id);
const RECENT = 4;

let last = null;
let isOpen = false;
export const menuOpen = () => isOpen;

// ── Open / close / follow the finger ────────────────────────────────────────
const width = () => $('menu')?.offsetWidth || 300;
function follow(p) {                         // 0 = closed … 1 = open
  const m = $('menu'), s = $('menuScrim');
  if (!m || !s) return;
  m.classList.add('dragging'); s.classList.add('dragging');
  m.style.transform = `translateX(${(Math.max(0, Math.min(1, p)) - 1) * 100}%)`;
  s.style.opacity = String(Math.max(0, Math.min(1, p)));
}
function settle(open) {
  const m = $('menu'), s = $('menuScrim');
  if (!m || !s) return;
  isOpen = open;
  m.classList.remove('dragging'); s.classList.remove('dragging');
  m.style.transform = ''; s.style.opacity = '';
  m.classList.toggle('open', open); s.classList.toggle('open', open);
  m.setAttribute('aria-hidden', String(!open));
  document.documentElement.classList.toggle('menu-open', open);
  if (open) paint();
}
export function openMenu() { document.activeElement?.blur?.(); settle(true); }
export function closeMenu() { if (isOpen || $('menu')?.classList.contains('dragging')) settle(false); }

// A swipe right off the first sub-tab pulls it in.
export const menuEdge = {
  drag(dx) { if (dx <= 0) { settle(false); return; } if (!$('menu')?.classList.contains('dragging')) paint(); follow(dx / width()); },
  release(dx, fast) { settle(dx > width() / 3 || (fast && dx > 40)); },
};

export function initMenu() {
  const m = $('menu'), s = $('menuScrim');
  const back = {
    move(dx) { follow(1 + Math.min(0, dx) / width()); },
    end(dx, fast) { settle(!(dx < -width() / 3 || (fast && dx < -40))); },
    cancel() { settle(true); },
  };
  if (m) sideways(m, () => isOpen, back);
  if (s) sideways(s, () => isOpen, back);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) closeMenu(); });
}

// ── Content ──────────────────────────────────────────────────────────────────
export function renderMenu(vm, sessions, currentId) {
  last = { vm, sessions, currentId };
  if (isOpen) paint();
}
function paint() {
  const root = $('menu-root');
  if (root && last) render(html`<${Menu} ...${last} />`, root);
}

const then = fn => () => { closeMenu(); fn(); };

function Big({ icon, label, sub, onClick, tone = '' }) {
  return html`<button class=${cx('menu-row', tone)} onClick=${onClick}>
    <${Icon} name=${icon} class="size-6" />
    <span class="flex min-w-0 flex-col"><span class="truncate">${label}</span>${sub && html`<span class="t-small truncate font-normal text-ink-3">${sub}</span>`}</span>
  </button>`;
}

function Menu({ vm, sessions, currentId }) {
  const s = vm.state;
  const rows = rowsOf(vm, sessions, currentId);
  const cur = rows.find(e => e.id === currentId) || { date: s.meta.date };
  const others = rows.filter(e => e.id !== currentId).slice(0, RECENT);
  const sh = !vm.blocked && vm.shares;
  const named = s.staff.filter(p => p.name.trim()).length;
  const dark = s.settings.theme === 'dark'
    || (s.settings.theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const size = s.settings.size || 'm';
  // Three parts: the session (pinned at the top), what's to do (scrolls if it
  // must — kept short so it rarely does), display (pinned at the bottom).
  return html`<div class="flex h-full flex-col">
    <div class="menu-head">
      <div class="flex items-center gap-3">
        <${DayDisc} iso=${s.meta.date} size="size-11" text="text-[1.25rem]" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="t-head truncate">${titleOf(cur)}</span>
          <span class="t-small truncate text-ink-3">${[cur.name ? fmtDay(s.meta.date) : '', (SHIFT_LABEL[s.meta.shiftType] || 'Night') + ' shift'].filter(Boolean).join(' · ')}</span>
        </span>
        <button class="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink active:bg-surface-2"
          onClick=${then(() => App.newSession())} aria-label="New session"><${Icon} name="plus" class="size-5" /></button>
      </div>
      <${Meta} class="mt-2" items=${[
        { v: named, l: named === 1 ? 'person' : 'people' },
        { v: fmtMoney(vm.totalCash || 0), l: 'in tips' },
        sh && { v: fmtHrs(shiftHours(sh)), l: 'h', tight: true },
      ]} />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      ${others.length > 0 && html`<div class="flex flex-col pb-1 pt-2">
        <span class="t-cap px-5 pb-1 text-ink-3">Switch to</span>
        ${others.map(e => html`<button key=${e.id} class="flex items-center gap-3 px-5 py-1.5 text-left active:bg-surface-2" onClick=${then(() => App.switchSession(e.id))}>
          <${DateTile} iso=${e.date} />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="t-body truncate">${titleOf(e)}</span>
            <span class="t-small truncate text-ink-3">${[e.name ? dayLabel(e.date) : '', peopleOf(e.people)].filter(Boolean).join(' · ')}</span>
          </span>
          <span class=${cx('t-small shrink-0 font-semibold tabular-nums', e.total > 0 ? 'text-ink-2' : 'text-ink-3')}>${e.total > 0 ? fmtMoney(e.total) : '—'}</span>
        </button>`)}
      </div>
      <div class="menu-sep"></div>`}
      <div class="flex flex-col py-1">
        <${Big} icon="calendar" label="This shift" onClick=${then(() => App.tab('shift', { sub: 'shift' }))} />
        <${Big} icon="layers" label="Sessions" onClick=${then(() => App.openSettings())} />
        <${Big} icon="copy" label="Copy summary" onClick=${then(() => App.copySummary())} />
        <${Big} icon="download" label="Export session" onClick=${then(() => App.exportSession())} />
        <${Big} icon="upload" label="Import a session" onClick=${then(() => App.triggerImport())} />
        <${Big} icon="gear" label="Settings" onClick=${then(() => App.openSettings())} />
      </div>
    </div>

    <div class="menu-foot">
      <div class="flex flex-1 rounded-xl bg-surface-2 p-0.5" role="group" aria-label="Display size">
        ${['s', 'm', 'l', 'xl'].map(k => html`<button key=${k} class=${cx('t-small h-9 flex-1 rounded-[0.625rem] font-semibold uppercase', size === k ? 'bg-raised text-ink shadow-[0_1px_3px_rgb(0_0_0/.14)]' : 'text-ink-3')}
          aria-pressed=${String(size === k)} onClick=${() => App.setSize(k)}>${k}</button>`)}
      </div>
      <button class="grid size-10 shrink-0 place-items-center rounded-full text-ink active:bg-surface-2" onClick=${() => App.setTheme(dark ? 'light' : 'dark')}
        aria-label=${dark ? 'Light theme' : 'Dark theme'}><${Icon} name=${dark ? 'sun' : 'moon'} class="size-6" /></button>
    </div>
  </div>`;
}
