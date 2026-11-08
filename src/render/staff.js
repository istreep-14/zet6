// Staff tab — a "Quick add" card that opens the saved-staff picker sheet, then
// one compact row per person:
//   name · [In] [Out] · hours
// Each time is its own chip: slide it up (later) or down (earlier) in 15-min
// steps, or tap it for the time sheet (steppers, typed entry, reset to default).
// Closer / Reset / Delete live behind a swipe-left on the row. A red Out chip
// marks a closer.
//
// Rows re-render only on structural changes (add/remove/role switch) so typing
// never loses focus; value-only updates patch labels and state classes.

import { ROLES } from '../store.js';
import { escapeHTML, fmtHrs } from '../util.js';
import {
  parseTime, fmtTimeAbs, resolveIn, nextAfter,
  absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS,
} from '../time.js';
import { getRoster } from '../roster.js';
import { openModal, closeModal } from './modals.js';

const $ = id => document.getElementById(id);

const PLURAL = { bartender: 'bartenders', server: 'servers', support: 'support' };
const SINGULAR = { bartender: 'bartender', server: 'server', support: 'support' };
const ADD_LABEL = { bartender: '+ Add bartender', server: '+ Add server', support: '+ Add support' };
const ROLE_TITLE = { bartender: 'Bartenders', server: 'Servers', support: 'Support' };

const STEP = 0.25;          // 15 minutes
const PX_PER_STEP = 14;     // vertical slide distance per 15-min step

let lastSignature = '';
let curVm = null;
let callbacks = { setTime() {} };

function rowDefaults(state, role) {
  const roleDef = state.defaults.byRole[role] || {};
  return {
    in: roleDef.in || state.defaults.global.in || '',
    out: roleDef.out || state.defaults.global.out || '',
  };
}

// Display-only mirror of the resolver — works for unnamed rows too. Same
// fixed-axis rules as resolve.js: In via resolveIn, Out = next after In.
function rowDisplay(state, person, vm) {
  const defs = rowDefaults(state, person.role);
  const inRaw = person.in.trim() || defs.in;
  const outRaw = person.out.trim() || defs.out;
  const inParsed = parseTime(inRaw);
  const outParsed = parseTime(outRaw);
  const resolved = vm?.resolved?.staff.find(p => p.id === person.id);

  const d = {
    person,
    role: person.role,
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

// Fresh display for one person. Store actions mutate state synchronously, so
// this is current even before the debounced render runs.
function freshDisplay(id) {
  const state = curVm?.state;
  const p = state?.staff.find(x => x.id === id);
  return p ? rowDisplay(state, p, curVm) : null;
}

const chipText = (abs, bad, field) => (bad ? '?' : abs != null ? fmtTimeAbs(abs) : field === 'in' ? 'In' : 'Out');

const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

function rowHTML(person, idx, d) {
  const id = person.id;
  return `<div class="staff-row" data-sid="${id}">
    <div class="sr-actions">
      <button class="sr-act sr-act--closer" data-act-closer onclick="App.rowAction('closer','${id}')">${d.forced ? 'Unforce' : 'Closer'}</button>
      <button class="sr-act sr-act--reset" onclick="App.rowAction('reset','${id}')">Reset</button>
      <button class="sr-act sr-act--del" onclick="App.rowAction('delete','${id}')">Delete</button>
    </div>
    <div class="sr-main">
      <input data-field="name" class="sr-name" value="${escapeHTML(person.name)}" placeholder="Name ${idx + 1}"
        autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="next" aria-label="Name"
        onkeydown="App.staffTab(event,'name')" oninput="App.staffField('${id}','name',this.value)"
        onchange="App.rememberStaff('${id}')">
      <div class="sr-times">
        <button class="tchip" data-tf="in" aria-label="In time — slide up or down, or tap to edit"><span data-lin></span></button>
        <button class="tchip" data-tf="out" aria-label="Out time — slide up or down, or tap to edit"><span data-lout></span></button>
      </div>
      <span class="hrs" data-hrs></span>
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
  const inChip = rowEl.querySelector('[data-tf="in"]');
  const outChip = rowEl.querySelector('[data-tf="out"]');
  if (inChip) {
    inChip.firstElementChild.textContent = chipText(d.inAbs, d.inBad, 'in');
    inChip.classList.toggle('is-set', d.inSet);
    inChip.classList.toggle('is-blank', d.inAbs == null && !d.inBad);
    inChip.classList.toggle('is-bad', d.inBad);
  }
  if (outChip) {
    outChip.firstElementChild.textContent = chipText(d.outAbs, d.outBad, 'out');
    outChip.classList.toggle('is-set', d.outSet);
    outChip.classList.toggle('is-blank', d.outAbs == null && !d.outBad);
    outChip.classList.toggle('is-bad', d.outBad);
  }
}

function noteHTML(vm) {
  const state = vm.state;
  const named = state.staff.filter(p => p.name.trim());
  if (!named.length) return '';

  const parts = state.settings.allRoles ? [named.length + ' staff total'] : [];
  const closeAbs = vm.resolved.closeAbs;
  if (closeAbs !== null) parts.push('close ' + fmtTimeAbs(closeAbs));
  const closers = vm.resolved.staff.filter(p => p.closer);
  if (closers.length) parts.push(closers.length + (closers.length === 1 ? ' closer' : ' closers'));

  let html = parts.length ? `<span>${escapeHTML(parts.join(' · '))}</span>` : '';
  const warnings = [];
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) {
        warnings.push(p.name + ' is out after the close time');
      }
    });
  }
  if (vm.inputError && vm.blocked) warnings.unshift(vm.blocked);
  warnings.forEach(w => { html += `<span class="warn">⚠ ${escapeHTML(w)}</span>`; });
  return html;
}

// ── Quick add: entry card + saved-staff picker sheet ────────────────────────

let rosterSel = new Set();          // lowercased names picked in the sheet
let rosterEditing = false;

function onShiftSet(state) {
  return new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));
}

function rosterEntryHTML(state) {
  const all = getRoster();
  if (!all.length) {
    return '<div class="roster-hint">Names you enter are saved for quick adding next shift.</div>';
  }
  const onShift = onShiftSet(state);
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const show = (avail.length ? avail : all).slice(0, 3);
  const avs = show.map(r => `<span class="ro-av av--${r.role}">${escapeHTML(initials(r.name))}</span>`).join('');
  const sub = avail.length
    ? `${avail.length} saved ${avail.length === 1 ? 'person' : 'people'} not on shift`
    : 'Everyone saved is on this shift';
  return `<button class="roster-open" onclick="App.openRoster()">
    <span class="ro-avs">${avs}</span>
    <span class="ro-main"><span class="ro-title">Quick add</span><span class="ro-sub">${sub}</span></span>
    <span class="ro-chev" aria-hidden="true">›</span>
  </button>`;
}

function rosterGroups(state) {
  const all = getRoster();
  if (!state.settings.allRoles) return [{ role: null, people: all }];
  const view = state.ui.staffViewRole;
  const order = [view, ...ROLES.filter(r => r !== view)];
  return order.map(role => ({ role, people: all.filter(r => r.role === role) }))
    .filter(g => g.people.length);
}

function rcardHTML(r, onShift) {
  const key = r.name.toLowerCase();
  const on = onShift.has(key);
  const sel = rosterSel.has(key);
  const arg = escapeHTML(JSON.stringify(r.name));
  const cls = ['rcard', on && 'is-on', sel && 'is-sel', rosterEditing && 'is-edit'].filter(Boolean).join(' ');
  const action = rosterEditing ? `App.forgetName(${arg})` : `App.rosterPick(${arg})`;
  const sub = rosterEditing ? 'Remove' : on ? 'On shift' : (sel ? 'Selected' : '');
  return `<button class="${cls}" onclick="${action}" ${on && !rosterEditing ? 'disabled' : ''} aria-pressed="${sel}">
    <span class="rcard-mark" aria-hidden="true"></span>
    <span class="rcard-av av--${r.role}">${escapeHTML(initials(r.name))}</span>
    <span class="rcard-name">${escapeHTML(r.name)}</span>
    <span class="rcard-sub">${sub}</span>
  </button>`;
}

export function openRosterSheet() {
  rosterSel = new Set();
  rosterEditing = false;
  openModal('rosterModal');
  renderRosterSheet();
}

export function renderRosterSheet() {
  if (!curVm || !$('rosterModal')?.classList.contains('open')) return;
  const state = curVm.state;
  const body = $('rosterModalBody');
  const foot = $('rosterModalFoot');
  const onShift = onShiftSet(state);
  const all = getRoster();
  // Drop picks that are no longer pickable (removed, or added meanwhile)
  rosterSel = new Set([...rosterSel].filter(k => all.some(r => r.name.toLowerCase() === k) && !onShift.has(k)));
  const avail = all.filter(r => !onShift.has(r.name.toLowerCase()));
  const allPicked = avail.length > 0 && avail.every(r => rosterSel.has(r.name.toLowerCase()));

  if (!all.length) {
    body.innerHTML = '<div class="roster-empty">No saved names yet.<br>Names you enter on the Staff tab show up here.</div>';
    foot.innerHTML = `<button class="btn btn--tonal btn--block" onclick="App.closeModal('rosterModal')">Close</button>`;
    return;
  }

  const groups = rosterGroups(state).map(g => `
    ${g.role ? `<div class="rgroup-title"><span class="dot dot--${g.role}"></span>${ROLE_TITLE[g.role]}</div>` : ''}
    <div class="rgrid">${g.people.map(r => rcardHTML(r, onShift)).join('')}</div>`).join('');

  body.innerHTML = `<div class="rsheet-bar">
      ${rosterEditing
        ? '<span class="rsheet-note">Tap a name to forget it on this device</span>'
        : `<button class="link-btn" onclick="App.rosterAll()" ${avail.length ? '' : 'disabled'}>${allPicked ? 'Clear' : 'Select all'}</button>`}
      <button class="link-btn" onclick="App.rosterEdit()">${rosterEditing ? 'Done' : 'Edit'}</button>
    </div>${groups}`;

  const n = rosterSel.size;
  foot.innerHTML = rosterEditing
    ? `<button class="btn btn--tonal btn--block" onclick="App.rosterEdit()">Done</button>`
    : `<button class="btn btn--primary btn--block" onclick="App.rosterAddSelected()" ${n ? '' : 'disabled'}>
        ${n ? `Add ${n} ${n === 1 ? 'person' : 'people'}` : 'Select people to add'}</button>`;
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

export function rosterSelected() {
  return getRoster().filter(r => rosterSel.has(r.name.toLowerCase()));
}

export function toggleRosterEdit() {
  rosterEditing = !rosterEditing;
  renderRosterSheet();
}

export function renderStaff(vm) {
  const state = vm.state;
  // Simple mode (roles off): one flat list of everyone, and the inline In/Out
  // edits the whole-shift open/close instead of a role default.
  const rolesOn = state.settings.allRoles;
  const viewRole = rolesOn ? state.ui.staffViewRole : 'bartender';

  $('roleSeg')?.classList.toggle('hidden', !rolesOn);
  ['bartender', 'server', 'support'].forEach(r => {
    $('rb-' + r)?.classList.toggle('active', r === viewRole);
  });

  const def = rolesOn ? (state.defaults.byRole[viewRole] || {}) : state.defaults.global;
  const rdefIn = $('rdef-in'), rdefOut = $('rdef-out');
  if (rdefIn && document.activeElement !== rdefIn) rdefIn.value = def.in || '';
  if (rdefOut && document.activeElement !== rdefOut) rdefOut.value = def.out || '';
  if (rdefIn) rdefIn.placeholder = rolesOn ? (state.defaults.global.in || '—') : '5';
  if (rdefOut) rdefOut.placeholder = rolesOn ? (state.defaults.global.out || '—') : '2';

  const visible = rolesOn ? state.staff.filter(p => p.role === viewRole) : state.staff;
  const named = visible.filter(p => p.name.trim()).length;
  const countEl = $('role-view-count');
  if (countEl) {
    countEl.textContent = rolesOn
      ? named + ' ' + (named === 1 ? SINGULAR[viewRole] : PLURAL[viewRole])
      : named + ' on shift';
  }

  const addBtn = $('addStaffBtn');
  if (addBtn) addBtn.textContent = rolesOn ? ADD_LABEL[viewRole] : '+ Add person';

  const noteEl = $('staff-section-summary');
  if (noteEl) noteEl.innerHTML = noteHTML(vm);

  const rosterEl = $('roster');
  if (rosterEl) rosterEl.innerHTML = rosterEntryHTML(state);

  curVm = vm;
  renderTimeSheet();
  renderRosterSheet();

  const list = $('staffList');
  if (!list) return;

  const ds = visible.map(p => rowDisplay(state, p, vm));

  const signature = (rolesOn ? viewRole : 'all') + '|' + visible.map(p => p.id).join(',');
  if (signature !== lastSignature) {
    lastSignature = signature;
    list.innerHTML = visible.map((p, i) => rowHTML(p, i, ds[i])).join('');
  }
  visible.forEach((p, i) => {
    const rowEl = list.querySelector(`[data-sid="${p.id}"]`);
    if (rowEl) patchRow(rowEl, ds[i]);
  });
}

// Force the next render to rebuild rows (e.g. after restoring state).
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

// ── Time edits: shared by chip sliding, the time sheet steppers and typing ──

// Snap an absolute time to the 15-minute grid and turn it into the stored raw
// string — or '' when it equals the inherited default, so sliding back to the
// default resets the field to "uses default".
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

// Repaint one person's row + the time sheet straight away (no debounce wait).
function refreshNow(id) {
  const d = freshDisplay(id);
  if (!d) return;
  const row = document.querySelector(`#staffList [data-sid="${id}"]`);
  if (row) patchRow(row, d);
  renderTimeSheet();
}

let timeEdit = null;   // { id, field } while the time sheet is open

function chevron(up) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`;
}

function timeColHTML(field) {
  return `<div class="tcol" data-tcol="${field}">
    <span class="tcol-lbl">${field === 'in' ? 'In' : 'Out'}</span>
    <button class="tstep" onclick="App.timeStep('${field}',1)" aria-label="15 minutes later">${chevron(true)}</button>
    <div class="tval" data-tval="${field}" role="slider" aria-label="${field === 'in' ? 'In' : 'Out'} time — slide up or down"></div>
    <button class="tstep" onclick="App.timeStep('${field}',-1)" aria-label="15 minutes earlier">${chevron(false)}</button>
    <input class="tinput" data-tin="${field}" inputmode="decimal" autocomplete="off" enterkeyhint="done"
      aria-label="Type ${field === 'in' ? 'in' : 'out'} time" oninput="App.timeInput('${field}',this.value)"
      onkeydown="if(event.key==='Enter')this.blur()">
    <button class="treset" data-treset="${field}" onclick="App.timeReset('${field}')"></button>
  </div>`;
}

export function openTimeSheet(id, field) {
  timeEdit = { id, field };
  const body = $('timeModalBody');
  if (!body) return;
  body.innerHTML = `<div class="tsheet">${timeColHTML('in')}${timeColHTML('out')}</div>
    <div class="tsum" data-tsum></div>
    <p class="tsheet-hint">Type 5 for 5:00, 10.5 for 10:30 (15-min steps). On the Staff list, slide a time up or down to nudge it.</p>`;
  openModal('timeModal');
  renderTimeSheet();
}

export function renderTimeSheet() {
  const modal = $('timeModal');
  if (!modal?.classList.contains('open')) { timeEdit = null; return; }
  if (!timeEdit) return;
  const d = freshDisplay(timeEdit.id);
  if (!d) { closeModal('timeModal'); timeEdit = null; return; }
  const p = d.person;
  $('timeModalTitle').textContent = p.name.trim() || 'Shift time';

  ['in', 'out'].forEach(field => {
    const col = modal.querySelector(`[data-tcol="${field}"]`);
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
    const input = col.querySelector('[data-tin]');
    if (document.activeElement !== input) input.value = p[field];
    input.placeholder = 'Type a time';
    input.classList.toggle('is-invalid', bad);
    const reset = col.querySelector('[data-treset]');
    const defParsed = parseTime(def);
    const defLabel = defParsed.value != null
      ? fmtTimeAbs(field === 'in' ? resolveIn(defParsed.value) : nextAfter(defParsed.value, d.inAbs ?? 17))
      : '';
    reset.textContent = defLabel ? 'Default · ' + defLabel : 'Clear';
    reset.disabled = !set;
  });

  const sum = modal.querySelector('[data-tsum]');
  if (sum) {
    const bits = [];
    if (d.hrs != null) bits.push(`<b>${fmtHrs(d.hrs)}h</b> shift`);
    else if (d.err) bits.push('<span class="bad">Check the times</span>');
    if (d.closer) bits.push(`<span class="closer">${d.forced ? 'forced closer' : 'closer'}</span>`);
    sum.innerHTML = bits.join(' · ');
  }
}

export function timeStep(field, dir) {
  if (!timeEdit) return;
  const d = freshDisplay(timeEdit.id);
  if (!d) return;
  timeEdit.field = field;
  const b = baseTimes(d);
  const cur = field === 'in' ? b.inAbs : b.outAbs;
  // A blank field's first tap lands on the starting value itself.
  const blank = field === 'in' ? d.inAbs == null : d.outAbs == null;
  writeAbs(timeEdit.id, d, field, blank ? cur : cur + dir * STEP);
  const input = $('timeModal')?.querySelector(`[data-tin="${field}"]`);
  if (input) input.blur();
  refreshNow(timeEdit.id);
}

export function timeInput(field, value) {
  if (!timeEdit) return;
  timeEdit.field = field;
  callbacks.setTime(timeEdit.id, field, value.trim());
  refreshNow(timeEdit.id);
}

export function timeReset(field) {
  if (!timeEdit) return;
  callbacks.setTime(timeEdit.id, field, '');
  const input = $('timeModal')?.querySelector(`[data-tin="${field}"]`);
  if (input) input.value = '';
  refreshNow(timeEdit.id);
}

// ── Gestures: slide time chips, swipe rows for actions ──────────────────────

const SWIPE_W = 228;   // width of the revealed action tray (3 × 76)
let scrub = null;      // active vertical slide on a time chip / sheet value
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
  const sheetBody = $('timeModalBody');
  sheetBody?.addEventListener('pointerdown', e => {
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
