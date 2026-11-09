// Bootstrap: load → mount sheets → subscribe → first render.
// Update flow: input event → action mutates state → schedule(120ms) →
// compute (buildViewModel) → render → persist.

import * as store from './store.js';
import * as persist from './persist.js';
import * as sessions from './sessions.js';
import { buildViewModel } from './viewmodel.js';
import { setClock24 } from './time.js';
import { mountSheets, closeSheet, closeAllSheets, sheetBackdrop } from './ui/sheet.js';
import { switchTab, updateTabIndicators, normalizeTab, TAB_ORDER } from './render/tabs.js';
import {
  renderStaff, invalidateStaffList, staffTabNav,
  initStaffGestures, closeAllSwipes,
  openTimeSheet, timeStep, timeInput, timeBand, bandPick, bandScroll, timeReset,
  openRosterSheet, rosterPick, rosterSelectAll, rosterSelected, toggleRosterEdit,
} from './render/staff.js';
import { loadRoster, rememberName, forgetName } from './roster.js';
import { renderTips, invalidateTips } from './render/tips.js';
import { renderPayout, applyPendingTradeUp, applyPendingTradeDown } from './render/payout.js';
import { openCloseTime, renderCloseTime, selectCloseTime } from './render/closetime.js';
import {
  renderSheets, openPerson, openBonus, adjustBonus, resetBonuses, openDefaults,
} from './render/sheets.js';
import {
  renderDrawer, openDrawer, closeDrawer, isDrawerOpen, toggleDrawerEdit, initDrawerGestures, EDGE,
} from './render/drawer.js';

const $ = id => document.getElementById(id);

// ── Load the current session (v4 or migrated v3) ──────────────────────────────

const saved = sessions.boot();
if (saved) store.replaceState(saved);

const state = store.getState();
if (!state.meta.date) state.meta.date = sessions.todayISO();
state.ui.activeTab = normalizeTab(state.ui.activeTab);

mountSheets($('sheets'));

// ── Render loop ───────────────────────────────────────────────────────────────

let lastVm = buildViewModel(state);

function render(s) {
  setClock24(s.settings.clock24);
  lastVm = buildViewModel(s);
  renderStaff(lastVm);
  renderTips(lastVm);
  renderPayout(lastVm);
  renderCloseTime(lastVm);
  renderSheets(lastVm);
  updateTabIndicators(lastVm);
  sessions.saveCurrent(s, {
    total: lastVm.totalCash || 0,
    people: s.staff.filter(p => p.name.trim()).length,
  });
  renderDrawer(lastVm, sessions.list(), sessions.currentId());
}

// ── Sessions: switch / create / delete without reloading ─────────────────────

// Settings are app preferences, shared by every session. A session that
// already uses roles or several pools keeps those visible.
function carryPrefs(next) {
  const prefs = store.getState().settings;
  const usesRoles = next.staff.some(p => p.role !== 'bartender') || next.pools.some(p => p.includeSupport);
  next.settings = {
    ...prefs,
    allRoles: prefs.allRoles || usesRoles,
    multiPool: prefs.multiPool || next.pools.length > 1,
  };
  return next;
}

// Flush the outgoing session (a debounced keystroke may not be saved yet).
function flushCurrent() {
  document.activeElement?.blur?.();
  render(store.getState());
}

function activate(next, { keepDrawer = false } = {}) {
  carryPrefs(next);
  if (!next.meta.date) next.meta.date = sessions.todayISO();
  next.ui.activeTab = normalizeTab(next.ui.activeTab);
  closeAllSheets();
  store.replaceState(next);
  invalidateStaffList();
  invalidateTips();
  next.staff.forEach(p => rememberName(p.name, p.role));
  switchTab(next.ui.activeTab);
  syncHdrDate();
  render(next);
  if (!keepDrawer) closeDrawer();
}

function freshState() {
  const fresh = store.initialState();
  fresh.meta.date = sessions.todayISO();
  fresh.ui.activeTab = 'staff';
  return fresh;
}

store.subscribe(render);

// ── Header date: formatted pill over the hidden native date input ─────────────
// The pill shows "Sat, Nov 8"; the invisible input sits over it and opens
// iOS's native picker on tap. Desktop/keyboard fall through to showPicker().

function fmtHdrDate(iso) {
  if (!iso) return 'Today';
  // Parse as local noon so DST shifts never move the visible day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
}

function syncHdrDate() {
  const d = store.getState().meta.date;
  const input = $('tipDate');
  if (input && input.value !== d) input.value = d || '';
  const label = $('hdrDateLabel');
  const text = fmtHdrDate(d);
  if (label && label.textContent !== text) label.textContent = text;
}

function openDatePicker() {
  const input = $('tipDate');
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  } catch { input.click(); }
}

// ── Global handler surface for inline on* attributes ──────────────────────────

const rolesOn = () => store.getState().settings.allRoles;
const fromDrawer = fn => (...a) => { closeDrawer(); fn(...a); };

window.App = {
  // tabs
  tab(name) {
    switchTab(name);
    store.setActiveTab(name);
  },

  // sheets
  closeSheet,
  sheetBg: sheetBackdrop,
  openDefaults: fromDrawer(() => openDefaults(lastVm)),
  openBonus: fromDrawer(() => openBonus(lastVm)),
  openCloseTime: fromDrawer(() => openCloseTime(lastVm)),

  // side drawer (sessions + settings)
  openDrawer() { closeAllSheets(); openDrawer(); },
  closeDrawer,
  toggleDrawer() { if (isDrawerOpen()) closeDrawer(); else App.openDrawer(); },
  drawerEdit: toggleDrawerEdit,
  personModal: id => openPerson(lastVm, id),

  // settings
  toggleSetting(key) {
    const s = store.getState();
    if (key === 'multiPool' && s.pools.length > 1) return;
    invalidateStaffList();
    invalidateTips();
    store.setSetting(key, !s.settings[key]);
  },

  // staff
  addStaff(role) {
    const id = store.addStaff(rolesOn() ? role : 'bartender');
    // Renders synchronously, so focus while still inside the tap (iOS keyboard).
    document.querySelector(`[data-sid="${id}"] [data-field="name"]`)?.focus();
  },
  staffField: store.updateStaff,
  staffTab: staffTabNav,

  // Swipe-revealed row actions (Closer / Reset / Delete)
  rowAction(kind, id) {
    closeAllSwipes();
    if (kind === 'closer') store.toggleCloserOverride(id);
    else if (kind === 'delete') store.removeStaff(id);
    else if (kind === 'reset') {
      store.mutate(s => {
        const p = s.staff.find(x => x.id === id);
        if (p) { p.in = ''; p.out = ''; }
      }, { immediate: true });
    }
  },

  // Roster: remember names as they're committed, one-tap re-add next shift
  rememberStaff(id) {
    const p = store.getState().staff.find(x => x.id === id);
    if (p && rememberName(p.name, p.role)) render(store.getState());
  },
  forgetName(name) {
    forgetName(name);
    render(store.getState());
  },
  openRoster: openRosterSheet,
  rosterPick,
  rosterAll: rosterSelectAll,
  rosterEdit: toggleRosterEdit,
  // Each pick fills the next blank row of their role, or gets a new row.
  rosterAddSelected() {
    const picks = rosterSelected();
    if (!picks.length) return;
    const roles = rolesOn();
    invalidateStaffList();
    store.mutate(st => {
      picks.forEach(({ name, role }) => {
        const r = roles ? role : 'bartender';
        const blank = st.staff.find(p => !p.name.trim() && (!roles || p.role === r));
        if (blank) blank.name = name;
        else st.staff.push({ ...store.newStaff(r), name });
      });
    }, { immediate: true });
    closeSheet('sheet-roster');
  },

  // Time sheet (tap a time chip)
  timeStep,
  timeInput,
  timeBand,
  bandPick,
  bandScroll,
  timeReset,

  // defaults
  roleDefault: (role, field, value) => store.setRoleDefault(role, field, value.trim()),
  globalDefault: (field, value) => store.setGlobalDefault(field, value.trim()),
  supportDefault: value => store.setSupportDefault(value.trim()),

  // pools
  addPool: store.addPool,
  removePool: store.removePool,
  selectPool: store.selectPool,
  poolMode: store.setPoolEntryMode,
  poolRole: store.togglePoolRole,
  poolLabel: (id, value) => store.updatePool(id, p => { p.label = value; }),
  poolWindow: (id, field, value) => store.updatePool(id, p => { p.window[field] = value; }),
  poolBill: (id, denom, value) => store.updatePool(id, p => { p.cash.billCounts[denom] = value; }),
  poolNet: (id, value) => store.updatePool(id, p => { p.cash.netTotal = value; }),
  poolSupport(id, field, value) {
    store.updatePool(id, p => {
      p.support ||= { pct: '', rate: '', hours: {} };
      p.support[field] = value;
    });
  },
  poolSupportHours(id, staffId, value) {
    store.updatePool(id, p => {
      p.support ||= { pct: '', rate: '', hours: {} };
      p.support.hours[staffId] = value;
    });
  },
  // −/+ steppers on a bill row. The input is updated directly because the
  // keystroke patch path never rewrites input values (it would steal focus).
  billStep(id, denom, delta) {
    const pool = store.getState().pools.find(p => p.id === id);
    if (!pool) return;
    const next = Math.max(0, (parseInt(pool.cash.billCounts[denom], 10) || 0) + delta);
    store.updatePool(id, p => { p.cash.billCounts[denom] = next ? String(next) : ''; });
    const input = document.querySelector(`[data-pid="${id}"] [data-bill="${denom}"]`);
    if (input) input.value = next ? String(next) : '';
  },
  // Enter / "next" hops down the denomination rows ($100 → $50 → … → $1)
  billKey(e, poolId) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll(`[data-pid="${poolId}"] [data-bill]`)];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select?.(); } else e.target.blur();
  },

  // bonus
  remBonus: (id, delta) => adjustBonus(lastVm, id, delta),
  resetRemBonuses: resetBonuses,

  // close time + trades
  selectCloseTime,
  applyTradeUp: applyPendingTradeUp,
  applyTradeDown: applyPendingTradeDown,

  // session
  setDate(v) { store.setDate(v); syncHdrDate(); },
  openDatePicker,
  exportSession() {
    const s = store.getState();
    const blob = new Blob([persist.serialize(s)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tippool-' + (s.meta.date || 'session') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  triggerImport() {
    const input = $('importFileInput');
    if (input) { input.value = ''; input.click(); }
  },
  importSession(file) {
    if (!file) return;
    const reader = new FileReader();
    const input = $('importFileInput');
    const resetInput = () => { if (input) input.value = ''; };
    reader.onload = e => {
      try {
        const next = persist.deserialize(e.target.result);
        resetInput();
        flushCurrent();
        sessions.createId();
        activate(next);
      } catch (err) {
        alert('Import failed: ' + err.message);
        resetInput();
      }
    };
    reader.onerror = () => { alert('Could not read file.'); resetInput(); };
    reader.readAsText(file);
  },

  // Sessions: every shift is kept; the drawer switches between them.
  newSession() {
    flushCurrent();
    sessions.createId();
    activate(freshState());
  },
  switchSession(id) {
    if (id === sessions.currentId()) { closeDrawer(); return; }
    flushCurrent();
    const next = sessions.loadSession(id);
    if (!next) {
      alert('That session could not be opened — its saved data is damaged.');
      sessions.remove(id);
      renderDrawer(lastVm, sessions.list(), sessions.currentId());
      return;
    }
    sessions.setCurrent(id);
    activate(next);
  },
  renameSession(id) {
    const e = sessions.list().find(x => x.id === id);
    const name = prompt('Session name (blank = show the date)', e?.name || '');
    if (name === null) return;
    sessions.rename(id, name);
    renderDrawer(lastVm, sessions.list(), sessions.currentId());
  },
  deleteSession(id) {
    const e = sessions.list().find(x => x.id === id);
    const what = e?.name || (e?.date ? 'the ' + e.date + ' session' : 'this session');
    if (!confirm(`Delete ${what}? This can’t be undone.`)) return;
    const wasCurrent = id === sessions.currentId();
    sessions.remove(id);
    if (!wasCurrent) { renderDrawer(lastVm, sessions.list(), sessions.currentId()); return; }
    // Open the next newest session, or start a fresh one.
    for (const other of sessions.list()) {
      const next = sessions.loadSession(other.id);
      if (next) { sessions.setCurrent(other.id); activate(next, { keepDrawer: true }); return; }
      sessions.remove(other.id);
    }
    sessions.createId();
    activate(freshState(), { keepDrawer: true });
  },
};

// ── One-time DOM wiring ───────────────────────────────────────────────────────

syncHdrDate();

// Hide the tab bar when the software keyboard is open. Compare the visible
// area to the layout viewport (innerHeight), not the screen: Safari's toolbars
// alone are >120pt. The keyboard shrinks only the visual viewport, and only
// while a text field has focus.
if (window.visualViewport) {
  const KEYBOARD_THRESHOLD = 150;
  const isTyping = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === 'TEXTAREA'
      || (el.tagName === 'INPUT' && !['date', 'file', 'checkbox', 'radio', 'button'].includes(el.type)));
  };
  const updateKeyboardState = () => {
    const shrink = window.innerHeight - window.visualViewport.height;
    document.body.classList.toggle('keyboard-open', isTyping() && shrink > KEYBOARD_THRESHOLD);
  };
  window.visualViewport.addEventListener('resize', updateKeyboardState);
  window.visualViewport.addEventListener('scroll', updateKeyboardState);
  document.addEventListener('focusout', () => setTimeout(updateKeyboardState, 50));
}

// Home-screen app fill. iOS can hand a home-screen web app a viewport shorter
// than the screen (e.g. 844 of 912pt), leaving a black strip below the page.
// Size <html>/<body> to the real screen height, lay the tab bar / HUD / sheets
// out inside that box, and keep the window locked at the top.
// Add ?pwa to the URL to force this in a desktop browser for testing.
(() => {
  const root = document.documentElement;
  const standalone = navigator.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches
    || new URLSearchParams(location.search).has('pwa');
  if (!standalone) return;
  root.classList.add('standalone');
  const typing = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
  };
  const fit = () => {
    if (typing()) return;                       // keyboard resizes are not the screen
    const landscape = window.innerWidth > window.innerHeight;
    const screenH = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    const h = Math.max(screenH, window.innerHeight);
    root.classList.toggle('fill-screen', h - window.innerHeight > 1);
    root.style.setProperty('--app-h', h + 'px');
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));
  document.addEventListener('focusout', () => setTimeout(fit, 120));
  window.addEventListener('scroll', () => {
    if (!typing() && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
  }, { passive: true });
})();

// Lock page zoom: a pinched or focus-zoomed page shifts the fixed tab bar.
(() => {
  const block = e => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, block, { passive: false }));
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault();
  }, { passive: false });
})();

// Swipe left/right on the content to move between tabs. Ignored inside
// sideways-scrolling areas and staff rows, while typing, or on vertical drags.
(() => {
  const area = $('mainContent');
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  area.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.target;
    // The left edge belongs to the drawer's drag-to-open.
    tracking = e.touches[0].clientX - document.body.getBoundingClientRect().left >= EDGE
      && !t.closest('.overflow-x-auto') && !t.closest('.staff-row')
      && !(t.matches('input') && t === document.activeElement)
      && !document.body.classList.contains('keyboard-open');
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
  }, { passive: true });
  area.addEventListener('touchend', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - t0 > 700) return;
    const next = TAB_ORDER[TAB_ORDER.indexOf(store.getState().ui.activeTab) + (dx < 0 ? 1 : -1)];
    if (!next) {
      if (dx > 0) App.openDrawer();          // right swipe on the first tab
      return;
    }
    document.activeElement?.blur?.();
    switchTab(next, { swipe: dx < 0 ? 'left' : 'right' });
    store.setActiveTab(next);
  }, { passive: true });
})();

// ── First render ──────────────────────────────────────────────────────────────

loadRoster();
state.staff.forEach(p => rememberName(p.name, p.role));

switchTab(state.ui.activeTab);
render(state);

// Slide a time chip up/down (or tap it) to set In/Out; swipe a row left for
// its actions. (After the first render: #staffList is built by renderStaff.)
initStaffGestures({
  setTime: (id, field, raw) => store.updateStaff(id, field, raw),
  openTime: (id, field) => openTimeSheet(id, field),
});

// Drawer: drag in from the left edge, drag it back to close.
initDrawerGestures({
  canOpen: () => !document.body.classList.contains('keyboard-open')
    && !document.querySelector('.sheet-backdrop.open'),
});

// Reveal once Tailwind has styled the page (it compiles in the browser).
(function reveal(tries = 0) {
  const ready = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim();
  if (ready || tries > 60) document.documentElement.classList.add('ready');
  else requestAnimationFrame(() => reveal(tries + 1));
})();

// Pulse-hint the first empty staff name on a fresh session
const firstEmpty = document.querySelector('#staffList [data-field="name"]');
if (firstEmpty && !firstEmpty.value.trim()) {
  const row = firstEmpty.closest('.staff-row');
  row?.classList.add('pulse');
  setTimeout(() => row?.classList.remove('pulse'), 1600);
}
