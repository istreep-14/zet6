// Bootstrap: load → mount sheets → subscribe → first render.
// Update flow: input event → action mutates state → schedule(120ms) →
// compute (buildViewModel) → render → persist.

import * as store from './store.js';
import * as persist from './persist.js';
import * as sessions from './sessions.js';
import { buildViewModel } from './viewmodel.js';
import { setClock24, setAmFrom } from './time.js';
import { countedValue, parseWholeNumber } from './util.js';
import { nextId } from './ids.js';
import { presetPools, partyPool, switchPools, cashLostBySwitch, timesFor, SHIFT_LABEL, applyPreset } from './shifts.js';
import { mountSheets, closeSheet, closeAllSheets } from './ui/sheet.js';
import { renderChrome, fmtDay } from './render/tabs.js';
import { initNav, onNav, showTab, setSub, currentTab, popPage, popAll, topPage, resetNav, renderPages, normalizeTab, pushPage } from './ui/nav.js';
import { renderStaff, openStaffEditor } from './render/staff.js';
import { loadRoster, rememberName, forgetName } from './roster.js';
import { renderTips } from './render/tips.js';
import { renderPayout, openPayoutPage } from './render/payout.js';
import { refreshSticky } from './ui/sticky.js';
import { trackChanges, resetChanges, snapOf, SHOW } from './ui/changes.js';
import { toast, copyText } from './ui/toast.js';
import { summaryText } from './textout.js';
import { renderHome, renderPay, openPerson as homePerson, resetHomeMarks } from './render/home.js';
import { renderSettings, SettingsPage } from './render/settings.js';
import { renderShift, openPool as shiftPool } from './render/shift.js';
import { html } from './ui/preact.js';
import { renderMenu, openMenu, closeMenu, menuOpen, menuEdge, initMenu } from './render/menu.js';
import { openCloseTime, renderCloseTime, selectCloseTime } from './render/closetime.js';
import {
  renderSheets, openPerson, adjustBonus, resetBonuses,
} from './render/sheets.js';

const $ = id => document.getElementById(id);

// ── Load the current session (v4 or migrated v3) ──────────────────────────────

const saved = sessions.boot();
if (saved) store.replaceState(saved);

const state = store.getState();
if (!state.meta.date) state.meta.date = sessions.todayISO();
state.ui.activeTab = landingTab(state);

mountSheets($('sheets'));

// Sessions always open on Home. Its checklist points at whatever step the
// shift still needs.
function landingTab() {
  return 'home';
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
  // A wheel / keypad edit lands in this render: a toast says what it was,
  // with Undo. Any other edit after it makes it stick (Undo only ever puts
  // back the latest one); moving between tabs isn't an edit (only `ui`).
  if (pendingReview) {
    review = { ...pendingReview, after: dataKey(s) };
    pendingReview = null;
    toast(review.label, { action: { label: 'Undo', onClick: reviewUndo } });
  } else if (review && dataKey(s) !== review.after) review = null;
  if (trackChanges(lastVm, sessions.currentId())) clearChangesLater();
  renderStaff(lastVm);
  renderTips(lastVm);
  renderPayout(lastVm);
  renderHome(lastVm, sessionName());
  renderPay(lastVm, sessionName());
  renderCloseTime(lastVm);
  renderSheets(lastVm);
  sessions.saveCurrent(s, {
    total: lastVm.totalCash || 0,
    people: s.staff.filter(p => p.name.trim()).length,
  });
  renderSettings(lastVm, sessions.list(), sessions.currentId());
  renderShift(lastVm);
  renderMenu(lastVm, sessions.list(), sessions.currentId());
  renderPages(lastVm);
  renderChrome(lastVm, sessionName());
  refreshSticky();
}

// ── What changed / what would change (ui/changes.js) ─────────────────────────
// A landed edit marks the figures it moved (vm.changes) for SHOW ms, then
// they're repainted plain. An edit in progress (a dragged or typed time)
// re-runs the split on a copy of the state and paints Staff with the
// would-be numbers (vm.preview); nothing is written until it lands. Pay's
// payout table follows a live preview when it is visible.
// Returns the preview view model (the wheel picker shows its figures).
let clearTimer = 0;
function clearChangesLater() {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (!lastVm.changes || previewing) return;
    lastVm.changes = null;
    renderPayout(lastVm);
    renderStaff(lastVm);
    renderPay(lastVm, sessionName());
  }, SHOW + 50);
}

// Review: a drag or keypad edit is written at once; the toast offers Undo
// (put the whole state back as it was just before) while nothing else has
// changed since.
let review = null, pendingReview = null;
const dataKey = s => JSON.stringify({ ...s, ui: null });
function withReview(label, write) {
  pendingReview = { label, before: structuredClone(store.getState()) };
  write();
}
function reviewUndo() {
  const r = review;
  review = null;
  if (!r || dataKey(store.getState()) !== r.after) { toast('Can’t undo — something else changed since'); return; }
  resetChanges();
  store.replaceState(r.before);
  render(store.getState());
  toast('Undone');
}
// Move the one pool's typed amount by `delta` dollars. The amount is the
// uncounted rest, or (restMode 'total') the total including counted bills —
// either way the tips total moves by delta. A blank total starts from what's
// counted.
function nudgeCash(s, delta) {
  const cash = s.pools[0]?.cash;
  if (!cash || s.pools.length !== 1) return;
  const typed = parseWholeNumber(String(cash.netTotal ?? ''));
  const asTotal = cash.restMode === 'total';
  const base = typed.valid && !typed.empty ? typed.value : asTotal ? countedValue(cash.billCounts) : 0;
  cash.netTotal = String(Math.max(asTotal ? countedValue(cash.billCounts) : 0, base + delta));
}

// Counting bills: a pool with nothing typed is in bill mode from the first
// count; an older pool with a typed amount keeps it as its total.
function startBills(cash) {
  if (cash.baseMode) return;
  if (!String(cash.netTotal ?? '').trim()) cash.baseMode = 'bills';
  else makeCashTotal(cash);
}

// Older sessions may store an amount in addition to counted bills. Convert it
// to an inclusive total before editing the bill count in the new interface.
function makeCashTotal(cash) {
  if (cash.restMode === 'total') return;
  const raw = String(cash.netTotal ?? '').trim();
  if (!raw) { cash.restMode = 'total'; return; }
  const parsed = parseWholeNumber(raw);
  if (!parsed.valid) return;
  cash.netTotal = String(parsed.value + countedValue(cash.billCounts));
  cash.restMode = 'total';
}

let previewing = false;
function preview(apply, focus = null) {
  if (!apply) {
    if (!previewing) return;
    previewing = false;
    renderStaff(lastVm);
    renderHome(lastVm, sessionName());
    renderPay(lastVm, sessionName());
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
  renderStaff(pv, { preview: true });
  if (currentTab() === 'pay') renderPay(pv, sessionName());     // payout table edits live
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

function activate(next) {
  carryPrefs(next);
  if (!next.meta.date) next.meta.date = sessions.todayISO();
  next.ui.activeTab = landingTab(next);
  closeAllSheets();
  resetNav();
  resetHomeMarks();                 // another session's pay isn't a change
  store.replaceState(next);
  next.staff.forEach(p => rememberName(p.name, p.role));
  showTab(next.ui.activeTab);
  render(next);
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

// ── Global handler surface for inline on* attributes ──────────────────────────

const rolesOn = () => store.getState().settings.allRoles;

window.App = {
  // Tabs: Home · Staff · Tips · Pay · Shift (opts.sub selects a header tab).
  tab(name, opts = {}) {
    name = normalizeTab(name);
    closeAllSheets();
    closeMenu();
    if (opts.sub) setSub(name, opts.sub);
    if (name !== currentTab()) showTab(name);
    store.setActiveTab(name);
  },
  // A bottom tab: another tab goes there; the tab you're on goes back to its
  // root page (or, already there, scrolls to the top).
  tabTap(name) {
    if (currentTab() !== name) { App.tab(name); return; }
    if (topPage()) popAll(name, { animate: true });
    else document.getElementById('mainContent')?.scrollTo({ top: 0, behavior: 'smooth' });
  },
  // Back: the subpage on top goes.
  back: () => popPage(),
  // The menu (render/menu.js): the drawer from the left.
  openMenu,
  closeMenu,
  // Repaint what shows the keypad's active cell (no data change).
  repaint() {
    if (previewing) return;
    renderStaff(lastVm);
    renderHome(lastVm, sessionName());
    renderPay(lastVm, sessionName());
    renderSheets(lastVm);
    renderShift(lastVm);
    renderPages(lastVm);
  },
  // Settings: a page from the menu, over whatever tab you're on.
  openSettings() {
    pushPage({ key: 'settings', title: 'Settings', body: vm => html`<${SettingsPage} vm=${vm} />` });
  },
  toggleShow: key => store.toggleShow(key),

  // sheets and subpages
  closeSheet,
  openBonus: () => App.tab('pay', { sub: 'bonus' }),
  openCloseTime: () => openCloseTime(lastVm),
  renameCurrent(name) {
    sessions.rename(sessions.currentId(), name);
    render(store.getState());
  },
  // A person: Pay keeps a read-only payout page; Staff and Tips use its sheet.
  personModal: id => (currentTab() === 'pay' ? homePerson(id, 'pay') : currentTab() === 'home' ? homePerson(id) : openPerson(lastVm, id)),

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
  // Add people, in order ([{ name, role }] — Staff's add field). Anyone
  // already on shift is skipped (and said so).
  addPeople(list) {
    const skipped = [];
    store.mutate(st => {
      const on = new Set(st.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));
      list.forEach(({ name, role }) => {
        const n = String(name || '').trim();
        if (!n) return;
        if (on.has(n.toLowerCase())) { skipped.push(n); return; }
        on.add(n.toLowerCase());
        const r = rolesOn() && store.ROLES.includes(role) ? role : 'bartender';
        const blank = st.staff.find(p => !p.name.trim() && p.role === r);
        if (blank) blank.name = n;
        else st.staff.push({ ...store.newStaff(r), name: n });
        rememberName(n, r);
      });
    }, { immediate: true });
    if (skipped.length) toast('Already on shift: ' + skipped.join(', '));
  },
  editStaff: id => openStaffEditor(id),
  // Preview an In / Out (or the default open / close) before it's written —
  // raw = the string it would store, null = end the preview.
  previewStaff: (id, field, raw) => preview(raw == null ? null : s => {
    const p = s.staff.find(x => x.id === id);
    if (p) p[field] = raw;
  }, id),
  previewDefault: (field, raw) => preview(raw == null ? null : s => { s.defaults.global[field] = String(raw).trim(); }),
  // The tips total by a nudge (Pay › Payouts' table, one pool): the wheel
  // previews it, a landed nudge gets Undo.
  previewCash: delta => preview(!delta ? null : s => nudgeCash(s, delta)),
  nudgeCash(delta) {
    if (!delta) return;
    withReview('Tips ' + (delta > 0 ? '+$' : '−$') + Math.abs(delta).toLocaleString('en-US'),
      () => store.mutate(s => nudgeCash(s, delta), { immediate: true }));
  },
  // Pay › Bills tools, each a back-navigable subpage.
  openPayoutPage,
  // Stacks of small bills for managers (Pay › Bills).
  toggleStackTo: id => store.toggleStackTo(id),
  setStackSize: (d, v) => store.setStackSize(d, v),
  // A drag / keypad edit with Undo · Apply in the totals strip (see withReview).
  reviewed: withReview,
  reviewUndo,
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
  selectPool: id => store.mutate(s => { s.ui.selectedPool = id; }, { immediate: true }),
  // A new pool / party opens its page on Shift › Pools.
  addPool() { const id = store.addPool(); App.selectPool(id); App.tab('shift', { sub: 'pools' }); shiftPool(id); },
  poolPreset: (id, kind) => store.updatePool(id, p => applyPreset(p, kind), true),
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
    const cashOf = p => {
      const counted = p.cash.baseMode === 'total' ? 0 : countedValue(p.cash.billCounts), typed = p.cash.baseMode === 'bills' ? 0 : (parseInt(p.cash.netTotal, 10) || 0);
      const base = p.cash.restMode === 'total' && String(p.cash.netTotal).trim() ? Math.max(typed, counted) : counted + typed;
      return base + (p.cash.batches || []).reduce((sum, b) => sum + (b.mode === 'bills' ? countedValue(b.billCounts) : (parseInt(b.amount, 10) || 0)), 0);
    };
    const lost = cashLostBySwitch(st.pools, type, cashOf);
    const ask = `Switch to a ${SHIFT_LABEL[type].toLowerCase()} shift? The $${lost} entered in the pools that go away will be cleared.`;
    if (lost > 0 && !window.confirm(ask)) return;
    store.mutate(s => {
      s.meta.shiftType = type;
      const t = timesFor(type, s.settings.shiftTimes);
      s.defaults.global = t.global;
      s.defaults.byRole = t.byRole;
      s.pools = switchPools(s.pools, type);
      s.ui.selectedPool = s.pools[0].id;
      // Day has servers; a night is the bar's (unless roles are already in use).
      if (type === 'day') s.settings.allRoles = true;
      else if (!s.staff.some(p => p.name.trim() && p.role !== 'bartender')) s.settings.allRoles = false;
    }, { immediate: true });
  },
  // A private party: its own pool over the floor pools, window to set.
  addParty() {
    let id;
    store.mutate(s => {
      const p = partyPool(s.pools);
      id = p.id;
      s.pools.push(p);
      s.ui.selectedPool = id;
    }, { immediate: true });
    App.tab('shift', { sub: 'pools' });
    shiftPool(id);
  },
  poolBill: (id, denom, value) => store.updatePool(id, p => { startBills(p.cash); p.cash.billCounts[denom] = value; }),
  poolTotal(id, value) {
    store.updatePool(id, p => { p.cash.netTotal = value; p.cash.restMode = 'total'; p.cash.baseMode = 'total'; });
  },
  poolBaseMode(id, mode) {
    const pool = store.getState().pools.find(p => p.id === id);
    if (!pool || pool.cash.baseMode === mode) return true;
    const c = pool.cash, counted = countedValue(c.billCounts), raw = String(c.netTotal ?? '').trim();
    const parsed = parseWholeNumber(raw);
    if (!c.baseMode && mode === 'bills' && raw && parsed.valid) {
      const previous = c.restMode === 'total' ? Math.max(parsed.value, counted) : parsed.value + counted;
      if (previous !== counted && !window.confirm('Switching to counted bills changes this starting amount from $' + previous + ' to $' + counted + '. Your entered total stays saved. Continue?')) return false;
    }
    store.updatePool(id, p => {
      if (!p.cash.baseMode && mode === 'total') {
        makeCashTotal(p.cash);
        if (!String(p.cash.netTotal ?? '').trim() && counted > 0) p.cash.netTotal = String(counted);
      }
      p.cash.baseMode = mode;
    }, true);
    return true;
  },
  addCashBatch(id) {
    let batchId = null;
    store.updatePool(id, p => {
      p.cash.batches ||= [];
      batchId = nextId('b');
      p.cash.batches.push({ id: batchId, label: '', mode: 'bills', amount: '', billCounts: store.blankBillStrings() });
    }, true);
    return batchId;
  },
  updateCashBatch(id, batchId, field, value) {
    store.updatePool(id, p => {
      const b = (p.cash.batches || []).find(x => x.id === batchId);
      if (b) b[field] = value;
    }, field === 'mode');
  },
  cashBatchBill(id, batchId, denom, value) {
    store.updatePool(id, p => {
      const b = (p.cash.batches || []).find(x => x.id === batchId);
      if (b) b.billCounts[denom] = value;
    });
  },
  cashBatchStep(id, batchId, denom, delta) {
    store.updatePool(id, p => {
      const b = (p.cash.batches || []).find(x => x.id === batchId);
      if (!b) return;
      const next = Math.max(0, (parseInt(b.billCounts[denom], 10) || 0) + delta);
      b.billCounts[denom] = next ? String(next) : '';
    }, true);
  },
  removeCashBatch(id, batchId) {
    if (!window.confirm('Remove this part and its cash from the pool?')) return;
    store.updatePool(id, p => { p.cash.batches = (p.cash.batches || []).filter(b => b.id !== batchId); }, true);
  },
  poolAdjust: (id, value) => store.updatePool(id, p => { p.cash.adjust = value; }),
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
      startBills(p.cash);
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

  // close time
  selectCloseTime,

  // session
  setDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    store.mutate(s => { s.meta.date = v; }, { immediate: true });
  },
  // Home's summary as plain text on the clipboard (for Notes).
  async copySummary() {
    const st = store.getState();
    const text = lastVm?.shares && lastVm.totalCash > 0 ? summaryText(lastVm, [sessionName() || 'Tips', fmtDay(st.meta.date)].join(' · ')) : '';
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
    if (id === sessions.currentId()) { App.tab('home'); return; }
    flushCurrent();
    const next = sessions.loadSession(id);
    if (!next) {
      alert('That session could not be opened — its saved data is damaged.');
      sessions.remove(id);
      render(store.getState());
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
    render(store.getState());
  },
  deleteSession(id) {
    const e = sessions.list().find(x => x.id === id);
    const what = e?.name || (e?.date ? 'the ' + e.date + ' session' : 'this session');
    if (!confirm(`Delete ${what}? This can’t be undone.`)) return;
    const wasCurrent = id === sessions.currentId();
    sessions.remove(id);
    if (!wasCurrent) { render(store.getState()); return; }
    // Open the next newest session, or start a fresh one.
    for (const other of sessions.list()) {
      const next = sessions.loadSession(other.id);
      if (next) { sessions.setCurrent(other.id); activate(next); return; }
      sessions.remove(other.id);
    }
    sessions.createId();
    activate(freshState());
  },
};

// ── One-time DOM wiring ───────────────────────────────────────────────────────

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
// Size <html>/<body> to the real screen height, lay the tab bar / totals strip / sheets
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

onNav(() => {
  const tab = currentTab();
  if (store.getState().ui.activeTab !== tab) store.getState().ui.activeTab = tab;
  // The sub-tab picks what each page shows.
  renderHome(lastVm, sessionName());
  renderStaff(lastVm);
  renderTips(lastVm);
  renderPayout(lastVm);
  renderPay(lastVm, sessionName());
  renderShift(lastVm);
  renderChrome(lastVm, sessionName());
  requestAnimationFrame(refreshSticky);
});
showTab(state.ui.activeTab);
render(state);

// Gestures (ui/nav.js): a sideways swipe moves between a page's sub-tabs
// (right off the first one: the menu); a swipe right on a subpage goes back.
// Tabs change only from the tab bar.
const calm = () => !menuOpen() && !document.querySelector('.sheet-backdrop.open')
  && !document.documentElement.classList.contains('wheel-open')
  && !document.documentElement.classList.contains('keypad-open');
// A swipe right off a tab's first sub-tab pulls the menu in (menuEdge).
initNav({ can: calm, subsOn: () => !(currentTab() === 'pay' && lastVm.blocked), edge: menuEdge });
initMenu();

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
