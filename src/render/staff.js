// Staff tab — one list, role filter. Rows re-render only on structural changes
// (add/remove/role switch) so typing never loses focus; value-only updates
// patch hours cells, placeholders, closer state, and validity in place.

import { escapeHTML, fmtHrs } from '../util.js';
import { parseTime, fmtTimeAbs, resolveIn, nextAfter } from '../time.js';

const $ = id => document.getElementById(id);

const PLURAL = { bartender: 'bartenders', server: 'servers', support: 'support' };
const SINGULAR = { bartender: 'bartender', server: 'server', support: 'support' };
const ADD_LABEL = { bartender: '+ Add Bartender', server: '+ Add Server', support: '+ Add Support' };

let lastSignature = '';

function rowDefaults(state, role) {
  const roleDef = state.defaults.byRole[role] || {};
  return {
    in: roleDef.in || state.defaults.global.in || '',
    out: roleDef.out || state.defaults.global.out || '',
  };
}

// Display-only mirror of the resolver — works for unnamed rows too, so a row
// shows its hours as soon as times are typed. Same fixed-axis rules as
// resolve.js: In via resolveIn, Out as the next occurrence after In.
function rowDisplay(state, person, vm) {
  const defs = rowDefaults(state, person.role);
  const inRaw = person.in.trim() || defs.in;
  const outRaw = person.out.trim() || defs.out;
  const inParsed = parseTime(inRaw);
  const outParsed = parseTime(outRaw);
  const usedDefault = !person.in.trim() || !person.out.trim();
  const resolved = vm.resolved?.staff.find(p => p.id === person.id);

  const display = {
    defIn: defs.in,
    defOut: defs.out,
    inInvalid: !!person.in.trim() && !parseTime(person.in).valid,
    outInvalid: !!person.out.trim() && !parseTime(person.out).valid,
    autoCloser: !!resolved?.autoCloser,
    hrsText: '–',
    hrsClass: 'hrs',
  };

  if (!inParsed.valid || !outParsed.valid) {
    display.hrsText = '?';
    display.hrsClass = 'hrs err';
    return display;
  }
  if (inParsed.empty || outParsed.empty) return display;

  const inAbs = resolveIn(inParsed.value);
  const outAbs = nextAfter(outParsed.value, inAbs);
  const h = outAbs - inAbs;

  if (h <= 0 || h > 12) {
    display.hrsText = '?';
    display.hrsClass = 'hrs err';
    return display;
  }
  display.hrsText = fmtHrs(h);
  display.hrsClass = 'hrs filled' + (usedDefault ? ' default' : '');
  return display;
}

function closerClass(person, display) {
  return 'closer-btn' + (person.closerOverride ? ' on' : display.autoCloser ? ' is-auto' : '');
}

function rowHTML(person, idx, display) {
  const id = person.id;
  return `<div class="staff-row staff-grid" data-sid="${id}">
    <input data-field="name" value="${escapeHTML(person.name)}" placeholder="Name ${idx + 1}"
      autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="next" aria-label="Name"
      onkeydown="App.staffTab(event,'name')" oninput="App.staffField('${id}','name',this.value)">
    <input data-field="in" value="${escapeHTML(person.in)}" placeholder="${escapeHTML(display.defIn || '—')}"
      class="${display.inInvalid ? 'is-invalid' : ''}" inputmode="decimal" enterkeyhint="next" aria-label="In"
      onkeydown="App.staffTab(event,'in')" oninput="App.staffField('${id}','in',this.value)">
    <input data-field="out" value="${escapeHTML(person.out)}" placeholder="${escapeHTML(display.defOut || '—')}"
      class="${display.outInvalid ? 'is-invalid' : ''}" inputmode="decimal" enterkeyhint="next" aria-label="Out"
      onkeydown="App.staffTab(event,'out')" oninput="App.staffField('${id}','out',this.value)">
    <div class="${display.hrsClass}" data-hrs>${display.hrsText}</div>
    <button class="${closerClass(person, display)}" data-closer onclick="App.toggleCloser('${id}')"
      aria-label="Force closer" aria-pressed="${person.closerOverride}" tabindex="-1">C</button>
    <button class="del-btn" onclick="App.delStaff('${id}')" aria-label="Remove" tabindex="-1">✕</button>
  </div>`;
}

function patchRow(rowEl, person, display) {
  const hrsEl = rowEl.querySelector('[data-hrs]');
  if (hrsEl) {
    hrsEl.textContent = display.hrsText;
    hrsEl.className = display.hrsClass;
  }
  const inEl = rowEl.querySelector('[data-field="in"]');
  const outEl = rowEl.querySelector('[data-field="out"]');
  if (inEl) {
    inEl.placeholder = display.defIn || '—';
    inEl.classList.toggle('is-invalid', display.inInvalid);
  }
  if (outEl) {
    outEl.placeholder = display.defOut || '—';
    outEl.classList.toggle('is-invalid', display.outInvalid);
  }
  const closerEl = rowEl.querySelector('[data-closer]');
  if (closerEl) closerEl.className = closerClass(person, display);
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

  // Inline defaults (don't clobber while focused)
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

  const signature = (rolesOn ? viewRole : 'all') + '|' + visible.map(p => p.id).join(',');
  const list = $('staffList');
  if (!list) return;

  if (signature !== lastSignature) {
    lastSignature = signature;
    list.innerHTML = visible.map((p, i) => rowHTML(p, i, rowDisplay(state, p, vm))).join('');
  } else {
    visible.forEach(p => {
      const rowEl = list.querySelector(`[data-sid="${p.id}"]`);
      if (rowEl) patchRow(rowEl, p, rowDisplay(state, p, vm));
    });
  }
}

// Force the next render to rebuild rows (e.g. after restoring state).
export function invalidateStaffList() {
  lastSignature = '';
}

// Column-major Tab/Enter order: stepping walks DOWN a column (all names, then
// all ins, then all outs). At the ends the default fires so focus can leave.
const TAB_COLS = ['name', 'in', 'out'];

export function staffTabNav(e, field) {
  const isEnter = e.key === 'Enter';
  if (e.key !== 'Tab' && !isEnter) return;
  const rows = [...document.querySelectorAll('#staffList [data-sid]')];
  const rowEl = e.target.closest('[data-sid]');
  let r = rows.indexOf(rowEl);
  let c = TAB_COLS.indexOf(field);
  if (r < 0 || c < 0) return;

  // Enter on the phone keyboard ("next") walks across the row instead —
  // name → in → out → next row's name — which matches how a shift is read off.
  if (isEnter) {
    e.preventDefault();
    if (c < TAB_COLS.length - 1) c++;
    else if (r < rows.length - 1) { r++; c = 0; }
    else { e.target.blur(); return; }
  } else if (!e.shiftKey) {
    if (r < rows.length - 1) r++;
    else if (c < TAB_COLS.length - 1) { c++; r = 0; }
    else return;
  } else {
    if (r > 0) r--;
    else if (c > 0) { c--; r = rows.length - 1; }
    else return;
  }

  const target = rows[r]?.querySelector(`[data-field="${TAB_COLS[c]}"]`);
  if (target) { e.preventDefault(); target.focus(); }
}
