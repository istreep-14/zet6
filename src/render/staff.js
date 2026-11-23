// Staff tab (Preact):
//   note line (count · close · closers, warnings)
//   → one table card per role (roles on) or one "On shift" card:
//   → Quick add card → saved-people picker sheet (multi-select, Select all,
//     Edit forgets, "Add N people")
//     Name · In · Out · Hrs · Close, every cell a control (name → person
//     editor, time pill → tap for the quick time sheet or drag sideways in
//     15-min steps, circle → forced closer), a "+ Add bartender" row (new
//     person, editor opens with the name focused), then a "Defaults 5p – 2a ›"
//     footer.
//
// Times are written as the same raw strings typing would store, '' when they
// equal the default (resolve.js does the rest).

import { ROLES } from '../store.js';
import { fmtHrs, fmtMoney, hasMinutes, hrsDecimals, hrsText } from '../util.js';
import { parseTime, fmtTimeAbs, fmtClockShort, inAbsOf, afterAbsOf, absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { getRoster } from '../roster.js';
import { html, render, useRef, useLayoutEffect } from '../ui/preact.js';
import { cx, Clock, Icon, Card, Button, Alert, Seg, SwitchRow, List, Item, Section, NextStep, INPUT_PAGE, ROLE_DOT, ROLE_PLURAL, TABLE_HEAD, THEAD, Sentinel, zebra } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, sheetFoot, setSheetTitle, onSheetClose } from '../ui/sheet.js';
import { DragTime, TIME_TEXT, ARROW_BEFORE } from '../ui/dragtime.js';
import { SwipeRow } from '../ui/swipe.js';
import { openKeypad, closeKeypad, activeKey, bufferAbs, focusCell } from '../ui/keypad.js';

export { DragTime };

const $ = id => document.getElementById(id);
const ROLE_ONE = { bartender: 'bartender', server: 'server', support: 'support' };
const ROLE_SHORT = { bartender: 'Bar', server: 'Server', support: 'Support' };

// ── Times ────────────────────────────────────────────────────────────────────

function roleDefaults(state, role) {
  const r = state.defaults.byRole[role] || {};
  return { in: r.in || state.defaults.global.in || '', out: r.out || state.defaults.global.out || '' };
}

// In / Out on the absolute axis for any row (named or not), plus flags.
function times(state, person, vm) {
  const def = roleDefaults(state, person.role);
  const res = vm?.resolved?.staff.find(p => p.id === person.id);
  const inP = parseTime(person.in.trim() || def.in);
  const outP = parseTime(person.out.trim() || def.out);
  const inAbs = res?.inAbs ?? (inP.value != null ? inAbsOf(inP) : null);
  const outAbs = res?.outAbs ?? (outP.value != null && inAbs != null ? afterAbsOf(outP, inAbs) : null);
  const bad = !inP.valid || !outP.valid;
  const hrs = inAbs != null && outAbs != null && outAbs > inAbs && outAbs - inAbs <= 12 ? outAbs - inAbs : null;
  return {
    def, inAbs, outAbs, hrs, bad,
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

function defaultsLabel(def) {
  const i = parseTime(def.in), o = parseTime(def.out);
  const inAbs = i.value != null ? inAbsOf(i) : null;
  return (inAbs != null ? fmtClockShort(inAbs) : '—') + ' – ' + (o.value != null ? fmtClockShort(afterAbsOf(o, inAbs ?? 17)) : '—');
}

// ── Note line ────────────────────────────────────────────────────────────────

function Note({ vm }) {
  const named = vm.state.staff.filter(p => p.name.trim());
  if (!named.length) return null;
  const parts = [named.length + ' on shift'];
  const closeAbs = vm.resolved.closeAbs;
  if (closeAbs !== null) parts.push('close ' + fmtTimeAbs(closeAbs));
  const closers = vm.resolved.staff.filter(p => p.closer).length;
  if (closers) parts.push(closers + (closers === 1 ? ' closer' : ' closers'));
  const warnings = [];
  if (vm.inputError && vm.blockedTab === 'staff') warnings.push(vm.blocked);
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) warnings.push(p.name + ' is out after the close time');
    });
  }
  return html`<div class="t-small px-4 text-ink-3">${parts.join(' · ')}</div>
    ${warnings.map(w => html`<${Alert} key=${w} tone="warn">${w}<//>`)}`;
}

// ── Quick add: entry card + saved-people picker sheet ──────────────────────
// The card shows who's saved and not on shift; it opens a grid of person
// cards to multi-select (Select all, Edit forgets), then "Add N people".
// New names are added from each table's "+ Add …" row.

const onShiftSet = state => new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));

function QuickAdd({ vm }) {
  const all = getRoster();
  if (!all.length) return html`<p class="t-small px-4 text-ink-3">Names you add are saved for quick adding next shift.</p>`;
  const onShift = onShiftSet(vm.state);
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const show = (avail.length ? avail : all).slice(0, 3);
  return html`<${List}><${Item} onClick=${() => App.openRoster()} title="Quick add"
    lead=${html`<span class="grid size-10 shrink-0 place-items-center rounded-[0.625rem] bg-accent/12 text-accent"><${Icon} name="plus" class="size-5" /></span>`}
    sub=${avail.length ? show.map(r => r.name).join(', ') + (avail.length > show.length ? ` +${avail.length - show.length}` : '') : 'Everyone saved is on this shift'} /><//>`;
}

let rosterSel = new Set();      // lowercased names picked in the sheet
let rosterEditing = false;
let rosterStart = null;         // abs In for the next add; null = the default
let rosterNote = '';            // "Added Maya, Leo · 4:00p"
onSheetClose('sheet-roster', () => { rosterSel = new Set(); rosterEditing = false; rosterStart = null; rosterNote = ''; });

export function openRosterSheet() {
  rosterSel = new Set();
  rosterEditing = false;
  rosterStart = null;
  rosterNote = '';
  openSheet('sheet-roster');
  if (lastVm) renderRoster(lastVm);
}
const rerenderRoster = () => { if (lastVm) renderRoster(lastVm); };

function RosterCard({ r, onShift, startOf }) {
  const key = r.name.toLowerCase();
  const on = onShift.has(key);
  const sel = rosterSel.has(key);
  const tap = () => {
    if (rosterEditing) { App.forgetName(r.name); return; }
    if (sel) rosterSel.delete(key); else rosterSel.add(key);
    rerenderRoster();
  };
  const mark = rosterEditing ? 'bg-bad text-white' : sel ? 'bg-accent text-on-accent' : on ? 'bg-ink-3 text-surface' : 'bg-surface-2';
  return html`<button class=${cx('relative flex min-h-[4.75rem] flex-col items-center justify-center gap-1 rounded-card px-2 py-2.5 transition active:scale-95',
      sel ? 'bg-accent/12 ring-2 ring-inset ring-accent' : 'bg-surface', on && !rosterEditing && 'opacity-45')}
    onClick=${tap} disabled=${on && !rosterEditing} aria-pressed=${String(sel)}>
    <span class=${cx('absolute right-2 top-2 grid size-[1.375rem] place-items-center rounded-full text-[0.75rem] font-bold', mark)} aria-hidden="true">${rosterEditing ? '✕' : sel || on ? '✓' : ''}</span>
    <span class="line-clamp-2 max-w-full px-4 t-body text-center font-medium leading-tight [overflow-wrap:anywhere]">${r.name}</span>
    <span class=${cx('min-h-3.5 text-[0.75rem] leading-3.5', rosterEditing ? 'text-bad' : sel ? 'text-accent' : 'text-ink-3')}>${rosterEditing ? 'Remove' : on ? (startOf(key) != null ? 'On · ' + fmtClockShort(startOf(key)) : 'On shift') : sel ? 'Selected' : ''}</span>
  </button>`;
}

function Roster({ vm }) {
  const state = vm.state;
  const all = getRoster();
  if (!all.length) return html`<div class="px-4 py-6 text-center leading-relaxed text-ink-2">No saved names yet.<br />Names you add on the Staff tab show up here.</div>`;
  const rolesOn = state.settings.allRoles;
  const onShift = onShiftSet(state);
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const allPicked = avail.length > 0 && avail.every(r => rosterSel.has(r.name.toLowerCase()));
  const groups = !rolesOn ? [{ role: null, people: all }]
    : ROLES.map(role => ({ role, people: all.filter(r => r.role === role) })).filter(g => g.people.length);
  const link = 't-body h-9 px-1 font-semibold text-accent disabled:text-ink-3';
  const starts = new Map(vm.state.staff.filter(p => p.name.trim()).map(p => [p.name.trim().toLowerCase(), times(state, p, vm).inAbs]));
  const startOf = k => starts.get(k) ?? null;
  return html`<div class="flex min-h-9 items-center justify-between">
      ${rosterEditing
        ? html`<span class="t-small text-ink-3">Tap a name to forget it on this device</span>`
        : html`<button class=${link} disabled=${!avail.length} onClick=${() => {
            rosterSel = allPicked ? new Set() : new Set(avail.map(r => r.name.toLowerCase())); rerenderRoster();
          }}>${allPicked ? 'Clear' : 'Select all'}</button>`}
      <button class=${link} onClick=${() => { rosterEditing = !rosterEditing; rerenderRoster(); }}>${rosterEditing ? 'Done' : 'Edit'}</button>
    </div>
    ${groups.map(g => html`<div key=${g.role || 'all'} class="flex flex-col gap-2">
      ${g.role && html`<div class="t-cap mt-1 flex items-center gap-2 px-1 text-ink-3"><span class=${cx('size-2 rounded-full', ROLE_DOT[g.role])}></span>${ROLE_PLURAL[g.role]}</div>`}
      <div class="grid auto-rows-fr grid-cols-3 gap-2.5">${g.people.map(r => html`<${RosterCard} key=${r.name} r=${r} onShift=${onShift} startOf=${startOf} />`)}</div>
    </div>`)}`;
}

// Footer: who starts when. Pick a start (Default or a half-hour around it),
// then Add — repeat for the next group (2 at 4p, 2 at 5p, 1 at 6p …); the
// sheet stays open while saved names are left.
function RosterFoot({ vm }) {
  const n = rosterSel.size;
  if (rosterEditing) return html`<${Button} block onClick=${() => { rosterEditing = false; rerenderRoster(); }}>Done<//>`;
  const gp = parseTime(vm.state.defaults.global.in);
  const def = gp.value != null ? inAbsOf(gp) : 17;
  const chips = [];
  for (let v = def - 2; v <= def + 2.01; v += 0.5) if (v >= IN_MIN_ABS && v <= IN_MAX_ABS && Math.abs(v - def) > 0.01) chips.push(v);
  const chip = (on, label, pick) => html`<button class=${cx('t-small h-8 shrink-0 rounded-full px-3 font-semibold tabular-nums transition active:scale-95',
    on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2')} aria-pressed=${String(on)} onClick=${pick}>${label}</button>`;
  const at = rosterStart == null ? '' : ' · ' + fmtClockShort(rosterStart);
  return html`<div class="flex flex-col gap-2.5">
    ${rosterNote && html`<div class="t-small text-center text-ink-3">${rosterNote}</div>`}
    <div class="flex items-center gap-2">
      <span class="t-cap shrink-0 text-ink-3">Start</span>
      <div class="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        ${chip(rosterStart == null, 'Default ' + fmtClockShort(def), () => { rosterStart = null; rerenderRoster(); })}
        ${chips.map(v => html`<span key=${v}>${chip(rosterStart != null && Math.abs(rosterStart - v) < 0.01, fmtClockShort(v), () => { rosterStart = v; rerenderRoster(); })}</span>`)}
      </div>
    </div>
    <${Button} variant="primary" block disabled=${!n} onClick=${() => App.rosterAddSelected()}>
      ${n ? `Add ${n} ${n === 1 ? 'person' : 'people'}${at}` : 'Select people to add'}<//>
  </div>`;
}

// Picks as [{ name, role, in }] (roster role; `in` = the raw start typed for
// the chosen Start, '' for the default), dropping anyone now on shift.
export function rosterSelected() {
  const inRaw = rosterStart == null ? '' : absToInRaw(rosterStart);
  return getRoster().filter(r => rosterSel.has(r.name.toLowerCase())).map(r => ({ name: r.name, role: r.role, in: inRaw }));
}

// After adding: clear the picks, note who went in at what time.
export function rosterAdded(picks) {
  rosterNote = 'Added ' + picks.map(p => p.name).join(', ') + (rosterStart == null ? '' : ' · ' + fmtClockShort(rosterStart));
  rosterSel = new Set();
  rerenderRoster();
}

function renderRoster(vm) {
  if (!isOpen('sheet-roster')) return;
  const onShift = onShiftSet(vm.state);
  const names = new Set(getRoster().map(r => r.name.toLowerCase()));
  rosterSel = new Set([...rosterSel].filter(k => names.has(k) && !onShift.has(k)));
  render(html`<${Roster} vm=${vm} />`, sheetBody('sheet-roster'));
  render(html`<${RosterFoot} vm=${vm} />`, sheetFoot('sheet-roster'));
}

// ── People table (spreadsheet entry) ─────────────────────────────────────────
// Name · In · Out · Hrs · Close (STAFF_ROW), every cell a control:
//   Name   a real text field. While it's focused, saved names that aren't on
//          shift (matching what's typed) show under the row — tap one to
//          fill it. Return / a pick → this row's In.
//   In/Out tap → the time keypad (ui/keypad.js): type 5, 530, 1045, 5:3 …
//          Next → the next cell (In → Out → next row's name), ↓ / ↑ → the
//          same column a row down / up. Drag sideways → 15-min steps.
//          Set times bright, inherited defaults dim.
//   Hrs    → person editor (role, closer, remove).
//   Close  toggles a forced closer (solid red); auto closer = red tint.
// Each section ends with one blank row ("Add name") — typing in it adds the
// person and a new blank row appears (store.ensureBlankRows).
// In · Out · Hrs: three equal columns with equal gaps (like Summary's),
// each at least 2.75rem and growing with spare width; the name takes the rest.
const STAFF_ROW = 'grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(2.75rem,0.5fr))_2.75rem] items-center gap-x-3 px-3';

// Sections in table order: one per role (roles on), else one "On shift".
// rows = named people, then that section's blank row.
function sections(state) {
  const roles = state.settings.allRoles ? ROLES : [null];
  return roles.map(r => {
    const mine = r ? state.staff.filter(p => p.role === r) : state.staff;
    const people = mine.filter(p => p.name.trim());
    // A row being typed in stays where it is, even while its name is empty.
    const shown = mine.filter(p => p.name.trim() || p.id === nameFocus);
    const blank = mine.find(p => !p.name.trim() && p.id !== nameFocus && p.role === (r || 'bartender'));
    return { role: r, title: r ? ROLE_PLURAL[r] : 'On shift', people, rows: blank ? [...shown, blank] : shown };
  });
}
const flatRows = state => sections(state).flatMap(g => g.rows);

// A typed reading (+ an explicit 'a' / 'p') → absolute time for this person
// (In: that time, or the am/pm rule; Out: the next such time after their In)
// and → the raw string to store.
function absFor(vm, p, field, v, mer = null) {
  const parsed = { value: v, mer };
  if (field === 'in') return inAbsOf(parsed);
  const t = times(vm.state, p, vm);
  return afterAbsOf(parsed, t.inAbs ?? 17);
}
function rawAt(vm, p, field, abs) {
  const def = roleDefaults(vm.state, p.role);
  return field === 'in' ? inRaw(abs, def) : outRaw(abs, def, times(vm.state, p, vm).inAbs);
}

const person = id => lastVm?.state.staff.find(x => x.id === id);
const rerender = () => { if (lastVm) renderStaff(lastVm); };

// Open the keypad on a person's In / Out cell.
export function openTimeCell(id, field) {
  const p0 = person(id);
  if (!p0) return false;
  openKeypad({
    key: id + ':' + field,
    title: (p0.name.trim() || 'New row') + ' · ' + (field === 'in' ? 'In' : 'Out'),
    current: () => {
      const p = person(id), t = p && times(lastVm.state, p, lastVm);
      return t ? (field === 'in' ? t.inAbs : t.outAbs) : null;
    },
    toAbs: (v, mer) => absFor(lastVm, person(id), field, v, mer),
    commit: (v, mer) => {
      const p = person(id);
      const abs = absFor(lastVm, p, field, v, mer);
      App.reviewed((p.name.trim() || 'New row') + ' · ' + (field === 'in' ? 'In ' : 'Out ') + fmtTimeAbs(abs),
        () => App.staffField(id, field, rawAt(lastVm, p, field, abs), true));
    },
    onClear: () => App.staffField(id, field, '', true),
    onMore: p0.name.trim() ? () => App.editStaff(id) : null,
    nav: dir => moveFrom(id, field, dir),
    // Each keystroke previews what the typed time would do (HUD, Summary);
    // closing the keypad (buffer gone) ends the preview.
    onChange: () => {
      rerender();
      const a = bufferAbs(), p = person(id);
      App.previewStaff(id, field, a == null || !p ? null : rawAt(lastVm, p, field, a));
    },
  });
  return true;
}

// Spreadsheet moves, by focusing the target cell (a time cell's focus opens
// the keypad on it; a name takes the system keyboard). Next / Tab: Name → In
// → Out → the next row's Name. Back / Shift-Tab: the reverse. ↓ / ↑: the
// same column a row down / up.
const COLS = ['name', 'in', 'out'];
function moveFrom(id, field, dir) {
  const rows = flatRows(lastVm.state);
  const i = rows.findIndex(p => p.id === id);
  const c = COLS.indexOf(field);
  let r = i, col = c;
  if (dir === 'next') { col = c + 1; if (col === COLS.length) { col = 0; r = i + 1; } }
  else if (dir === 'prev') { col = c - 1; if (col < 0) { col = COLS.length - 1; r = i - 1; } }
  else r = i + (dir === 'down' ? 1 : -1);
  const n = rows[r];
  if (!n) return false;
  return focusCell(COLS[col] === 'name' ? 'name:' + n.id : n.id + ':' + COLS[col]);
}

// ── Name cell + saved-name suggestions ──
let nameFocus = null;          // id of the row whose name field has focus

function NameCell({ p }) {
  return html`<input data-kcell=${'name:' + p.id} class=${cx('h-10 w-full min-w-0 rounded-lg bg-transparent px-1.5 text-[0.9375rem] font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-ink-3 focus:bg-accent/12 focus:ring-2 focus:ring-inset focus:ring-accent')}
    value=${p.name} placeholder="Add name" aria-label="Name"
    autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="next"
    onFocus=${() => { closeKeypad(); nameFocus = p.id; rerender(); }}
    onBlur=${() => { if (nameFocus === p.id) { nameFocus = null; App.rememberStaff(p.id); rerender(); } }}
    onInput=${e => App.staffField(p.id, 'name', e.target.value)}
    onKeyDown=${e => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        App.staffField(p.id, 'name', e.target.value, true);
        if (e.key === 'Tab' && e.shiftKey) moveFrom(p.id, 'name', 'prev');
        else if (e.target.value.trim() || e.key === 'Tab') moveFrom(p.id, 'name', 'next');
        else e.target.blur();
      } else if (e.key === 'ArrowDown') { e.preventDefault(); moveFrom(p.id, 'name', 'down'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveFrom(p.id, 'name', 'up'); }
    }} />`;
}

// Saved names not on shift, best matches first (starts-with, then contains).
function Suggestions({ vm, p }) {
  const q = p.name.trim().toLowerCase();
  const onShift = onShiftSet(vm.state);
  const rolesOn = vm.state.settings.allRoles;
  const pool = getRoster().filter(r => !onShift.has(r.name.toLowerCase()) || r.name.toLowerCase() === q);
  const hits = pool
    .filter(r => r.name.toLowerCase() !== q)
    .map(r => ({ r, k: !q ? (rolesOn && r.role === p.role ? 0 : 1) : r.name.toLowerCase().startsWith(q) ? 0 : r.name.toLowerCase().includes(q) ? 1 : 9 }))
    .filter(x => x.k < 9)
    .sort((a, b) => a.k - b.k)
    .slice(0, 16);
  if (!hits.length) return null;
  // A pick keeps the role it was saved with (roles on), like Quick add.
  const pick = name => {
    const saved = getRoster().find(r => r.name === name);
    if (rolesOn && saved && saved.role !== p.role) App.staffField(p.id, 'role', saved.role, true);
    App.staffField(p.id, 'name', name, true);
    App.rememberStaff(p.id);
    nameFocus = null;
    focusCell(p.id + ':in');
  };
  return html`<div class="overflow-x-auto bg-accent/6 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-kcell="suggest">
    <div class="flex w-max gap-1.5">
      ${hits.map(({ r }) => html`<button key=${r.name} type="button"
        class="t-small inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 font-semibold text-ink shadow-[0_1px_0_rgb(0_0_0/.08)] active:scale-95"
        onPointerDown=${e => e.preventDefault()} onClick=${() => pick(r.name)}>
        ${rolesOn && html`<span class=${cx('size-1.5 rounded-full', ROLE_DOT[r.role])}></span>`}${r.name}</button>`)}
    </div>
  </div>`;
}

// A person's In / Out in the table: keypad cell + drag. Set like Summary's
// times (TIME_TEXT: smaller number, "am" / "pm" under it, medium weight);
// a typed time reads ink-2 medium, one that follows the default regular ink-3 (fainter) — the same "pinned to default" look as Summary. `mins`: the column
// shows minutes on every row (one has them).
const TABLE_TIME = 'h-10 w-full rounded-lg transition ' + TIME_TEXT;
function TimeCell({ vm, p, field, mins }) {
  const t = times(vm.state, p, vm);
  const k = pickerFor(vm, p, field);
  const key = p.id + ':' + field;
  const active = activeKey() === key;
  return html`<${DragTime} abs=${field === 'in' ? t.inAbs : t.outAbs} set=${field === 'in' ? t.inSet : t.outSet} bad=${t.bad}
    min=${k.min} max=${k.max} onSet=${k.onSet} onPreview=${k.onPreview} onTap=${() => openTimeCell(p.id, field)}
    kcell=${key} active=${active} preview=${active ? bufferAbs() : null}
    cls=${field === 'out' ? TABLE_TIME + ' ' + ARROW_BEFORE('0.75rem') : TABLE_TIME} tone=${(field === 'in' ? t.inSet : t.outSet) ? 'font-medium text-ink-2' : 'font-normal text-ink-3/80'} mins=${mins}
    label=${(p.name || 'New row') + ' ' + field + ' time'} />`;
}

// A person's In / Out elsewhere (Summary rows): tap → quick time sheet.
function TimePill({ vm, p, field, cls, tone, full, mins }) {
  const t = times(vm.state, p, vm);
  const k = pickerFor(vm, p, field);
  return html`<${DragTime} abs=${field === 'in' ? t.inAbs : t.outAbs} set=${field === 'in' ? t.inSet : t.outSet} bad=${t.bad}
    min=${k.min} max=${k.max} onSet=${k.onSet} onPreview=${k.onPreview} onTap=${() => App.editTime(p.id, field)} cls=${cls} tone=${tone} full=${full} mins=${mins}
    label=${p.name + ' ' + field + ' time'} />`;
}

// By staff id (Summary's payout rows).
export function StaffTime({ vm, id, field, cls, tone, full, mins }) {
  const p = vm.state.staff.find(x => x.id === id);
  return p ? html`<${TimePill} vm=${vm} p=${p} field=${field} cls=${cls} tone=${tone} full=${full} mins=${mins} />` : null;
}

// The shift's default open / close (defaults.global). Tap → shift panel at
// its times; drag writes the new default.
export function DefaultTime({ vm, field, cls, tone, full, mins }) {
  const g = vm.state.defaults.global;
  const gi = parseTime(g.in), go = parseTime(g.out);
  const inAbs = gi.value != null ? inAbsOf(gi) : null;
  const outAbs = go.value != null && inAbs != null ? afterAbsOf(go, inAbs) : null;
  const isIn = field === 'in';
  return html`<${DragTime} abs=${isIn ? inAbs : outAbs} set=${true}
    min=${isIn ? IN_MIN_ABS : (inAbs ?? 17) + 0.25} max=${isIn ? IN_MAX_ABS : (inAbs ?? 17) + 12}
    onSet=${abs => App.reviewed('Default ' + (isIn ? 'open ' : 'close ') + fmtTimeAbs(abs),
      () => App.globalDefault(field, isIn ? absToInRaw(abs) : absToOutRaw(abs, inAbs), true))}
    onPreview=${abs => App.previewDefault(field, abs == null ? null : isIn ? absToInRaw(abs) : absToOutRaw(abs, inAbs))}
    onTap=${() => App.openDefaults()} cls=${cls} tone=${tone} full=${full} mins=${mins} label=${'Default ' + (isIn ? 'open' : 'close') + ' time'} />`;
}

function PersonRow({ vm, p, i = 0, col = {} }) {
  const named = !!p.name.trim();
  const t = times(vm.state, p, vm);
  const closer = t.forced ? 'bg-bad text-white'
    : t.closer ? 'bg-bad/25 text-bad' : 'bg-surface-2 text-transparent';
  // Swipe a named row left → Remove (Undo · Apply in the HUD).
  return html`<${SwipeRow} enabled=${named} onAction=${() => App.reviewed('Removed ' + p.name.trim(), () => App.removePerson(p.id))}>
  <div class=${cx(STAFF_ROW, 'min-h-[3.375rem] py-1.5', zebra(i), !named && 'opacity-80')}>
    <${NameCell} p=${p} />
    <${TimeCell} vm=${vm} p=${p} field="in" mins=${col.inMins} />
    <${TimeCell} vm=${vm} p=${p} field="out" mins=${col.outMins} />
    ${named
      ? html`<button class=${cx('t-body h-11 rounded-lg text-center font-medium tabular-nums active:bg-ink/10', t.hrs == null ? 'text-bad' : 'text-ink/80')}
          onClick=${() => App.editStaff(p.id)} aria-label=${p.name + ' — more'}>${t.hrs != null ? hrsText(t.hrs, col.hdp) : '?'}</button>
        <button class="grid h-11 place-items-center" onClick=${() => App.toggleCloser(p.id)}
          aria-pressed=${String(t.forced)} aria-label=${p.name + ' closer'}>
          <span class=${cx('grid size-8 place-items-center rounded-full transition', closer)}><${Icon} name="check" class="size-4" /></span>
        </button>`
      : html`<span></span><span></span>`}
  </div><//>
  ${nameFocus === p.id && html`<${Suggestions} vm=${vm} p=${p} />`}`;
}

// One card per section: header row, the people, the blank row, then the
// section's default times (tap → shift panel at its times).
function Group({ vm, role, title, people, rows }) {
  const def = roleDefaults(vm.state, role || 'bartender');
  // One look per column, like Summary: minutes on every row of a time column
  // if any time in it has them; Hrs padded to the most decimals any row has.
  const ts = rows.filter(p => p.name.trim()).map(p => times(vm.state, p, vm));
  const col = {
    inMins: hasMinutes(ts.map(t => t.inAbs)),
    outMins: hasMinutes(ts.map(t => t.outAbs)),
    hdp: Math.max(0, ...ts.filter(t => t.hrs != null).map(t => hrsDecimals(t.hrs))),
  };
  const heading = html`${role && html`<span class=${cx('size-2 shrink-0 rounded-full', ROLE_DOT[role])}></span>`}${title}${people.length > 0 && html`<span class="text-ink-3">${people.length}</span>`}`;
  return html`<${Section} title=${heading}><${Card} flush>
    <${Sentinel} /><div class=${cx(STAFF_ROW, THEAD, 'h-9 data-[stuck]:h-7')}>
      <span class=${cx(TABLE_HEAD, 'pl-1.5 text-left')}>Name</span>
      <span class=${TABLE_HEAD}>In</span><span class=${TABLE_HEAD}>Out</span><span class=${TABLE_HEAD}>Hrs</span>
      <span class=${cx(TABLE_HEAD, 'tracking-normal')}>Close</span>
    </div>
    ${rows.map((p, i) => html`<${PersonRow} key=${p.id} vm=${vm} p=${p} i=${i} col=${col} />`)}
    <button class="t-small flex h-11 w-full items-center gap-2 border-t border-line px-4 text-ink-3 transition active:bg-surface-2"
      onClick=${() => App.openDefaults()} aria-label="Default times">
      <${Icon} name="clock" class="size-4 text-ink-3" />Defaults<span class="ml-auto font-semibold tabular-nums text-ink">${defaultsLabel(def)}</span><${Icon} name="chevR" class="size-4 text-ink-3" />
    </button>
  <//><//>`;
}

function Staff({ vm }) {
  const state = vm.state;
  const named = state.staff.filter(p => p.name.trim());
  const groups = sections(state);
  // Staff is done once everyone named has valid times (no staff-side error).
  const done = named.length > 0 && vm.blockedTab !== 'staff';
  const hours = done && vm.resolved.staff.filter(p => p.role !== 'support').reduce((t, p) => t + p.hours, 0);
  return html`<div class="flex flex-col gap-4">
    <${Note} vm=${vm} />
    <${QuickAdd} vm=${vm} />
    ${groups.map(g => html`<${Group} key=${g.role || 'all'} vm=${vm} ...${g} />`)}
    <p class="t-small px-6 text-center text-ink-3">Type a name, then times on the keypad (530 = 5:30) — Next moves along the row, ↓ down the column. Drag a time to nudge it; tap Hrs for more. Faded times are the defaults.</p>
    ${done && (vm.totalCash > 0 && !vm.blocked
      ? html`<${NextStep} tab="summary" label="See who gets what" sub=${fmtMoney(vm.totalCash) + ' over ' + fmtHrs(hours) + ' hours'} />`
      : html`<${NextStep} tab="tips" label="Next: enter the tips" sub=${named.length + ' on shift · ' + fmtHrs(hours) + ' hours'} />`)}
  </div>`;
}

// ── Person editor sheet ──────────────────────────────────────────────────────

let editId = null;
let lastVm = null;
onSheetClose('sheet-staff', () => { editId = null; });

export function openStaffEditor(id, { focusName = false } = {}) {
  editId = id;
  openSheet('sheet-staff');
  if (lastVm) renderEditor(lastVm);
  if (focusName) sheetBody('sheet-staff')?.querySelector('input[aria-label="Name"]')?.focus();
}

// A row of half-hour chips around the default, scrolled to the current value.
function ChipRow({ values, current, onPick, fmt }) {
  const row = useRef(null);
  useLayoutEffect(() => {
    const el = row.current;
    let sel = el?.querySelector('[aria-pressed="true"]');
    if (el && !sel && current != null) {
      sel = [...el.querySelectorAll('[data-v]')].reduce((best, b) =>
        !best || Math.abs(+b.dataset.v - current) < Math.abs(+best.dataset.v - current) ? b : best, null);
    }
    if (el && sel) el.scrollLeft = sel.offsetLeft - el.clientWidth / 2 + sel.offsetWidth / 2;
  }, [current]);
  return html`<div ref=${row} class="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <div class="flex w-max gap-1.5 px-0.5 py-0.5">
      ${values.map(v => {
        const on = current != null && Math.abs(v - current) < 0.01;
        return html`<button key=${v} data-v=${v} aria-pressed=${String(on)} onClick=${() => onPick(v)}
          class=${cx('t-small h-9 rounded-full px-3.5 font-semibold tabular-nums transition active:scale-95', on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2')}>${fmt(v)}</button>`;
      })}
    </div>
  </div>`;
}

function TimePicker({ label, abs, isSet, defAbs, min, max, onSet, onReset }) {
  const step = d => { if (abs != null) onSet(Math.min(max, Math.max(min, abs + d))); };
  const chips = [];
  const center = defAbs ?? abs ?? min;
  for (let v = Math.ceil((center - 3) * 2) / 2; v <= center + 3; v += 0.5) if (v >= min && v <= max) chips.push(v);
  const sb = 'grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-[1.5rem] text-ink transition active:scale-95 disabled:opacity-30';
  return html`<div class="flex flex-col gap-3 rounded-card bg-surface p-3.5">
    <div class="flex items-center gap-3">
      <span class="t-cap w-10 text-ink-3">${label}</span>
      <button class=${sb} onClick=${() => step(-0.25)} disabled=${abs == null || abs <= min} aria-label=${label + ' 15 minutes earlier'}>−</button>
      <span class=${cx('flex-1 text-center text-[2rem] font-semibold tabular-nums tracking-tight', !isSet && 'text-ink-2')}>${abs != null ? fmtTimeAbs(abs) : '—'}</span>
      <button class=${sb} onClick=${() => step(0.25)} disabled=${abs == null || abs >= max} aria-label=${label + ' 15 minutes later'}>+</button>
    </div>
    <${ChipRow} values=${chips} current=${abs} onPick=${onSet} fmt=${fmtTimeAbs} />
    <div class="t-small flex items-center justify-between px-0.5">
      <span class="text-ink-3">${isSet ? 'Set for this person' : 'Using the default'}</span>
      ${isSet && html`<button class="font-semibold text-accent" onClick=${onReset}>Use default${defAbs != null ? ' · ' + fmtTimeAbs(defAbs) : ''}</button>`}
    </div>
  </div>`;
}

// Props for one time's <TimePicker> (In or Out) of a person.
function pickerFor(vm, p, field) {
  const t = times(vm.state, p, vm);
  const def = t.def;
  const set = raw => App.staffField(p.id, field, raw, true);
  // A drag / picker write waits for Undo · Apply in the HUD (App.reviewed).
  const said = abs => (p.name.trim() || 'New row') + ' · ' + (field === 'in' ? 'In ' : 'Out ') + fmtTimeAbs(abs);
  if (field === 'in') {
    const dp = parseTime(def.in);
    return { label: 'In', abs: t.inAbs, isSet: t.inSet, defAbs: dp.value != null ? inAbsOf(dp) : null,
      min: IN_MIN_ABS, max: IN_MAX_ABS, onSet: abs => App.reviewed(said(abs), () => set(inRaw(abs, def))), onReset: () => set(''),
      onPreview: abs => App.previewStaff(p.id, field, abs == null ? null : inRaw(abs, def)) };
  }
  const dp = parseTime(def.out);
  return { label: 'Out', abs: t.outAbs, isSet: t.outSet, defAbs: dp.value != null && t.inAbs != null ? afterAbsOf(dp, t.inAbs) : null,
    min: (t.inAbs ?? 17) + 0.25, max: (t.inAbs ?? 17) + 12, onSet: abs => App.reviewed(said(abs), () => set(outRaw(abs, def, t.inAbs))), onReset: () => set(''),
    onPreview: abs => App.previewStaff(p.id, field, abs == null ? null : outRaw(abs, def, t.inAbs)) };
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
    <${TimePicker} ...${pickerFor(vm, p, 'in')} />
    <${TimePicker} ...${pickerFor(vm, p, 'out')} />
    <div class="t-body flex items-center justify-between rounded-card bg-surface px-4 py-3">
      <span class="text-ink-2">${t.hrs != null ? fmtHrs(t.hrs) + ' hours' : 'Check the times'}</span>
      ${share && html`<span class="text-ink-2">takes home <b class="t-head text-ink">$${share.final}</b></span>`}
    </div>
    <${List}>
      <${SwitchRow} on=${t.forced} onClick=${() => App.toggleCloser(p.id)} label="Closer"
        hint=${t.forced ? 'Forced — shares the closer bonus' : t.closer ? 'Auto: out at the close time' : 'Shares the dollars left after rounding'} />
    <//>
    <div class="flex gap-2">
      <${Button} class="flex-1" disabled=${!t.inSet && !t.outSet} onClick=${() => { set('in', ''); set('out', ''); }}>Reset times<//>
      <${Button} variant="danger" class="flex-1" icon="trash" onClick=${() => { App.removePerson(p.id); }}>Remove<//>
    </div>`;
}

// Quick time sheet: one person's In or Out, opened from its table cell.
let timeEdit = null;          // { id, field }
onSheetClose('sheet-time', () => { timeEdit = null; });

export function openTimeEditor(id, field) {
  timeEdit = { id, field };
  openSheet('sheet-time');
  if (lastVm) renderTimeEditor(lastVm);
}

function TimeEditor({ vm, p, field }) {
  const t = times(vm.state, p, vm);
  const other = field === 'in' ? 'out' : 'in';
  return html`
    <${Seg} value=${field} onChange=${f => openTimeEditor(p.id, f)}
      items=${[{ value: 'in', label: 'In · ' + (t.inAbs != null ? fmtClockShort(t.inAbs) : '—') }, { value: 'out', label: 'Out · ' + (t.outAbs != null ? fmtClockShort(t.outAbs) : '—') }]} />
    <${TimePicker} key=${field} ...${pickerFor(vm, p, field)} />
    <div class="t-body flex items-center justify-between px-1 text-ink-2">
      <span>${t.hrs != null ? fmtHrs(t.hrs) + ' hours' : 'Check the times'}</span>
      <button class="font-semibold text-accent" onClick=${() => openTimeEditor(p.id, other)}>${field === 'in' ? 'Set out time →' : '← Set in time'}</button>
    </div>
    <${Button} variant="primary" block onClick=${() => App.closeSheet('sheet-time')}>Done<//>`;
}

function renderTimeEditor(vm) {
  if (!timeEdit || !isOpen('sheet-time')) return;
  const p = vm.state.staff.find(x => x.id === timeEdit.id);
  if (!p) { closeSheet('sheet-time'); return; }
  setSheetTitle('sheet-time', (p.name.trim() || 'Person') + ' · ' + (timeEdit.field === 'in' ? 'In' : 'Out'));
  render(html`<${TimeEditor} vm=${vm} p=${p} field=${timeEdit.field} />`, sheetBody('sheet-time'));
}

function renderEditor(vm) {
  if (!editId || !isOpen('sheet-staff')) return;
  const p = vm.state.staff.find(x => x.id === editId);
  if (!p) { closeSheet('sheet-staff'); return; }
  setSheetTitle('sheet-staff', p.name.trim() || 'New person');
  render(html`<${Editor} vm=${vm} p=${p} />`, sheetBody('sheet-staff'));
}

// ── Render ───────────────────────────────────────────────────────────────────

export function renderStaff(vm) {
  lastVm = vm;
  const root = $('staff-root');
  if (root) render(html`<${Staff} vm=${vm} />`, root);
  renderEditor(vm);
  renderTimeEditor(vm);
  renderRoster(vm);
}
