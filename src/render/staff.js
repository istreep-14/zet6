// Staff tab — quick-add roster chips, then one compact row per person:
//   name · draggable In→Out time bar · hours
// Closer / Reset / Delete live behind a swipe-left on the row, so nothing
// clutters the row itself. The closer shows as a red end on the time bar.
//
// Rows re-render only on structural changes (add/remove/role switch) so typing
// never loses focus; value-only updates patch geometry, labels and state.

import { escapeHTML, fmtHrs } from '../util.js';
import {
  parseTime, fmtTimeAbs, resolveIn, nextAfter,
  absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS,
} from '../time.js';
import { getRoster } from '../roster.js';

const $ = id => document.getElementById(id);

const PLURAL = { bartender: 'bartenders', server: 'servers', support: 'support' };
const SINGULAR = { bartender: 'bartender', server: 'server', support: 'support' };
const ADD_LABEL = { bartender: '+ Add bartender', server: '+ Add server', support: '+ Add support' };

let lastSignature = '';
let rosterEditing = false;
let axis = { lo: 15, hi: 28 };        // absolute hours shown across every time bar
let dragging = null;                  // freezes the axis while a bar end is held
const displays = new Map();           // id → last computed display (for gestures)
let callbacks = { setTime() {}, closeSwipes() {} };

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
  const resolved = vm.resolved?.staff.find(p => p.id === person.id);

  const d = {
    role: person.role,
    defIn: defs.in,
    defOut: defs.out,
    explicit: !!(person.in.trim() || person.out.trim()),
    closer: !!resolved?.closer,
    forced: !!person.closerOverride,
    inAbs: null,
    outAbs: null,
    hrsText: '–',
    err: false,
  };
  if (!inParsed.valid || !outParsed.valid) { d.err = true; d.hrsText = '?'; return d; }
  if (inParsed.empty || outParsed.empty) return d;

  d.inAbs = resolveIn(inParsed.value);
  d.outAbs = nextAfter(outParsed.value, d.inAbs);
  const h = d.outAbs - d.inAbs;
  if (h <= 0 || h > 12) { d.err = true; d.hrsText = '?'; return d; }
  d.hrsText = fmtHrs(h) + 'h';
  return d;
}

// Shared time axis for every bar: earliest In − 1h … latest Out + 1h, at least
// 8 hours wide. Frozen while a drag is in progress so the bar never slides
// out from under the finger.
function computeAxis(list, vm) {
  if (dragging) return;
  let lo = Infinity, hi = -Infinity;
  list.forEach(d => {
    if (d.inAbs != null) lo = Math.min(lo, d.inAbs);
    if (d.outAbs != null) hi = Math.max(hi, d.outAbs);
  });
  if (vm.resolved?.anchorAbs != null) lo = Math.min(lo, vm.resolved.anchorAbs);
  if (vm.resolved?.closeAbs != null) hi = Math.max(hi, vm.resolved.closeAbs);
  if (!isFinite(lo)) lo = 17;
  if (!isFinite(hi)) hi = lo + 9;
  lo = Math.max(IN_MIN_ABS - 1, Math.floor(lo) - 1);
  hi = Math.ceil(hi) + 1;
  if (hi - lo < 8) hi = lo + 8;
  axis = { lo, hi };
}

const pct = abs => ((abs - axis.lo) / (axis.hi - axis.lo)) * 100;

// Position the bar, its end handles and labels for a given In/Out.
function applyGeom(rowEl, inAbs, outAbs) {
  const bar = rowEl.querySelector('[data-bar]');
  const tl = rowEl.querySelector('.tl');
  if (!bar || !tl) return;
  const empty = inAbs == null || outAbs == null;
  tl.classList.toggle('is-empty', empty);
  if (empty) return;
  const a = pct(inAbs), b = pct(outAbs);
  bar.style.left = a + '%';
  bar.style.width = Math.max(0, b - a) + '%';
  rowEl.querySelector('[data-lin]').textContent = fmtTimeAbs(inAbs);
  rowEl.querySelector('[data-lout]').textContent = fmtTimeAbs(outAbs);
}

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
      <div class="tl" role="slider" aria-label="Shift time — drag the ends">
        <div class="tl-track"></div>
        <div class="tl-bar" data-bar>
          <span class="tl-lbl" data-lin></span><span class="tl-lbl" data-lout></span>
        </div>
        <span class="tl-empty">set times</span>
      </div>
      <span class="hrs" data-hrs></span>
    </div>
  </div>`;
}

function patchRow(rowEl, person, d) {
  rowEl.classList.toggle('is-closer', d.closer);
  rowEl.classList.toggle('is-forced', d.forced);
  rowEl.classList.toggle('is-default', !d.explicit);
  rowEl.classList.toggle('is-err', d.err);
  const hrs = rowEl.querySelector('[data-hrs]');
  if (hrs) hrs.textContent = d.hrsText;
  const act = rowEl.querySelector('[data-act-closer]');
  if (act) act.textContent = d.forced ? 'Unforce' : 'Closer';
  if (!(dragging && dragging.id === person.id)) applyGeom(rowEl, d.inAbs, d.outAbs);
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

// Quick-add chips: remembered names not already on this shift (filtered to the
// current role when roles are on). Edit mode turns chips into remove buttons.
function rosterHTML(state, rolesOn, viewRole) {
  const onShift = new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));
  const all = getRoster().filter(r => !rolesOn || r.role === viewRole);
  const avail = rosterEditing ? all : all.filter(r => !onShift.has(r.name.toLowerCase()));
  if (!all.length) {
    return '<div class="roster-hint">Names you enter are saved here for one-tap adding next shift.</div>';
  }
  const chips = avail.map(r => {
    const name = escapeHTML(r.name);
    const arg = escapeHTML(JSON.stringify(r.name));
    return rosterEditing
      ? `<button class="rchip rchip--edit" onclick="App.forgetName(${arg})">${name}<span aria-hidden="true">✕</span></button>`
      : `<button class="rchip" onclick="App.quickAdd(${arg})"><span aria-hidden="true">+</span>${name}</button>`;
  }).join('');
  return `<div class="roster-hdr">
      <span class="eyebrow">Quick add</span>
      <button class="roster-edit" onclick="App.rosterEdit()">${rosterEditing ? 'Done' : 'Edit'}</button>
    </div>
    <div class="roster-chips">${chips || '<span class="hint">Everyone saved is already on this shift.</span>'}</div>`;
}

export function toggleRosterEdit() {
  rosterEditing = !rosterEditing;
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
  if (rosterEl) rosterEl.innerHTML = rosterHTML(state, rolesOn, viewRole);

  const list = $('staffList');
  if (!list) return;

  const ds = visible.map(p => rowDisplay(state, p, vm));
  displays.clear();
  visible.forEach((p, i) => displays.set(p.id, { ...ds[i], person: p }));
  computeAxis(ds, vm);

  const signature = (rolesOn ? viewRole : 'all') + '|' + visible.map(p => p.id).join(',');
  if (signature !== lastSignature) {
    lastSignature = signature;
    list.innerHTML = visible.map((p, i) => rowHTML(p, i, ds[i])).join('');
  }
  visible.forEach((p, i) => {
    const rowEl = list.querySelector(`[data-sid="${p.id}"]`);
    if (rowEl) patchRow(rowEl, p, ds[i]);
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

// ── Gestures: drag time-bar ends, swipe rows for actions ────────────────────

const SWIPE_W = 228;   // width of the revealed action tray (3 × 76)

export function closeAllSwipes(except) {
  document.querySelectorAll('#staffList .staff-row.is-open').forEach(r => {
    if (r === except) return;
    r.classList.remove('is-open');
    r.querySelector('.sr-main').style.transform = '';
  });
}

// Snap an absolute time to the 15-minute grid and turn it into the stored raw
// string — or '' when it equals the inherited default, so dragging back to the
// default resets the row to "uses default".
function toRaw(field, abs, d) {
  if (field === 'in') {
    const raw = absToInRaw(abs);
    return parseTime(d.defIn).value === Number(raw) ? '' : raw;
  }
  const raw = absToOutRaw(abs);
  return parseTime(d.defOut).value === Number(raw) ? '' : raw;
}

export function initStaffGestures(cb) {
  callbacks = { ...callbacks, ...cb };
  const list = $('staffList');
  if (!list) return;

  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.staff-row');
    if (!row || e.target.closest('.sr-actions')) return;
    if (e.button !== undefined && e.button !== 0) return;
    const tl = e.target.closest('.tl');
    const start = { x: e.clientX, y: e.clientY, id: row.dataset.sid, row, tl, mode: null, pid: e.pointerId };
    closeAllSwipes(row);

    const onMove = ev => {
      if (ev.pointerId !== start.pid) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!start.mode) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return finish();       // scrolling
        if (Math.abs(dx) < 6) return;
        start.mode = start.tl && !row.classList.contains('is-open') ? 'drag' : 'swipe';
        try { row.setPointerCapture(start.pid); } catch { /* ok */ }
        if (start.mode === 'drag') beginDrag(start, ev.clientX);
      }
      ev.preventDefault();
      if (start.mode === 'drag') moveDrag(start, ev.clientX);
      else moveSwipe(start, dx);
    };
    const onUp = ev => {
      if (ev.pointerId !== start.pid) return;
      if (!start.mode && start.tl && !row.classList.contains('is-open')) {
        // Tap on the bar: move the nearer end to the tapped time.
        beginDrag(start, ev.clientX);
        moveDrag(start, ev.clientX);
      } else if (!start.mode && row.classList.contains('is-open')) {
        closeAllSwipes();
      }
      if (start.mode === 'swipe') endSwipe(start, ev.clientX - start.x);
      finish();
    };
    const finish = () => {
      list.removeEventListener('pointermove', onMove);
      list.removeEventListener('pointerup', onUp);
      list.removeEventListener('pointercancel', finish);
      if (dragging) { dragging.row.classList.remove('is-dragging'); dragging = null; }
    };
    list.addEventListener('pointermove', onMove, { passive: false });
    list.addEventListener('pointerup', onUp);
    list.addEventListener('pointercancel', finish);
  });

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#staffList')) closeAllSwipes();
  });
}

function absAt(tl, clientX) {
  const r = tl.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  return Math.round((axis.lo + f * (axis.hi - axis.lo)) * 4) / 4;
}

function beginDrag(start, clientX) {
  const d = displays.get(start.id);
  if (!d) return;
  // Rows with no times yet start from the role/global defaults or 5p–2a.
  const inAbs = d.inAbs ?? 17;
  const outAbs = d.outAbs ?? Math.min(inAbs + 9, axis.hi);
  const t = absAt(start.tl, clientX);
  const field = Math.abs(t - inAbs) <= Math.abs(t - outAbs) ? 'in' : 'out';
  dragging = { id: start.id, row: start.row, field, inAbs, outAbs, d };
  start.row.classList.add('is-dragging');
}

function moveDrag(start, clientX) {
  if (!dragging) return;
  const g = dragging;
  let t = absAt(start.tl, clientX);
  if (g.field === 'in') {
    t = Math.min(Math.max(t, IN_MIN_ABS, g.outAbs - 12), IN_MAX_ABS, g.outAbs - 0.25);
    if (t === g.inAbs && g.d.inAbs != null) return;
    g.inAbs = t;
  } else {
    t = Math.min(Math.max(t, g.inAbs + 0.25), g.inAbs + 12);
    if (t === g.outAbs && g.d.outAbs != null) return;
    g.outAbs = t;
  }
  applyGeom(g.row, g.inAbs, g.outAbs);
  const hrs = g.row.querySelector('[data-hrs]');
  if (hrs) hrs.textContent = fmtHrs(g.outAbs - g.inAbs) + 'h';
  // A row that had no times gets both ends written so it resolves at once.
  if (g.d.inAbs == null || g.d.outAbs == null) {
    callbacks.setTime(g.id, 'in', toRaw('in', g.inAbs, g.d));
    callbacks.setTime(g.id, 'out', toRaw('out', g.outAbs, g.d));
    g.d = { ...g.d, inAbs: g.inAbs, outAbs: g.outAbs };
  } else {
    callbacks.setTime(g.id, g.field, toRaw(g.field, g.field === 'in' ? g.inAbs : g.outAbs, g.d));
  }
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
