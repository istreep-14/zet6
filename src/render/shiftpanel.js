// Right panel — settings for THIS shift (the current session): name, date
// (inline calendar, with dots on days that have saved sessions), default
// shift times, support tip-out, tools, export / delete. Opens from the date
// pill in the header, a drag in from the right edge, or a flick left past
// the last sub-tab. App-wide settings live in the left panel (drawer.js).
//
// Rebuilt on every app render while open — except while one of its inputs
// has focus, so typing is never interrupted.

import { html, cx, mount } from '../ui/html.js';
import { Card, Field, Label, ListRow, INPUT, ROLE_TEXT } from '../ui/kit.js';
import { icon } from '../ui/icons.js';
import { todayISO } from '../sessions.js';
import { isPanelOpen, onPanel } from '../ui/panels.js';

const $ = id => document.getElementById(id);

let lastArgs = null;
let calY = 0, calM = 0;           // month shown in the calendar

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}

function showMonthOf(iso) {
  const d = parseISO(iso) || new Date();
  calY = d.getFullYear();
  calM = d.getMonth();
}

onPanel('right', {
  open() {
    if (lastArgs) showMonthOf(lastArgs[0].state.meta.date);
    renderShiftPanel(...(lastArgs || []), true);
    $('shift-body')?.scrollTo?.(0, 0);
  },
});

export function calendarStep(delta) {
  if (delta === 0) showMonthOf(todayISO());
  else {
    calM += delta;
    if (calM < 0) { calM = 11; calY -= 1; }
    if (calM > 11) { calM = 0; calY += 1; }
  }
  if (lastArgs) renderShiftPanel(...lastArgs, true);
}

// Scroll the panel to a section (e.g. the default times).
export function scrollShiftTo(id) {
  requestAnimationFrame(() => $(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function calendarHTML(selected, sessionDates) {
  const first = new Date(calY, calM, 1);
  const lead = first.getDay();
  const days = new Date(calY, calM + 1, 0).getDate();
  const today = todayISO();
  const iso = d => calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(first);
  const nav = 'grid size-9 shrink-0 place-items-center rounded-full text-ink-2 active:bg-high';

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<span></span>`);
  for (let d = 1; d <= days; d++) {
    const v = iso(d);
    const sel = v === selected;
    const isToday = v === today;
    cells.push(html`<button class="${cx(
      'relative mx-auto grid size-10 place-items-center rounded-full font-rounded text-[16px] font-semibold tabular-nums transition active:scale-90',
      sel ? 'bg-gold text-gold-ink' : isToday ? 'text-gold ring-1 ring-inset ring-gold/60' : 'text-ink active:bg-high',
    )}" onclick="App.setDate('${v}')" aria-label="${v}" aria-pressed="${String(sel)}">${d}${
      !sel && sessionDates.has(v) ? html`<i class="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-ink-2"></i>` : ''}</button>`);
  }

  return Card({ class: 'flex flex-col gap-1 !px-3 !py-3' }, html`
    <div class="flex items-center gap-0.5 pb-1 pl-2">
      <span class="min-w-0 flex-1 truncate whitespace-nowrap text-[16px] font-bold">${title}</span>
      <button class="h-8 shrink-0 rounded-full bg-fill px-2.5 text-[13px] font-semibold text-ink active:bg-high" onclick="App.calMonth(0)">Today</button>
      <button class="${nav}" onclick="App.calMonth(-1)" aria-label="Previous month">${icon('chevR', 'size-5 rotate-180')}</button>
      <button class="${nav}" onclick="App.calMonth(1)" aria-label="Next month">${icon('chevR', 'size-5')}</button>
    </div>
    <div class="grid grid-cols-7 text-center text-[11px] font-bold uppercase tracking-wider text-ink-3">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => html`<span class="py-1">${d}</span>`)}
    </div>
    <div class="grid grid-cols-7 gap-y-1">${cells}</div>`);
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function renderShiftPanel(vm, sessions, currentId, force = false) {
  if (!vm) return;
  lastArgs = [vm, sessions, currentId];
  if (!force && !isPanelOpen('right')) return;
  const body = $('shift-body');
  if (!body) return;
  if (body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;

  const s = vm.state;
  const d = s.defaults;
  const entry = sessions.find(e => e.id === currentId) || {};
  const sessionDates = new Set(sessions.filter(e => e.id !== currentId).map(e => e.date));
  const rolesOn = s.settings.allRoles;
  const date = parseISO(s.meta.date);
  const sub = $('shift-sub');
  if (sub) sub.textContent = date ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(date) : 'No date';

  const cell = (role, field) => html`<input class="${cx(INPUT, 'text-center font-semibold')}" inputmode="decimal" placeholder="—"
    value="${d.byRole[role][field] ?? ''}" oninput="App.roleDefault('${role}','${field}',this.value)" aria-label="${role} ${field}">`;

  mount(body, html`
    ${Field({ label: 'Session name', value: entry.name || '', placeholder: 'e.g. Brunch, Private party', maxlength: 40, enterkeyhint: 'done',
      onchange: 'App.renameCurrent(this.value)', onkeydown: "if(event.key==='Enter')this.blur()" })}

    ${Label('Date')}
    ${calendarHTML(s.meta.date, sessionDates)}

    <div id="shift-times" class="scroll-mt-2">${Label('Shift times')}</div>
    ${Card({ class: 'flex flex-col gap-3' }, html`
      <div class="flex gap-3">
        ${Field({ label: 'Open (in)', inputmode: 'decimal', placeholder: '5', value: d.global.in, oninput: "App.globalDefault('in',this.value)" })}
        ${Field({ label: 'Close (out)', inputmode: 'decimal', placeholder: '2', value: d.global.out, oninput: "App.globalDefault('out',this.value)" })}
      </div>
      <p class="text-[13px] leading-snug text-ink-3">Fills any blank In/Out. Blank Outs inherit the close time, which also decides the auto closers. Type 5, 10.5, 2 …</p>`)}
    ${rolesOn && Card({ class: 'flex flex-col gap-3' }, html`
      <div class="text-[14px] font-medium text-ink-2">Per role</div>
      <div class="grid grid-cols-[72px_1fr_1fr] items-center gap-x-3 gap-y-2.5">
        <span></span><span class="text-center text-[13px] font-medium text-ink-2">In</span><span class="text-center text-[13px] font-medium text-ink-2">Out</span>
        ${['bartender', 'server', 'support'].map(r => html`
          <span class="${cx('text-[15px] font-semibold', ROLE_TEXT[r])}">${{ bartender: 'Bar', server: 'Server', support: 'Support' }[r]}</span>
          ${cell(r, 'in')}${cell(r, 'out')}`)}
      </div>
      <p class="text-[13px] leading-snug text-ink-3">Role times win over the shift times for that role.</p>`)}
    ${rolesOn && Card({ class: 'flex flex-col gap-3' }, html`
      ${Field({ label: 'Support tip-out · % of each pool', inputmode: 'decimal', placeholder: '10', value: d.supportPct ?? '', oninput: 'App.supportDefault(this.value)' })}
      <p class="text-[13px] leading-snug text-ink-3">Each pool can override % or $/hr on the Tips tab.</p>`)}

    ${Label('Tools')}
    ${Card({ flush: true }, html`
      ${ListRow({ icon: 'gift', onclick: 'App.openBonus()' }, 'Closer bonus & chump')}
      ${ListRow({ icon: 'sliders', onclick: 'App.openCloseTime()' }, 'Close-time what-if')}`)}

    ${Label('This session')}
    ${Card({ flush: true }, html`
      ${ListRow({ icon: 'download', onclick: 'App.exportSession()', chevron: false }, 'Export JSON')}
      ${ListRow({ icon: 'trash', tone: 'danger', onclick: `App.deleteSession('${currentId}')`, chevron: false }, 'Delete session')}`)}`);
}
