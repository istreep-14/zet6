// Bootstrap: load → mount sheets → subscribe → first render.
// Update flow: input event → action mutates state → schedule(120ms) →
// compute (buildViewModel) → render → persist.

import * as store from './store.js';
import * as persist from './persist.js';
import * as sessions from './sessions.js';
import { buildViewModel } from './viewmodel.js';
import { setClock24 } from './time.js';
import { mountSheets, closeSheet, closeAllSheets } from './ui/sheet.js';
import { switchTab, updateTabIndicators, normalizeTab, renderSubtabs, subsFor, activeSub } from './render/tabs.js';
import { renderStaff, openStaffEditor, openTimeEditor, openRosterSheet, rosterSelected } from './render/staff.js';
import { loadRoster, rememberName, forgetName } from './roster.js';
import { renderTips, invalidateTips } from './render/tips.js';
import { renderPayout, applyPendingTradeUp, applyPendingTradeDown } from './render/payout.js';
import { renderSummary } from './render/summary.js';
import { openCloseTime, renderCloseTime, selectCloseTime } from './render/closetime.js';
import {
  renderSheets, openPerson, openBonus, adjustBonus, resetBonuses,
} from './render/sheets.js';
import { renderDrawer, toggleDrawerEdit } from './render/drawer.js';
import { renderShiftPanel, calendarStep, scrollShiftTo } from './render/shiftpanel.js';
import {
  openPanel, closePanel, closePanels, togglePanel, isPanelOpen, initPanelGestures, EDGE,
} from './ui/panels.js';

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
  renderSummary(lastVm, sessions.list().find(e => e.id === sessions.currentId())?.name || '');
  renderCloseTime(lastVm);
  renderSheets(lastVm);
  updateTabIndicators(lastVm);
  sessions.saveCurrent(s, {
    total: lastVm.totalCash || 0,
    people: s.staff.filter(p => p.name.trim()).length,
  });
  renderSubtabs(lastVm);
  const list = sessions.list(), cur = sessions.currentId();
  renderDrawer(lastVm, list, cur);
  renderShiftPanel(lastVm, list, cur);
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

function activate(next, { keepPanel = false } = {}) {
  carryPrefs(next);
  if (!next.meta.date) next.meta.date = sessions.todayISO();
  next.ui.activeTab = normalizeTab(next.ui.activeTab);
  closeAllSheets();
  store.replaceState(next);
  next.staff.forEach(p => rememberName(p.name, p.role));
  switchTab(next.ui.activeTab);
  syncHdrDate();
  render(next);
  if (!keepPanel) closePanels();
}

function freshState() {
  const fresh = store.initialState();
  fresh.meta.date = sessions.todayISO();
  fresh.ui.activeTab = 'staff';
  return fresh;
}

store.subscribe(render);

// ── Header date pill: "Sat, Nov 8" — tap opens the shift panel (calendar) ────

function fmtHdrDate(iso) {
  if (!iso) return 'Today';
  // Parse as local noon so DST shifts never move the visible day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
}

function syncHdrDate() {
  const label = $('hdrDateLabel');
  const text = fmtHdrDate(store.getState().meta.date);
  if (label && label.textContent !== text) label.textContent = text;
}

// Slide a sub-tab's content in from the side it came from.
function slideIn(tab, dir) {
  const r = $(tab + '-root');
  if (!r) return;
  r.classList.remove('sub-in-left', 'sub-in-right');
  void r.offsetWidth;
  r.classList.add(dir === 'left' ? 'sub-in-right' : 'sub-in-left');
}

// ── Global handler surface for inline on* attributes ──────────────────────────

const rolesOn = () => store.getState().settings.allRoles;
const fromPanel = fn => (...a) => { closePanels(); fn(...a); };

window.App = {
  // tabs
  tab(name) {
    switchTab(name);
    store.setActiveTab(name);
  },

  // HUD: from Staff / Tips → Summary; from Summary → Payout (the bills).
  hudTap() { App.tab(store.getState().ui.activeTab === 'summary' ? 'payout' : 'summary'); },

  // Sub-tab inside a tab (header tap or page swipe).
  sub(tab, v) {
    const st = store.getState();
    const subs = subsFor(tab, st);
    const from = subs.findIndex(x => x.v === activeSub(tab, st));
    const to = subs.findIndex(x => x.v === v);
    if (to < 0 || to === from) return;
    document.activeElement?.blur?.();
    if (tab === 'tips') {
      if (st.pools.length > 1) store.selectPool(v);
      else store.setPoolEntryMode(st.pools[0].id, v);
    } else store.setSub(tab, v);
    slideIn(tab, to > from ? 'left' : 'right');
    const area = $('mainContent');
    if (area.scrollTop > 0) area.scrollTop = 0;
  },

  // sheets
  closeSheet,
  openBonus: fromPanel(() => openBonus(lastVm)),
  openCloseTime: fromPanel(() => openCloseTime(lastVm)),
  // Default times live in the shift panel now.
  openDefaults() { App.panel('right'); scrollShiftTo('shift-times'); },

  // side panels: left = sessions + app settings, right = this shift
  panel(side) { closeAllSheets(); togglePanel(side); },
  closePanels,
  drawerEdit: toggleDrawerEdit,
  calMonth: calendarStep,
  renameCurrent(name) {
    sessions.rename(sessions.currentId(), name);
    render(store.getState());
  },
  personModal: id => openPerson(lastVm, id),

  // settings
  toggleSetting(key) {
    const s = store.getState();
    if (key === 'multiPool' && s.pools.length > 1) return;
    store.setSetting(key, !s.settings[key]);
  },

  // staff
  // Add a named person: fills a blank row of that role first (fresh sessions
  // start with blank rows), else a new row. Remembered for next shift.
  addPerson(name, role = 'bartender') {
    const n = String(name || '').trim();
    if (!n) return;
    const r = rolesOn() ? role : 'bartender';
    store.mutate(st => {
      const blank = st.staff.find(p => !p.name.trim() && p.role === r);
      if (blank) blank.name = n;
      else st.staff.push({ ...store.newStaff(r), name: n });
    }, { immediate: true });
    rememberName(n, r);
  },
  editStaff: id => openStaffEditor(id),
  // "+ Add bartender": a new blank person, editor open with the name focused
  // (synchronously, inside the tap, so iOS raises the keyboard).
  addBlank(role = 'bartender') {
    const r = rolesOn() ? role : 'bartender';
    // Reuse a blank row of that role (fresh sessions start with some).
    const blank = store.getState().staff.find(p => !p.name.trim() && p.role === r);
    openStaffEditor(blank ? blank.id : store.addStaff(r), { focusName: true });
  },
  openRoster: openRosterSheet,
  // Each pick fills a blank row of their role, or gets a new row.
  rosterAddSelected() {
    const picks = rosterSelected();
    if (!picks.length) return;
    closeSheet('sheet-roster');
    picks.forEach(({ name, role }) => App.addPerson(name, role));
  },
  editTime: (id, field) => openTimeEditor(id, field),
  // immediate = picker / button edits (render now); typing debounces.
  staffField(id, field, value, immediate = false) {
    store.mutate(s => {
      const p = s.staff.find(x => x.id === id);
      if (p) p[field] = value;
    }, { immediate });
  },
  toggleCloser: id => store.toggleCloserOverride(id),
  removePerson(id) {
    closeSheet('sheet-staff');
    store.removeStaff(id);
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
  setDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    store.mutate(s => { s.meta.date = v; }, { immediate: true });
    syncHdrDate();
  },
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
    if (id === sessions.currentId()) { closePanels(); return; }
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
      if (next) { sessions.setCurrent(other.id); activate(next, { keepPanel: true }); return; }
      sessions.remove(other.id);
    }
    sessions.createId();
    activate(freshState(), { keepPanel: true });
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

// Swipe left/right on the page to move between the tab's SUB-tabs (bottom
// tabs are tapped). Past the first sub-tab a right swipe opens the left
// panel; past the last, a left swipe opens the shift panel. Ignored inside
// sideways-scrolling areas and staff rows, at the screen edges (those drag
// the panels), while typing, or on vertical drags.
(() => {
  const area = $('mainContent');
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  area.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.target;
    const x = e.touches[0].clientX, box = document.body.getBoundingClientRect();
    tracking = x - box.left >= EDGE && box.right - x >= EDGE
      && !t.closest('.overflow-x-auto') && !t.closest('.subtabs') && !t.closest('[data-drag]')
      && !(t.matches('input') && t === document.activeElement)
      && !document.body.classList.contains('keyboard-open');
    x0 = x;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
  }, { passive: true });
  area.addEventListener('touchend', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - t0 > 700) return;
    const st = store.getState();
    const tab = st.ui.activeTab;
    const subs = subsFor(tab, st);
    const i = subs.findIndex(x => x.v === activeSub(tab, st));
    const j = i + (dx < 0 ? 1 : -1);
    if (subs.length && j >= 0 && j < subs.length) App.sub(tab, subs[j].v);
    else openPanel(dx > 0 ? 'left' : 'right');
  }, { passive: true });
})();

// ── First render ──────────────────────────────────────────────────────────────

loadRoster();
state.staff.forEach(p => rememberName(p.name, p.role));

switchTab(state.ui.activeTab);
render(state);

// Side panels: drag in from either screen edge, drag back to close.
initPanelGestures({
  canOpen: () => !document.body.classList.contains('keyboard-open')
    && !document.querySelector('.sheet-backdrop.open'),
});

// Reveal once Tailwind has styled the page (it compiles in the browser).
(function reveal(tries = 0) {
  const ready = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim();
  if (ready || tries > 60) document.documentElement.classList.add('ready');
  else requestAnimationFrame(() => reveal(tries + 1));
})();
