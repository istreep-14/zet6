// Bootstrap: load → subscribe → first render.
// Update flow: input event → action mutates state → schedule(120ms) →
// compute (buildViewModel) → render → persist.

import * as store from './store.js';
import * as persist from './persist.js';
import { buildViewModel } from './viewmodel.js';
import { switchTab, updateTabIndicators } from './render/tabs.js';
import {
  renderStaff, invalidateStaffList, staffTabNav,
  initStaffGestures, closeAllSwipes,
  openTimeSheet, timeStep, timeInput, timeReset,
  openRosterSheet, rosterPick, rosterSelectAll, rosterSelected, toggleRosterEdit,
} from './render/staff.js';
import { loadRoster, rememberName, forgetName } from './roster.js';
import { renderPools, invalidatePools } from './render/pools.js';
import { renderSummary } from './render/summary.js';
import {
  renderDist, openCloseTimeSidebar, closeCloseTimeSidebar, selectCloseTime,
  applyPendingTradeUp, applyPendingTradeDown,
} from './render/dist.js';
import {
  openModal, closeModal, modalBgClose,
  openPersonModal, renderPersonModal,
  openRemModal, renderRemModal, adjustRemBonus, resetRemBonuses,
  renderDefaultsModal,
} from './render/modals.js';

const $ = id => document.getElementById(id);

// ── Load persisted state (v4 or migrated v3) ──────────────────────────────────

const saved = persist.load();
if (saved) store.replaceState(saved);

const state = store.getState();
if (!state.meta.date) {
  const t = new Date();
  state.meta.date = t.getFullYear() + '-'
    + String(t.getMonth() + 1).padStart(2, '0') + '-'
    + String(t.getDate()).padStart(2, '0');
}

// ── Render loop ───────────────────────────────────────────────────────────────

let lastVm = buildViewModel(state);

function render(s) {
  lastVm = buildViewModel(s);
  renderStaff(lastVm);
  renderPools(lastVm);
  renderSummary(lastVm);
  renderDist(lastVm);
  renderPersonModal(lastVm);
  renderRemModal(lastVm);
  renderDefaultsModal(lastVm);
  updateTabIndicators(lastVm);
  renderSettings(s);
  persist.save(s);
}

// Settings switches on the More tab. Multiple pools can't be switched off
// while extra pools exist (that would hide entered cash) — remove them first.
function renderSettings(s) {
  const set = (id, on, disabled) => {
    const el = $(id);
    if (!el) return;
    el.setAttribute('aria-checked', String(on));
    el.disabled = !!disabled;
  };
  const extraPools = s.pools.length > 1;
  set('set-allRoles', s.settings.allRoles);
  set('set-multiPool', s.settings.multiPool || extraPools, extraPools);
  const hint = $('set-multiPool-hint');
  if (hint) {
    hint.textContent = extraPools
      ? 'On while ' + s.pools.length + ' pools exist — remove extras to turn off'
      : 'Split tips by time window (e.g. lunch / dinner)';
  }
}

store.subscribe(render);

// ── Global handler surface for inline on* attributes ──────────────────────────

const rolesOn = () => store.getState().settings.allRoles;

window.App = {
  // tabs
  tab(name) {
    switchTab(name);
    store.setActiveTab(name);
  },

  // settings
  toggleSetting(key) {
    const s = store.getState();
    if (key === 'multiPool' && s.pools.length > 1) return;
    invalidateStaffList();
    invalidatePools();
    store.setSetting(key, !s.settings[key]);
  },

  // staff
  addStaff() {
    store.addStaff(rolesOn() ? store.getState().ui.staffViewRole : 'bartender');
  },
  delStaff: store.removeStaff,
  staffField: store.updateStaff,
  staffTab: staffTabNav,
  toggleCloser: store.toggleCloserOverride,

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

  // Quick-add sheet: pick saved people (cards), add them all at once. Each
  // fills the next blank row of their role, or gets a new row.
  openRoster: openRosterSheet,
  rosterPick,
  rosterAll: rosterSelectAll,
  rosterEdit: toggleRosterEdit,
  rosterAddSelected() {
    const picks = rosterSelected();
    if (!picks.length) return;
    const roles = rolesOn();
    invalidateStaffList();                       // name inputs must show the new values
    store.mutate(st => {
      picks.forEach(({ name, role }) => {
        const r = roles ? role : 'bartender';
        const blank = st.staff.find(p => !p.name.trim() && (!roles || p.role === r));
        if (blank) blank.name = name;
        else st.staff.push({ ...store.newStaff(r), name });
      });
    }, { immediate: true });
    closeModal('rosterModal');
  },

  // Time sheet (tap a time chip): steppers, typed entry, reset per field
  timeStep,
  timeInput,
  timeReset,
  switchRole(role) {
    invalidateStaffList();
    store.setStaffViewRole(role);
  },
  // Simple mode edits the whole-shift open/close; roles mode the role default.
  roleDefaultInline(field, value) {
    if (rolesOn()) store.setRoleDefault(store.getState().ui.staffViewRole, field, value.trim());
    else store.setGlobalDefault(field, value.trim());
  },
  roleDefault(role, field, value) {
    store.setRoleDefault(role, field, value.trim());
  },
  globalDefault(field, value) {
    store.setGlobalDefault(field, value.trim());
  },
  supportDefault(value) {
    store.setSupportDefault(value.trim());
  },

  // pools
  addPool: store.addPool,
  removePool: store.removePool,
  selectPool: store.selectPool,
  poolMode: store.setPoolEntryMode,
  poolRole: store.togglePoolRole,
  poolLabel(id, value) {
    store.updatePool(id, p => { p.label = value; });
  },
  poolWindow(id, field, value) {
    store.updatePool(id, p => { p.window[field] = value; });
  },
  poolBill(id, denom, value) {
    store.updatePool(id, p => { p.cash.billCounts[denom] = value; });
  },
  poolNet(id, value) {
    store.updatePool(id, p => { p.cash.netTotal = value; });
  },
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
    const cur = parseInt(pool.cash.billCounts[denom], 10) || 0;
    const next = Math.max(0, cur + delta);
    store.updatePool(id, p => { p.cash.billCounts[denom] = next ? String(next) : ''; });
    const input = document.querySelector(`[data-pid="${id}"] [data-bill="${denom}"]`);
    if (input) input.value = next ? String(next) : '';
  },
  // Enter / "next" key hops down the denomination rows ($100 → $50 → … → $1)
  billKey(e, poolId) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const card = document.querySelector(`[data-pid="${poolId}"]`);
    if (!card) return;
    const inputs = [...card.querySelectorAll('[data-bill]')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select?.(); }
    else e.target.blur();
  },

  // modals
  openModal,
  closeModal,
  modalBg: modalBgClose,
  personModal(id) {
    openPersonModal(lastVm, id);
  },
  openRemModal() {
    openRemModal(lastVm);
  },
  remBonus(id, delta) {
    adjustRemBonus(lastVm, id, delta);
  },
  resetRemBonuses,

  // close time sidebar
  openCloseTime: openCloseTimeSidebar,
  closeCloseTime: closeCloseTimeSidebar,
  selectCloseTime,

  // trades
  applyTradeUp: applyPendingTradeUp,
  applyTradeDown: applyPendingTradeDown,

  // session
  setDate: store.setDate,
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
        const imported = persist.deserialize(e.target.result);
        persist.save(imported);
        resetInput();
        location.reload();
      } catch (err) {
        alert('Import failed: ' + err.message);
        resetInput();
      }
    };
    reader.onerror = () => { alert('Could not read file.'); resetInput(); };
    reader.readAsText(file);
  },
  clearSession() {
    if (!confirm('Start a new session? This will clear all current data.')) return;
    // Settings are a preference, not session data — carry them over.
    const fresh = store.initialState();
    fresh.settings = { ...store.getState().settings };
    persist.save(fresh);
    location.reload();
  },
};

// ── One-time DOM wiring ───────────────────────────────────────────────────────

$('tipDate').value = state.meta.date;

// Hide the tab bar when the software keyboard is open.
if (window.visualViewport) {
  // Compare the visible area to the layout viewport (innerHeight), not the
  // physical screen: in regular Safari the address bar + toolbar alone are
  // >120pt, which used to flag "keyboard open" and hide the tab bar while
  // just scrolling. The keyboard shrinks only the visual viewport, and only
  // while a text field has focus.
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

// Lock page zoom. iOS ignores user-scalable=no in places, and a pinched or
// focus-zoomed page shifts the fixed tab bar off the bottom edge — so block
// pinch gestures here; double-tap zoom is off via touch-action in app.css.
(() => {
  const block = e => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, block, { passive: false }));
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault();
  }, { passive: false });
})();

// Swipe left/right on the content area to move between tabs. Ignored when the
// gesture starts in a sideways-scrolling table, while typing, or when it's
// mostly vertical (normal scrolling).
const TAB_ORDER = ['summary', 'staff', 'cash', 'bills', 'more'];
(() => {
  const area = $('mainContent');
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;

  area.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.target;
    tracking = !t.closest('.tbl-wrap') && !t.closest('.staff-row')
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
    const cur = TAB_ORDER.indexOf(store.getState().ui.activeTab || 'summary');
    const next = TAB_ORDER[cur + (dx < 0 ? 1 : -1)];
    if (!next) return;
    document.activeElement?.blur?.();
    switchTab(next, { swipe: dx < 0 ? 'left' : 'right' });
    store.setActiveTab(next);
  }, { passive: true });
})();

// ── First render ──────────────────────────────────────────────────────────────

// Roster: load saved names and fold in anyone already on this shift.
loadRoster();
state.staff.forEach(p => rememberName(p.name, p.role));

// Slide a time chip up/down (or tap it) to set In/Out; swipe a row left for its actions.
initStaffGestures({
  setTime: (id, field, raw) => store.updateStaff(id, field, raw),
  openTime: (id, field) => openTimeSheet(id, field),
});

switchTab(state.ui.activeTab || 'summary');
render(state);

// Pulse-hint the first empty staff name field on a fresh session
const firstEmpty = document.querySelector('#staffList [data-field="name"]');
if (firstEmpty && !firstEmpty.value.trim()) {
  const row = firstEmpty.closest('.staff-row');
  if (row) {
    row.classList.add('pulse');
    setTimeout(() => row.classList.remove('pulse'), 1600);
  }
}
