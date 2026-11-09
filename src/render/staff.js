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
import { fmtHrs } from '../util.js';
import { parseTime, fmtTimeAbs, fmtClockShort, resolveIn, nextAfter, absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { getRoster } from '../roster.js';
import { html, render, useState, useRef, useLayoutEffect } from '../ui/preact.js';
import { cx, Icon, Card, Button, Avatar, Alert, Seg, SwitchRow, Section, INPUT, ROLE_DOT, ROLE_PLURAL, TABLE_HEAD } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, sheetFoot, setSheetTitle, onSheetClose } from '../ui/sheet.js';
import { activeSub } from './tabs.js';

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
  const inAbs = res?.inAbs ?? (inP.value != null ? resolveIn(inP.value) : null);
  const outAbs = res?.outAbs ?? (outP.value != null && inAbs != null ? nextAfter(outP.value, inAbs) : null);
  const bad = !inP.valid || !outP.valid;
  const hrs = inAbs != null && outAbs != null && outAbs > inAbs && outAbs - inAbs <= 12 ? outAbs - inAbs : null;
  return {
    def, inAbs, outAbs, hrs, bad,
    inSet: !!person.in.trim(), outSet: !!person.out.trim(),
    closer: !!res?.closer, forced: !!person.closerOverride,
  };
}

function inRaw(abs, def) {
  const raw = absToInRaw(Math.min(IN_MAX_ABS, Math.max(IN_MIN_ABS, abs)));
  return parseTime(def.in).value === Number(raw) ? '' : raw;
}
function outRaw(abs, def) {
  const raw = absToOutRaw(abs);
  return parseTime(def.out).value === Number(raw) ? '' : raw;
}

function defaultsLabel(def) {
  const i = parseTime(def.in), o = parseTime(def.out);
  const inAbs = i.value != null ? resolveIn(i.value) : null;
  return (inAbs != null ? fmtClockShort(inAbs) : '—') + ' – ' + (o.value != null ? fmtClockShort(nextAfter(o.value, inAbs ?? 17)) : '—');
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
  if (vm.inputError && vm.blocked) warnings.push(vm.blocked);
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) warnings.push(p.name + ' is out after the close time');
    });
  }
  return html`<div class="px-1 text-[14px] text-ink-2">${parts.join(' · ')}</div>
    ${warnings.map(w => html`<${Alert} key=${w} tone="warn">${w}<//>`)}`;
}

// ── Quick add: entry card + saved-people picker sheet ──────────────────────
// The card shows who's saved and not on shift; it opens a grid of person
// cards to multi-select (Select all, Edit forgets), then "Add N people".
// New names are added from each table's "+ Add …" row.

const onShiftSet = state => new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));

function QuickAdd({ vm }) {
  const all = getRoster();
  if (!all.length) return html`<p class="px-1 text-[13px] text-ink-3">Names you add are saved for quick adding next shift.</p>`;
  const onShift = onShiftSet(vm.state);
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const show = (avail.length ? avail : all).slice(0, 3);
  return html`<button class="flex min-h-16 w-full items-center gap-3 rounded-card bg-surface py-2.5 pl-3.5 pr-3 text-left transition active:scale-[.98] active:bg-raised"
    onClick=${() => App.openRoster()}>
    <span class="flex shrink-0 -space-x-1.5">${show.map((r, i) => html`<span key=${r.name} class="rounded-full ring-2 ring-surface"><${Avatar} name=${r.name} index=${i} /></span>`)}</span>
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-[17px] font-semibold">Quick add</span>
      <span class="text-[13px] text-ink-2">${avail.length ? `${avail.length} saved ${avail.length === 1 ? 'person' : 'people'} not on shift` : 'Everyone saved is on this shift'}</span>
    </span>
    <${Icon} name="chevR" class="size-5 text-ink-3" />
  </button>`;
}

let rosterSel = new Set();      // lowercased names picked in the sheet
let rosterEditing = false;
onSheetClose('sheet-roster', () => { rosterSel = new Set(); rosterEditing = false; });

export function openRosterSheet() {
  rosterSel = new Set();
  rosterEditing = false;
  openSheet('sheet-roster');
  if (lastVm) renderRoster(lastVm);
}
const rerenderRoster = () => { if (lastVm) renderRoster(lastVm); };

function RosterCard({ r, onShift, idx }) {
  const key = r.name.toLowerCase();
  const on = onShift.has(key);
  const sel = rosterSel.has(key);
  const tap = () => {
    if (rosterEditing) { App.forgetName(r.name); return; }
    if (sel) rosterSel.delete(key); else rosterSel.add(key);
    rerenderRoster();
  };
  const mark = rosterEditing ? 'bg-red text-white' : sel ? 'bg-gold text-gold-ink' : on ? 'bg-ink-3 text-surface' : 'bg-white/10';
  return html`<button class=${cx('relative flex min-h-[116px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 transition active:scale-95',
      sel ? 'bg-gold/20 ring-2 ring-inset ring-gold' : 'bg-white/[.08]', on && !rosterEditing && 'opacity-45')}
    onClick=${tap} disabled=${on && !rosterEditing} aria-pressed=${String(sel)}>
    <span class=${cx('absolute right-2 top-2 grid size-[22px] place-items-center rounded-full text-[12px] font-extrabold', mark)} aria-hidden="true">${rosterEditing ? '✕' : sel || on ? '✓' : ''}</span>
    <${Avatar} name=${r.name} index=${idx} size="lg" />
    <span class="line-clamp-2 max-w-full text-center text-[15px] font-semibold leading-tight [overflow-wrap:anywhere]">${r.name}</span>
    <span class=${cx('min-h-3.5 text-[12px] leading-3.5', rosterEditing ? 'text-red' : sel ? 'text-gold' : 'text-ink-3')}>${rosterEditing ? 'Remove' : on ? 'On shift' : sel ? 'Selected' : ''}</span>
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
  const link = 'h-9 px-1 text-[16px] font-semibold text-gold disabled:text-ink-3';
  return html`<div class="flex min-h-9 items-center justify-between">
      ${rosterEditing
        ? html`<span class="text-[13px] text-ink-2">Tap a name to forget it on this device</span>`
        : html`<button class=${link} disabled=${!avail.length} onClick=${() => {
            rosterSel = allPicked ? new Set() : new Set(avail.map(r => r.name.toLowerCase())); rerenderRoster();
          }}>${allPicked ? 'Clear' : 'Select all'}</button>`}
      <button class=${link} onClick=${() => { rosterEditing = !rosterEditing; rerenderRoster(); }}>${rosterEditing ? 'Done' : 'Edit'}</button>
    </div>
    ${groups.map(g => html`<div key=${g.role || 'all'} class="flex flex-col gap-2">
      ${g.role && html`<div class="mt-1 flex items-center gap-2 text-[14px] font-semibold text-ink-2"><span class=${cx('size-2 rounded-full', ROLE_DOT[g.role])}></span>${ROLE_PLURAL[g.role]}</div>`}
      <div class="grid auto-rows-fr grid-cols-3 gap-2.5">${g.people.map(r => html`<${RosterCard} key=${r.name} r=${r} onShift=${onShift} idx=${all.indexOf(r)} />`)}</div>
    </div>`)}`;
}

function RosterFoot() {
  const n = rosterSel.size;
  if (rosterEditing) return html`<${Button} block onClick=${() => { rosterEditing = false; rerenderRoster(); }}>Done<//>`;
  return html`<${Button} variant="primary" block disabled=${!n} onClick=${() => App.rosterAddSelected()}>
    ${n ? `Add ${n} ${n === 1 ? 'person' : 'people'}` : 'Select people to add'}<//>`;
}

// Picks as [{ name, role }] (roster role), dropping anyone now on shift.
export function rosterSelected() {
  return getRoster().filter(r => rosterSel.has(r.name.toLowerCase())).map(r => ({ name: r.name, role: r.role }));
}

function renderRoster(vm) {
  if (!isOpen('sheet-roster')) return;
  const onShift = onShiftSet(vm.state);
  const names = new Set(getRoster().map(r => r.name.toLowerCase()));
  rosterSel = new Set([...rosterSel].filter(k => names.has(k) && !onShift.has(k)));
  render(html`<${Roster} vm=${vm} />`, sheetBody('sheet-roster'));
  render(html`<${RosterFoot} />`, sheetFoot('sheet-roster'));
}

// ── People list ──────────────────────────────────────────────────────────────
// ── People list ──────────────────────────────────────────────────────────────

// Staff table: name · In · Out · Hrs · Closer at 3 : 2 : 2 : 1 : 1, every
// cell its own control —
//   name     → person editor (name, role, both times, closer, remove)
//   In / Out → quick time sheet for just that time (±15 min, half-hour chips,
//              use default); set times bright, inherited defaults faded
//   closer   → toggles a forced closer (solid red); an auto closer (out at the
//              close time) shows an outlined red check.
const STAFF_ROW = 'grid grid-cols-[3fr_2fr_2fr_1fr_1fr] items-center gap-x-1.5 px-3';
const CELL = 'h-10 w-full rounded-xl text-center text-[16px] tabular-nums transition';
const PX_PER_STEP = 18;        // horizontal drag distance per 15 minutes

// In / Out pill. Tap → quick time sheet. Drag sideways → 15-min steps
// (right = later), previewed in gold while dragging, written on release.
// Set times are filled bright, inherited defaults dim.
function TimePill({ vm, p, field, abs, set, bad }) {
  const [drag, setDrag] = useState(null);         // { x0, abs0, abs, moved }
  const pick = () => pickerFor(vm, p, field);
  const clamp = (v, k) => Math.min(k.max, Math.max(k.min, v));
  const down = e => {
    if (abs == null || bad) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, abs0: abs, abs, moved: false });
  };
  const move = e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 6) return;
    const next = clamp(drag.abs0 + Math.round(dx / PX_PER_STEP) * 0.25, pick());
    if (next !== drag.abs || !drag.moved) {
      if (next !== drag.abs) try { navigator.vibrate?.(4); } catch { /* optional */ }
      setDrag({ ...drag, abs: next, moved: true });
    }
  };
  const up = () => {
    const d = drag;
    setDrag(null);
    if (!d || !d.moved) { App.editTime(p.id, field); return; }
    if (d.abs !== d.abs0) pick().onSet(d.abs);
  };
  const shown = drag?.moved ? drag.abs : abs;
  return html`<button data-drag class=${cx(CELL, 'touch-pan-y select-none',
      drag?.moved ? 'scale-105 bg-gold font-bold text-gold-ink shadow-[0_6px_18px_-6px_rgb(255_210_63/.7)]'
        : bad ? 'bg-red/20 font-semibold text-red'
        : set ? 'bg-white/[.16] font-semibold text-ink' : 'bg-white/[.06] text-ink-3')}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${() => setDrag(null)}
    aria-label=${p.name + ' ' + field + ' time — tap to edit, drag sideways to adjust'}>
    ${bad ? '?' : shown != null ? fmtClockShort(shown) : '—'}</button>`;
}

function PersonRow({ vm, p }) {
  const t = times(vm.state, p, vm);
  const closer = t.forced ? 'bg-red text-white'
    : t.closer ? 'bg-red/25 text-red' : 'bg-white/[.08] text-transparent';
  return html`<div class=${cx(STAFF_ROW, 'min-h-[54px] border-t border-sep py-1.5')}>
    <button class="flex min-w-0 items-center gap-1 text-left active:opacity-60" onClick=${() => App.editStaff(p.id)}>
      <span class="truncate text-[20px] font-semibold">${p.name}</span>
      <${Icon} name="chevR" class="size-3.5 text-ink-3" />
    </button>
    <${TimePill} vm=${vm} p=${p} field="in" abs=${t.inAbs} set=${t.inSet} bad=${t.bad} />
    <${TimePill} vm=${vm} p=${p} field="out" abs=${t.outAbs} set=${t.outSet} bad=${t.bad} />
    <span class=${cx('text-center text-[16px] font-medium tabular-nums', t.hrs == null ? 'text-red' : 'text-ink-2')}>${t.hrs != null ? fmtHrs(t.hrs) : '?'}</span>
    <button class="grid h-10 place-items-center" onClick=${() => App.toggleCloser(p.id)}
      aria-pressed=${String(t.forced)} aria-label=${p.name + ' closer'}>
      <span class=${cx('grid size-7 place-items-center rounded-full transition', closer)}><${Icon} name="check" class="size-4" /></span>
    </button>
  </div>`;
}

// One card per role (or "On shift"): header row with the columns, the
// people, and a footer row showing the role's default times (tap → shift
// panel at its times).
function Group({ vm, role, people, title }) {
  const def = roleDefaults(vm.state, role || 'bartender');
  const heading = html`${role && html`<span class=${cx('size-2 shrink-0 rounded-full', ROLE_DOT[role])}></span>`}${title}${people.length > 0 && html`<span class="text-ink-3">${people.length}</span>`}`;
  return html`<${Section} title=${heading}><${Card} flush>
    ${people.length > 0 && html`<div class=${cx(STAFF_ROW, 'h-9')}>
      <span class=${cx(TABLE_HEAD, 'text-left')}>Name</span>
      <span class=${TABLE_HEAD}>In</span><span class=${TABLE_HEAD}>Out</span><span class=${TABLE_HEAD}>Hrs</span>
      <span class=${cx(TABLE_HEAD, 'tracking-normal')}>Close</span>
    </div>`}
    ${people.length
      ? people.map(p => html`<${PersonRow} key=${p.id} vm=${vm} p=${p} />`)
      : null}
    <button class="flex h-12 w-full items-center gap-2 border-t border-sep px-4 text-[16px] font-semibold text-gold transition active:bg-raised"
      onClick=${() => App.addBlank(role || 'bartender')}><${Icon} name="plus" class="size-[18px]" />${role ? 'Add ' + ROLE_ONE[role] : 'Add person'}</button>
    <button class="flex h-11 w-full items-center gap-2 border-t border-sep bg-raised/60 px-4 text-[14px] text-ink-2 transition active:bg-raised"
      onClick=${() => App.openDefaults()} aria-label="Default times">
      <${Icon} name="clock" class="size-4 text-ink-3" />Defaults<span class="ml-auto font-semibold tabular-nums text-ink">${defaultsLabel(def)}</span><${Icon} name="chevR" class="size-4 text-ink-3" />
    </button>
  <//><//>`;
}

function Staff({ vm }) {
  const state = vm.state;
  const sub = activeSub('staff', state);
  const named = state.staff.filter(p => p.name.trim());
  const groups = !state.settings.allRoles
    ? [{ role: null, title: 'On shift', people: named }]
    : ROLES.filter(r => !sub || sub === 'all' || sub === r)
      .map(r => ({ role: r, title: ROLE_PLURAL[r], people: named.filter(p => p.role === r) }));
  return html`<div class="flex flex-col gap-4" data-has-staff=${named.length > 0 ? '' : undefined}>
    <${Note} vm=${vm} />
    <${QuickAdd} vm=${vm} />
    ${groups.map(g => html`<${Group} key=${g.role || 'all'} vm=${vm} ...${g} />`)}
    ${named.length > 0 && html`<p class="px-6 text-center text-[13px] leading-snug text-ink-3">Tap a time to change it, the circle to make someone a closer, or a name for more. Faded times are the defaults.</p>`}
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
          class=${cx('h-10 rounded-full px-3.5 text-[15px] font-semibold tabular-nums transition active:scale-95', on ? 'bg-gold text-gold-ink' : 'bg-fill text-ink-2')}>${fmt(v)}</button>`;
      })}
    </div>
  </div>`;
}

function TimePicker({ label, abs, isSet, defAbs, min, max, onSet, onReset }) {
  const step = d => { if (abs != null) onSet(Math.min(max, Math.max(min, abs + d))); };
  const chips = [];
  const center = defAbs ?? abs ?? min;
  for (let v = Math.ceil((center - 3) * 2) / 2; v <= center + 3; v += 0.5) if (v >= min && v <= max) chips.push(v);
  const sb = 'grid size-12 shrink-0 place-items-center rounded-full bg-fill text-[26px] text-ink transition active:bg-high disabled:opacity-30';
  return html`<div class="flex flex-col gap-2.5 rounded-2xl bg-raised p-3.5">
    <div class="flex items-center gap-3">
      <span class="w-10 text-[13px] font-bold uppercase tracking-wider text-ink-2">${label}</span>
      <button class=${sb} onClick=${() => step(-0.25)} disabled=${abs == null || abs <= min} aria-label=${label + ' 15 minutes earlier'}>−</button>
      <span class=${cx('flex-1 text-center font-rounded text-[34px] font-bold tabular-nums tracking-tight', !isSet && 'text-ink-2')}>${abs != null ? fmtTimeAbs(abs) : '—'}</span>
      <button class=${sb} onClick=${() => step(0.25)} disabled=${abs == null || abs >= max} aria-label=${label + ' 15 minutes later'}>+</button>
    </div>
    <${ChipRow} values=${chips} current=${abs} onPick=${onSet} fmt=${fmtTimeAbs} />
    <div class="flex items-center justify-between px-0.5 text-[13px]">
      <span class="text-ink-3">${isSet ? 'Set for this person' : 'Using the default'}</span>
      ${isSet && html`<button class="font-semibold text-gold" onClick=${onReset}>Use default${defAbs != null ? ' · ' + fmtTimeAbs(defAbs) : ''}</button>`}
    </div>
  </div>`;
}

// Props for one time's <TimePicker> (In or Out) of a person.
function pickerFor(vm, p, field) {
  const t = times(vm.state, p, vm);
  const def = t.def;
  const set = raw => App.staffField(p.id, field, raw, true);
  if (field === 'in') {
    const v = parseTime(def.in).value;
    return { label: 'In', abs: t.inAbs, isSet: t.inSet, defAbs: v != null ? resolveIn(v) : null,
      min: IN_MIN_ABS, max: IN_MAX_ABS, onSet: abs => set(inRaw(abs, def)), onReset: () => set('') };
  }
  const v = parseTime(def.out).value;
  return { label: 'Out', abs: t.outAbs, isSet: t.outSet, defAbs: v != null && t.inAbs != null ? nextAfter(v, t.inAbs) : null,
    min: (t.inAbs ?? 17) + 0.25, max: (t.inAbs ?? 17) + 12, onSet: abs => set(outRaw(abs, def)), onReset: () => set('') };
}

function Editor({ vm, p }) {
  const state = vm.state;
  const t = times(state, p, vm);
  const share = vm.shares?.perPerson.find(x => x.id === p.id);
  const set = (field, raw) => App.staffField(p.id, field, raw, true);

  return html`
    <input class=${cx(INPUT, 'h-14 rounded-2xl text-[22px] font-bold')} value=${p.name} placeholder="Name"
      autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="done" aria-label="Name"
      onInput=${e => App.staffField(p.id, 'name', e.target.value)} onChange=${() => App.rememberStaff(p.id)}
      onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
    ${state.settings.allRoles && html`<${Seg} value=${p.role} onChange=${r => App.staffField(p.id, 'role', r, true)}
      items=${ROLES.map(r => ({ value: r, label: ROLE_SHORT[r] }))} />`}
    <${TimePicker} ...${pickerFor(vm, p, 'in')} />
    <${TimePicker} ...${pickerFor(vm, p, 'out')} />
    <div class="flex items-center justify-between rounded-2xl bg-raised px-4 py-3">
      <span class="text-[15px] text-ink-2">${t.hrs != null ? fmtHrs(t.hrs) + ' hours' : 'Check the times'}</span>
      ${share && html`<span class="text-[15px] text-ink-2">takes home <b class="font-rounded text-[20px] text-gold">$${share.final}</b></span>`}
    </div>
    <div class="overflow-hidden rounded-card bg-raised">
      <${SwitchRow} on=${t.forced} onClick=${() => App.toggleCloser(p.id)} label="Closer"
        hint=${t.forced ? 'Forced — shares the closer bonus' : t.closer ? 'Auto: out at the close time' : 'Shares the dollars left after rounding'} />
    </div>
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
    <div class="flex items-center justify-between px-1 text-[15px] text-ink-2">
      <span>${t.hrs != null ? fmtHrs(t.hrs) + ' hours' : 'Check the times'}</span>
      <button class="font-semibold text-gold" onClick=${() => openTimeEditor(p.id, other)}>${field === 'in' ? 'Set out time →' : '← Set in time'}</button>
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
