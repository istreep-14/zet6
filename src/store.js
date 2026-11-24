// Single state store — plain data, mutated only through exported actions.
// Subscribers are notified on a 120ms debounce (immediate for structural
// changes) and run the full pipeline: compute → render → persist.

import { nextId } from './ids.js';

export const ROLES = ['bartender', 'server', 'support'];

export function blankBillStrings() {
  return { 100: '', 50: '', 20: '', 10: '', 5: '', 1: '' };
}

export function newStaff(role = 'bartender') {
  return {
    id: nextId('s'),
    name: '',
    role,
    in: '',
    out: '',
    brk: '',                       // break length in hours ('0.5'), '' = none
    brkAt: '',                     // when the break began (a time reading), '' = not placed
    closerOverride: false,
  };
}

export function newPool(label = 'Pool') {
  return {
    id: nextId('p'),
    label,
    kind: '',                      // 'night' | 'day' | 'mid' | 'party' | '' (shifts.js)
    window: { start: '', end: '' },
    roles: { bartender: true, server: true },
    includeSupport: false,
    // Tip-out config: pct overrides defaults.supportPct, rate overrides the
    // pct-derived $/hr, hours[staffId] overrides a support person's overlap.
    support: { pct: '', rate: '', hours: {} },
    cash: {
      entryMode: 'mixed',          // counted bills + uncounted rest (netTotal)
      billCounts: blankBillStrings(),
      netTotal: '',
      restMode: 'rest',            // netTotal is 'rest' (uncounted) or 'total' (incl. counted)
      adjust: '',                  // signed register over / short, e.g. '-50'
    },
  };
}

export function initialState() {
  const pool = newPool('Night');
  pool.kind = 'night';
  const state = {
    meta: { date: '', shiftType: 'night' },
    staff: [newStaff(), newStaff(), newStaff()],
    defaults: {
      supportPct: '',          // default support tip-out % per pool ('' = 10)
      global: { in: '5', out: '2' },
      byRole: {
        bartender: { in: '', out: '' },
        server: { in: '', out: '' },
        support: { in: '', out: '' },
      },
    },
    pools: [pool],
    overrides: { bonuses: {}, stackTo: [] },
    // Simple mode by default: one staff list, one pool. allRoles exposes the
    // server/support split; multiPool exposes add-pool / windows / labels.
    // shiftTimes: the default times last used per shift type ({ night, day }).
    // amFrom: bare In readings from this hour to 11:59 read as morning (default 9).
    settings: { allRoles: false, multiPool: false, clock24: false, size: 'm', theme: 'system', shiftTimes: {}, amFrom: 9, show: { timelines: true, bestBills: true, working: true } },
    ui: { activeTab: 'summary', selectedPool: pool.id },
  };
  return state;
}

let state = initialState();
const listeners = [];
let timer = null;

export function getState() {
  return state;
}

export function replaceState(next) {
  state = next;
}

export function subscribe(fn) {
  listeners.push(fn);
}

function notify() {
  timer = null;
  listeners.forEach(fn => fn(state));
}

function schedule(immediate) {
  if (timer) clearTimeout(timer);
  if (immediate) {
    notify();
  } else {
    timer = setTimeout(notify, 120);
  }
}

// All mutations funnel through here. Structural changes (rows/pools/tabs
// appearing or disappearing) render immediately; keystrokes debounce.
export function mutate(fn, { immediate = false } = {}) {
  fn(state);
  schedule(immediate);
}

// ── Staff actions ─────────────────────────────────────────────────────────────

export function addStaff(role) {
  const person = newStaff(role);
  mutate(s => { s.staff.push(person); }, { immediate: true });
  return person.id;
}

// The Staff table always ends each section with one blank row to type a new
// name into. Idempotent; called before every render (main.js).
export function ensureBlankRows(s) {
  const roles = s.settings?.allRoles ? ROLES : ['bartender'];
  roles.forEach(r => {
    if (!s.staff.some(p => p.role === r && !p.name.trim())) s.staff.push(newStaff(r));
  });
}

// Stacks for managers (Payout): pick who takes bundled small bills, and how
// big a stack of each bill is (an app preference, settings.stacks).
export function toggleStackTo(id) {
  mutate(s => {
    const cur = s.overrides.stackTo || [];
    s.overrides.stackTo = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  }, { immediate: true });
}
export function setStackSize(d, dollars) {
  mutate(s => { s.settings.stacks = { ...(s.settings.stacks || {}), [d]: String(dollars ?? '').replace(/[^0-9]/g, '') }; });
}

export function removeStaff(id) {
  mutate(s => {
    s.staff = s.staff.filter(p => p.id !== id);
    delete s.overrides.bonuses[id];
    if (s.overrides.stackTo) s.overrides.stackTo = s.overrides.stackTo.filter(x => x !== id);
    s.pools.forEach(pool => { if (pool.support) delete pool.support.hours[id]; });
  }, { immediate: true });
}

export function toggleCloserOverride(id) {
  mutate(s => {
    const p = s.staff.find(x => x.id === id);
    if (p) p.closerOverride = !p.closerOverride;
  }, { immediate: true });
}

// ── Defaults actions ──────────────────────────────────────────────────────────

export function setGlobalDefault(field, value, immediate = false) {
  mutate(s => { s.defaults.global[field] = value; rememberTimes(s); }, { immediate });
}

export function setRoleDefault(role, field, value, immediate = false) {
  mutate(s => { s.defaults.byRole[role][field] = value; rememberTimes(s); }, { immediate });
}

export function setSupportDefault(value) {
  mutate(s => { s.defaults.supportPct = value; });
}

// ── Pool actions ──────────────────────────────────────────────────────────────

export function addPool() {
  const pool = newPool();
  mutate(s => {
    pool.label = 'Pool ' + (s.pools.length + 1);
    s.pools.push(pool);
    s.ui.selectedPool = pool.id;
  }, { immediate: true });
  return pool.id;
}

export function removePool(id) {
  mutate(s => {
    s.pools = s.pools.filter(p => p.id !== id);
    if (s.ui.selectedPool === id && s.pools.length) s.ui.selectedPool = s.pools[0].id;
  }, { immediate: true });
}

export function updatePool(id, fn, immediate = false) {
  mutate(s => {
    const pool = s.pools.find(p => p.id === id);
    if (pool) fn(pool);
  }, { immediate });
}

export function togglePoolRole(id, role) {
  mutate(s => {
    const pool = s.pools.find(p => p.id === id);
    if (!pool) return;
    if (role === 'support') pool.includeSupport = !pool.includeSupport;
    else pool.roles[role] = !pool.roles[role];
  }, { immediate: true });
}

// ── Overrides ─────────────────────────────────────────────────────────────────

export function setBonuses(map) {
  mutate(s => { s.overrides.bonuses = { ...map }; }, { immediate: true });
}

export function clearBonuses() {
  mutate(s => { s.overrides.bonuses = {}; }, { immediate: true });
}

// ── Settings ──────────────────────────────────────────────────────────────────

// Fill in settings for snapshots that predate them. Sessions already using
// roles or several pools keep those features visible.
export function normalizeSettings(state) {
  const s = state.settings && typeof state.settings === 'object' ? state.settings : {};
  const usesRoles = state.staff.some(p => p.role !== 'bartender') || state.pools.some(p => p.includeSupport)
    || state.meta?.shiftType === 'day';
  state.settings = {
    allRoles: typeof s.allRoles === 'boolean' ? s.allRoles : usesRoles,
    multiPool: typeof s.multiPool === 'boolean' ? s.multiPool : state.pools.length > 1,
    clock24: typeof s.clock24 === 'boolean' ? s.clock24 : false,
    size: SIZES.includes(s.size) ? s.size : 'm',
    theme: THEMES.includes(s.theme) ? s.theme : 'system',
    shiftTimes: validShiftTimes(s.shiftTimes),
    amFrom: Number.isInteger(s.amFrom) && s.amFrom >= 1 && s.amFrom <= 11 ? s.amFrom : 9,
    show: validShow(s.show),
    ...(s.stacks && typeof s.stacks === 'object' ? { stacks: s.stacks } : {}),
  };
  if (!state.meta.shiftType || !['night', 'day'].includes(state.meta.shiftType)) {
    state.meta.shiftType = state.pools.some(p => p.kind === 'day' || p.kind === 'mid') ? 'day' : 'night';
  }
  return state;
}

// What each page shows (its drawer's Show switches): Staff's timelines,
// Tips' best bills card, Payout's "How the split works".
export const SHOW_DEFAULTS = { timelines: true, bestBills: true, working: true };
function validShow(v) {
  const out = { ...SHOW_DEFAULTS };
  if (v && typeof v === 'object') Object.keys(out).forEach(k => { if (typeof v[k] === 'boolean') out[k] = v[k]; });
  return out;
}
export function toggleShow(key) {
  mutate(s => { s.settings.show = { ...SHOW_DEFAULTS, ...(s.settings.show || {}), [key]: !(s.settings.show?.[key] ?? SHOW_DEFAULTS[key]) }; }, { immediate: true });
}

// { night: { global, byRole }, day: … } with string times only.
function validShiftTimes(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  const str = x => (typeof x === 'string' ? x : '');
  ['night', 'day'].forEach(t => {
    const e = v[t];
    if (!e || typeof e !== 'object' || !e.global) return;
    const byRole = {};
    ROLES.forEach(r => { byRole[r] = { in: str(e.byRole?.[r]?.in), out: str(e.byRole?.[r]?.out) }; });
    out[t] = { global: { in: str(e.global.in), out: str(e.global.out) }, byRole };
  });
  return out;
}

// Remember this session's default times for its shift type (app-wide), so
// the next session of that type starts from them.
function rememberTimes(s) {
  const t = s.meta.shiftType || 'night';
  s.settings.shiftTimes = { ...(s.settings.shiftTimes || {}), [t]: JSON.parse(JSON.stringify({ global: s.defaults.global, byRole: s.defaults.byRole })) };
}

// Display size: s / m / l / xl → root font size 13.5 / 15 / 17 / 18.5px (css/app.css).
export const SIZES = ['s', 'm', 'l', 'xl'];
export function setSize(size) {
  if (!SIZES.includes(size)) return;
  mutate(s => { s.settings.size = size; }, { immediate: true });
}

// Theme: follow the system, or force light / dark (css/app.css).
export const THEMES = ['system', 'light', 'dark'];
export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  mutate(s => { s.settings.theme = theme; }, { immediate: true });
}

export function setSetting(key, value) {
  mutate(s => {
    s.settings[key] = !!value;
  }, { immediate: true });
}

// ── UI / meta ─────────────────────────────────────────────────────────────────

export function setDate(date) {
  mutate(s => { s.meta.date = date; });
}

export function setActiveTab(tab) {
  mutate(s => { s.ui.activeTab = tab; }, { immediate: true });
}
