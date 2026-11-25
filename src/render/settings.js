// Settings tab (Preact) — three sub-tabs (the header):
//   Shift     this session: its name, the date (inline calendar, dots on
//             days with other sessions), export, delete
//   Sessions  New session, every saved session (tap to switch; Edit →
//             rename / delete)
//   App       theme, display size, roles, several pools, 24-hour time,
//             morning starts at; copy / export / import
// The default shift times live on Staff › Defaults (RoleTimes is exported
// for it), the support tip-out on Tips › Pools (SupportDefault).

import { fmtMoney } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Card, Field, Section, Seg, SwitchRow, List, Item, ROLE_TEXT } from '../ui/pkit.js';
import { KeyTime } from '../ui/keytime.js';
import { parseTime, inAbsOf, afterAbsOf, absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { focusCell } from '../ui/keypad.js';
import { todayISO } from '../sessions.js';
import { currentSub } from '../ui/nav.js';

const $ = id => document.getElementById(id);

// ── Dates ────────────────────────────────────────────────────────────────────

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}

export function dayLabel(iso) {
  const d = parseISO(iso);
  if (!d) return 'No date';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === todayISO()) return 'Today';
  if (iso === todayISO(y)) return 'Yesterday';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

export function DateTile({ iso, active }) {
  const d = parseISO(iso);
  const wk = d ? new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d) : '—';
  return html`<span class=${cx('flex size-10 shrink-0 flex-col items-center justify-center rounded-[0.625rem] leading-none',
    active ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink')}>
    <span class=${cx('text-[0.5625rem] font-semibold uppercase tracking-[.06em]', active ? 'text-on-accent/75' : 'text-ink-3')}>${wk}</span>
    <span class="t-head mt-0.5 leading-none tabular-nums">${d ? d.getDate() : '?'}</span>
  </span>`;
}

// The sessions with the current one's live numbers; unnamed ones sharing a
// date read "Today", "Today · 2" … (oldest first).
export function rowsOf(vm, sessions, currentId) {
  const s = vm.state;
  const rows = sessions.map(e => e.id === currentId
    ? { ...e, date: s.meta.date, total: vm.totalCash || 0, people: s.staff.filter(p => p.name.trim()).length }
    : { ...e });
  const byDate = {};
  [...rows].reverse().forEach(e => {
    if (e.name) return;
    byDate[e.date] = (byDate[e.date] || 0) + 1;
    if (byDate[e.date] > 1) e.nth = byDate[e.date];
  });
  return rows;
}
export const titleOf = e => e.name || dayLabel(e.date) + (e.nth ? ' · ' + e.nth : '');
export const peopleOf = n => (n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'No staff yet');

// Kept from the last render (sessions live outside the view model).
let sessionsNow = [], currentNow = null;

// ── The tab ──────────────────────────────────────────────────────────────────

function AppPrefs({ vm }) {
  const s = vm.state;
  const extraPools = s.pools.length > 1;
  const toggle = key => () => App.toggleSetting(key);
  return html`<div class="flex flex-col gap-6">
    <${Section} title="Appearance"><${List}>
      <${Item} icon="contrast" title="Theme" chevron=${false}>
        <${Seg} value=${s.settings.theme || 'system'} onChange=${v => App.setTheme(v)}
          items=${[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]} />
      <//>
      <${Item} icon="textsize" title="Display size" chevron=${false}>
        <${Seg} value=${s.settings.size || 'm'} onChange=${v => App.setSize(v)}
          items=${[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }, { value: 'xl', label: 'XL' }]} />
      <//>
    <//><//>

    <${Section} title="App" footer="Shared by every session."><${List}>
      <${SwitchRow} icon="users" on=${s.settings.allRoles} onClick=${toggle('allRoles')} label="Servers & support" hint="Role sections, support tip-out, who-shares chips" />
      <${SwitchRow} icon="cash" on=${s.settings.multiPool || extraPools} disabled=${extraPools} onClick=${toggle('multiPool')} label="Several pools"
        hint=${extraPools ? `On while ${s.pools.length} pools exist — remove extras to turn off` : 'Split tips by time window (day · mid · parties)'} />
      <${SwitchRow} icon="clock" on=${s.settings.clock24} onClick=${toggle('clock24')} label="24-hour time" hint="17:00 instead of 5:00p" />
      <${Item} icon="sun" title="Morning starts at" chevron=${false}
        sub=${'A bare ' + (s.settings.amFrom ?? 9) + ' to 11:59 reads as am, anything else as pm. Type a / p on the keypad for any other time.'}>
        <${Seg} value=${s.settings.amFrom ?? 9} onChange=${v => App.setAmFrom(v)}
          items=${[5, 6, 7, 8, 9, 10].map(h => ({ value: h, label: h + 'a' }))} />
      <//>
    <//><//>

    <${Section} title="Data"><${List}>
      <${Item} icon="copy" title="Copy summary as text" sub="For Notes" chevron=${false} onClick=${() => App.copySummary()} />
      <${Item} icon="download" title="Export this session" sub="A .json file" chevron=${false} onClick=${() => App.exportSession()} />
      <${Item} icon="upload" title="Import a session" sub="Adds it and opens it" chevron=${false} onClick=${() => App.triggerImport()} />
    <//><//>
  </div>`;
}

function Settings({ vm }) {
  const v = currentSub('settings');
  return v === 'sessions' ? html`<${Sessions} vm=${vm} />` : v === 'app' ? html`<${AppPrefs} vm=${vm} />` : html`<${Shift} vm=${vm} />`;
}

export function renderSettings(vm, sessions, currentId) {
  sessionsNow = sessions;
  currentNow = currentId;
  const root = $('settings-root');
  if (root) render(html`<${Settings} vm=${vm} />`, root);
}

// ── Sessions ─────────────────────────────────────────────────

let editing = false;

function Sessions({ vm }) {
  const rows = rowsOf(vm, sessionsNow, currentNow);
  const iconBtn = 'grid size-9 place-items-center rounded-full';
  return html`<div class="flex flex-col gap-5">
    <${List}>
      <${Item} icon="plus" title=${html`<span class="text-accent">New session</span>`} chevron=${false} onClick=${() => App.newSession()} />
    <//>
    <${Section} title="Sessions" aside=${(rows.length > 1 || editing) && html`<button class="font-semibold text-accent" onClick=${() => { editing = !editing; App.repaint(); }}>${editing ? 'Done' : 'Edit'}</button>`} footer=${editing ? 'Deleting a session can’t be undone. Export it first to keep a copy.' : 'Tap one to open it.'}><${List}>
      ${rows.map(e => {
        const active = e.id === currentNow;
        const lead = html`<${DateTile} iso=${e.date} active=${active} />`;
        const sub = [e.name ? dayLabel(e.date) : '', peopleOf(e.people)].filter(Boolean).join(' · ');
        return editing
          ? html`<${Item} key=${e.id} lead=${lead} title=${html`<span class="truncate">${titleOf(e)}</span>`} sub=${sub} tone=${active ? 'active' : ''}
              trail=${html`<span class="flex shrink-0 gap-1.5">
                <button class=${cx(iconBtn, 'bg-surface-2 text-ink-2 active:opacity-70')} onClick=${() => App.renameSession(e.id)} aria-label="Rename"><${Icon} name="pencil" class="size-4" /></button>
                <button class=${cx(iconBtn, 'bg-bad/12 text-bad active:opacity-70')} onClick=${() => App.deleteSession(e.id)} aria-label="Delete"><${Icon} name="trash" class="size-4" /></button>
              </span>`} />`
          : html`<${Item} key=${e.id} lead=${lead} title=${html`<span class="truncate">${titleOf(e)}</span>`} sub=${sub} tone=${active ? 'active' : ''}
              chevron=${false} onClick=${() => App.switchSession(e.id)} aria-current=${active ? 'true' : 'false'}
              value=${e.total > 0 ? fmtMoney(e.total) : '—'} valueTone=${e.total > 0 ? 'text-ink' : 'text-ink-3'} />`;
      })}
    <//><//>
  </div>`;
}

// ── This shift ───────────────────────────────────────────────────

let calY = 0, calM = 0;           // month shown in the calendar

function showMonthOf(iso) {
  const d = parseISO(iso) || new Date();
  calY = d.getFullYear();
  calM = d.getMonth();
}

function calendarStep(delta) {
  if (delta === 0) showMonthOf(todayISO());
  else {
    calM += delta;
    if (calM < 0) { calM = 11; calY -= 1; }
    if (calM > 11) { calM = 0; calY += 1; }
  }
  App.repaint();
}

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

// Shift times as keypad / wheel cells: Open → Close, then each role's In →
// Out. Next walks that order; ↓ / ↑ move down / up the same column.
const ROLES3 = ['bartender', 'server', 'support'];
const ROLE_NAME = { bartender: 'Bar', server: 'Server', support: 'Support' };
const tap = k => focusCell(k);
function order() {
  return ROLES3.map(r => ['r:' + r + ':in', 'r:' + r + ':out']);
}
function navFrom(k) {
  const rows = order();
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
function DefCell({ k, title, raw, fallback, field, inAbs, write }) {
  const v = parsed(raw) ?? parsed(fallback);
  const isIn = field === 'in';
  const abs = v == null ? null : isIn ? inAbsOf(v) : afterAbsOf(v, inAbs ?? 17);
  return html`<${KeyTime} k=${k} title=${title} abs=${abs} set=${!!String(raw || '').trim()} cls=${CELLCLS}
    toAbs=${(x, mer) => (isIn ? inAbsOf({ value: x, mer }) : afterAbsOf({ value: x, mer }, inAbs ?? 17))}
    fromAbs=${a => (isIn ? absToInRaw(Math.min(IN_MAX_ABS, Math.max(IN_MIN_ABS, a))) : absToOutRaw(a, inAbs ?? 17))}
    min=${isIn ? IN_MIN_ABS : (inAbs ?? 17) + 0.25} max=${isIn ? IN_MAX_ABS : (inAbs ?? 17) + 12}
    write=${write} next=${navFrom(k)} rerender=${() => App.repaint()} clearable />`;
}

function Shift({ vm }) {
  const s = vm.state;
  const entry = sessionsNow.find(e => e.id === currentNow) || {};
  const sessionDates = new Set(sessionsNow.filter(e => e.id !== currentNow).map(e => e.date));
  if (calFor !== s.meta.date) { calFor = s.meta.date; showMonthOf(calFor); }
  return html`<div class="flex flex-col gap-6">
    <${Field} page label="Session name" value=${entry.name || ''} placeholder="e.g. Brunch, Private party" maxlength="40" enterkeyhint="done"
      onChange=${e => App.renameCurrent(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
    <${Section} title="Date"><${Calendar} selected=${s.meta.date} sessionDates=${sessionDates} /><//>
    <${Section} title="This session"><${List}>
      <${Item} icon="download" title="Export JSON" chevron=${false} onClick=${() => App.exportSession()} />
      <${Item} icon="trash" tone="danger" title="Delete session" chevron=${false} onClick=${() => App.deleteSession(currentNow)} />
    <//><//>
  </div>`;
}
let calFor = null;

// ── Default times per role (Staff › Defaults, roles on) ──────────────────────
// Role times win over the shift's open / close for that role. Tap a time to
// type it, hold for the wheel; Clear puts it back to the shift's.
export function RoleTimes({ vm }) {
  const s = vm.state;
  const d = s.defaults;
  if (!s.settings.allRoles) return null;
  const day = (s.meta.shiftType || 'night') === 'day';
  return html`<${Section} title="Per role" footer=${'Role times win over the shift’s open / close for that role. Remembered for the next ' + (day ? 'day' : 'night') + ' shift.' + (day ? ' Servers’ Out is where Day hands over to Mid (unless a server stays later).' : '')}>
    <${Card}>
      <div class="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-x-3 gap-y-2.5">
        <span></span><span class="t-small text-center font-medium text-ink-2">In</span><span class="t-small text-center font-medium text-ink-2">Out</span>
        ${ROLES3.map(r => {
          const rin = parsed(d.byRole[r].in) ?? parsed(d.global.in);
          return html`
          <span key=${r + 'l'} class=${cx('t-body font-semibold', ROLE_TEXT[r])}>${ROLE_NAME[r]}</span>
          <${DefCell} key=${r + 'in'} k=${'r:' + r + ':in'} title=${ROLE_NAME[r] + ' in'} raw=${d.byRole[r].in} fallback=${d.global.in} field="in"
            write=${v => App.roleDefault(r, 'in', v, true)} />
          <${DefCell} key=${r + 'out'} k=${'r:' + r + ':out'} title=${ROLE_NAME[r] + ' out'} raw=${d.byRole[r].out} fallback=${d.global.out} field="out"
            inAbs=${rin != null ? inAbsOf(rin) : null} write=${v => App.roleDefault(r, 'out', v, true)} />`;
        })}
      </div>
    <//>
  <//>`;
}

// The support tip-out % every pool starts from (Tips › Pools, roles on).
export function SupportDefault({ vm }) {
  if (!vm.state.settings.allRoles) return null;
  return html`<${Section} title="Support tip-out" footer="Each pool can override % or $/hr below.">
    <${Card}>
      <${Field} label="% of each pool" inputmode="decimal" placeholder="10" value=${vm.state.defaults.supportPct ?? ''} onInput=${e => App.supportDefault(e.target.value)} />
    <//>
  <//>`;
}
