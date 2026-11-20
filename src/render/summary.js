// Summary tab (Preact) — the shift at a glance, for reading (setup lives on
// Staff / Tips). The live HUD floats over it (rate · pool · chump · small
// bills needed); tapping it goes on to Payout.
//   register banner (when the Tips tab has an over / short)
//   → payouts list: one row per person in Staff order — numbered tile (faint
//     red ring = closer) · name over "5:00 pm – 2:00 am" (still tap / drag to
//     edit) · Hrs · Tips, or Was · Now · ± when the register was adjusted;
//     a Total row with the default open / close, hours and paid out
//   → pools (several pools; tap → that pool's table in a sheet)
//   → close time / bonus tools.
// Support staff are paid a tip-out off the top, so their hours never count in
// hours totals and their pay shows in the support colour.
// Tap a person → Person sheet.

import { fmtHrs, fmtMoney } from '../util.js';
import { html, render, useRef, useLayoutEffect } from '../ui/preact.js';
import { cx, Icon, Alert, Banner, List, Item, Money, Clock, Blocked, Card, Section, ROLE_TINT, TABLE, TABLE_ROW, TABLE_HEAD, THEAD, Sentinel, zebra, ROLE_DOT, ROLE_PLURAL } from '../ui/pkit.js';
import { StaffTime, DefaultTime } from './staff.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);


// ── Shared table pieces ──────────────────────────────────────────────────────
// Every table is one grid (TABLE) with a subgrid per row (TABLE_ROW), so the
// columns line up; useFitColumns sets the widths.
const GRID = TABLE_ROW;
const HOURS = 'text-center text-[1.125rem] font-medium leading-none text-ink/85';
// Pay cells carry pl-3: a fixed gap after Hours.
const TIPS = 'text-[1.1875rem] font-semibold leading-none tracking-tight';
const PILL = 'h-9 w-full rounded-md px-2 text-center text-[0.9375rem] tracking-[-0.035em] tabular-nums transition';
const QUIET = 'font-medium text-ink-2';
// Sits on the In / Out boundary: absolutely placed in the Out column's area,
// pulled back half a gap and centred on that line. The time cells' own
// px-2 keeps the text clear of it; nudged up to the digits' middle.
const DASH = html`<span class="pointer-events-none absolute inset-y-0 left-[-0.125rem] col-start-3 row-start-1 flex -translate-x-1/2 items-center pb-[0.2em] text-[0.9375rem] text-ink-3" aria-hidden="true">–</span>`;
// One colour per pool (max 3 in practice) for its dot.
const POOL_HUES = ['var(--accent)', 'var(--pool-2)', 'var(--pool-3)', 'var(--pool-4)'];
const PoolDot = ({ i }) => html`<span class="inline-block size-2 shrink-0 rounded-full" style=${{ background: POOL_HUES[i % POOL_HUES.length] }}></span>`;
// $ amount with small cents: $95.38 (cents dropped when .00).
function Cents({ value, class: cls = '' }) {
  const c = Math.round((Number(value) || 0) * 100);
  const whole = Math.floor(c / 100), frac = c % 100;
  return html`<span class=${cx('whitespace-nowrap tabular-nums', cls)}><small class="mr-px align-[.12em] text-[.68em] font-semibold">$</small>${whole.toLocaleString('en-US')}${frac > 0 && html`<small class="text-[.68em] font-semibold">.${String(frac).padStart(2, '0')}</small>`}</span>`;
}
const rate2 = r => '$' + (Math.round(r * 100) / 100).toFixed(2);

// Column widths = each column's widest cell + a share of the spare width by
// weight, so a column is only wider than another when its data is. If the
// cells don't fit, the name (column 1) gives way and truncates. Re-fits on
// every render and on resize (also catches the tab becoming visible).
const NAME_COL = 0, NAME_MIN = 40;
// `head`: a second grid (a header kept outside a sideways scroller) that is
// measured too and gets the same columns.
function useFitColumns(weights, { scroll = false, head = null } = {}) {
  const ref = useRef(null);
  const wRef = useRef(weights);
  wRef.current = weights;
  const fit = () => {
    const el = ref.current, W = wRef.current, hd = head?.current;
    if (!el || !el.clientWidth) return;                  // hidden tab
    const mc = W.map(() => 'max-content').join(' ');
    el.style.gridTemplateColumns = mc;
    if (hd) hd.style.gridTemplateColumns = mc;
    const w = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat);
    if (w.length !== W.length || w.some(isNaN)) return;
    if (hd) getComputedStyle(hd).gridTemplateColumns.split(' ').map(parseFloat).forEach((x, i) => { if (x > w[i]) w[i] = x; });
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const spare = el.clientWidth - w.reduce((a, b) => a + b, 0) - gap * (w.length - 1);
    if (spare >= 0) {
      const tot = W.reduce((a, b) => a + b, 0);
      W.forEach((k, i) => { w[i] += spare * k / tot; });
    } else if (!scroll) {
      w[NAME_COL] = Math.max(NAME_MIN, w[NAME_COL] + spare);
    }                                    // scroll: keep natural widths, the wrapper scrolls
    const tpl = w.map(x => x.toFixed(2) + 'px').join(' ');
    el.style.gridTemplateColumns = tpl;
    if (hd) hd.style.gridTemplateColumns = tpl;
  };
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = 0;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== last) { last = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

// Roles on shift, and whether avatars take the role colour (several roles).
function rolesOf(vm, people) {
  const roles = vm.state.settings.allRoles ? ['bartender', 'server', 'support'].filter(r => people.some(p => p.role === r)) : [];
  return { roles, tint: roles.length > 1 };
}

function RoleKey({ roles }) {
  return html`<div class="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line px-4 py-2 text-[0.75rem] text-ink-3">
    ${roles.map(r => html`<span key=${r} class="inline-flex items-center gap-1.5"><span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_PLURAL[r]}</span>`)}
    ${roles.includes('support') && html`<span class="text-ink-3">· support is a tip-out, not counted in hours</span>`}
  </div>`;
}


// Small role dot before a name — only when several roles share the table
// (the role key at the foot explains the colours). No avatars.
const RoleDot = ({ role }) => html`<span class=${cx('size-2 shrink-0 rounded-full', ROLE_DOT[role])} aria-label=${role}></span>`;

function Lead({ p, tint, sub }) {
  return html`<span class="flex min-w-0 items-center gap-2">
    ${tint && html`<${RoleDot} role=${p.role} />`}
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-[1.0625rem] font-medium leading-tight">${p.name}</span>
      ${sub}
    </span>
  </span>`;
}

const rowCls = 'min-h-[3.25rem] py-1.5 transition active:bg-surface-2';
const TOTAL_ROW = 'h-13 border-t border-line bg-surface-2';

// Support: paid a tip-out off the top of each pool, so their hours aren't
// part of the split — left out of every hours total — and their pay shows in
// the support colour.
const isSup = p => p.role === 'support';
const SUP_TEXT = 'text-sup';
// Which roles share a pool (state.pools: roles.{bartender,server}, includeSupport).
function poolRoles(vm, poolId) {
  const pl = vm.state.pools.find(x => x.id === poolId);
  if (!pl) return { bartender: true, server: true, support: false };
  return { bartender: !!pl.roles?.bartender, server: !!pl.roles?.server, support: !!pl.includeSupport };
}

const dec2 = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Payouts list (the Summary page) ─────────────────────────────────────────
// One row per person in Staff-tab order (by role when roles are on), built
// like a List Item: a numbered tile (1…n; role-tinted when several roles
// share the shift; a faint red ring marks a closer) · name over
// "5:00 pm – 2:00 am" · Hrs · Tips, the last columns fixed so they line up.
// The times are the Staff tab's DragTime: tap → quick time sheet, drag
// sideways → 15-min steps. A Total row closes it.
// With a register over / short (Tips tab) the money columns become
// Was · Now · ± — the split before and after the adjustment.
const PAY_GRID = 'grid grid-cols-[2rem_minmax(0,1fr)_2.75rem_4.5rem] items-center gap-x-3';
const PAY_GRID_ADJ = 'grid grid-cols-[2rem_minmax(0,1fr)_3.25rem_3.75rem_2.75rem] items-center gap-x-2.5';
const TILE = 'grid size-8 shrink-0 place-items-center rounded-lg';
const ROW = 'li min-h-11 w-full px-4 py-1.5';
// Tight under the name, but the tap / drag target reaches up over the name's
// lower half (padding out, negative margin back) so it's easy to hit.
const TIME_INLINE = 'relative z-[1] rounded -mx-1 -my-2 px-1 py-2 tabular-nums transition';
const HRS_CELL = 't-body text-center font-medium tabular-nums';
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + (v ? Math.abs(v).toLocaleString('en-US') : '—');

function Times({ a, b }) {
  return html`<span class="t-small line-clamp-2 text-ink-3">${a}<span class="mx-1">–</span>${b}</span>`;
}

// Was · Now · ± cells (register adjusted), or Hrs · Tips.
function MoneyCells({ adj, before, now, hours, sup, bold }) {
  if (adj) {
    const d = now - before;
    return html`
      <span class="t-small text-right tabular-nums text-ink-3">${fmtMoney(before)}</span>
      <${Money} value=${now} class=${cx('t-body text-right font-semibold', sup && SUP_TEXT)} />
      <span class=${cx('t-small text-right font-medium tabular-nums', d < 0 ? 'text-bad' : d > 0 ? 'text-good' : 'text-ink-3')}>${signed(d)}</span>`;
  }
  return html`
    <span class=${cx(HRS_CELL, bold ? 'font-semibold' : sup ? 'text-ink-3' : 'text-ink/80')}>${fmtHrs(hours)}</span>
    <${Money} value=${now} class=${cx('t-body text-right font-semibold', sup && SUP_TEXT, !(now > 0) && 'text-ink-3')} />`;
}

function PayRow({ vm, p, n, tint, before }) {
  const adj = !!vm.sharesBefore;
  return html`<div role="button" tabindex="0" style=${{ '--inset': '3.5rem' }}
    class=${cx(ROW, adj ? PAY_GRID_ADJ : PAY_GRID, 'cursor-pointer text-left transition active:bg-surface-2')}
    onClick=${() => App.personModal(p.id)} onKeyDown=${e => { if (e.key === 'Enter') App.personModal(p.id); }}>
    <span class=${cx(TILE, 't-small font-semibold tabular-nums', tint ? ROLE_TINT[p.role] : 'bg-surface-2 text-ink-2', p.closer && 'ring-1 ring-inset ring-bad/45')}
      aria-label=${'#' + n + (p.closer ? ', closer' : '')}>${n}</span>
    <span class="flex min-w-0 flex-col">
      <span class="t-body flex min-w-0 items-center gap-1.5 font-medium"><span class="truncate">${p.name}</span></span>
      <${Times}
        a=${html`<${StaffTime} vm=${vm} id=${p.id} field="in" cls=${TIME_INLINE} tone="text-ink-3" full />`}
        b=${html`<${StaffTime} vm=${vm} id=${p.id} field="out" cls=${TIME_INLINE} tone="text-ink-3" full />`} />
    </span>
    <${MoneyCells} adj=${adj} before=${before} now=${p.final} hours=${p.shiftHours ?? p.hours} sup=${isSup(p)} />
  </div>`;
}

function TotalRow({ vm, hours, paidOut, before }) {
  const adj = !!vm.sharesBefore;
  return html`<div style=${{ '--inset': '3.5rem' }} class=${cx(ROW, adj ? PAY_GRID_ADJ : PAY_GRID, 'bg-surface-2/60')}>
    <span class=${cx(TILE, 'bg-surface-2 text-ink-2')}><${Icon} name="users" class="size-[1.125rem]" /></span>
    <span class="flex min-w-0 flex-col">
      <span class="t-body flex min-w-0 items-center gap-1.5 font-semibold">Total</span>
      <${Times}
        a=${html`<${DefaultTime} vm=${vm} field="in" cls=${TIME_INLINE} tone="text-ink-2" full />`}
        b=${html`<${DefaultTime} vm=${vm} field="out" cls=${TIME_INLINE} tone="text-ink-2" full />`} />
    </span>
    <${MoneyCells} adj=${adj} before=${before} now=${paidOut} hours=${hours} bold />
  </div>`;
}

// Staff-tab order: state order, grouped by role when roles are on.
function staffOrder(vm, people) {
  if (!vm.state.settings.allRoles) return people;
  const rank = { bartender: 0, server: 1, support: 2 };
  return people.map((p, i) => [p, i]).sort((x, y) => (rank[x[0].role] - rank[y[0].role]) || (x[1] - y[1])).map(x => x[0]);
}

function PayoutList({ vm, name }) {
  const s = vm.shares;
  const adj = !!vm.sharesBefore;
  const ordered = staffOrder(vm, s.perPerson);
  const was = id => vm.sharesBefore?.perPerson.find(x => x.id === id)?.final ?? 0;
  const { roles, tint } = rolesOf(vm, ordered);
  const hours = ordered.filter(p => !isSup(p)).reduce((t, p) => t + (p.shiftHours ?? p.hours), 0);
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  const paidBefore = adj ? vm.sharesBefore.perPerson.reduce((t, p) => t + p.final, 0) : 0;
  const footer = tint && html`<span class="flex flex-wrap items-center gap-x-3 gap-y-1">
    ${roles.map(r => html`<span key=${r} class="inline-flex items-center gap-1.5"><span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_PLURAL[r]}</span>`)}
    ${roles.includes('support') && html`<span>· support is a tip-out, not counted in hours</span>`}</span>`;
  const cap = 't-cap text-ink-3';
  return html`<section class="flex flex-col gap-2">
    <div class=${cx(adj ? PAY_GRID_ADJ : PAY_GRID, 'min-h-5 items-end px-4')}>
      <span class=${cx(cap, 'text-center')}>#</span>
      <span class=${cx(cap, 'truncate')}>${name || 'Payouts'}</span>
      ${adj
        ? html`<span class=${cx(cap, 'text-right')}>Was</span><span class=${cx(cap, 'text-right')}>Now</span><span class=${cx(cap, 'text-right')}>±</span>`
        : html`<span class=${cx(cap, 'text-center')}>Hrs</span><span class=${cx(cap, 'text-right')}>Tips</span>`}
    </div>
    <${List}>
      ${ordered.map((p, i) => html`<${PayRow} key=${p.id} vm=${vm} p=${p} n=${i + 1} tint=${tint} before=${was(p.id)} />`)}
      <${TotalRow} vm=${vm} hours=${hours} paidOut=${paidOut} before=${paidBefore} />
    <//>
    ${footer && html`<div class="t-small px-4 text-ink-3">${footer}</div>`}
  </section>`;
}

// Register over / short (Tips tab): what changed, tap → Tips.
function AdjustBanner({ vm }) {
  if (!vm.sharesBefore) return null;
  const a = vm.adjust;
  return html`<${Banner} tone=${a < 0 ? 'warn' : 'ok'} icon="swap" onClick=${() => App.tab('tips')}
    title=${'Register ' + (a < 0 ? 'short ' : 'over ') + fmtMoney(Math.abs(a))}
    sub=${'Tips re-split on ' + fmtMoney(vm.totalCash) + ' (was ' + fmtMoney(vm.totalBefore) + ')'} />`;
}

// Several pools: each pool as a row → its own table in a sheet.
function PoolsList({ vm }) {
  const pools = vm.shares.perPool;
  if (pools.length < 2) return null;
  return html`<${Section} title="Pools"><${List}>${pools.map((pl, i) => html`<${Item} key=${pl.id}
    lead=${html`<span class="grid size-8 shrink-0 place-items-center"><${PoolDot} i=${i} /></span>`}
    title=${pl.label} sub=${html`<${Clock} abs=${pl.startAbs} /> – <${Clock} abs=${pl.endAbs} /> · ${fmtHrs(pl.tippedHours)}h · ${rate2(pl.rate)}/h`}
    value=${fmtMoney(pl.total)} onClick=${() => App.openPoolSummary(pl.id)} />`)}<//><//>`;
}

// ── Several pools, one pool's tab ───────────────────────────────────────────
// Who's in that pool: name · In · Out (draggable) · Hrs in the pool · pay from
// it (exact, before rounding). Header = pool + rate (+ support cut, roles that
// share it; those lines hide while stuck); Total row = the pool's window,
// hours (support excluded) and cash.
function PoolTable({ vm, pool, index }) {
  const s = vm.shares;
  const people = staffOrder(vm, s.perPerson.filter(p => p.perPool[pool.id]?.hours > 0));
  const { roles, tint } = rolesOf(vm, people);
  const r = poolRoles(vm, pool.id);
  const rolesOn = vm.state.settings.allRoles;
  const table = useFitColumns([1, 0.55, 0.55, 0.35, 1.2]);
  const head = TABLE_HEAD;
  const extra = 'whitespace-nowrap text-[0.75rem] font-medium leading-tight tabular-nums group-data-[stuck]:hidden';
  return html`<${Card} flush><div ref=${table} class=${TABLE}>
    <${Sentinel} cls="col-span-full" />
    <div class=${cx(GRID, THEAD, 'min-h-11 py-1.5 data-[stuck]:min-h-7 data-[stuck]:py-1')}>
      <span class="flex w-0 min-w-full flex-col gap-0.5">
        <span class="t-cap flex items-center gap-1.5 text-ink-3"><${PoolDot} i=${index} /><span class="truncate">${pool.label}</span></span>
        <span class=${cx(extra, 'text-ink-3')}>${rate2(pool.rate)}/h${pool.support && pool.support.cut > 0 ? '' : ''}</span>
        ${pool.support && pool.support.cut > 0 && html`<span class=${cx(extra, SUP_TEXT)}>−${dec2(pool.support.cut)} support first</span>`}
        ${rolesOn && html`<span class="flex items-center gap-1 group-data-[stuck]:hidden">${['bartender', 'server', 'support'].filter(k => r[k]).map(k => html`<span key=${k} class=${cx('size-1.5 rounded-full', ROLE_DOT[k])}></span>`)}</span>`}
      </span>
      <span class=${head}>In</span><span class=${head}>Out</span><span class=${head}>Hrs</span>
      <span class=${cx(head, 'pl-3')}>Tips</span>
    </div>
    ${people.length ? people.map((p, i) => {
      const x = p.perPool[pool.id];
      return html`<div key=${p.id} role="button" class=${cx(GRID, rowCls, zebra(i))} onClick=${() => App.personModal(p.id)}>
        <${Lead} p=${p} tint=${tint} />
        <${StaffTime} vm=${vm} id=${p.id} field="in" cls=${PILL} tone=${QUIET} />
        <${StaffTime} vm=${vm} id=${p.id} field="out" cls=${PILL} tone=${QUIET} />
        ${DASH}
        <span class=${cx(HOURS, isSup(p) && 'text-ink-3')}>${fmtHrs(x.hours)}</span>
        <span class="pl-3 text-center"><${Cents} value=${x.raw} class=${cx(TIPS, isSup(p) && SUP_TEXT)} /></span>
      </div>`;
    }) : html`<div class=${cx(GRID, 'py-4')}><span class="col-span-full w-0 min-w-full text-center text-ink-3">No one is in this pool yet.</span></div>`}
    <div class=${cx(GRID, TOTAL_ROW)}>
      <span class="t-body font-semibold">Total</span>
      <span class="text-center text-[0.9375rem] font-semibold"><${Clock} abs=${pool.startAbs} /></span>
      <span class="text-center text-[0.9375rem] font-semibold"><${Clock} abs=${pool.endAbs} /></span>
      ${DASH}
      <span class=${cx(HOURS, 'font-semibold text-ink')}>${fmtHrs(pool.tippedHours)}</span>
      <span class="pl-3 text-center"><${Money} value=${pool.total} class=${TIPS} /></span>
    </div>
  </div>${tint && html`<${RoleKey} roles=${roles} />`}<//>`;
}

let sheetPool = null;
let lastVm = null;
onSheetClose('sheet-poolsum', () => { sheetPool = null; });
export function openPoolSummary(id) {
  sheetPool = id;
  openSheet('sheet-poolsum');
  if (lastVm) renderPoolSheet(lastVm);
}
function renderPoolSheet(vm) {
  if (!sheetPool || !isOpen('sheet-poolsum')) return;
  const pools = vm.shares.perPool;
  const i = pools.findIndex(p => p.id === sheetPool);
  if (i < 0 || pools.length < 2) { closeSheet('sheet-poolsum'); return; }
  setSheetTitle('sheet-poolsum', pools[i].label);
  render(html`<${PoolTable} key=${pools[i].id} vm=${vm} pool=${pools[i]} index=${i} />`, sheetBody('sheet-poolsum'));
}

function Tools() {
  return html`<${List}>
    <${Item} icon="clock" title="Close-time what-if" sub="Payouts at other close times" onClick=${() => App.openCloseTime()} />
    <${Item} icon="gift" title="Closer bonus & chump" sub="Who gets the dollars left after rounding" onClick=${() => App.openBonus()} />
    <${Item} icon="copy" title="Copy as text" sub="Names, times, hours and tips — paste into Notes" chevron=${false} onClick=${() => App.copySummary()} />
  <//>`;
}

function Summary({ vm, name }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  return html`<div class="flex flex-col gap-6">
    ${vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`)}
    <${AdjustBanner} vm=${vm} />
    <${PayoutList} vm=${vm} name=${name} />
    <${PoolsList} vm=${vm} />
    <${Tools} />
  </div>`;
}

export function renderSummary(vm, sessionName = '') {
  lastVm = vm;
  const root = $('summary-root');
  if (root) render(html`<${Summary} vm=${vm} name=${sessionName} />`, root);
  renderPoolSheet(vm);
}
