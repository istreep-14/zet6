// Staff tab — everyone on the shift on one page, grouped by role when roles
// are on (one section per role, each with its default times and its own
// "+ Add" row). Each person is one compact row:
//   name · [In] [Out] · hours
// Time chips slide up (later) / down (earlier) in 15-min steps, or tap for the
// time sheet. Closer / Reset / Delete sit behind a swipe-left on the row.
//
// Rows re-render only on structural changes (add / remove / role mode) so
// typing never loses focus; value updates patch labels and state classes.

import { ROLES } from '../store.js';
import { fmtHrs } from '../util.js';
import {
  parseTime, fmtTimeAbs, resolveIn, nextAfter,
  absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS,
} from '../time.js';
import { getRoster } from '../roster.js';
import { html, cx, js, mount } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import {
  Card, Button, Avatar, Dot, Alert, ROLE_PLURAL, ROLE_ONE,
} from '../ui/kit.js';
import { openSheet, closeSheet, isOpen, sheetBody, sheetFoot, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);

const STEP = 0.25;          // 15 minutes
const PX_PER_STEP = 14;     // vertical slide distance per 15-min step

let lastSignature = '';
let curVm = null;
let callbacks = { setTime() {} };

// ── Display model per row ────────────────────────────────────────────────────

function rowDefaults(state, role) {
  const roleDef = state.defaults.byRole[role] || {};
  return {
    in: roleDef.in || state.defaults.global.in || '',
    out: roleDef.out || state.defaults.global.out || '',
  };
}

// Display-only mirror of the resolver — works for unnamed rows too.
function rowDisplay(state, person, vm) {
  const defs = rowDefaults(state, person.role);
  const inParsed = parseTime(person.in.trim() || defs.in);
  const outParsed = parseTime(person.out.trim() || defs.out);
  const resolved = vm?.resolved?.staff.find(p => p.id === person.id);

  const d = {
    person,
    defIn: defs.in,
    defOut: defs.out,
    inSet: !!person.in.trim(),
    outSet: !!person.out.trim(),
    inBad: !inParsed.valid,
    outBad: !outParsed.valid,
    closer: !!resolved?.closer,
    forced: !!person.closerOverride,
    inAbs: null,
    outAbs: null,
    hrs: null,
    hrsText: '–',
    err: false,
  };
  if (!inParsed.valid || !outParsed.valid) { d.err = true; d.hrsText = '?'; return d; }
  if (!inParsed.empty) d.inAbs = resolveIn(inParsed.value);
  if (inParsed.empty || outParsed.empty) return d;

  d.outAbs = nextAfter(outParsed.value, d.inAbs);
  const h = d.outAbs - d.inAbs;
  if (h <= 0 || h > 12) { d.err = true; d.hrsText = '?'; return d; }
  d.hrs = h;
  d.hrsText = fmtHrs(h) + 'h';
  return d;
}

function freshDisplay(id) {
  const state = curVm?.state;
  const p = state?.staff.find(x => x.id === id);
  return p ? rowDisplay(state, p, curVm) : null;
}

const chipText = (abs, bad, field) => (bad ? '?' : abs != null ? fmtTimeAbs(abs) : field === 'in' ? 'In' : 'Out');

// "5:00p – 2:00a" for a section's default times.
function defaultsLabel(defs) {
  const i = parseTime(defs.in), o = parseTime(defs.out);
  const inAbs = i.value != null ? resolveIn(i.value) : null;
  const a = inAbs != null ? fmtTimeAbs(inAbs) : '—';
  const b = o.value != null ? fmtTimeAbs(nextAfter(o.value, inAbs ?? 17)) : '—';
  return a + ' – ' + b;
}

// ── Markup ───────────────────────────────────────────────────────────────────

function rowHTML(person, idx) {
  const id = person.id;
  const act = 'w-[76px] text-[14px] font-semibold text-white';
  return html`<div class="staff-row relative overflow-hidden" data-sid="${id}">
    <div class="sr-actions absolute inset-y-0 right-0 flex">
      <button class="${cx(act, 'bg-red')}" data-act-closer onclick="App.rowAction('closer','${id}')">Closer</button>
      <button class="${cx(act, 'bg-[#636366]')}" onclick="App.rowAction('reset','${id}')">Reset</button>
      <button class="${cx(act, 'bg-[#8e1d17]')}" onclick="App.rowAction('delete','${id}')">Delete</button>
    </div>
    <div class="sr-main relative z-[1] grid h-[58px] grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-2.5 bg-surface pl-4 pr-3 max-[400px]:gap-2">
      <input data-field="name" class="h-10 w-full min-w-0 bg-transparent text-[17px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-3"
        value="${person.name}" placeholder="Name ${idx + 1}"
        autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="next" aria-label="Name"
        onkeydown="App.staffTab(event)" oninput="App.staffField('${id}','name',this.value)"
        onchange="App.rememberStaff('${id}')">
      <div class="flex gap-1.5">
        <button class="tchip" data-tf="in" aria-label="In time — slide up or down, or tap to edit"><span></span></button>
        <button class="tchip" data-tf="out" aria-label="Out time — slide up or down, or tap to edit"><span></span></button>
      </div>
      <span class="hrs text-right text-[15px] font-semibold text-ink-2 tabular-nums" data-hrs></span>
    </div>
  </div>`;
}

function patchRow(rowEl, d) {
  rowEl.classList.toggle('is-closer', d.closer);
  rowEl.classList.toggle('is-forced', d.forced);
  rowEl.classList.toggle('is-err', d.err);
  const hrs = rowEl.querySelector('[data-hrs]');
  if (hrs) hrs.textContent = d.hrsText;
  const act = rowEl.querySelector('[data-act-closer]');
  if (act) act.textContent = d.forced ? 'Unforce' : 'Closer';
  [['in', d.inAbs, d.inBad, d.inSet], ['out', d.outAbs, d.outBad, d.outSet]].forEach(([f, abs, bad, set]) => {
    const chip = rowEl.querySelector(`[data-tf="${f}"]`);
    if (!chip) return;
    chip.firstElementChild.textContent = chipText(abs, bad, f);
    chip.classList.toggle('is-set', set);
    chip.classList.toggle('is-blank', abs == null && !bad);
    chip.classList.toggle('is-bad', bad);
  });
}

// One section per role (roles on) or a single "On shift" section.
function groups(state) {
  if (!state.settings.allRoles) return [{ key: 'all', role: null, addRole: 'bartender', people: state.staff }];
  return ROLES.map(role => ({ key: role, role, addRole: role, people: state.staff.filter(p => p.role === role) }));
}

function sectionHTML(g) {
  const title = g.role ? ROLE_PLURAL[g.role] : 'On shift';
  const add = g.role ? 'Add ' + ROLE_ONE[g.role] : 'Add person';
  return Card({ flush: true, 'data-sec': g.key },
    html`<div class="flex items-center gap-2 py-2.5 pl-4 pr-3">
      ${g.role ? Dot(g.role) : ''}
      <span class="text-[17px] font-semibold">${title}</span>
      <span class="text-[15px] font-semibold text-ink-3 tabular-nums" data-sec-count></span>
      <button class="ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[15px] font-semibold tabular-nums text-ink transition active:scale-[.97] active:bg-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        onclick="App.openDefaults()" aria-label="Default times">${icon('clock', 'size-4 text-ink-2')}<span data-sec-def></span></button>
    </div>
    ${g.people.map((p, i) => rowHTML(p, i))}
    <button class="flex h-12 w-full items-center gap-2 border-t border-sep px-4 text-[16px] font-semibold text-gold transition active:bg-raised" onclick="App.addStaff('${g.addRole}')">
      ${icon('plus', 'size-[18px]')}${add}</button>`);
}

function noteHTML(vm) {
  const state = vm.state;
  const named = state.staff.filter(p => p.name.trim());
  if (!named.length) return '';

  const parts = [named.length + ' on shift'];
  const closeAbs = vm.resolved.closeAbs;
  if (closeAbs !== null) parts.push('close ' + fmtTimeAbs(closeAbs));
  const closers = vm.resolved.staff.filter(p => p.closer);
  if (closers.length) parts.push(closers.length + (closers.length === 1 ? ' closer' : ' closers'));

  const warnings = [];
  if (vm.inputError && vm.blocked) warnings.push(vm.blocked);
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) {
        warnings.push(p.name + ' is out after the close time');
      }
    });
  }
  return html`<div class="px-1 text-[14px] text-ink-2">${parts.join(' · ')}</div>
    ${warnings.map(w => Alert({ tone: 'warn' }, w))}`;
}

// ── Quick add: entry card + saved-staff picker sheet ────────────────────────

let rosterSel = new Set();          // lowercased names picked in the sheet
let rosterEditing = false;

const onShiftSet = state => new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));

function rosterEntryHTML(state) {
  const all = getRoster();
  if (!all.length) {
    return html`<div class="px-1 text-[13px] text-ink-3">Names you enter are saved for quick adding next shift.</div>`;
  }
  const onShift = onShiftSet(state);
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const show = (avail.length ? avail : all).slice(0, 3);
  const sub = avail.length
    ? `${avail.length} saved ${avail.length === 1 ? 'person' : 'people'} not on shift`
    : 'Everyone saved is on this shift';
  return html`<button class="flex min-h-16 w-full items-center gap-3 rounded-card bg-surface py-2.5 pl-3.5 pr-3 text-left transition active:scale-[.98] active:bg-raised" onclick="App.openRoster()">
    <span class="flex shrink-0 -space-x-1.5">${show.map(r => html`<span class="rounded-full ring-2 ring-surface">${Avatar(r.name, r.role)}</span>`)}</span>
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-[17px] font-semibold">Quick add</span>
      <span class="text-[13px] text-ink-2">${sub}</span>
    </span>
    ${icon('chevR', 'size-5 text-ink-3')}
  </button>`;
}

function rosterGroups(state) {
  const all = getRoster();
  if (!state.settings.allRoles) return [{ role: null, people: all }];
  return ROLES.map(role => ({ role, people: all.filter(r => r.role === role) })).filter(g => g.people.length);
}

function rcardHTML(r, onShift) {
  const key = r.name.toLowerCase();
  const on = onShift.has(key);
  const sel = rosterSel.has(key);
  const action = rosterEditing ? html`App.forgetName(${js(r.name)})` : html`App.rosterPick(${js(r.name)})`;
  const sub = rosterEditing ? 'Remove' : on ? 'On shift' : sel ? 'Selected' : '';
  const mark = rosterEditing ? 'bg-red text-white' : sel ? 'bg-gold text-gold-ink' : on ? 'bg-ink-3 text-surface' : 'ring-[1.5px] ring-inset ring-ink-3';
  return html`<button class="${cx(
    'relative flex min-h-[116px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 transition active:scale-95',
    sel ? 'bg-gold/15 ring-2 ring-inset ring-gold' : 'bg-raised',
    on && !rosterEditing && 'opacity-45',
  )}" onclick="${action}" ${on && !rosterEditing ? 'disabled' : ''} aria-pressed="${sel}">
    <span class="${cx('absolute right-2 top-2 grid size-[22px] place-items-center rounded-full text-[12px] font-extrabold', mark)}" aria-hidden="true">${rosterEditing ? '✕' : sel || on ? '✓' : ''}</span>
    ${Avatar(r.name, r.role, 'lg')}
    <span class="line-clamp-2 max-w-full text-center text-[15px] font-semibold leading-tight [overflow-wrap:anywhere]">${r.name}</span>
    <span class="${cx('min-h-3.5 text-[12px] leading-3.5', rosterEditing ? 'text-red' : sel ? 'text-gold' : 'text-ink-3')}">${sub}</span>
  </button>`;
}

export function openRosterSheet() {
  rosterSel = new Set();
  rosterEditing = false;
  openSheet('sheet-roster');
  renderRosterSheet();
}

export function renderRosterSheet() {
  if (!curVm || !isOpen('sheet-roster')) return;
  const state = curVm.state;
  const body = sheetBody('sheet-roster');
  const foot = sheetFoot('sheet-roster');
  const onShift = onShiftSet(state);
  const all = getRoster();
  rosterSel = new Set([...rosterSel].filter(k => all.some(r => r.name.toLowerCase() === k) && !onShift.has(k)));
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const allPicked = avail.length > 0 && avail.every(r => rosterSel.has(r.name.toLowerCase()));

  if (!all.length) {
    mount(body, html`<div class="px-4 py-6 text-center leading-relaxed text-ink-2">No saved names yet.<br>Names you enter on the Staff tab show up here.</div>`);
    mount(foot, Button({ variant: 'plain', block: true, onclick: "App.closeSheet('sheet-roster')" }, 'Close'));
    return;
  }

  const link = 'h-9 px-1 text-[16px] font-semibold text-gold disabled:text-ink-3';
  mount(body, html`<div class="flex min-h-9 items-center justify-between">
      ${rosterEditing
        ? html`<span class="text-[13px] text-ink-2">Tap a name to forget it on this device</span>`
        : html`<button class="${link}" onclick="App.rosterAll()" ${avail.length ? '' : 'disabled'}>${allPicked ? 'Clear' : 'Select all'}</button>`}
      <button class="${link}" onclick="App.rosterEdit()">${rosterEditing ? 'Done' : 'Edit'}</button>
    </div>
    ${rosterGroups(state).map(g => html`
      ${g.role ? html`<div class="mt-2 flex items-center gap-2 text-[14px] font-semibold text-ink-2">${Dot(g.role)}${ROLE_PLURAL[g.role]}</div>` : ''}
      <div class="grid auto-rows-fr grid-cols-3 gap-2.5">${g.people.map(r => rcardHTML(r, onShift))}</div>`)}`);

  const n = rosterSel.size;
  mount(foot, rosterEditing
    ? Button({ variant: 'plain', block: true, onclick: 'App.rosterEdit()' }, 'Done')
    : Button({ variant: 'primary', block: true, onclick: 'App.rosterAddSelected()', disabled: !n },
      n ? `Add ${n} ${n === 1 ? 'person' : 'people'}` : 'Select people to add'));
}

export function rosterPick(name) {
  const k = name.toLowerCase();
  if (rosterSel.has(k)) rosterSel.delete(k); else rosterSel.add(k);
  renderRosterSheet();
}

export function rosterSelectAll() {
  const onShift = onShiftSet(curVm.state);
  const avail = getRoster().filter(r => !onShift.has(r.name.toLowerCase()));
  const allPicked = avail.every(r => rosterSel.has(r.name.toLowerCase()));
  rosterSel = allPicked ? new Set() : new Set(avail.map(r => r.name.toLowerCase()));
  renderRosterSheet();
}

export const rosterSelected = () => getRoster().filter(r => rosterSel.has(r.name.toLowerCase()));

export function toggleRosterEdit() {
  rosterEditing = !rosterEditing;
  renderRosterSheet();
}

// ── Tab render ───────────────────────────────────────────────────────────────

function ensureSkeleton(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = '1';
  mount(root, html`<div class="flex flex-col gap-3">
    <div class="flex flex-col gap-2 empty:hidden" id="staff-note"></div>
    <div id="roster" class="empty:hidden"></div>
    <div id="staffList" class="flex flex-col gap-3"></div>
    <p class="px-4 text-center text-[13px] leading-normal text-ink-3">
      <b class="text-ink-2">Slide a time</b> up or down to move it 15 min, or <b class="text-ink-2">tap it</b> to type or reset.
      Faded times are defaults; a red Out marks a closer. <b class="text-ink-2">Swipe a row left</b> for Closer, Reset and Delete.
    </p>
  </div>`);
}

export function renderStaff(vm) {
  const root = $('staff-root');
  if (!root) return;
  ensureSkeleton(root);
  const state = vm.state;
  curVm = vm;

  mount($('staff-note'), noteHTML(vm));
  mount($('roster'), rosterEntryHTML(state));
  renderTimeSheet();
  renderRosterSheet();

  const list = $('staffList');
  const gs = groups(state);
  const signature = (state.settings.allRoles ? 'R' : 'r') + '|' + state.staff.map(p => p.id + p.role[0]).join(',');
  if (signature !== lastSignature) {
    lastSignature = signature;
    mount(list, gs.map(sectionHTML));
  }

  gs.forEach(g => {
    const sec = list.querySelector(`[data-sec="${g.key}"]`);
    if (!sec) return;
    const named = g.people.filter(p => p.name.trim()).length;
    sec.querySelector('[data-sec-count]').textContent = named ? String(named) : '';
    const def = sec.querySelector('[data-sec-def]');
    const label = defaultsLabel(rowDefaults(state, g.addRole));
    if (def.textContent !== label) def.textContent = label;
    g.people.forEach(p => {
      const rowEl = sec.querySelector(`[data-sid="${p.id}"]`);
      if (rowEl) patchRow(rowEl, rowDisplay(state, p, vm));
    });
  });
}

export function invalidateStaffList() {
  lastSignature = '';
}

// Enter / Tab on a name hops to the next row's name; at the end, focus leaves.
export function staffTabNav(e) {
  const isEnter = e.key === 'Enter';
  if (e.key !== 'Tab' && !isEnter) return;
  const names = [...document.querySelectorAll('#staffList [data-field="name"]')];
  const i = names.indexOf(e.target);
  if (i < 0) return;
  const j = e.shiftKey ? i - 1 : i + 1;
  if (names[j]) { e.preventDefault(); names[j].focus(); }
  else if (isEnter) { e.preventDefault(); e.target.blur(); }
}

// ── Time edits: shared by chip sliding, the time sheet band/steppers/typing ──

// Snap to the 15-minute grid → stored raw string, or '' when it equals the
// inherited default (sliding back to the default resets the field).
function toRaw(field, abs, d) {
  if (field === 'in') {
    const raw = absToInRaw(abs);
    return parseTime(d.defIn).value === Number(raw) ? '' : raw;
  }
  const raw = absToOutRaw(abs);
  return parseTime(d.defOut).value === Number(raw) ? '' : raw;
}

// Starting point for a row whose times don't resolve yet: 5p → 2a.
function baseTimes(d) {
  const inAbs = d.inAbs ?? 17;
  return { inAbs, outAbs: d.outAbs ?? inAbs + 9 };
}

// Set one field to an absolute time (clamped so In < Out ≤ In + 12h and In is
// expressible). A row missing either time gets both written so it resolves.
function writeAbs(id, d, field, t) {
  const b = baseTimes(d);
  const v = field === 'in'
    ? Math.min(Math.max(t, IN_MIN_ABS, b.outAbs - 12), IN_MAX_ABS, b.outAbs - STEP)
    : Math.min(Math.max(t, b.inAbs + STEP), b.inAbs + 12);
  const next = field === 'in' ? { inAbs: v, outAbs: b.outAbs } : { inAbs: b.inAbs, outAbs: v };
  if (d.inAbs == null || d.outAbs == null || d.err) {
    callbacks.setTime(id, 'in', toRaw('in', next.inAbs, d));
    callbacks.setTime(id, 'out', toRaw('out', next.outAbs, d));
  } else {
    callbacks.setTime(id, field, toRaw(field, v, d));
  }
  return next;
}

function refreshNow(id) {
  const d = freshDisplay(id);
  if (!d) return;
  const row = document.querySelector(`#staffList [data-sid="${id}"]`);
  if (row) patchRow(row, d);
  renderTimeSheet();
}

// ── Time sheet ───────────────────────────────────────────────────────────────

let timeEdit = null;   // { id, field } while the time sheet is open
onSheetClose('sheet-time', () => { timeEdit = null; });

function timeColHTML(field) {
  const name = field === 'in' ? 'In' : 'Out';
  const step = 'grid h-11 place-items-center rounded-xl bg-fill-2 text-ink transition active:bg-fill';
  return html`<div class="tcol flex flex-col gap-1.5 rounded-2xl bg-raised p-2.5" data-tcol="${field}">
    <span class="text-center text-[14px] font-semibold text-ink-2">${name}</span>
    <button class="${step}" onclick="App.timeStep('${field}',1)" aria-label="15 minutes later">${icon('chevU', 'size-[22px]')}</button>
    <div class="tval grid h-14 place-items-center rounded-xl font-rounded text-[36px] font-bold tracking-tight tabular-nums" data-tval="${field}" role="slider" aria-label="${name} time — slide up or down"></div>
    <div class="px-1">
      <div class="band" data-band="${field}" onscroll="App.bandScroll('${field}',this)" role="listbox" aria-label="${name} band picker — scroll, 15-minute steps">
        <div class="band-center" aria-hidden="true"></div>
        <div class="band-inner" data-bandinner="${field}"></div>
        <div class="band-fade band-fade-t" aria-hidden="true"></div>
        <div class="band-fade band-fade-b" aria-hidden="true"></div>
      </div>
    </div>
    <button class="${step}" onclick="App.timeStep('${field}',-1)" aria-label="15 minutes earlier">${icon('chevD', 'size-[22px]')}</button>
    <input class="mt-1 h-11 w-full min-w-0 rounded-xl bg-fill px-3 text-center text-[17px] font-semibold text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-gold [&.is-invalid]:bg-red/15 [&.is-invalid]:ring-2 [&.is-invalid]:ring-red"
      data-tin="${field}" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Type a time"
      aria-label="Type ${field} time" oninput="App.timeInput('${field}',this.value)" onkeydown="if(event.key==='Enter')this.blur()">
    <button class="h-9 text-[14px] font-semibold text-gold disabled:text-ink-3 disabled:opacity-100" data-treset="${field}" onclick="App.timeReset('${field}')"></button>
  </div>`;
}

// Absolute range for a field's band, derived from the other field so In
// always stays before Out and the span never exceeds 12h.
function timeRange(field, d) {
  const b = baseTimes(d);
  if (field === 'in') return { min: IN_MIN_ABS, max: IN_MAX_ABS, val: b.inAbs };
  return { min: b.inAbs + STEP, max: b.inAbs + 12, val: b.outAbs };
}

// ── Band wheel (custom, UIDatePicker .wheels feel: one 15-min band) ─────────────
// Each column is a vertical snap-scrolling band showing full times
// ("4:00 PM", "4:15 PM", …; "17:00", "17:15" in 24h mode). The centre band
// is the selection. Scrolling or tapping an item writes through writeAbs,
// so In < Out ≤ In + 12h still holds.

const BAND_ITEM_H = 40;   // px per 15-min row; visible 3 rows (120px)
let bandScrolling = { in: false, out: false };
let bandTimers = { in: null, out: null };

// "4:00p" → "4:00 PM"; 24h mode is already "17:00" via fmtTimeAbs.
function fmtWheelTime(abs) {
  const s = fmtTimeAbs(abs);
  const m = /^(\d+:\d{2})([ap])$/.exec(s);
  if (!m) return s;
  return m[1] + ' ' + (m[2] === 'a' ? 'AM' : 'PM');
}

function buildBandItems(field, r) {
  const out = [];
  for (let abs = r.min; abs <= r.max + 0.001; abs += STEP) {
    const a = Math.round(abs * 4) / 4;
    out.push(`<div class="band-item" data-abs="${a}" role="option" onclick="App.bandPick('${field}',${a})">${fmtWheelTime(a)}</div>`);
  }
  return out.join('');
}

function syncBand(field, d, col, bad) {
  const band = col.querySelector(`[data-band="${field}"]`);
  const inner = col.querySelector(`[data-bandinner="${field}"]`);
  if (!band || !inner) return;
  const r = timeRange(field, d);
  const clamped = Math.min(r.max, Math.max(r.min, r.val));
  const sig = `${r.min.toFixed(2)}-${r.max.toFixed(2)}`;
  if (band.dataset.sig !== sig) {
    band.dataset.sig = sig;
    inner.innerHTML = buildBandItems(field, r);
  }
  const idx = Math.round((clamped - r.min) / STEP);
  const items = inner.querySelectorAll('.band-item');
  items.forEach((it, i) => it.classList.toggle('is-sel', i === idx));
  band.setAttribute('aria-activedescendant', `band-${field}-${idx}`);
  items[idx]?.setAttribute('id', `band-${field}-${idx}`);
  if (!bandScrolling[field]) {
    const target = idx * BAND_ITEM_H;
    if (Math.abs(band.scrollTop - target) > 0.5) band.scrollTop = target;
  }
}

export function openTimeSheet(id, field) {
  timeEdit = { id, field };
  mount(sheetBody('sheet-time'), html`<div class="grid grid-cols-2 gap-2.5">${timeColHTML('in')}${timeColHTML('out')}</div>
    <div class="min-h-5 text-center text-[15px] text-ink-2" data-tsum></div>
    <p class="px-2 text-center text-[13px] leading-normal text-ink-3">Scroll the band (15-min steps) to set the time, or type 5 for 5:00, 10.5 for 10:30. On the Staff list, slide a time up or down to nudge it.</p>`);
  openSheet('sheet-time');
  renderTimeSheet();
}

export function renderTimeSheet() {
  if (!timeEdit || !isOpen('sheet-time')) return;
  const d = freshDisplay(timeEdit.id);
  if (!d) { closeSheet('sheet-time'); return; }
  const body = sheetBody('sheet-time');
  const p = d.person;
  setSheetTitle('sheet-time', p.name.trim() || 'Shift time');

  ['in', 'out'].forEach(field => {
    const col = body.querySelector(`[data-tcol="${field}"]`);
    if (!col) return;
    const abs = field === 'in' ? d.inAbs : d.outAbs;
    const bad = field === 'in' ? d.inBad : d.outBad;
    const set = field === 'in' ? d.inSet : d.outSet;
    const def = field === 'in' ? d.defIn : d.defOut;
    col.classList.toggle('is-focus', timeEdit.field === field);
    col.classList.toggle('is-set', set);
    const val = col.querySelector('[data-tval]');
    val.textContent = bad ? '?' : abs != null ? fmtTimeAbs(abs) : '—';
    val.classList.toggle('is-bad', bad);
    if (field === 'out') val.classList.toggle('is-closer', d.closer);
    syncBand(field, d, col, bad);
    const input = col.querySelector('[data-tin]');
    if (document.activeElement !== input) input.value = p[field];
    input.classList.toggle('is-invalid', bad);
    const reset = col.querySelector('[data-treset]');
    const dp = parseTime(def);
    const defLabel = dp.value != null
      ? fmtTimeAbs(field === 'in' ? resolveIn(dp.value) : nextAfter(dp.value, d.inAbs ?? 17))
      : '';
    reset.textContent = defLabel ? 'Default · ' + defLabel : 'Clear';
    reset.disabled = !set;
  });

  const bits = [];
  if (d.hrs != null) bits.push(html`<b class="text-ink">${fmtHrs(d.hrs)}h</b> shift`);
  else if (d.err) bits.push(html`<span class="font-semibold text-red">Check the times</span>`);
  if (d.closer) bits.push(html`<span class="font-semibold text-red">${d.forced ? 'forced closer' : 'closer'}</span>`);
  mount(body.querySelector('[data-tsum]'), bits.map((b, i) => html`${i ? ' · ' : ''}${b}`));
}

export function timeStep(field, dir) {
  if (!timeEdit) return;
  const d = freshDisplay(timeEdit.id);
  if (!d) return;
  timeEdit.field = field;
  const b = baseTimes(d);
  const cur = field === 'in' ? b.inAbs : b.outAbs;
  const blank = field === 'in' ? d.inAbs == null : d.outAbs == null;
  writeAbs(timeEdit.id, d, field, blank ? cur : cur + dir * STEP);
  sheetBody('sheet-time')?.querySelector(`[data-tin="${field}"]`)?.blur();
  refreshNow(timeEdit.id);
}

export function timeInput(field, value) {
  if (!timeEdit) return;
  timeEdit.field = field;
  callbacks.setTime(timeEdit.id, field, value.trim());
  refreshNow(timeEdit.id);
}

// Band wheel: scroll/tap to a 15-minute step ("4:00 PM", "4:15 PM", …).
// Bounds shift with the other field, so writeAbs keeps In < Out ≤ In + 12h.
export function timeBand(field, abs) {
  if (!timeEdit) return;
  const d = freshDisplay(timeEdit.id);
  if (!d) return;
  const b = baseTimes(d);
  const cur = field === 'in' ? b.inAbs : b.outAbs;
  const blank = field === 'in' ? d.inAbs == null : d.outAbs == null;
  if (!blank && Math.abs(abs - cur) < 0.001) return;
  timeEdit.field = field;
  writeAbs(timeEdit.id, d, field, abs);
  refreshNow(timeEdit.id);
}

export function bandPick(field, abs) {
  timeBand(field, abs);
}

export function bandScroll(field, el) {
  if (!timeEdit) return;
  bandScrolling[field] = true;
  clearTimeout(bandTimers[field]);
  bandTimers[field] = setTimeout(() => { bandScrolling[field] = false; }, 140);
  const items = el.querySelectorAll('.band-item');
  if (!items.length) return;
  const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / BAND_ITEM_H)));
  items.forEach((it, i) => it.classList.toggle('is-sel', i === idx));
  timeBand(field, Number(items[idx].dataset.abs));
}

export function timeReset(field) {
  if (!timeEdit) return;
  callbacks.setTime(timeEdit.id, field, '');
  const input = sheetBody('sheet-time')?.querySelector(`[data-tin="${field}"]`);
  if (input) input.value = '';
  refreshNow(timeEdit.id);
}

// ── Gestures: slide time chips, swipe rows for actions ──────────────────────

const SWIPE_W = 228;   // width of the revealed action tray (3 × 76)
let scrub = null;
let suppressClick = false;

export function closeAllSwipes(except) {
  document.querySelectorAll('#staffList .staff-row.is-open').forEach(r => {
    if (r === except) return;
    r.classList.remove('is-open');
    r.querySelector('.sr-main').style.transform = '';
  });
}

function beginScrub(id, field, el, y) {
  const d = freshDisplay(id);
  if (!d) return;
  const b = baseTimes(d);
  scrub = { id, field, el, d, y0: y, start: field === 'in' ? b.inAbs : b.outAbs, last: null };
  el.classList.add('is-scrubbing');
}

function moveScrub(y) {
  if (!scrub) return;
  const steps = Math.round((scrub.y0 - y) / PX_PER_STEP);   // up = later
  const t = scrub.start + steps * STEP;
  if (t === scrub.last) return;
  scrub.last = t;
  writeAbs(scrub.id, scrub.d, scrub.field, t);
  refreshNow(scrub.id);
}

function endScrub() {
  if (!scrub) return;
  scrub.el.classList.remove('is-scrubbing');
  scrub = null;
}

export function initStaffGestures(cb) {
  callbacks = { ...callbacks, ...cb };
  const list = $('staffList');
  if (!list) return;

  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.staff-row');
    if (!row || e.target.closest('.sr-actions')) return;
    if (e.button !== undefined && e.button !== 0) return;
    suppressClick = false;
    const chip = e.target.closest('.tchip');
    const start = { x: e.clientX, y: e.clientY, id: row.dataset.sid, row, chip, mode: null, pid: e.pointerId };
    const wasOpen = row.classList.contains('is-open');
    closeAllSwipes(row);

    const onMove = ev => {
      if (ev.pointerId !== start.pid) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!start.mode) {
        const vertical = Math.abs(dy) > Math.abs(dx);
        if (chip && !wasOpen && vertical && Math.abs(dy) >= 6) {
          start.mode = 'scrub';
          beginScrub(start.id, chip.dataset.tf, chip, start.y);
        } else if (vertical && Math.abs(dy) > 10) {
          return finish();                                   // page scroll
        } else if (Math.abs(dx) >= 6) {
          start.mode = 'swipe';
        } else return;
        suppressClick = true;
        try { row.setPointerCapture(start.pid); } catch { /* ok */ }
      }
      ev.preventDefault();
      if (start.mode === 'scrub') moveScrub(ev.clientY);
      else moveSwipe(start, dx);
    };
    const onUp = ev => {
      if (ev.pointerId !== start.pid) return;
      if (!start.mode && wasOpen) { closeAllSwipes(); suppressClick = true; }
      if (start.mode === 'swipe') endSwipe(start, ev.clientX - start.x);
      finish();
    };
    const finish = () => {
      list.removeEventListener('pointermove', onMove);
      list.removeEventListener('pointerup', onUp);
      list.removeEventListener('pointercancel', finish);
      endScrub();
    };
    list.addEventListener('pointermove', onMove, { passive: false });
    list.addEventListener('pointerup', onUp);
    list.addEventListener('pointercancel', finish);
  });

  // Tap on a chip → time sheet (a slide or swipe swallows the click)
  list.addEventListener('click', e => {
    const chip = e.target.closest('.tchip');
    if (!chip) return;
    if (suppressClick) { suppressClick = false; return; }
    const row = chip.closest('.staff-row');
    if (row) callbacks.openTime?.(row.dataset.sid, chip.dataset.tf);
  });

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#staffList')) closeAllSwipes();
  });

  // The big values in the time sheet slide the same way.
  sheetBody('sheet-time')?.addEventListener('pointerdown', e => {
    const val = e.target.closest('[data-tval]');
    if (!val || !timeEdit) return;
    const pid = e.pointerId;
    document.activeElement?.blur?.();
    timeEdit.field = val.dataset.tval;
    beginScrub(timeEdit.id, val.dataset.tval, val, e.clientY);
    try { val.setPointerCapture(pid); } catch { /* ok */ }
    const onMove = ev => { if (ev.pointerId === pid) { ev.preventDefault(); moveScrub(ev.clientY); } };
    const done = ev => {
      if (ev.pointerId !== pid) return;
      val.removeEventListener('pointermove', onMove);
      val.removeEventListener('pointerup', done);
      val.removeEventListener('pointercancel', done);
      endScrub();
      renderTimeSheet();
    };
    val.addEventListener('pointermove', onMove, { passive: false });
    val.addEventListener('pointerup', done);
    val.addEventListener('pointercancel', done);
  });
}

function moveSwipe(start, dx) {
  const base = start.row.classList.contains('is-open') ? -SWIPE_W : 0;
  const x = Math.min(0, Math.max(-SWIPE_W - 24, base + dx));
  const main = start.row.querySelector('.sr-main');
  main.style.transition = 'none';
  main.style.transform = `translateX(${x}px)`;
}

function endSwipe(start, dx) {
  const base = start.row.classList.contains('is-open') ? -SWIPE_W : 0;
  const open = base + dx < -SWIPE_W / 2;
  const main = start.row.querySelector('.sr-main');
  main.style.transition = '';
  main.style.transform = open ? `translateX(${-SWIPE_W}px)` : '';
  start.row.classList.toggle('is-open', open);
}
