// Staff (Preact) — for entering who worked and when. Two sub-tabs (the
// header):
//   People   one list: Name · In · Out · Hrs per person (In / Out are boxes —
//            tap → keypad, whose Next walks every time in order; hold → the
//            wheel; Undo in the toast), and as its last row an "Add a name"
//            field: type a name and Return, the field stays ready for the
//            next (a pasted list adds them all). Saved names not on shift are
//            chips under it. Tap a name for the person's drawer: name, role,
//            break, closer, remove.
//   Shift    the shift's Open / Close, per-role times, the close-time what-if.
//
// Times are written as the same raw strings typing would store, '' when they
// equal the default (resolve.js does the rest).

import { ROLES } from '../store.js';
import { fmtHrs, fmtMoney } from '../util.js';
import { parseTime, fmtTimeAbs, fmtClockShort, inAbsOf, afterAbsOf, absToInRaw, absToOutRaw, absToEdgeRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { getRoster } from '../roster.js';
import { html, render, useState } from '../ui/preact.js';
import { cx, Icon, Button, Alert, Seg, SwitchRow, List, Item, Section, NextStep, INPUT_PAGE, ROLE_DOT, ROLE_TINT, ROLE_PLURAL, Sentinel, THEAD, Avatar, hueIndex } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';
import { DragTime } from '../ui/dragtime.js';
import { openKeypad, activeKey, bufferAbs } from '../ui/keypad.js';
import { RoleTimes } from './settings.js';
import { timeMoved, defaultMoved, hoursMoved } from '../ui/changes.js';

export { DragTime };

const $ = id => document.getElementById(id);
const ROLE_SHORT = { bartender: 'Bar', server: 'Server', support: 'Support' };
const named = p => !!p.name.trim();

// ── Times ────────────────────────────────────────────────────────────────────

function roleDefaults(state, role) {
  const r = state.defaults.byRole[role] || {};
  return { in: r.in || state.defaults.global.in || '', out: r.out || state.defaults.global.out || '' };
}

// In / Out on the absolute axis for a person, their worked hours (less the
// break) and flags.
function times(state, person, vm) {
  const def = roleDefaults(state, person.role);
  const res = vm?.resolved?.staff.find(p => p.id === person.id);
  const inP = parseTime(person.in.trim() || def.in);
  const outP = parseTime(person.out.trim() || def.out);
  const inAbs = res?.inAbs ?? (inP.value != null ? inAbsOf(inP) : null);
  const outAbs = res?.outAbs ?? (outP.value != null && inAbs != null ? afterAbsOf(outP, inAbs) : null);
  const bad = !inP.valid || !outP.valid;
  const span = inAbs != null && outAbs != null && outAbs > inAbs && outAbs - inAbs <= 12 ? outAbs - inAbs : null;
  const brk = res?.brkLen ?? 0;
  return {
    def, inAbs, outAbs, bad, span, brk, brkStart: res?.brkStart ?? null,
    hrs: span != null ? Math.max(0, span - brk) : null,
    inSet: !!person.in.trim(), outSet: !!person.out.trim(),
    closer: !!res?.closer, forced: !!person.closerOverride,
  };
}

// Absolute time → the raw string to store for a person: '' when it's the
// default's time (so it keeps inheriting), else exact (a meridiem is added
// when the bare reading would read back differently — any time works).
function inRaw(abs, def) {
  const d = parseTime(def.in);
  if (d.value != null && inAbsOf(d) === abs) return '';
  return absToInRaw(Math.min(IN_MAX_ABS, Math.max(IN_MIN_ABS, abs)));
}
function outRaw(abs, def, inAbs) {
  const d = parseTime(def.out);
  if (d.value != null && inAbs != null && afterAbsOf(d, inAbs) === abs) return '';
  return absToOutRaw(abs, inAbs);
}
function rawAt(vm, p, field, abs) {
  const def = roleDefaults(vm.state, p.role);
  return field === 'in' ? inRaw(abs, def) : outRaw(abs, def, times(vm.state, p, vm).inAbs);
}

// "30m" · "1h" · "1h 15m"
export function fmtBreak(h) {
  const m = Math.round(h * 60), hh = Math.floor(m / 60), mm = m % 60;
  return (hh ? hh + 'h' : '') + (hh && mm ? ' ' : '') + (mm ? mm + 'm' : '');
}

// Everyone in page order: by role (bartenders → servers → support) with roles
// on, else as entered. Only named people.
function groups(state) {
  const people = state.staff.filter(named);
  if (!state.settings.allRoles) return [{ role: null, people }];
  return ROLES.map(role => ({ role, people: people.filter(p => p.role === role) })).filter(g => g.people.length);
}
const ordered = state => groups(state).flatMap(g => g.people);

// The night on one axis: from the earliest In (on the hour) to the later of
// the close and the last Out.
export function nightSpan(vm) {
  const rs = vm.resolved?.staff || [];
  const ins = rs.map(p => p.inAbs).filter(v => v != null);
  const outs = rs.map(p => p.outAbs).filter(v => v != null);
  const close = vm.resolved?.closeAbs ?? null;
  if (!ins.length) return null;
  const a = Math.floor(Math.min(...ins));
  const b = Math.ceil(Math.max(...outs, close ?? -Infinity, a + 1));
  return b > a && b - a <= 16 ? { a, b, close } : null;
}

const person = id => lastVm?.state.staff.find(x => x.id === id);
const rerender = () => { if (lastVm) renderStaff(lastVm); };

// ── Typing a time: the keypad (ui/keypad.js) ───────────────────────────────
// Tap any time (a Staff card in Edit times, the person's drawer, Summary's
// rows) → the time keypad docks at the bottom: type 5, 530, 1045 …, a / p
// pins the meridiem, Default puts it back, Next / ← / ↓ / ↑ walk the people
// (In → Out → the next person's In). Each key previews what it would do
// (Summary, the HUD); leaving the cell writes it (Undo · Apply). Hold a time
// for the wheel instead.

// A typed reading (+ an explicit 'a' / 'p') → absolute time for this person
// (In: that time, or the am/pm rule; Out: the next such time after their In).
function absFor(vm, p, field, v, mer = null) {
  const parsed = { value: v, mer };
  if (field === 'in') return inAbsOf(parsed);
  return afterAbsOf(parsed, times(vm.state, p, vm).inAbs ?? 17);
}
// Repaint what shows the active cell (the keypad's buffer) when no preview does.
const repaint = () => App.repaint();

export function openTimeCell(id, field) {
  const p0 = person(id);
  if (!p0) return false;
  const label = f => (person(id)?.name.trim() || 'Person') + ' · ' + (f === 'in' ? 'In' : 'Out');
  openKeypad({
    key: id + ':' + field,
    title: label(field),
    current: () => { const p = person(id), t = p && times(lastVm.state, p, lastVm); return t ? (field === 'in' ? t.inAbs : t.outAbs) : null; },
    toAbs: (v, mer) => absFor(lastVm, person(id), field, v, mer),
    commit: (v, mer) => {
      const p = person(id);
      const abs = absFor(lastVm, p, field, v, mer);
      App.reviewed(label(field) + ' ' + fmtTimeAbs(abs), () => App.staffField(id, field, rawAt(lastVm, p, field, abs), true));
    },
    onClear: () => App.staffField(id, field, '', true),
    onMore: () => App.editStaff(id),
    nav: dir => moveFrom(id, field, dir),
    onChange: () => {
      const a = bufferAbs(), p = person(id);
      App.previewStaff(id, field, a == null || !p ? null : rawAt(lastVm, p, field, a));
      if (a == null) repaint();
    },
  });
  return true;
}
// Next / ← walk In → Out → the next person's In (and back); ↓ / ↑ stay in
// the column. The page order (by role with roles on).
function moveFrom(id, field, dir) {
  const rows = ordered(lastVm.state);
  const i = rows.findIndex(p => p.id === id);
  let r = i, f = field;
  if (dir === 'next') { if (field === 'in') f = 'out'; else { f = 'in'; r = i + 1; } }
  else if (dir === 'prev') { if (field === 'out') f = 'in'; else { f = 'out'; r = i - 1; } }
  else r = i + (dir === 'down' ? 1 : -1);
  const n = rows[r];
  if (!n) return false;
  return openTimeCell(n.id, f);
}
// DragTime props that make a person's time a keypad cell.
function keyCell(p, field) {
  const key = p.id + ':' + field;
  const active = activeKey() === key;
  return { kcell: key, active, preview: active ? bufferAbs() : null, onTap: () => openTimeCell(p.id, field) };
}

// The shift's open / close on the keypad (the close moves every closer).
function openShiftCell(field) {
  const vm = lastVm;
  if (!vm) return;
  const open = () => { const gi = parseTime(lastVm.state.defaults.global.in); return gi.value != null ? inAbsOf(gi) : lastVm.resolved?.anchorAbs ?? 17; };
  const isIn = field === 'in';
  const toAbs = (v, mer) => (isIn ? inAbsOf({ value: v, mer }) : afterAbsOf({ value: v, mer }, open()));
  const raw = a => (isIn ? absToInRaw(a) : absToOutRaw(a, open()));
  openKeypad({
    key: 'shift:' + field,
    title: isIn ? 'Shift open' : 'Close time',
    current: () => {
      const g = parseTime(lastVm.state.defaults.global[field]);
      return g.value == null ? null : isIn ? inAbsOf(g) : afterAbsOf(g, open());
    },
    toAbs,
    commit: (v, mer) => { const a = toAbs(v, mer); App.reviewed((isIn ? 'Open ' : 'Close ') + fmtTimeAbs(a), () => App.globalDefault(field, raw(a), true)); },
    onClear: null,
    onChange: () => { const a = bufferAbs(); App.previewDefault(field, a == null ? null : raw(a)); if (a == null) repaint(); },
  });
}
function shiftCell(field) {
  const key = 'shift:' + field;
  const active = activeKey() === key;
  return { kcell: key, active, preview: active ? bufferAbs() : null, onTap: () => openShiftCell(field) };
}

// ── Warnings (only when something needs a look) ─────────────────────────────
function Note({ vm }) {
  const warnings = [];
  if (vm.inputError && vm.blockedTab === 'staff') warnings.push(vm.blocked);
  const closeAbs = vm.resolved.closeAbs;
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) warnings.push(p.name + ' is out after the close time');
    });
  }
  return warnings.map(w => html`<${Alert} key=${w} tone="warn">${w}<//>`);
}

// ── The close time ───────────────────────────────────────────────────────────
// The shift's close (defaults.global.out): closers and anyone without an Out
// of their own end then. Tap → the keypad, hold → the wheel.
export function CloseTime({ vm, cls, tone, mins = false, full = false, bare = false }) {
  const g = vm.state.defaults.global;
  const gi = parseTime(g.in), go = parseTime(g.out);
  const open = gi.value != null ? inAbsOf(gi) : vm.resolved?.anchorAbs ?? 17;
  const abs = go.value != null ? afterAbsOf(go, open) : null;
  return html`<${DragTime} abs=${abs} set=${true} ...${shiftCell('out')}
    min=${open + 0.25} max=${open + 12}
    onSet=${a => App.reviewed('Close ' + fmtTimeAbs(a), () => App.globalDefault('out', absToOutRaw(a, open), true))}
    onPreview=${a => App.previewDefault('out', a == null ? null : absToOutRaw(a, open))}
    cls=${cls} tone=${tone} mins=${mins} full=${full} bare=${bare} moved=${defaultMoved(vm, 'out')} label="Close time" />`;
}

// Hour labels for a time axis (Home's Shift view).
export function AxisLabels({ span }) {
  if (!span) return null;
  const W = span.b - span.a, step = W > 8 ? 3 : W > 5 ? 2 : 1;
  const marks = [];
  for (let h = span.a; h <= span.b; h += step) marks.push(h);
  if (span.b - marks[marks.length - 1] >= step) marks.push(span.b);
  return html`<div class="relative h-4" aria-hidden="true">
    ${marks.map((h, i) => html`<span key=${h} class=${cx('t-small absolute top-0 text-[0.6875rem] tabular-nums text-ink-3',
        i === 0 ? '' : h === span.b ? '-translate-x-full' : '-translate-x-1/2')}
      style=${{ left: ((h - span.a) / W) * 100 + '%' }}>${fmtClockShort(h)}</span>`)}
  </div>`;
}

// ── The list ─────────────────────────────────────────────────────────────────
// Name · In · → · Out · Hrs
const COLS = 'grid grid-cols-[minmax(0,1fr)_3.75rem_0.625rem_3.75rem_2rem] items-center gap-x-2';
const BOX = 'h-11 w-full rounded-lg bg-surface-2 text-[1rem] tabular-nums transition';
const TONE = set => (set ? 'font-semibold text-ink' : 'font-normal text-ink-3');

function TimeBox({ vm, p, field, cls = BOX, mins = false, bare = false, tone = null }) {
  const t = times(vm.state, p, vm);
  const k = pickerFor(vm, p, field);
  const set = field === 'in' ? t.inSet : t.outSet;
  return html`<${DragTime} abs=${field === 'in' ? t.inAbs : t.outAbs} set=${set} bad=${t.bad} ...${keyCell(p, field)}
    min=${k.min} max=${k.max} onSet=${k.onSet} onPreview=${k.onPreview} wheelSub=${k.wheelSub} mins=${mins} bare=${bare}
    cls=${cls} tone=${tone ? tone(set) : TONE(set)} moved=${timeMoved(vm, p.id, field)} label=${p.name + ' ' + field + ' time'} />`;
}
// The same keypad / wheel cell for another page (Home › Pay's table): one key
// per person and field, so the keypad's Next walks the same order.
export const TimeCell = TimeBox;

function Head() {
  const cap = 't-cap text-ink-3';
  return html`<${Sentinel} /><div class=${cx(THEAD, 'li px-4 py-2')} style=${{ '--inset': '0' }}>
    <div class=${COLS}>
      <span class=${cx(cap, 'pl-[2.625rem]')}>Name</span>
      <span class=${cx(cap, 'text-center')}>In</span><span></span><span class=${cx(cap, 'text-center')}>Out</span>
      <span class=${cx(cap, 'text-right')}>Hrs</span>
    </div>
  </div>`;
}

function PersonRow({ vm, p, allClose }) {
  const t = times(vm.state, p, vm);
  // An auto closer is only worth a mark while not everyone is one.
  const closer = t.forced || (t.closer && !allClose);
  const sub = [
    t.bad ? 'Check the times' : '',
    t.brk > 0 ? fmtBreak(t.brk) + ' break' : '',
  ].filter(Boolean).join(' · ');
  return html`<div class=${cx('li px-4 py-1.5', COLS)}>
    <button class="flex min-h-11 min-w-0 items-center gap-2.5 text-left active:opacity-60" onClick=${() => App.editStaff(p.id)} aria-label=${'Edit ' + p.name}>
      <${Avatar} name=${p.name} i=${hueIndex(vm.state, p.id)} closer=${closer} forced=${t.forced} size="sm" />
      <span class="flex min-w-0 flex-col">
        <span class="t-body truncate">${p.name}</span>
        ${sub && html`<span class=${cx('t-small truncate', t.bad ? 'text-bad' : 'text-ink-3')}>${sub}</span>`}
      </span>
    </button>
    <${TimeBox} vm=${vm} p=${p} field="in" /><span class="text-center text-[0.6875rem] text-ink-3/70">→</span><${TimeBox} vm=${vm} p=${p} field="out" />
    <span class=${cx('t-body rounded-md text-right font-semibold tabular-nums', hoursMoved(vm, p.id) && 'live-changed', t.hrs == null ? 'text-bad' : p.role === 'support' ? 'text-ink-3' : 'text-ink')}>${t.hrs != null ? fmtHrs(t.hrs) : '?'}</span>
  </div>`;
}

// ── Adding people: the list's last row ───────────────────────────────────────
// Type a name and Return — it's added and the field stays ready for the next;
// a comma ends a name too; a pasted list (lines / commas) adds them all, in
// order. With roles on, the chip beside the field says which role they come
// in as (tap to change). Saved names not on shift are chips under it,
// narrowed by what's typed: tap one to add it.
let addRole = 'bartender';
let draft = '';
let forgetting = false;
const onShiftSet = state => new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));
const splitNames = text => String(text).split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean);
const addAll = names => { if (names.length) App.addPeople(names.map(n => ({ name: n, role: addRole }))); };
// A chip tapped while typing puts the cursor back in the add field (so the
// keyboard stays up); tapped otherwise, it doesn't bring the keyboard up.
let leftField = 0;
const backToField = () => { if (Date.now() - leftField < 600) document.querySelector('[data-addnames]')?.focus(); };
const keepFocus = e => e.preventDefault();      // mouse only: touch taps must not be cancelled

// Staff › People with the cursor in the add field.
export function startAdding() {
  App.tab('staff', { sub: 'people' });
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-addnames]');
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  });
}

function AddRow({ vm }) {
  const rolesOn = vm.state.settings.allRoles;
  if (!rolesOn) addRole = 'bartender';
  const next = { bartender: 'server', server: 'support', support: 'bartender' };
  return html`<div class="li flex items-center gap-2.5 px-4 py-1.5" data-addbox>
    <span class="grid size-8 shrink-0 place-items-center rounded-full bg-accent/12 text-accent"><${Icon} name="plus" class="size-[1.125rem]" /></span>
    <input data-addnames class="h-11 min-w-0 flex-1 bg-transparent text-[1rem] text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
      placeholder="Add a name" aria-label="Add a name" value=${draft} onBlur=${() => { leftField = Date.now(); }}
      autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="next"
      onKeyDown=${e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        addAll(splitNames(e.target.value));
        draft = '';
        e.target.value = '';
        rerender();
      }}
      onInput=${e => {
        const v = e.target.value;
        if (/[,;\n]/.test(v)) {            // a comma ends a name
          const parts = v.split(/[\n,;]+/);
          const rest = parts.pop();
          addAll(parts.map(x => x.trim()).filter(Boolean));
          e.target.value = rest.trimStart();
        }
        draft = e.target.value;
        rerender();
      }}
      onPaste=${e => {
        const text = e.clipboardData?.getData('text') || '';
        if (!/[\n,;\t]/.test(text.trim())) return;
        e.preventDefault();
        addAll(splitNames(e.target.value + text));
        draft = '';
        e.target.value = '';
        rerender();
      }} />
    ${rolesOn && html`<button class=${cx('t-small inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 font-semibold transition active:scale-95', ROLE_TINT[addRole])}
      onMouseDown=${keepFocus} onClick=${() => { addRole = next[addRole]; rerender(); backToField(); }} aria-label=${'Adds as ' + ROLE_SHORT[addRole] + ' — tap to change'}>
      <span class=${cx('size-2 rounded-full', ROLE_DOT[addRole])}></span>${ROLE_SHORT[addRole]}</button>`}
  </div>`;
}

function SavedNames({ vm }) {
  const rolesOn = vm.state.settings.allRoles;
  const onShift = onShiftSet(vm.state);
  const q = draft.trim().toLowerCase();
  const saved = getRoster().filter(r => !onShift.has(r.name.toLowerCase()) && (!q || r.name.toLowerCase().includes(q)));
  if (!saved.length) return null;
  const chip = 't-small inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 font-semibold transition active:scale-95';
  return html`<${Section} title="Saved names" aside=${html`<button class="font-semibold text-accent" onClick=${() => { forgetting = !forgetting; rerender(); }}>${forgetting ? 'Done' : 'Edit'}</button>`}>
    <div class="flex flex-wrap gap-1.5">
      ${saved.map(r => html`<button key=${r.name} class=${cx(chip, forgetting ? 'bg-bad/12 text-bad' : 'bg-surface text-ink')} onMouseDown=${keepFocus}
        onClick=${() => {
          if (forgetting) { App.forgetName(r.name); return; }
          App.addPeople([{ name: r.name, role: rolesOn ? r.role : 'bartender' }]);
          if (q) { draft = ''; const el = document.querySelector('[data-addnames]'); if (el) el.value = ''; }
          backToField();
        }}>
        ${forgetting ? html`<${Icon} name="x" class="size-3.5" />` : html`<${Icon} name="plus" class="size-3.5 text-ink-3" />`}
        ${rolesOn && !forgetting && html`<span class=${cx('size-1.5 rounded-full', ROLE_DOT[r.role])}></span>`}${r.name}</button>`)}
    </div>
  <//>`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

function People({ vm }) {
  const state = vm.state;
  const people = state.staff.filter(named);
  const gs = groups(state);
  const tipped = vm.resolved.staff.filter(p => p.role !== 'support');
  const allClose = tipped.length > 1 && tipped.every(p => p.closer && !p.closerOverride);
  // Staff is done once everyone named has valid times (no staff-side error).
  const done = people.length > 0 && vm.blockedTab !== 'staff';
  const hours = done && vm.resolved.staff.filter(p => p.role !== 'support').reduce((t, p) => t + p.hours, 0);
  return html`<div class="flex flex-col gap-5">
    <${Note} vm=${vm} />
    <${List}>
      ${people.length > 0 && html`<${Head} />`}
      ${gs.map(g => html`
        ${g.role && gs.length > 1 && html`<div key=${'h-' + g.role} class="li t-cap flex items-center gap-2 px-4 pb-1 pt-2.5 text-ink-3" style=${{ '--inset': '1rem' }}>
          <span class=${cx('size-2 rounded-full', ROLE_DOT[g.role])}></span>${ROLE_PLURAL[g.role]}<span class="text-ink-3/70">${g.people.length}</span></div>`}
        ${g.people.map(p => html`<${PersonRow} key=${p.id} vm=${vm} p=${p} allClose=${allClose} />`)}`)}
      <${AddRow} vm=${vm} />
    <//>
    <${StaffDefaults} vm=${vm} />
    <${SavedNames} vm=${vm} />
    ${done && (vm.totalCash > 0 && !vm.blocked
      ? html`<${NextStep} tab="home" label="See who gets what" sub=${fmtMoney(vm.totalCash) + ' over ' + fmtHrs(hours) + ' hours'} />`
      : html`<${NextStep} tab="tips" label="Next: enter the tips" sub=${people.length + ' on shift · ' + fmtHrs(hours) + ' hours'} />`)}
  </div>`;
}

// ── Shift: the open / close, per-role times, the close-time what-if. ─────────
function ShiftTimes({ vm }) {
  const cell = 'h-11 w-[4.5rem] rounded-lg bg-surface-2 text-[1rem] tabular-nums transition';
  return html`<${List}>
    <div class="li flex min-h-12 items-center justify-between gap-3 px-4 py-1.5">
      <span class="t-body">Open</span>
      <${DefaultTime} vm=${vm} field="in" cls=${cell} tone="font-semibold text-ink" />
    </div>
    <div class="li flex min-h-12 items-center justify-between gap-3 px-4 py-1.5">
      <span class="t-body flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-bad"></span>Close</span>
      <${CloseTime} vm=${vm} cls=${cell} tone="font-semibold text-ink" />
    </div>
  <//>`;
}

export function ShiftDefaults({ vm }) {
  return html`<div class="flex flex-col gap-5">
    <${Section} title="Shift" footer="Anyone without a time of their own starts at the open. Closers, and anyone without an Out, leave at the close.">
      <${ShiftTimes} vm=${vm} />
    <//>
    <${RoleTimes} vm=${vm} />
    <${List}>
      <${Item} icon="clock" title="Close-time what-if" disabled=${!(vm.totalCash > 0 && !vm.blocked)}
        sub=${vm.totalCash > 0 && !vm.blocked ? 'Everyone’s take-home at other close times' : 'Enter the tips first'} onClick=${() => App.openCloseTime()} />
    <//>
  </div>`;
}

function StaffDefaults({ vm }) {
  const [open, setOpen] = useState(false);
  const time = abs => abs == null ? '—' : fmtTimeAbs(abs);
  const g = vm.state.defaults.global;
  const start = parseTime(g.in), end = parseTime(g.out);
  const startAbs = start.value == null ? null : inAbsOf(start);
  const endAbs = end.value == null ? null : afterAbsOf(end, startAbs ?? 17);
  return html`<div class="flex flex-col gap-3">
    <${List}><${Item} icon="clock" title="Default times" sub="Used when a person has no time of their own"
      value=${time(startAbs) + ' – ' + time(endAbs)} valueTone="text-ink-3" aria-expanded=${String(open)}
      onClick=${() => setOpen(!open)} /><//>
    ${open && html`<${ShiftDefaults} vm=${vm} />`}
  </div>`;
}

function Staff({ vm }) {
  return html`<${People} vm=${vm} />`;
}

// ── A person's drawer ────────────────────────────────────────────────────────
// Name, role, In → Out (tap a time for the wheel; "Default" puts it back),
// the break (how long; when it began, or not placed), closer, remove.

let editId = null;
let lastVm = null;
onSheetClose('sheet-staff', () => { editId = null; });

export function openStaffEditor(id, { focusName = false } = {}) {
  editId = id;
  openSheet('sheet-staff');
  if (lastVm) renderEditor(lastVm);
  if (focusName) sheetBody('sheet-staff')?.querySelector('input[aria-label="Name"]')?.focus();
}

// Props for a person's In or Out time box (and the wheel's hours beside each
// value). A wheel write waits for Undo · Apply in the HUD (App.reviewed).
function pickerFor(vm, p, field) {
  const t = times(vm.state, p, vm);
  const def = t.def;
  const set = raw => App.staffField(p.id, field, raw, true);
  const hrsAt = h => (h > 0 ? fmtHrs(Math.max(0, h - t.brk)) + 'h' : '');
  const said = abs => (p.name.trim() || 'New person') + ' · ' + (field === 'in' ? 'In ' : 'Out ') + fmtTimeAbs(abs);
  if (field === 'in') {
    const dp = parseTime(def.in);
    return { abs: t.inAbs, isSet: t.inSet, defAbs: dp.value != null ? inAbsOf(dp) : null,
      min: IN_MIN_ABS, max: IN_MAX_ABS, onSet: abs => App.reviewed(said(abs), () => set(inRaw(abs, def))), onReset: () => set(''),
      onPreview: abs => App.previewStaff(p.id, field, abs == null ? null : inRaw(abs, def)),
      wheelSub: abs => (t.outAbs != null ? hrsAt(t.outAbs - abs) : '') };
  }
  const dp = parseTime(def.out);
  return { abs: t.outAbs, isSet: t.outSet, defAbs: dp.value != null && t.inAbs != null ? afterAbsOf(dp, t.inAbs) : null,
    min: (t.inAbs ?? 17) + 0.25, max: (t.inAbs ?? 17) + 12, onSet: abs => App.reviewed(said(abs), () => set(outRaw(abs, def, t.inAbs))), onReset: () => set(''),
    onPreview: abs => App.previewStaff(p.id, field, abs == null ? null : outRaw(abs, def, t.inAbs)),
    wheelSub: abs => (t.inAbs != null ? hrsAt(abs - t.inAbs) : '') };
}

const BREAKS = [0.25, 0.5, 0.75, 1, 1.5];

function BreakField({ vm, p }) {
  const t = times(vm.state, p, vm);
  const len = t.brk || (parseFloat(p.brk) || 0);
  const several = vm.state.pools.length > 1;
  const setLen = v => App.reviewed((p.name.trim() || 'Person') + ' · ' + (v ? fmtBreak(v) + ' break' : 'no break'), () => {
    App.staffField(p.id, 'brk', v ? String(v) : '', true);
    if (!v) App.staffField(p.id, 'brkAt', '', true);
  });
  const placed = t.brkStart != null;
  const canPlace = len > 0 && t.inAbs != null && t.span != null && t.span > len;
  const placeAt = abs => App.staffField(p.id, 'brkAt', absToEdgeRaw(abs, t.inAbs), true);
  const chip = (on, label, onClick) => html`<button class=${cx('t-small h-9 shrink-0 rounded-full px-3 font-semibold tabular-nums transition active:scale-95',
    on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2')} aria-pressed=${String(on)} onClick=${onClick}>${label}</button>`;
  return html`<div class="flex flex-col gap-3 rounded-card bg-surface p-3.5">
    <div class="flex items-center justify-between">
      <span class="t-body">Break</span>
      <span class="t-small text-ink-3">${len > 0 ? 'Off their hours' : 'None'}</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      ${chip(!len, 'None', () => setLen(0))}
      ${BREAKS.map(v => html`<span key=${v} class="contents">${chip(Math.abs(len - v) < 0.01, fmtBreak(v), () => setLen(v))}</span>`)}
    </div>
    ${len > 0 && html`<div class="flex items-center gap-3 border-t border-line pt-3">
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="t-small font-semibold text-ink-2">When</span>
        <span class="t-small text-ink-3">${placed
          ? (several ? 'Comes off the pool it falls in' : 'From ' + fmtClockShort(t.brkStart) + ' to ' + fmtClockShort(t.brkStart + len))
          : (several ? 'Not set — comes off each pool in proportion' : 'Not set — only the length counts')}</span>
      </span>
      ${placed
        ? html`<${DragTime} abs=${t.brkStart} set=${true} tapWheel min=${t.inAbs} max=${t.outAbs - len}
            onSet=${placeAt} cls="h-10 min-w-[4.5rem] rounded-lg bg-surface-2 px-2 text-[1rem] tabular-nums transition" tone="font-semibold text-ink" label="Break start" />
          <button class="t-small h-10 px-1 font-semibold text-accent" onClick=${() => App.staffField(p.id, 'brkAt', '', true)}>Clear</button>`
        : canPlace && html`<${Button} size="sm" variant="tonal" icon="clock"
            onClick=${() => placeAt(Math.round((t.inAbs + (t.span - len) / 2) * 4) / 4)}>Set time<//>`}
    </div>`}
  </div>`;
}

function Editor({ vm, p }) {
  const state = vm.state;
  const t = times(state, p, vm);
  const share = vm.shares?.perPerson.find(x => x.id === p.id);
  const line = [
    t.inAbs != null && t.outAbs != null ? fmtClockShort(t.inAbs) + ' – ' + fmtClockShort(t.outAbs) : '',
    t.hrs != null ? fmtHrs(t.hrs) + ' hours' : 'Check the times',
    share && vm.totalCash > 0 && !vm.blocked ? 'takes home $' + share.final : '',
  ].filter(Boolean).join(' · ');
  return html`
    <input class=${cx(INPUT_PAGE, 'h-12 text-[1.25rem] font-semibold')} value=${p.name} placeholder="Name"
      autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="done" aria-label="Name"
      onInput=${e => App.staffField(p.id, 'name', e.target.value)} onChange=${() => App.rememberStaff(p.id)}
      onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
    <p class="t-small px-1 text-ink-3">${line}</p>
    ${state.settings.allRoles && html`<${Seg} value=${p.role} onChange=${r => App.staffField(p.id, 'role', r, true)}
      items=${ROLES.map(r => ({ value: r, label: ROLE_SHORT[r] }))} />`}
    <${BreakField} vm=${vm} p=${p} />
    <${List}>
      <${SwitchRow} on=${t.forced} onClick=${() => App.toggleCloser(p.id)} label="Closer"
        hint=${t.forced ? 'Forced — shares the closer bonus' : t.closer ? 'Auto: out at the close time' : 'Shares the dollars left after rounding'} />
    <//>
    <${Button} variant="danger" block icon="trash" onClick=${() => App.reviewed('Removed ' + (p.name.trim() || 'person'), () => App.removePerson(p.id))}>Remove<//>`;
}

function renderEditor(vm) {
  if (!editId || !isOpen('sheet-staff')) return;
  const p = vm.state.staff.find(x => x.id === editId);
  if (!p) { closeSheet('sheet-staff'); return; }
  setSheetTitle('sheet-staff', p.name.trim() || 'New person');
  render(html`<${Editor} vm=${vm} p=${p} />`, sheetBody('sheet-staff'));
}

// ── Elsewhere: a person's In / Out (Summary rows, the Person sheet) and the
//    shift's open / close (Summary's Total row) — tap for the keypad, hold
//    for the wheel. ────────────────────────────────────────────────────────

export function StaffTime({ vm, id, field, cls, tone, full, mins, bare, alt }) {
  const p = vm.state.staff.find(x => x.id === id);
  if (!p) return null;
  const t = times(vm.state, p, vm);
  const k = pickerFor(vm, p, field);
  return html`<${DragTime} abs=${k.abs} set=${k.isSet} bad=${t.bad} ...${keyCell(p, field)}
    min=${k.min} max=${k.max} onSet=${k.onSet} onPreview=${k.onPreview} wheelSub=${k.wheelSub} cls=${cls} tone=${tone} full=${full} mins=${mins} bare=${bare} alt=${alt}
    label=${p.name + ' ' + field + ' time'} />`;
}

export function DefaultTime({ vm, field, cls, tone, full, mins, bare }) {
  if (field === 'out') return html`<${CloseTime} vm=${vm} cls=${cls} tone=${tone} mins=${mins} full=${full} bare=${bare} />`;
  const g = vm.state.defaults.global;
  const gi = parseTime(g.in);
  const inAbs = gi.value != null ? inAbsOf(gi) : null;
  return html`<${DragTime} abs=${inAbs} set=${true} ...${shiftCell('in')} min=${IN_MIN_ABS} max=${IN_MAX_ABS}
    onSet=${abs => App.reviewed('Default open ' + fmtTimeAbs(abs), () => App.globalDefault('in', absToInRaw(abs), true))}
    onPreview=${abs => App.previewDefault('in', abs == null ? null : absToInRaw(abs))}
    cls=${cls} tone=${tone} full=${full} mins=${mins} bare=${bare} moved=${defaultMoved(vm, 'in')} label="Default open time" />`;
}

// ── Render ───────────────────────────────────────────────────────────────────
// preview: a would-be view model while a wheel turns — painted, but the
// handlers keep reading the real state (lastVm).

export function renderStaff(vm, { preview = false } = {}) {
  if (!preview) lastVm = vm;
  const root = $('staff-root');
  if (root) render(html`<${Staff} vm=${vm} />`, root);
  renderEditor(vm);
}
