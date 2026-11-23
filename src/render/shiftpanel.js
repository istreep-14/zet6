// Right panel (Preact) — settings for THIS shift (the current session): name, date
// (inline calendar, with dots on days that have saved sessions), default
// shift times, support tip-out, tools, export / delete. Opens from the date
// pill in the header, a drag in from the right edge, or a flick left past
// the last sub-tab. App-wide settings live in the left panel (drawer.js).
//
// Re-rendered with every app render while open; Preact keeps input focus.

import { html, render } from '../ui/preact.js';
import { cx, Icon, Card, Field, Section, ListRow, List, Seg, ROLE_TEXT } from '../ui/pkit.js';
import { KeyTime } from '../ui/keytime.js';
import { parseTime, inAbsOf, afterAbsOf, absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { focusCell } from '../ui/keypad.js';
import { SHIFT_TYPES, SHIFT_LABEL } from '../shifts.js';
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
  const nav = 'grid size-9 shrink-0 place-items-center rounded-full text-ink-2 active:opacity-70';

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<span key=${'b' + i}></span>`);
  for (let d = 1; d <= days; d++) {
    const v = iso(d);
    const sel = v === selected;
    cells.push(html`<button key=${v} class=${cx(
      'relative mx-auto grid size-10 place-items-center rounded-full text-[0.9375rem] font-medium tabular-nums transition active:scale-90',
      sel ? 'bg-accent text-on-accent' : v === today ? 'text-accent ring-1 ring-inset ring-accent/60' : 'text-ink active:opacity-70',
    )} onClick=${() => App.setDate(v)} aria-label=${v} aria-pressed=${String(sel)}>${d}${
      !sel && sessionDates.has(v) && html`<i class="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-ink-2"></i>`}</button>`);
  }

  return html`<${Card} class="flex flex-col gap-1 !px-3 !py-3">
    <div class="flex items-center gap-0.5 pb-1 pl-2">
      <span class="t-head min-w-0 flex-1 truncate whitespace-nowrap">${title}</span>
      <button class="t-small h-8 shrink-0 rounded-full bg-accent/12 px-3 font-semibold text-accent active:opacity-70" onClick=${() => calendarStep(0)}>Today</button>
      <button class=${nav} onClick=${() => calendarStep(-1)} aria-label="Previous month"><${Icon} name="chevR" class="size-5 rotate-180" /></button>
      <button class=${nav} onClick=${() => calendarStep(1)} aria-label="Next month"><${Icon} name="chevR" class="size-5" /></button>
    </div>
    <div class="t-cap grid grid-cols-7 text-center text-ink-3">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => html`<span key=${i} class="py-1">${d}</span>`)}
    </div>
    <div class="grid grid-cols-7 gap-y-1">${cells}</div>
  <//>`;
}

// ── Shift times: keypad / drag cells ─────────────────────────────────────────
// Open → Close, then each role's In → Out. Next walks that order; ↓ / ↑ move
// down / up the same column.
const ROLES3 = ['bartender', 'server', 'support'];
const rerender = () => { if (lastArgs) renderShiftPanel(...lastArgs, true); };
const tap = k => focusCell(k);

function order(rolesOn) {
  return [['g:in', 'g:out'], ...(rolesOn ? ROLES3.map(r => ['r:' + r + ':in', 'r:' + r + ':out']) : [])];
}
function navFrom(k, rolesOn) {
  const rows = order(rolesOn);
  const r = rows.findIndex(row => row.includes(k)), c = rows[r].indexOf(k);
  return dir => {
    if (dir === 'next' || dir === 'prev') {
      const flat = rows.flat(), j = flat.indexOf(k) + (dir === 'next' ? 1 : -1);
      return flat[j] ? tap(flat[j]) : false;
    }
    const n = rows[r + (dir === 'down' ? 1 : -1)];
    return n ? tap(n[c]) : false;
  };
}

const parsed = raw => { const p = parseTime(raw); return p.value != null ? p : null; };
const CELLCLS = 'h-11 w-full rounded-xl bg-surface-2 text-center text-[1.0625rem] tabular-nums transition';

// One default time. `raw` is what's stored ('' = inherits `fallback`).
function DefCell({ k, title, raw, fallback, field, inAbs, write, rolesOn }) {
  const v = parsed(raw) ?? parsed(fallback);
  const isIn = field === 'in';
  const abs = v == null ? null : isIn ? inAbsOf(v) : afterAbsOf(v, inAbs ?? 17);
  return html`<${KeyTime} k=${k} title=${title} abs=${abs} set=${!!String(raw || '').trim()} cls=${CELLCLS}
    toAbs=${(x, mer) => (isIn ? inAbsOf({ value: x, mer }) : afterAbsOf({ value: x, mer }, inAbs ?? 17))}
    fromAbs=${a => (isIn ? absToInRaw(Math.min(IN_MAX_ABS, Math.max(IN_MIN_ABS, a))) : absToOutRaw(a, inAbs ?? 17))}
    min=${isIn ? IN_MIN_ABS : (inAbs ?? 17) + 0.25} max=${isIn ? IN_MAX_ABS : (inAbs ?? 17) + 12}
    write=${write} next=${navFrom(k, rolesOn)} rerender=${rerender} clearable=${k.startsWith('r:')} />`;
}

// ── Panel ────────────────────────────────────────────────────────────────────

function ShiftPanel({ vm, sessions, currentId }) {
  const s = vm.state;
  const d = s.defaults;
  const entry = sessions.find(e => e.id === currentId) || {};
  const sessionDates = new Set(sessions.filter(e => e.id !== currentId).map(e => e.date));
  const ROLE_NAME = { bartender: 'Bar', server: 'Server', support: 'Support' };
  const type = s.meta.shiftType || 'night';
  const rolesOn = s.settings.allRoles;
  const gv = parsed(d.global.in);
  const gIn = gv != null ? inAbsOf(gv) : null;

  return html`
    <${Field} page label="Session name" value=${entry.name || ''} placeholder="e.g. Brunch, Private party" maxlength="40" enterkeyhint="done"
      onChange=${e => App.renameCurrent(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />

    <${Section} title="Shift type" footer=${type === 'day'
      ? 'Day: bar + servers share the floor until the servers are out, then Mid is the bar’s. Add parties on the Tips tab.'
      : 'Night: one pool for the whole shift. Add parties on the Tips tab.'}>
      <${Seg} value=${type} onChange=${t => App.setShiftType(t)} items=${SHIFT_TYPES.map(t => ({ value: t, label: SHIFT_LABEL[t] }))} />
    <//>

    <${Section} title="Date">
      <${Calendar} selected=${s.meta.date} sessionDates=${sessionDates} />
    <//>

    <div id="shift-times" class="scroll-mt-2"><${Section} title=${SHIFT_LABEL[type] + ' shift times'}
      footer=${'Fills any blank In/Out; blank Outs leave at close, which also decides the auto closers. Tap a time to type it (530 = 5:30), drag to nudge. Remembered for the next ' + SHIFT_LABEL[type].toLowerCase() + ' shift.'}>
      <${Card} class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5"><span class="t-small font-medium text-ink-2">Open</span>
          <${DefCell} k="g:in" title="Shift opens" raw=${d.global.in} field="in" rolesOn=${rolesOn} write=${r => App.globalDefault('in', r, true)} /></div>
        <div class="flex flex-col gap-1.5"><span class="t-small font-medium text-ink-2">Close</span>
          <${DefCell} k="g:out" title="Shift closes" raw=${d.global.out} field="out" inAbs=${gIn} rolesOn=${rolesOn} write=${r => App.globalDefault('out', r, true)} /></div>
      <//>
    <//></div>
    ${rolesOn && html`<${Section} title="Per role" footer=${'Role times win over the shift times for that role.' + (type === 'day' ? ' Servers’ Out is where Day hands over to Mid (unless a server stays later).' : '')}>
      <${Card}>
        <div class="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-x-3 gap-y-2.5">
          <span></span><span class="t-small text-center font-medium text-ink-2">In</span><span class="t-small text-center font-medium text-ink-2">Out</span>
          ${ROLES3.map(r => {
            const rin = parsed(d.byRole[r].in) ?? parsed(d.global.in);
            return html`
            <span key=${r + 'l'} class=${cx('t-body font-semibold', ROLE_TEXT[r])}>${ROLE_NAME[r]}</span>
            <${DefCell} key=${r + 'in'} k=${'r:' + r + ':in'} title=${ROLE_NAME[r] + ' in'} raw=${d.byRole[r].in} fallback=${d.global.in} field="in" rolesOn=${rolesOn}
              write=${v => App.roleDefault(r, 'in', v, true)} />
            <${DefCell} key=${r + 'out'} k=${'r:' + r + ':out'} title=${ROLE_NAME[r] + ' out'} raw=${d.byRole[r].out} fallback=${d.global.out} field="out"
              inAbs=${rin != null ? inAbsOf(rin) : null} rolesOn=${rolesOn} write=${v => App.roleDefault(r, 'out', v, true)} />`;
          })}
        </div>
      <//>
    <//>`}
    ${s.settings.allRoles && html`<${Section} title="Support" footer="Each pool can override % or $/hr on the Tips tab.">
      <${Card}>
        <${Field} label="Tip-out · % of each pool" inputmode="decimal" placeholder="10" value=${d.supportPct ?? ''} onInput=${e => App.supportDefault(e.target.value)} />
      <//>
    <//>`}

    <${Section} title="Tools">
      <${List}>
        <${ListRow} icon="gift" onClick=${() => App.openBonus()}>Closer bonus & chump<//>
        <${ListRow} icon="sliders" onClick=${() => App.openCloseTime()}>Close-time what-if<//>
      <//>
    <//>

    <${Section} title="This session">
      <${List}>
        <${ListRow} icon="copy" chevron=${false} onClick=${() => App.copySummary()}>Copy summary as text<//>
        <${ListRow} icon="download" chevron=${false} onClick=${() => App.exportSession()}>Export JSON<//>
        <${ListRow} icon="trash" tone="danger" chevron=${false} onClick=${() => App.deleteSession(currentId)}>Delete session<//>
      <//>
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
