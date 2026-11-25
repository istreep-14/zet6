// Staff page (Preact) — who worked, and when, as a card list and nothing
// else on the page:
//   note line (count · closers · hours, warnings)
//   → one list: the hour axis, a small heading per role (roles on), a card
//     per person — number tile · name (with a Closer mark) over their break,
//     In → Out and hours on the right, and under it a timeline of their shift
//     against the night (hour ticks, the close as a red line, a placed break
//     as a gap)
//   → Add names, only while adding (or while nobody's on shift)
// Its actions are on the HUD (staffPills: + Add, Times, Select, the Close
// time) and in the page drawer (StaffOptions: the same, Default times, and
// Show: Timelines, Roles, 24-hour times).
// Modes:
//   view    tap a card → that person's drawer (name, role, In / Out, break,
//           closer, remove)
//   times   the times on each card become boxes — tap one for the wheel (hold
//           works too), Undo · Apply in the HUD after
//   select  tap cards to pick people; the bulk bar docks at the bottom (in
//           place of the HUD): In / Out hour chips set the picked people's
//           times — "Each in turn" gives the next picked person the chip you
//           tap (4, 5, 6, 6 down the list), "Same for all" sets everyone —
//           plus :30, Closer, Remove, Undo
//
// Times are written as the same raw strings typing would store, '' when they
// equal the default (resolve.js does the rest).

import { ROLES } from '../store.js';
import { fmtHrs, fmtMoney } from '../util.js';
import { parseTime, fmtTimeAbs, fmtClockShort, inAbsOf, afterAbsOf, absToInRaw, absToOutRaw, absToEdgeRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { getRoster } from '../roster.js';
import { html, render } from '../ui/preact.js';
import { cx, Clock, Icon, Button, Alert, Seg, SwitchRow, List, Section, NextStep, INPUT_PAGE, ROLE_DOT, ROLE_PLURAL, hueVar, hueIndex, hueTile, Sentinel, THEAD } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';
import { DragTime } from '../ui/dragtime.js';
import { openKeypad, activeKey, bufferAbs } from '../ui/keypad.js';

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

// ── Modes ────────────────────────────────────────────────────────────────────

let mode = 'view';                // 'view' | 'times' | 'select'
let sel = new Set();              // picked ids (select mode)
let how = 'turn';                 // bulk: 'turn' (each in turn) | 'all'
let turn = 0;                     // each in turn: index into the picked people
let half = false;                 // bulk chips at :30
let undoLabel = '';               // the last bulk action, while Undo can put it back

function setMode(m) {
  mode = mode === m ? 'view' : m;
  if (mode !== 'select') { sel = new Set(); turn = 0; undoLabel = ''; }
  document.documentElement.classList.toggle('bulk-on', mode === 'select');
  rerender();
}
export const staffMode = () => mode;
export function exitStaffModes() { if (mode !== 'view') setMode(mode); }

const picked = state => ordered(state).filter(p => sel.has(p.id));

// ── Note line ────────────────────────────────────────────────────────────────

function Note({ vm }) {
  const people = vm.state.staff.filter(named);
  if (!people.length) return null;
  const parts = [people.length + ' on shift'];
  const closers = vm.resolved.staff.filter(p => p.closer).length;
  if (closers) parts.push(closers + (closers === 1 ? ' closer' : ' closers'));
  const hrs = vm.resolved.staff.filter(p => p.role !== 'support').reduce((t, p) => t + p.hours, 0);
  if (hrs > 0) parts.push(fmtHrs(hrs) + ' hours');
  const warnings = [];
  if (vm.inputError && vm.blockedTab === 'staff') warnings.push(vm.blocked);
  const closeAbs = vm.resolved.closeAbs;
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) warnings.push(p.name + ' is out after the close time');
    });
  }
  return html`<div class="t-small px-4 text-ink-3">${parts.join(' · ')}</div>
    ${warnings.map(w => html`<${Alert} key=${w} tone="warn">${w}<//>`)}`;
}

// ── The close time ───────────────────────────────────────────────────────────

// The shift's close (defaults.global.out): closers and anyone without an Out
// of their own end then. Tap → the keypad, hold → the wheel; Undo · Apply after.
export function CloseTime({ vm, cls, tone, mins = false, full = false, bare = false }) {
  const g = vm.state.defaults.global;
  const gi = parseTime(g.in), go = parseTime(g.out);
  const open = gi.value != null ? inAbsOf(gi) : vm.resolved?.anchorAbs ?? 17;
  const abs = go.value != null ? afterAbsOf(go, open) : null;
  return html`<${DragTime} abs=${abs} set=${true} ...${shiftCell('out')}
    min=${open + 0.25} max=${open + 12}
    onSet=${a => App.reviewed('Close ' + fmtTimeAbs(a), () => App.globalDefault('out', absToOutRaw(a, open), true))}
    onPreview=${a => App.previewDefault('out', a == null ? null : absToOutRaw(a, open))}
    cls=${cls} tone=${tone} mins=${mins} full=${full} bare=${bare} label="Close time" />`;
}

// ── Person cards ─────────────────────────────────────────────────────────────

// Their shift against the night: a track with hour ticks, their stretch in
// the role colour, a placed break as a gap, the close as a red line.
export function Timeline({ span, t, role, hue = null }) {
  if (!span || t.span == null) return html`<div class="h-1.5"></div>`;
  const W = span.b - span.a;
  const at = v => ((v - span.a) / W) * 100 + '%';
  const len = (x, y) => ((y - x) / W) * 100 + '%';
  const ticks = [];
  for (let h = span.a + 1; h < span.b; h++) ticks.push(h);
  return html`<div class="relative h-1.5 rounded-full bg-ink/[.07]" aria-hidden="true">
    ${ticks.map(h => html`<span key=${h} class="absolute inset-y-0 w-px bg-ink/10" style=${{ left: at(h) }}></span>`)}
    <span class=${cx('absolute inset-y-0 rounded-full', hue == null && ROLE_DOT[role])} style=${{ left: at(t.inAbs), width: len(t.inAbs, t.outAbs), ...(hue != null ? { background: hueVar(hue) } : {}) }}></span>
    ${t.brk > 0 && t.brkStart != null && html`<span class="absolute -inset-y-px rounded-sm" style=${{
      left: at(t.brkStart), width: len(t.brkStart, t.brkStart + t.brk),
      backgroundImage: 'repeating-linear-gradient(135deg, var(--surface) 0 2px, transparent 2px 4px)', backgroundColor: 'color-mix(in srgb, var(--surface) 55%, transparent)',
    }}></span>`}
    ${span.close != null && html`<span class="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-bad/55" style=${{ left: at(span.close) }}></span>`}
  </div>`;
}

// The axis over the cards: an hour label every hour (every two on a long
// night), lined up with the timelines.
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
function Axis({ span }) {
  if (!span) return null;
  return html`<div class=${cx(THEAD, 'grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 bg-bg px-4 pb-1 pt-2')} aria-hidden="true">
    <span></span><${AxisLabels} span=${span} />
  </div>`;
}

const CARD = 'li grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 text-left';
const BOX = 'h-10 w-[3.5rem] rounded-lg bg-surface-2 text-[0.875rem] tabular-nums transition';

function TimeBox({ vm, p, field }) {
  const t = times(vm.state, p, vm);
  const k = pickerFor(vm, p, field);
  const set = field === 'in' ? t.inSet : t.outSet;
  return html`<${DragTime} abs=${field === 'in' ? t.inAbs : t.outAbs} set=${set} bad=${t.bad} ...${keyCell(p, field)}
    min=${k.min} max=${k.max} onSet=${k.onSet} onPreview=${k.onPreview} wheelSub=${k.wheelSub}
    cls=${BOX} tone=${set ? 'font-semibold text-ink' : 'font-normal text-ink-3'} label=${p.name + ' ' + field + ' time'} />`;
}

function PersonCard({ vm, p, n, tint, span, allClose, lines = true }) {
  const t = times(vm.state, p, vm);
  const picking = mode === 'select';
  const on = sel.has(p.id);
  const next = picking && how === 'turn' && sel.size > 1 && picked(vm.state)[turn % sel.size]?.id === p.id;
  const tap = () => {
    if (picking) {
      if (on) sel.delete(p.id); else sel.add(p.id);
      turn = 0;
      rerender();
    } else if (mode === 'view') App.editStaff(p.id);
  };
  const lead = picking
    ? html`<span class=${cx('grid size-7 place-items-center justify-self-center rounded-full transition', on ? 'bg-accent text-on-accent' : 'ring-2 ring-inset ring-ink/20')}>
        ${on && html`<${Icon} name="check" class="size-4" />`}</span>`
    : html`<span class="grid size-8 place-items-center rounded-lg t-small font-semibold tabular-nums" style=${hueTile(hueIndex(vm.state, p.id))}>${n}</span>`;
  const sub = t.brk > 0 ? fmtBreak(t.brk) + ' break' + (t.brkStart != null ? ' at ' + fmtClockShort(t.brkStart) : '') : '';
  // An auto closer is only worth a mark while not everyone is one (early in
  // the night everyone still ends at the close).
  const closer = t.forced ? 'bg-bad text-white' : t.closer && !allClose ? 'bg-bad/12 text-bad' : '';
  const right = mode === 'times'
    ? html`<span class="flex items-center gap-1.5">
        <${TimeBox} vm=${vm} p=${p} field="in" /><span class="text-[0.75rem] text-ink-3/70">→</span><${TimeBox} vm=${vm} p=${p} field="out" />
      </span>`
    : html`<span class="flex items-center gap-3">
        <span class="t-small whitespace-nowrap tabular-nums">
          ${t.bad ? html`<span class="font-semibold text-bad">Check times</span>` : html`
            <span class=${t.inSet ? 'font-medium text-ink' : 'text-ink-2'}>${t.inAbs != null ? html`<${Clock} abs=${t.inAbs} />` : '—'}</span>
            <span class="mx-1 text-ink-3/70">→</span>
            <span class=${t.outSet ? 'font-medium text-ink' : 'text-ink-2'}>${t.outAbs != null ? html`<${Clock} abs=${t.outAbs} />` : '—'}</span>`}
        </span>
        <span class=${cx('t-body w-10 text-right font-semibold tabular-nums', t.hrs == null ? 'text-bad' : p.role === 'support' ? 'text-ink-3' : 'text-ink')}>${t.hrs != null ? fmtHrs(t.hrs) + 'h' : '?'}</span>
      </span>`;
  const Tag = mode === 'times' ? 'div' : 'button';
  return html`<${Tag} class=${cx(CARD, Tag === 'button' && 'transition active:bg-surface-2', on && 'bg-accent/8', next && 'ring-2 ring-inset ring-accent')}
      style=${{ '--inset': '3.75rem' }} onClick=${Tag === 'button' ? tap : undefined} aria-pressed=${picking ? String(on) : undefined}>
    ${lead}
    <span class="flex min-w-0 flex-col">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="t-body truncate font-medium">${p.name}</span>
        ${closer && html`<span class=${cx('shrink-0 rounded-full px-1.5 text-[0.6875rem] font-semibold leading-4', closer)}>Closer</span>`}
        ${next && html`<span class="shrink-0 rounded-full bg-accent px-1.5 text-[0.6875rem] font-semibold leading-4 text-on-accent">Next</span>`}
      </span>
      ${sub && html`<span class="t-small truncate text-ink-3">${sub}</span>`}
    </span>
    ${right}
    ${lines && html`<span></span><div class="col-span-2"><${Timeline} span=${span} t=${t} role=${p.role} hue=${hueIndex(vm.state, p.id)} /></div>`}
  <//>`;
}

// ── Add names ────────────────────────────────────────────────────────────────
// A composer at the end of the list, shown while adding (+ Add on the HUD, or
// the page drawer) and whenever nobody's on shift yet. Type a name and Return
// — it's added and the field clears for the next; a comma ends a name too; a
// pasted list (lines / commas) adds them all, in order. With roles on, the
// chips say which role they come in as. Saved names not on shift are chips:
// tap to add; Edit saved → tap to forget one. Done (or leaving the field
// empty) folds it away.

let adding = false;
let addRole = 'bartender';
let forgetting = false;
const onShiftSet = state => new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));
const splitNames = text => String(text).split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean);

function addAll(names) {
  if (!names.length) return;
  App.addPeople(names.map(n => ({ name: n, role: addRole })));
}

// Open the composer and put the cursor in it.
export function startAdding() {
  if (mode !== 'view') setMode(mode);
  adding = true;
  rerender();
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-addnames]');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus();
  });
}
const stopAdding = () => { adding = false; forgetting = false; rerender(); };

function AddNames({ vm }) {
  const state = vm.state;
  const rolesOn = state.settings.allRoles;
  if (!rolesOn) addRole = 'bartender';
  const onShift = onShiftSet(state);
  const saved = getRoster().filter(r => !onShift.has(r.name.toLowerCase()));
  const chip = 't-small inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 font-semibold transition active:scale-95';
  const people = state.staff.some(named);
  return html`<${Section} title="Add names" aside=${html`<span class="flex items-center gap-4">
      ${saved.length > 0 && html`<button class="t-small font-semibold text-accent" onClick=${() => { forgetting = !forgetting; rerender(); }}>${forgetting ? 'Done editing' : 'Edit saved'}</button>`}
      ${people && html`<button class="t-small font-semibold text-accent" onClick=${stopAdding}>Done</button>`}</span>`}>
    <${List}>
      <div class="li flex items-center gap-3 px-4 py-1.5" style=${{ '--inset': '3.5rem' }} data-addbox>
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent"><${Icon} name="plus" class="size-[1.125rem]" /></span>
        <input data-addnames class="h-11 min-w-0 flex-1 bg-transparent text-[1rem] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
          placeholder="Name, then Return — or paste a list" aria-label="Add names"
          onFocus=${() => { adding = true; }}
          onBlur=${e => { if (!e.target.value.trim() && state.staff.some(named)) setTimeout(() => { if (document.activeElement?.closest?.('[data-addbox]')) return; stopAdding(); }, 150); }}
          autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="next"
          onKeyDown=${e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            addAll(splitNames(e.target.value));
            e.target.value = '';
          }}
          onInput=${e => {
            // A comma ends a name too (so does a pasted list).
            const v = e.target.value;
            if (!/[,;\n]/.test(v)) return;
            const parts = v.split(/[\n,;]+/);
            const rest = parts.pop();
            addAll(parts.map(s => s.trim()).filter(Boolean));
            e.target.value = rest.trimStart();
          }}
          onPaste=${e => {
            const text = e.clipboardData?.getData('text') || '';
            if (!/[\n,;\t]/.test(text.trim())) return;
            e.preventDefault();
            addAll(splitNames(e.target.value + text));
            e.target.value = '';
          }} />
      </div>
      ${rolesOn && html`<div class="li flex items-center gap-2 px-4 py-2" style=${{ '--inset': '3.5rem' }} data-addbox>
        <span class="t-cap w-8 shrink-0 text-ink-3">As</span>
        ${ROLES.map(r => html`<button key=${r} class=${cx(chip, addRole === r ? ROLE_TINT[r] + ' ring-1 ring-inset ring-current' : 'bg-surface-2 text-ink-2')}
          aria-pressed=${String(addRole === r)} onPointerDown=${e => e.preventDefault()} onClick=${() => { addRole = r; rerender(); }}>
          <span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_SHORT[r]}</button>`)}
      </div>`}
      ${saved.length > 0 && html`<div class="li overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style=${{ '--inset': '1rem' }} data-addbox>
        <div class="flex w-max gap-1.5">
          ${saved.map(r => html`<button key=${r.name} class=${cx(chip, forgetting ? 'bg-bad/12 text-bad' : 'bg-surface-2 text-ink')} onPointerDown=${e => e.preventDefault()}
            onClick=${() => (forgetting ? App.forgetName(r.name) : App.addPeople([{ name: r.name, role: rolesOn ? r.role : 'bartender' }]))}>
            ${forgetting ? html`<${Icon} name="x" class="size-3.5" />` : rolesOn && html`<span class=${cx('size-1.5 rounded-full', ROLE_DOT[r.role])}></span>`}${r.name}</button>`)}
        </div>
      </div>`}
    <//>
  <//>`;
}

// ── Bulk bar (select mode) ───────────────────────────────────────────────────
// Docked at the bottom in place of the HUD while Select is on.

function hourChips(from, to) {
  const out = [];
  for (let h = Math.ceil(from); h <= to; h++) out.push(h);
  return out;
}

function bulkSet(vm, field, abs) {
  const people = picked(vm.state);
  if (!people.length) return;
  const targets = how === 'turn' && people.length > 1 ? [people[turn % people.length]] : people;
  const changes = {};
  targets.forEach(p => {
    if (abs == null) { changes[p.id] = { [field]: '' }; return; }
    if (field === 'out') { const t = times(vm.state, p, vm); if (t.inAbs == null || abs <= t.inAbs || abs - t.inAbs > 12) return; }
    changes[p.id] = { [field]: rawAt(vm, p, field, abs) };
  });
  const what = (field === 'in' ? 'In ' : 'Out ') + (abs == null ? (field === 'in' ? 'default' : 'at close') : fmtClockShort(abs));
  undoLabel = (targets.length === 1 ? targets[0].name.trim() : targets.length + ' people') + ' · ' + what;
  if (how === 'turn' && people.length > 1) turn = (turn + 1) % people.length;
  App.bulk(undoLabel, () => App.setStaffFields(changes));
}

function BulkBar({ vm }) {
  const state = vm.state;
  const people = picked(state);
  const all = ordered(state);
  const n = people.length;
  const open = vm.resolved?.anchorAbs ?? 17;
  const close = vm.resolved?.closeAbs ?? open + 9;
  const off = half ? 0.5 : 0;
  const ins = hourChips(open - 3, open + 4).map(h => h + off).filter(v => v >= IN_MIN_ABS && v <= IN_MAX_ABS);
  const outs = hourChips(close - 6, close + 1).map(h => h + off).filter(v => v > open);
  const chip = (label, onClick, cls = 'bg-surface-2 text-ink') => html`<button class=${cx('t-small h-9 shrink-0 rounded-full px-3 font-semibold tabular-nums transition active:scale-95 disabled:opacity-40', cls)}
    disabled=${!n} onClick=${onClick}>${label}</button>`;
  const row = (label, chips) => html`<div class="flex items-center gap-2">
    <span class="t-cap w-8 shrink-0 text-ink-3">${label}</span>
    <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${chips}</div>
  </div>`;
  const nextP = how === 'turn' && n > 1 ? people[turn % n] : null;
  const forced = n > 0 && people.every(p => p.closerOverride);
  return html`<div class="flex flex-col gap-2.5">
    <div class="flex items-center gap-2">
      <span class="flex min-w-0 flex-1 flex-col leading-tight">
        <span class="t-body font-semibold">${n ? n + ' picked' : 'Tap people to pick them'}</span>
        <span class="t-small truncate text-ink-3">${nextP ? 'Next: ' + nextP.name.trim() : n > 1 ? 'Every chip sets all of them' : n ? 'Tap a time to set it' : 'Then tap a time'}</span>
      </span>
      <button class="t-small h-9 px-2 font-semibold text-accent" onClick=${() => { sel = n === all.length ? new Set() : new Set(all.map(p => p.id)); turn = 0; rerender(); }}>${n === all.length && n ? 'None' : 'All'}</button>
      <${Button} size="sm" variant="primary" onClick=${() => setMode('select')}>Done<//>
    </div>
    ${n > 1 && html`<${Seg} size="sm" value=${how} onChange=${v => { how = v; turn = 0; rerender(); }}
      items=${[{ value: 'turn', label: 'Each in turn' }, { value: 'all', label: 'Same for all' }]} />`}
    ${row('In', html`
      ${chip(':30', () => { half = !half; rerender(); }, half ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2')}
      ${ins.map(v => html`<span key=${v} class="contents">${chip(fmtClockShort(v), () => bulkSet(vm, 'in', v))}</span>`)}
      ${chip('Default', () => bulkSet(vm, 'in', null), 'bg-surface-2 text-ink-2')}`)}
    ${row('Out', html`
      ${chip('Close', () => bulkSet(vm, 'out', null), 'bg-bad/12 text-bad')}
      ${outs.map(v => html`<span key=${v} class="contents">${chip(fmtClockShort(v), () => bulkSet(vm, 'out', v))}</span>`)}`)}
    <div class="flex items-center gap-2">
      ${chip(forced ? 'Not closers' : 'Closers', () => {
        undoLabel = (forced ? 'Not closers · ' : 'Closers · ') + n;
        App.bulk(undoLabel, () => App.setStaffFields(Object.fromEntries(people.map(p => [p.id, { closerOverride: !forced }]))));
      })}
      ${chip('Remove', () => {
        undoLabel = 'Removed ' + (n === 1 ? people[0].name.trim() : n + ' people');
        const ids = people.map(p => p.id);
        sel = new Set();
        App.bulk(undoLabel, () => ids.forEach(id => App.removePerson(id)));
      }, 'bg-bad/12 text-bad')}
      <span class="flex-1"></span>
      ${undoLabel && html`<button class="t-small inline-flex h-9 min-w-0 items-center gap-1 rounded-full bg-surface-2 px-3 font-semibold text-ink active:scale-95"
        onClick=${() => { if (App.bulkUndo()) { undoLabel = ''; turn = Math.max(0, turn - 1); } else { undoLabel = ''; } rerender(); }}>
        <${Icon} name="undo" class="size-4 shrink-0" /><span class="truncate">Undo</span></button>`}
    </div>
  </div>`;
}

function renderBulk(vm) {
  const el = $('bulkBar');
  if (el) render(mode === 'select' ? html`<${BulkBar} vm=${vm} />` : null, el);
}

// ── Page ─────────────────────────────────────────────────────────────────────

function Staff({ vm }) {
  const state = vm.state;
  const people = state.staff.filter(named);
  const gs = groups(state);
  const lines = state.settings.show?.timelines !== false;
  const span = lines ? nightSpan(vm) : null;
  const tint = state.settings.allRoles && new Set(people.map(p => p.role)).size > 1;
  const tipped = vm.resolved.staff.filter(p => p.role !== 'support');
  const allClose = tipped.length > 1 && tipped.every(p => p.closer && !p.closerOverride);
  // Staff is done once everyone named has valid times (no staff-side error).
  const done = people.length > 0 && vm.blockedTab !== 'staff';
  const hours = done && vm.resolved.staff.filter(p => p.role !== 'support').reduce((t, p) => t + p.hours, 0);
  let n = 0;
  // One list: the hour axis once, a small heading per role (roles on), a
  // card per person. Actions live on the HUD and in the page drawer.
  return html`<div class="flex flex-col gap-4">
    <${Note} vm=${vm} />
    ${people.length > 0 && html`<${List}>
      ${lines && span && html`<${Sentinel} /><${Axis} span=${span} />`}
      ${gs.map(g => html`
        ${g.role && gs.length > 1 && html`<div key=${'h-' + g.role} class="li t-cap flex items-center gap-2 px-4 pb-1 pt-2.5 text-ink-3" style=${{ '--inset': '1rem' }}>
          <span class=${cx('size-2 rounded-full', ROLE_DOT[g.role])}></span>${ROLE_PLURAL[g.role]}<span class="text-ink-3/70">${g.people.length}</span></div>`}
        ${g.people.map(p => html`<${PersonCard} key=${p.id} vm=${vm} p=${p} n=${++n} tint=${tint} span=${span} lines=${lines} allClose=${allClose} />`)}`)}
    <//>`}
    ${(adding || !people.length) && html`<${AddNames} vm=${vm} />`}
    ${done && mode === 'view' && !adding && (vm.totalCash > 0 && !vm.blocked
      ? html`<${NextStep} tab="summary" label="See who gets what" sub=${fmtMoney(vm.totalCash) + ' over ' + fmtHrs(hours) + ' hours'} />`
      : html`<${NextStep} tab="tips" label="Next: enter the tips" sub=${people.length + ' on shift · ' + fmtHrs(hours) + ' hours'} />`)}
  </div>`;
}

// ── The page drawer's Staff part: actions, the close, what it shows. ──────

export function StaffOptions({ vm }) {
  const state = vm.state;
  const show = state.settings.show || {};
  const row = (icon, title, sub, onClick, on) => html`<button class=${cx('li flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition active:bg-surface-2', on && 'bg-accent/8')}
    style=${{ '--inset': '3.5rem' }} onClick=${() => { App.closeSheet('sheet-page'); onClick(); }}>
    <span class=${cx('grid size-8 shrink-0 place-items-center rounded-lg', on ? 'bg-accent text-on-accent' : 'bg-accent/12 text-accent')}><${Icon} name=${icon} class="size-[1.125rem]" /></span>
    <span class="flex min-w-0 flex-1 flex-col"><span class="t-body font-medium">${title}</span><span class="t-small text-ink-3">${sub}</span></span>
  </button>`;
  return html`<${Section} title="Do"><${List}>
      ${row('plus', 'Add names', 'Type or paste a list; saved names are a tap', startAdding)}
      ${row('clock', mode === 'times' ? 'Stop editing times' : 'Edit times', 'Every time becomes a wheel', () => setMode('times'), mode === 'times')}
      ${row('users', mode === 'select' ? 'Stop selecting' : 'Select people', 'Set several people’s times at once — 4, 5, 6, 6 …', () => setMode('select'), mode === 'select')}
      <div class="li flex min-h-12 items-center gap-3 px-4 py-2" style=${{ '--inset': '3.5rem' }}>
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-bad/12 text-bad"><span class="size-2 rounded-full bg-bad"></span></span>
        <span class="flex min-w-0 flex-1 flex-col"><span class="t-body font-medium">Close time</span><span class="t-small text-ink-3">Closers and anyone without an Out end then</span></span>
        <${CloseTime} vm=${vm} cls="h-10 min-w-[4rem] rounded-lg bg-surface-2 px-2 text-[0.9375rem] tabular-nums transition" tone="font-semibold text-ink" />
      </div>
      ${row('sliders', 'Default times', 'Open, and per role — in this shift’s panel', () => App.openDefaults())}
    <//><//>
    <${Section} title="Show"><${List}>
      <${SwitchRow} on=${show.timelines !== false} onClick=${() => App.toggleShow('timelines')}
        icon="clock" label="Timelines" hint="Each shift against the night, the close as a red line" />
      <${SwitchRow} on=${state.settings.allRoles} onClick=${() => App.toggleSetting('allRoles')}
        icon="users" label="Roles" hint="Bartenders · servers · support, grouped" />
      <${SwitchRow} on=${state.settings.clock24} onClick=${() => App.toggleSetting('clock24')}
        icon="clock" label="24-hour times" hint="17:30 instead of 5:30p" />
    <//><//>
    <p class="t-small px-4 text-ink-3">Tap a person for their drawer — times, a break, closer, remove. Faint times follow the defaults.</p>`;
}

// The HUD's actions on Staff (render/tabs.js shows them as pills).
export function staffPills(vm) {
  return [
    { icon: 'plus', label: 'Add', onClick: startAdding },
    { icon: 'clock', label: 'Times', on: mode === 'times', onClick: () => setMode('times') },
    { icon: 'users', label: 'Select', on: mode === 'select', onClick: () => setMode('select') },
    { close: true },
  ];
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

const BIG = 'h-12 w-full rounded-xl bg-surface-2 text-[1.25rem] tabular-nums transition';

function TimeField({ vm, p, field }) {
  const k = pickerFor(vm, p, field);
  const t = times(vm.state, p, vm);
  return html`<div class="flex min-w-0 flex-1 flex-col gap-1.5">
    <span class="t-cap px-1 text-ink-3">${field === 'in' ? 'In' : 'Out'}</span>
    <${DragTime} abs=${k.abs} set=${k.isSet} bad=${t.bad} ...${keyCell(p, field)} min=${k.min} max=${k.max} onSet=${k.onSet} onPreview=${k.onPreview} wheelSub=${k.wheelSub}
      cls=${BIG} tone=${k.isSet ? 'font-semibold text-ink' : 'font-medium text-ink-3'} full label=${p.name + ' ' + field + ' time'} />
    <span class="t-small min-h-5 px-1">${k.isSet
      ? html`<button class="font-semibold text-accent" onClick=${k.onReset}>${field === 'out' ? 'Out at close' : 'Use default'}${k.defAbs != null ? ' · ' + fmtClockShort(k.defAbs) : ''}</button>`
      : html`<span class="text-ink-3">${field === 'out' ? 'At the close' : 'The default'}</span>`}</span>
  </div>`;
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
      <span class="t-body font-medium">Break</span>
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
            onSet=${placeAt} cls="h-10 min-w-[4.5rem] rounded-lg bg-surface-2 px-2 text-[0.9375rem] tabular-nums transition" tone="font-semibold text-ink" label="Break start" />
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
  const set = (field, raw) => App.staffField(p.id, field, raw, true);
  return html`
    <input class=${cx(INPUT_PAGE, 'h-12 text-[1.25rem] font-semibold')} value=${p.name} placeholder="Name"
      autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="done" aria-label="Name"
      onInput=${e => App.staffField(p.id, 'name', e.target.value)} onChange=${() => App.rememberStaff(p.id)}
      onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
    ${state.settings.allRoles && html`<${Seg} value=${p.role} onChange=${r => App.staffField(p.id, 'role', r, true)}
      items=${ROLES.map(r => ({ value: r, label: ROLE_SHORT[r] }))} />`}
    <div class="flex flex-col gap-3 rounded-card bg-surface p-3.5">
      <div class="flex items-start gap-3">
        <${TimeField} vm=${vm} p=${p} field="in" />
        <span class="mt-9 text-ink-3/70">→</span>
        <${TimeField} vm=${vm} p=${p} field="out" />
      </div>
      <div class="t-body flex items-center justify-between border-t border-line pt-3">
        <span class="text-ink-2">${t.hrs != null ? fmtHrs(t.hrs) + ' hours' + (t.brk > 0 ? ' (' + fmtHrs(t.span) + ' − ' + fmtBreak(t.brk) + ')' : '') : 'Check the times'}</span>
        ${share && html`<span class="text-ink-2">takes home <b class="t-head text-ink">$${share.final}</b></span>`}
      </div>
    </div>
    <${BreakField} vm=${vm} p=${p} />
    <${List}>
      <${SwitchRow} on=${t.forced} onClick=${() => App.toggleCloser(p.id)} label="Closer"
        hint=${t.forced ? 'Forced — shares the closer bonus' : t.closer ? 'Auto: out at the close time' : 'Shares the dollars left after rounding'} />
    <//>
    <div class="flex gap-2">
      <${Button} class="flex-1" disabled=${!t.inSet && !t.outSet} onClick=${() => { set('in', ''); set('out', ''); }}>Reset times<//>
      <${Button} variant="danger" class="flex-1" icon="trash" onClick=${() => App.reviewed('Removed ' + (p.name.trim() || 'person'), () => App.removePerson(p.id))}>Remove<//>
    </div>`;
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
    cls=${cls} tone=${tone} full=${full} mins=${mins} bare=${bare} label="Default open time" />`;
}

// ── Render ───────────────────────────────────────────────────────────────────
// preview: a would-be view model while a wheel turns — painted, but the
// handlers keep reading the real state (lastVm).

export function renderStaff(vm, { preview = false } = {}) {
  if (!preview) lastVm = vm;
  // Drop picks of people who are gone.
  if (sel.size) sel = new Set([...sel].filter(id => vm.state.staff.some(p => p.id === id && named(p))));
  const root = $('staff-root');
  if (root) render(html`<${Staff} vm=${vm} />`, root);
  renderEditor(vm);
  renderBulk(vm);
}
