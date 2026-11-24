// Bootstrap: load → mount sheets → subscribe → first render.
// Update flow: input event → action mutates state → schedule(120ms) →
// compute (buildViewModel) → render → persist.

import * as store from './store.js';
import * as persist from './persist.js';
import * as sessions from './sessions.js';
import { buildViewModel } from './viewmodel.js';
import { setClock24, setAmFrom, parseTime, inAbsOf } from './time.js';
import { countedValue } from './util.js';
import { presetPools, partyPool, switchPools, cashLostBySwitch, timesFor, SHIFT_LABEL } from './shifts.js';
import { mountSheets, closeSheet, closeAllSheets } from './ui/sheet.js';
import { switchTab, updateTabIndicators, normalizeTab } from './render/tabs.js';
import { initPages, openHub, closeHub, pagesOpen } from './ui/pages.js';
import { renderStaff, openStaffEditor, openTimeEditor, openRosterSheet, rosterSelected, rosterAdded } from './render/staff.js';
import { loadRoster, rememberName, forgetName, getRoster } from './roster.js';
import { renderTips } from './render/tips.js';
import { renderPayout, applyPendingTradeUp, applyPendingTradeDown, openPayoutSheet } from './render/payout.js';
import { refreshSticky } from './ui/sticky.js';
import { trackChanges, resetChanges, snapOf, SHOW } from './ui/changes.js';
import { toast, copyText } from './ui/toast.js';
import { summaryText } from './textout.js';
import { renderSummary, openPoolSummary } from './render/summary.js';
import { openCloseTime, renderCloseTime, selectCloseTime } from './render/closetime.js';
import {
  renderSheets, openPerson, openBonus, adjustBonus, resetBonuses,
} from './render/sheets.js';
import { renderDrawer, toggleDrawerEdit } from './render/drawer.js';
import { renderShiftPanel, calendarStep, scrollShiftTo } from './render/shiftpanel.js';
import {
  openPanel, closePanel, closePanels, togglePanel, isPanelOpen, initPanelGestures,
} from './ui/panels.js';

const $ = id => document.getElementById(id);

// ── Load the current session (v4 or migrated v3) ──────────────────────────────

const saved = sessions.boot();
if (saved) store.replaceState(saved);

const state = store.getState();
if (!state.meta.date) state.meta.date = sessions.todayISO();
state.ui.activeTab = landingTab(state);

mountSheets($('sheets'));

// Sessions always open on Summary — home. Its checklist points at whatever
// step the shift still needs.
function landingTab() {
  return 'summary';
}

// ── Render loop ───────────────────────────────────────────────────────────────

let lastVm = buildViewModel(state);
const sessionName = () => sessions.list().find(e => e.id === sessions.currentId())?.name || '';

function render(s) {
  setClock24(s.settings.clock24);
  setAmFrom(s.settings.amFrom);
  const root = document.documentElement;
  root.dataset.size = s.settings.size || 'm';
  if (s.settings.theme === 'light' || s.settings.theme === 'dark') root.dataset.theme = s.settings.theme;
  else delete root.dataset.theme;
  store.ensureBlankRows(s);
  lastVm = buildViewModel(s);
  previewing = false;
  // A reviewed edit (drag / keypad) lands in this render; any other edit
  // after it accepts it (Undo only ever puts back the latest one). Moving
  // between tabs isn't an edit: only `ui` changed, so the review stays.
  if (pendingReview) { review = { ...pendingReview, stamp: ++reviewN, after: dataKey(s) }; pendingReview = null; }
  else if (review && dataKey(s) !== review.after) review = null;
  if (trackChanges(lastVm, sessions.currentId(), review)) clearChangesLater();
  renderStaff(lastVm);
  renderTips(lastVm);
  renderPayout(lastVm);
  renderSummary(lastVm, sessionName());
  renderCloseTime(lastVm);
  renderSheets(lastVm);
  updateTabIndicators(lastVm, sessionName());
  sessions.saveCurrent(s, {
    total: lastVm.totalCash || 0,
    people: s.staff.filter(p => p.name.trim()).length,
  });
  refreshSticky();
  const list = sessions.list(), cur = sessions.currentId();
  renderDrawer(lastVm, list, cur);
  renderShiftPanel(lastVm, list, cur);
}

// ── What changed / what would change (ui/changes.js) ─────────────────────────
// A landed edit marks the figures it moved (vm.changes) for SHOW ms, then
// they're repainted plain. An edit in progress (a dragged or typed time)
// re-runs the split on a copy of the state and paints Summary + the HUD with
// the would-be numbers (vm.preview); nothing is written until it lands.
// Returns the preview view model (the wheel picker shows its figures).
let clearTimer = 0;
function clearChangesLater() {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (!lastVm.changes || lastVm.changes.review || previewing) return;
    lastVm.changes = null;
    renderSummary(lastVm, sessionName());
    renderPayout(lastVm);
    updateTabIndicators(lastVm);
  }, SHOW + 50);
}

// Review: a drag or keypad edit is written at once, then waits for a word —
// the HUD shows what it moved with Undo (put the whole state back as it was
// just before) and Apply (keep it; the marks go). Its marks stay until then.
let review = null, pendingReview = null, reviewN = 0;
const dataKey = s => JSON.stringify({ ...s, ui: null });
function withReview(label, write) {
  pendingReview = { label, before: structuredClone(store.getState()), base: snapOf(lastVm) };
  write();
}
function reviewUndo() {
  const r = review;
  if (!r) return;
  review = null;
  resetChanges();
  store.replaceState(r.before);
  render(store.getState());
  toast('Undone');
}
function reviewApply() {
  if (!review) return;
  review = null;
  lastVm.changes = null;
  renderSummary(lastVm, sessionName());
  renderPayout(lastVm);
  updateTabIndicators(lastVm);
}

// Nudge the tips total (one pool) by `delta` dollars: the uncounted rest
// moves, the counted bills stay; with "Amount is the Total" the typed total
// moves with it. vmPool = that pool in the current view model.
function nudgeCash(s, vmPool, delta) {
  const pool = s.pools[0];
  if (!pool || !vmPool) return;
  const rest = Math.max(0, (vmPool.rest || 0) + delta);
  const asTotal = pool.cash.restMode === 'total' && String(pool.cash.netTotal ?? '').trim() !== '';
  pool.cash.netTotal = String(asTotal ? (vmPool.counted || 0) + rest : rest);
}

let previewing = false;
function preview(apply, focus = null) {
  if (!apply) {
    if (!previewing) return;
    previewing = false;
    renderSummary(lastVm, sessionName());
    updateTabIndicators(lastVm);
    return;
  }
  const base = snapOf(lastVm);
  if (!base) return;
  const s = structuredClone(store.getState());
  apply(s);
  let pv;
  try { pv = buildViewModel(s); } catch { return; }
  pv.preview = { base, focus };
  previewing = true;
  renderSummary(pv, sessionName());
  updateTabIndicators(pv);
  return pv;                                     // the wheel shows its figures
}

// ── Sessions: switch / create / delete without reloading ─────────────────────

// Settings are app preferences, shared by every session. A session that
// already uses roles or several pools keeps those visible.
function carryPrefs(next) {
  const prefs = store.getState().settings;
  const usesRoles = next.staff.some(p => p.role !== 'bartender') || next.pools.some(p => p.includeSupport)
    || next.meta.shiftType === 'day';
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
  next.ui.activeTab = landingTab(next);
  closeAllSheets();
  store.replaceState(next);
  next.staff.forEach(p => rememberName(p.name, p.role));
  switchTab(next.ui.activeTab);
  syncHdrDate();
  render(next);
  if (!keepPanel) closePanels();
}

// A new session keeps the current shift type, with that type's remembered
// default times and pools.
function freshState() {
  const cur = store.getState();
  const type = cur.meta.shiftType || 'night';
  const fresh = store.initialState();
  fresh.meta.date = sessions.todayISO();
  fresh.meta.shiftType = type;
  const t = timesFor(type, cur.settings.shiftTimes);
  fresh.defaults.global = t.global;
  fresh.defaults.byRole = t.byRole;
  fresh.pools = presetPools(type);
  fresh.ui.selectedPool = fresh.pools[0].id;
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

// ── Global handler surface for inline on* attributes ──────────────────────────

const rolesOn = () => store.getState().settings.allRoles;
const fromPanel = fn => (...a) => { closePanels(); fn(...a); };

window.App = {
  // tabs
  // Summary closes the pages drawer; Staff / Tips / Payout open it there.
  tab(name, opts = {}) {
    closeHub();
    switchTab(name, opts);
    store.setActiveTab(name);
  },

  // HUD: from Staff / Tips → Summary; from Summary → Payout (the bills).
  hudTap() { App.tab(store.getState().ui.activeTab === 'summary' ? 'payout' : 'summary'); },
  // The hub (pull down at the top of Summary): every page and tool.
  hub(on = true) { if (on) openHub(); else closeHub(); },

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
  setSize: size => store.setSize(size),
  setAmFrom: h => store.mutate(s => { s.settings.amFrom = h; }, { immediate: true }),
  setTheme: theme => store.setTheme(theme),
  toggleSetting(key) {
    const s = store.getState();
    if (key === 'multiPool' && s.pools.length > 1) return;
    store.setSetting(key, !s.settings[key]);
  },

  // staff
  // Add a named person: fills a blank row of that role first (fresh sessions
  // start with blank rows), else a new row. Remembered for next shift.
  addPerson(name, role = 'bartender', inRaw = '') {
    const n = String(name || '').trim();
    if (!n) return;
    const r = rolesOn() ? role : 'bartender';
    store.mutate(st => {
      // A start equal to the role's default is stored blank (it inherits).
      const def = st.defaults.byRole[r]?.in || st.defaults.global.in || '';
      const a = parseTime(inRaw), b = parseTime(def);
      const start = inRaw && !(a.value != null && b.value != null && inAbsOf(a) === inAbsOf(b)) ? inRaw : '';
      const blank = st.staff.find(p => !p.name.trim() && p.role === r);
      if (blank) { blank.name = n; blank.in = start; }
      else st.staff.push({ ...store.newStaff(r), name: n, in: start });
    }, { immediate: true });
    rememberName(n, r);
  },
  editStaff: id => openStaffEditor(id),
  openRoster: openRosterSheet,
  // Each pick fills a blank row of their role, or gets a new row.
  rosterAddSelected() {
    const picks = rosterSelected();
    if (!picks.length) return;
    picks.forEach(p => App.addPerson(p.name, p.role, p.in));
    // Keep the sheet open while saved names are left, for the next start time.
    const onShift = new Set(store.getState().staff.map(p => p.name.trim().toLowerCase()));
    if (getRoster().some(r => !onShift.has(r.name.toLowerCase()))) rosterAdded(picks);
    else closeSheet('sheet-roster');
  },
  editTime: (id, field) => openTimeEditor(id, field),
  // Preview an In / Out (or the default open / close) before it's written —
  // raw = the string it would store, null = end the preview.
  previewStaff: (id, field, raw) => preview(raw == null ? null : s => {
    const p = s.staff.find(x => x.id === id);
    if (p) p[field] = raw;
  }, id),
  previewDefault: (field, raw) => preview(raw == null ? null : s => { s.defaults.global[field] = String(raw).trim(); }),
  // The tips total (Summary Total row, one pool): preview / write a nudge.
  previewCash: delta => preview(delta == null || !delta ? null : s => nudgeCash(s, lastVm.pools[0], delta)),
  nudgeCash(delta) {
    const vmPool = lastVm.pools[0];
    if (!vmPool || !delta) return;
    withReview('Tips ' + (delta > 0 ? '+$' : '−$') + Math.abs(delta).toLocaleString('en-US'),
      () => store.mutate(s => nudgeCash(s, vmPool, delta), { immediate: true }));
  },
  // Payout's extras, each a small drawer: 'fix' · 'stacks' · 'tidy'.
  openPayoutSheet,
  // Stacks of small bills for managers (Payout).
  toggleStackTo: id => store.toggleStackTo(id),
  setStackSize: (d, v) => store.setStackSize(d, v),
  // A drag / keypad edit with Undo · Apply in the HUD (see withReview).
  reviewed: withReview,
  reviewUndo,
  reviewApply,
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
  roleDefault: (role, field, value, immediate = false) => store.setRoleDefault(role, field, value.trim(), immediate),
  globalDefault: (field, value, immediate = false) => store.setGlobalDefault(field, value.trim(), immediate),
  supportDefault: value => store.setSupportDefault(value.trim()),

  // pools
  // Several pools: the Tips page shows one pool at a time (swipe between them).
  selectPool: id => store.mutate(s => { s.ui.selectedPool = id; }, { immediate: true }),
  addPool() { const id = store.addPool(); App.selectPool(id); App.tab('tips'); },
  openPool(id) { App.selectPool(id); App.tab('tips'); },
  openPoolSummary: id => openPoolSummary(id),
  removePool: store.removePool,
  poolRole: store.togglePoolRole,
  poolLabel: (id, value) => store.updatePool(id, p => { p.label = value; }),
  poolWindow: (id, field, value, immediate = false) => store.updatePool(id, p => { p.window[field] = value; }, immediate),
  // Night (one pool) / Day (Day + Mid): the pools are rebuilt, keeping cash
  // where it maps over and any parties; the default times switch to the
  // type's remembered ones.
  setShiftType(type) {
    const st = store.getState();
    if ((st.meta.shiftType || 'night') === type) return;
    const cashOf = p => countedValue(p.cash.billCounts) + (parseInt(p.cash.netTotal, 10) || 0);
    const lost = cashLostBySwitch(st.pools, type, cashOf);
    const ask = `Switch to a ${SHIFT_LABEL[type].toLowerCase()} shift? The $${lost} entered in the pools that go away will be cleared.`;
    if (lost > 0 && !window.confirm(ask)) return;
    closeSheet('sheet-pool');
    store.mutate(s => {
      s.meta.shiftType = type;
      const t = timesFor(type, s.settings.shiftTimes);
      s.defaults.global = t.global;
      s.defaults.byRole = t.byRole;
      s.pools = switchPools(s.pools, type);
      s.ui.selectedPool = s.pools[0].id;
      if (type === 'day') s.settings.allRoles = true;
      if (s.pools.length > 1) s.settings.multiPool = true;
    }, { immediate: true });
  },
  // A private party: its own pool over the floor pools, window to set.
  addParty() {
    let id;
    store.mutate(s => {
      const p = partyPool(s.pools);
      id = p.id;
      s.pools.push(p);
      s.settings.multiPool = true;
    }, { immediate: true });
    openPoolSheet(id);
  },
  poolBill: (id, denom, value) => store.updatePool(id, p => { p.cash.billCounts[denom] = value; }),
  poolNet: (id, value) => store.updatePool(id, p => { p.cash.netTotal = value; }),
  poolAdjust: (id, value) => store.updatePool(id, p => { p.cash.adjust = value; }),
  // Count bills on: the amount box now means the total (incl. the counted
  // bills). Off: the counted bills fold back into one amount.
  poolCounting(id, on) {
    store.mutate(s => {
      const p = s.pools.find(x => x.id === id);
      if (!p) return;
      const counted = countedValue(p.cash.billCounts);
      const n = parseInt(p.cash.netTotal, 10) || 0;
      if (on) {
        if (!counted) p.cash.restMode = 'total';
        return;
      }
      const sum = p.cash.restMode === 'total' && String(p.cash.netTotal).trim() ? Math.max(n, counted) : n + counted;
      p.cash.netTotal = sum ? String(sum) : '';
      Object.keys(p.cash.billCounts).forEach(d => { p.cash.billCounts[d] = ''; });
      p.cash.restMode = 'rest';
    }, { immediate: true });
  },
  // The amount box means the uncounted rest, or the whole total (incl. the
  // counted bills). Switching keeps the same cash: the typed number converts.
  poolRestMode(id, mode) {
    store.mutate(s => {
      const p = s.pools.find(x => x.id === id);
      if (!p || (p.cash.restMode || 'rest') === mode) return;
      const counted = countedValue(p.cash.billCounts);
      const n = parseInt(p.cash.netTotal, 10);
      if (Number.isFinite(n)) p.cash.netTotal = String(mode === 'total' ? n + counted : Math.max(0, n - counted));
      p.cash.restMode = mode;
    }, { immediate: true });
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
  // −/+ steppers on a bill row: a tap renders at once (no typing debounce).
  billStep(id, denom, delta) {
    store.mutate(s => {
      const p = s.pools.find(x => x.id === id);
      if (!p) return;
      const next = Math.max(0, (parseInt(p.cash.billCounts[denom], 10) || 0) + delta);
      p.cash.billCounts[denom] = next ? String(next) : '';
    }, { immediate: true });
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
  // Summary as plain text on the clipboard (for Notes).
  async copySummary() {
    const st = store.getState();
    const text = lastVm?.shares && lastVm.totalCash > 0 ? summaryText(lastVm, [sessionName() || 'Tips', fmtHdrDate(st.meta.date)].join(' · ')) : '';
    if (!text) { toast('Nothing to copy yet'); return; }
    toast(await copyText(text) ? 'Copied — paste into Notes' : 'Couldn’t copy on this device');
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

// ── First render ──────────────────────────────────────────────────────────────

loadRoster();
state.staff.forEach(p => rememberName(p.name, p.role));

switchTab(state.ui.activeTab);
render(state);

// Side panels: drag in from either screen edge, drag back to close.
initPanelGestures({
  canOpen: () => !document.body.classList.contains('keyboard-open')
    && !document.querySelector('.sheet-backdrop.open') && !pagesOpen(),
});

// The pages drawer and the hub (ui/pages.js): a swipe that moves the drawer
// to another page, closes it, or raises it from the HUD keeps state in step.
initPages({
  onChange: name => App.tab(name),
  canPull: () => !pagesOpen() && !document.querySelector('.sheet-backdrop.open')
    && !document.documentElement.classList.contains('panel-open') && !document.body.classList.contains('keyboard-open'),
});

// Reveal once Tailwind has styled the page (it compiles in the browser): a
// probe with `hidden` turns display:none once the utilities exist.
(() => {
  const probe = Object.assign(document.createElement('div'), { className: 'hidden' });
  document.body.append(probe);
  let tries = 0;
  (function reveal() {
    if (getComputedStyle(probe).display === 'none' || ++tries > 90) {
      probe.remove();
      document.documentElement.classList.add('ready');
    } else requestAnimationFrame(reveal);
  })();
})();
