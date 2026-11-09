// Right panel (Preact) — settings for THIS shift (the current session): name, date
// (inline calendar, with dots on days that have saved sessions), default
// shift times, support tip-out, tools, export / delete. Opens from the date
// pill in the header, a drag in from the right edge, or a flick left past
// the last sub-tab. App-wide settings live in the left panel (drawer.js).
//
// Re-rendered with every app render while open; Preact keeps input focus.

import { html, render } from '../ui/preact.js';
import { cx, Icon, Card, Field, Label, ListRow, INPUT, ROLE_TEXT } from '../ui/pkit.js';
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

function Calendar({ selected, sessionDates }) {
  const first = new Date(calY, calM, 1);
  const lead = first.getDay();
  const days = new Date(calY, calM + 1, 0).getDate();
  const today = todayISO();
  const iso = d => calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(first);
  const nav = 'grid size-9 shrink-0 place-items-center rounded-full text-ink-2 active:bg-high';

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<span key=${'b' + i}></span>`);
  for (let d = 1; d <= days; d++) {
    const v = iso(d);
    const sel = v === selected;
    cells.push(html`<button key=${v} class=${cx(
      'relative mx-auto grid size-10 place-items-center rounded-full font-rounded text-[1rem] font-semibold tabular-nums transition active:scale-90',
      sel ? 'bg-gold text-gold-ink' : v === today ? 'text-gold ring-1 ring-inset ring-gold/60' : 'text-ink active:bg-high',
    )} onClick=${() => App.setDate(v)} aria-label=${v} aria-pressed=${String(sel)}>${d}${
      !sel && sessionDates.has(v) && html`<i class="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-ink-2"></i>`}</button>`);
  }

  return html`<${Card} class="flex flex-col gap-1 !px-3 !py-3">
    <div class="flex items-center gap-0.5 pb-1 pl-2">
      <span class="min-w-0 flex-1 truncate whitespace-nowrap text-[1rem] font-bold">${title}</span>
      <button class="h-8 shrink-0 rounded-full bg-fill px-2.5 text-[0.8125rem] font-semibold text-ink active:bg-high" onClick=${() => calendarStep(0)}>Today</button>
      <button class=${nav} onClick=${() => calendarStep(-1)} aria-label="Previous month"><${Icon} name="chevR" class="size-5 rotate-180" /></button>
      <button class=${nav} onClick=${() => calendarStep(1)} aria-label="Next month"><${Icon} name="chevR" class="size-5" /></button>
    </div>
    <div class="grid grid-cols-7 text-center text-[0.6875rem] font-bold uppercase tracking-wider text-ink-3">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => html`<span key=${i} class="py-1">${d}</span>`)}
    </div>
    <div class="grid grid-cols-7 gap-y-1">${cells}</div>
  <//>`;
}

// ── Panel ────────────────────────────────────────────────────────────────────

function ShiftPanel({ vm, sessions, currentId }) {
  const s = vm.state;
  const d = s.defaults;
  const entry = sessions.find(e => e.id === currentId) || {};
  const sessionDates = new Set(sessions.filter(e => e.id !== currentId).map(e => e.date));
  const ROLE_NAME = { bartender: 'Bar', server: 'Server', support: 'Support' };
  const note = 'text-[0.8125rem] leading-snug text-ink-3';

  return html`
    <${Field} label="Session name" value=${entry.name || ''} placeholder="e.g. Brunch, Private party" maxlength="40" enterkeyhint="done"
      onChange=${e => App.renameCurrent(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />

    <${Label}>Date<//>
    <${Calendar} selected=${s.meta.date} sessionDates=${sessionDates} />

    <div id="shift-times" class="scroll-mt-2"><${Label}>Shift times<//></div>
    <${Card} class="flex flex-col gap-3">
      <div class="flex gap-3">
        <${Field} label="Open (in)" inputmode="decimal" placeholder="5" value=${d.global.in} onInput=${e => App.globalDefault('in', e.target.value)} />
        <${Field} label="Close (out)" inputmode="decimal" placeholder="2" value=${d.global.out} onInput=${e => App.globalDefault('out', e.target.value)} />
      </div>
      <p class=${note}>Fills any blank In/Out. Blank Outs inherit the close time, which also decides the auto closers. Type 5, 10.5, 2 …</p>
    <//>
    ${s.settings.allRoles && html`<${Card} class="flex flex-col gap-3">
      <div class="text-[0.875rem] font-medium text-ink-2">Per role</div>
      <div class="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-x-3 gap-y-2.5">
        <span></span><span class="text-center text-[0.8125rem] font-medium text-ink-2">In</span><span class="text-center text-[0.8125rem] font-medium text-ink-2">Out</span>
        ${['bartender', 'server', 'support'].map(r => html`
          <span key=${r + 'l'} class=${cx('text-[0.9375rem] font-semibold', ROLE_TEXT[r])}>${ROLE_NAME[r]}</span>
          ${['in', 'out'].map(f => html`<input key=${r + f} class=${cx(INPUT, 'text-center font-semibold')} inputmode="decimal" placeholder="—"
            value=${d.byRole[r][f] ?? ''} onInput=${e => App.roleDefault(r, f, e.target.value)} aria-label=${r + ' ' + f} />`)}`)}
      </div>
      <p class=${note}>Role times win over the shift times for that role.</p>
    <//>`}
    ${s.settings.allRoles && html`<${Card} class="flex flex-col gap-3">
      <${Field} label="Support tip-out · % of each pool" inputmode="decimal" placeholder="10" value=${d.supportPct ?? ''} onInput=${e => App.supportDefault(e.target.value)} />
      <p class=${note}>Each pool can override % or $/hr on the Tips tab.</p>
    <//>`}

    <${Label}>Tools<//>
    <${Card} flush>
      <${ListRow} icon="gift" onClick=${() => App.openBonus()}>Closer bonus & chump<//>
      <${ListRow} icon="sliders" onClick=${() => App.openCloseTime()}>Close-time what-if<//>
    <//>

    <${Label}>This session<//>
    <${Card} flush>
      <${ListRow} icon="download" chevron=${false} onClick=${() => App.exportSession()}>Export JSON<//>
      <${ListRow} icon="trash" tone="danger" chevron=${false} onClick=${() => App.deleteSession(currentId)}>Delete session<//>
    <//>`;
}

export function renderShiftPanel(vm, sessions, currentId, force = false) {
  if (!vm) return;
  lastArgs = [vm, sessions, currentId];
  if (!force && !isPanelOpen('right')) return;
  const body = $('shift-body');
  if (!body) return;
  const date = parseISO(vm.state.meta.date);
  const sub = $('shift-sub');
  const text = date ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(date) : 'No date';
  if (sub && sub.textContent !== text) sub.textContent = text;
  render(html`<${ShiftPanel} vm=${vm} sessions=${sessions} currentId=${currentId} />`, body);
}
