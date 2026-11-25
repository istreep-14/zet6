// Summary page (Preact) — home: the shift at a glance (setup lives on Staff /
// Tips; until it's done this shows the close-out checklist).
//   pool warnings, the register banner (an over / short on Tips)
//   → the figures: Tips · Hours · Rate · $10 · $5 · $1
//   → the payouts as a list group (PayItems) — one line per person: name ·
//     [In|Out] pill ("4 | close", no a / p; keypad cells) · hours · take-home
//     · chevron (→ their payout drawer), with their shift as a slim line in
//     their colour just above the row's hairline; the chump; Total
//   → pools (several pools; tap → that pool's table in a sheet).
// The other views (Table — the old Shift grid, Pools, Bills, Math) are picked from the page drawer
// (SummaryOptions), with a "Back to the list" chip while one is up.
// Support staff are paid a tip-out off the top, so their hours never count in
// hours totals and their pay shows in the support colour.
// Tap a person → Person sheet.

import { fmtHrs, fmtMoney, hasMinutes, hrsDecimals, hrsText } from '../util.js';
import { TIME_TEXT, ARROW_BEFORE, DragAmount } from '../ui/dragtime.js';
import { html, render, useRef, useEffect, useLayoutEffect } from '../ui/preact.js';
import { payDelta, sumDelta, figDelta, timeMoved, defaultMoved } from '../ui/changes.js';
import { cx, Icon, Alert, Banner, List, Item, Money, Clock, Blocked, Card, Section, Stats, Delta, Flash, Table, ROLE_TINT, TABLE, TABLE_ROW, TABLE_HEAD, THEAD, Sentinel, zebra, ROLE_DOT, ROLE_PLURAL, TOTAL_FILL, hueTile, hueIndex, hueVar } from '../ui/pkit.js';
import { StaffTime, DefaultTime, nightSpan, fmtBreak } from './staff.js';
import { smallBillsNeeded } from './tabs.js';
import { EnvelopeTable } from './payout.js';
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
const r2 = v => (Number(v) || 0).toFixed(2);
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
// Tips' width (--pw) = the widest amount in the list (PayoutList).
// List view (the glance): name over "5p – 2a" · Hrs · Tips. Hrs is set small
// (t-small medium ink-2) here and in the Shift view.
const PAY_GRID_LIST = 'grid grid-cols-[2rem_minmax(0,1fr)_2.5rem_var(--pw,4.5rem)] items-center gap-x-3';
// Shift view (no register adjustment): one flat grid — Name · In · Out ·
// Hrs · Tips — sized from the data by fitShift (measured in PayoutList):
//   In / Out    two equal columns: the widest time (or caption) + padding
//               (--tmin), growing a little with spare width (0.4fr)
//   Hrs         2.5rem, the same as the List view's Hrs column
//   Tips        the widest amount (or caption) + padding (--vmin), growing
//               a bit more (0.5fr)
//   Name        at least the longest name (--nmin), and the rest (1fr)
// When the longest name doesn't fit, the number columns give way first —
// their padding shrinks to nothing, then the gaps (--g) tighten — and only
// then does the name truncate with "…" (the tile's track widens as the gap
// tightens, so the name never moves). The times' LINE becomes `contents`
// so its cells join this grid.
const PAY_GRID_SHIFT = 'grid grid-cols-[calc(2.75rem-var(--g,0.75rem))_minmax(var(--nmin,0px),1fr)_repeat(2,minmax(var(--tmin,2.5rem),0.4fr))_2.5rem_minmax(var(--vmin,2.75rem),0.5fr)] items-center gap-x-[var(--g,0.75rem)]';
const PAY_GRID_ADJ = 'grid grid-cols-[2rem_minmax(0,1fr)_3.25rem_3.75rem_2.75rem] items-center gap-x-2.5';
const gridFor = (adj, view) => (adj ? PAY_GRID_ADJ : view === 'shift' ? PAY_GRID_SHIFT : PAY_GRID_LIST);
const hasHrs = view => view === 'shift' || view === 'list';
// The times' wrapper: its own grid inside the name cell when the register
// was adjusted (Was · Now · ± take the right), else dissolved into the row.
const lineCls = adj => (adj ? cx(LINE, 'self-stretch') : 'contents');
const TILE = 'grid size-8 shrink-0 place-items-center rounded-lg';
const ROW = 'li min-h-11 w-full px-4 py-1.5';
const HRS_CELL = 't-body text-center font-medium tabular-nums';
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + (v ? Math.abs(v).toLocaleString('en-US') : '—');

// ── Shift view: In – Out columns ─────────────────────────────────────────────
// One line per person: Name · In · Out · Hrs · Tips (see PAY_GRID_SHIFT).
// Each time is the Staff tab's DragTime as a box filling its cell — the
// column's width and the row's full height (`TimeCol` stretches over the
// row padding) — tap → quick time sheet, hold → the wheel picker (the
// box fills accent while dragged, like the Staff table). With a register
// adjustment the times sit in `LINE`, a grid inside the name cell, same
// column sizing.
const LINE = 'grid min-w-0 grid-cols-[minmax(0,1fr)_repeat(2,minmax(var(--tmin,2.5rem),0.4fr))] items-center gap-x-3';
// Inside the box: the number with "am" / "pm" hanging under it (TIME_TEXT,
// shared with the Staff table — see dragtime.js).
const TIME_CELL = 'flex size-full items-center justify-center rounded-lg transition ' + TIME_TEXT;
// The cell: fills the column and stretches over the row's py-1.5.
// `arrow`: the Out cell, with a "→" in the gap before it (ARROW_BEFORE).
const TimeCol = ({ children, arrow }) => html`<span data-tc class=${cx('-my-1.5 flex self-stretch', arrow && ARROW_BEFORE('var(--g,0.75rem)'))}>${children}</span>`;
// Quiet (ink-3; support dimmer) so the times don't compete with the name,
// hours and tips.
// Times you typed for this person: medium weight; times that follow the
// shift default: regular weight, a shade fainter — a subtle "pinned to the
// default" look (DragTime calls the function with whether it's set). A time
// that moves with an edit (preview in progress, or waiting for Undo · Apply —
// say everyone on the default close while you drag it) reads accent.
const TIME_TONE = (p, mv) => (mv === 'preview' ? 'font-semibold text-accent' : mv ? 'font-medium text-accent'
  : set => (set ? cx('font-medium', isSup(p) ? 'text-ink-2' : 'text-ink') : cx('font-normal', isSup(p) ? 'text-ink-2' : 'text-ink/75')));

// Was · Now · ± cells (register adjusted), or Hrs · Tips.
// `d`: the change in this row's pay (ui/changes.js) — shown under the amount;
// while previewed the amount itself reads accent.
// `amount`: a node in place of the plain amount (the Total row's draggable
// tips total).
function MoneyCells({ adj, before, now, hours, sup, bold, noHrs, hdp = 0, small = false, d = null, amount = null }) {
  if (adj) {
    const d = now - before;
    return html`
      <span class="t-small text-right tabular-nums text-ink-3">${fmtMoney(before)}</span>
      <${Money} value=${now} class=${cx('t-body text-right font-semibold', sup ? SUP_TEXT : 'text-money')} />
      <span class=${cx('t-small text-right font-medium tabular-nums', d < 0 ? 'text-bad' : d > 0 ? 'text-good' : 'text-ink-3')}>${signed(d)}</span>`;
  }
  return html`
    ${!noHrs && html`<span class=${cx(small ? 't-small text-center font-medium tabular-nums' : HRS_CELL, bold ? 'font-semibold text-ink' : sup ? 'text-ink-2' : 'text-ink/85')}><span data-cw>${hrsText(hours, hdp)}</span></span>`}
    <span data-pw class="t-body relative text-right">${amount || html`<${Money} value=${now} class=${cx('t-body font-semibold', sup ? SUP_TEXT : now > 0 ? 'text-money' : 'text-ink-3', d?.kind === 'preview' && '!text-accent')} />`}<${Delta} d=${d} under /></span>`;
}

// The times as a subtext line under a name: "5 pm – 2 am" (still the Staff
// tab's DragTime — tap → quick time sheet, drag → 15-min steps; the tap /
// drag box pads out past the text). Used by the List view and the Pools
// table.
// a / p spelled out with a space: "11 am – 5 pm" (Clock's suffix span + "m").
const TIME_SUB = 'relative z-[1] -mx-1 -my-1.5 rounded px-1 py-1.5 tabular-nums transition [&>span>span]:ml-[0.25em] [&>span>span]:after:content-[\'m\']';
const TimesSub = ({ a, b }) => html`<span class="t-small whitespace-nowrap text-ink-3">${a}<span class="mx-0.5">–</span>${b}</span>`;
const PersonTimes = ({ vm, id, sup = false }) => html`<${TimesSub}
  a=${html`<${StaffTime} vm=${vm} id=${id} field="in" cls=${TIME_SUB} tone=${SUB_TONE(sup, timeMoved(vm, id, 'in'))} />`}
  b=${html`<${StaffTime} vm=${vm} id=${id} field="out" cls=${TIME_SUB} tone=${SUB_TONE(sup, timeMoved(vm, id, 'out'))} />`} />`;
// The same rule for the subtext times (List view, Pools table).
const SUB_TONE = (sup, mv) => (mv === 'preview' ? 'font-semibold text-accent' : mv ? 'font-medium text-accent'
  : set => (set ? (sup ? 'text-ink-2' : 'font-medium text-ink-2') : (sup ? 'text-ink-3' : 'text-ink-2/85')));

// A closer: a small red dot after the name (the # tile stays plain).
const CloserDot = () => html`<span data-closer class="ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-bad/75" aria-label="closer"></span>`;

const NAME_TEXT = 't-body flex min-w-0 items-center';

// List and Shift views (Bills / Math are tables: BillsTable, MathTable).
function PayRow({ vm, p, n, tint, before, view, col = {} }) {
  const adj = !!vm.sharesBefore;
  const d = payDelta(vm, p.id, p.final);
  return html`<div role="button" tabindex="0" style=${{ '--inset': '3.5rem' }}
    class=${cx(ROW, gridFor(adj, view), 'cursor-pointer text-left transition active:bg-surface-2')}
    onClick=${() => App.personModal(p.id)} onKeyDown=${e => { if (e.key === 'Enter' && e.target === e.currentTarget) App.personModal(p.id); }}>
    <span class=${cx(TILE, 't-small font-semibold tabular-nums')} style=${hueTile(hueIndex(vm.state, p.id))}
      aria-label=${'#' + n}>${n}</span>
    ${view === 'shift' ? html`<span class=${lineCls(adj)}>
        <span class="flex min-w-0 items-center gap-1.5">${tint && html`<${RoleDot} role=${p.role} />`}<span data-nw class="t-body min-w-0 truncate font-semibold text-ink">${p.name}</span>${p.closer && html`<${CloserDot} />`}</span>
        <${TimeCol}><${StaffTime} vm=${vm} id=${p.id} field="in" cls=${TIME_CELL} tone=${TIME_TONE(p, timeMoved(vm, p.id, 'in'))} mins=${col.inMins} /><//>
        <${TimeCol} arrow><${StaffTime} vm=${vm} id=${p.id} field="out" cls=${TIME_CELL} tone=${TIME_TONE(p, timeMoved(vm, p.id, 'out'))} mins=${col.outMins} /><//>
      </span>`
      : html`<span class="flex min-w-0 flex-col">
        <span class=${cx(NAME_TEXT, 'gap-1.5 font-semibold text-ink')}>${tint && html`<${RoleDot} role=${p.role} />`}<span class="truncate">${p.name}</span>${p.closer && html`<${CloserDot} />`}</span>
        <${PersonTimes} vm=${vm} id=${p.id} sup=${isSup(p)} />
      </span>`}
    <${MoneyCells} adj=${adj} before=${before} now=${p.final} hours=${p.shiftHours ?? p.hours} sup=${isSup(p)} small hdp=${col.hdp} d=${d} />
    <${Flash} d=${d} />
  </div>`;
}

// The chump: a small quiet row just above Total — the dollars left after
// rounding that stay in the drawer. Tap → Closer bonus & chump.
function ChumpRow({ vm, view }) {
  const adj = !!vm.sharesBefore;
  const s = vm.shares;
  const amt = html`<span class="text-right tabular-nums">${fmtMoney(s.leftover)}</span>`;
  const was = vm.sharesBefore?.leftover || 0;
  const mid = adj ? html`<span class="text-right tabular-nums">${fmtMoney(was)}</span>${amt}<span class="text-right tabular-nums">${signed(s.leftover - was)}</span>`
    : view === 'shift' ? html`<span></span><span></span><span></span>${amt}` : html`<span></span>${amt}`;
  return html`<button style=${{ '--inset': '3.5rem' }} class=${cx('li t-small w-full px-4 py-1 text-left text-ink-2 transition active:bg-surface-2', gridFor(adj, view))}
    onClick=${() => App.openBonus()} aria-label="Chump — closer bonus and chump">
    <span></span><span class="truncate">Chump <span class="text-ink-3">· stays in the drawer</span></span>${mid}</button>`;
}

// The Total row's open / close: semibold ink-2, accent while it's moving.
const TOTAL_TONE = mv => (mv === 'preview' ? 'font-semibold text-accent' : mv ? 'font-semibold text-accent' : 'font-semibold text-ink');

function TotalRow({ vm, hours, paidOut, before, view, col = {} }) {
  const adj = !!vm.sharesBefore;
  // One pool: the tips total drags like a time — hold, then $1 per 6px
  // (App.nudgeCash moves the uncounted rest; previewed while dragging,
  // Undo · Apply after). Tap → Tips. Not below the counted bills.
  const vmPool = vm.state.pools.length === 1 ? vm.pools[0] : null;
  const amount = vmPool && !adj && html`<${DragAmount} value=${paidOut} min=${Math.max(0, paidOut - (vmPool.rest || 0))}
    cls="-mx-1.5" moneyCls="t-body font-semibold text-money" label="Tips total"
    onSet=${(v, v0) => App.nudgeCash(v - v0)} onPreview=${(v, v0) => App.previewCash(v == null ? null : v - v0)}
    onTap=${() => App.tab('tips')} />`;
  const tIn = TOTAL_TONE(defaultMoved(vm, 'in')), tOut = TOTAL_TONE(defaultMoved(vm, 'out'));
  return html`<div style=${{ '--inset': '3.5rem' }} class=${cx(ROW, gridFor(adj, view), 'bg-surface-2/60')}>
    <span class=${cx(TILE, 'bg-surface-2 text-ink-2')}><${Icon} name="users" class="size-[1.125rem]" /></span>
    ${view === 'shift' ? html`<span class=${lineCls(adj)}>
        <span class="flex min-w-0"><span data-nw class="t-body min-w-0 truncate font-semibold">Total</span></span>
        <${TimeCol}><${DefaultTime} vm=${vm} field="in" cls=${TIME_CELL} tone=${tIn} mins=${col.inMins} /><//>
        <${TimeCol} arrow><${DefaultTime} vm=${vm} field="out" cls=${TIME_CELL} tone=${tOut} mins=${col.outMins} /><//>
      </span>`
      : html`<span class="flex min-w-0 flex-col">
        <span class=${cx(NAME_TEXT, 'font-semibold')}>Total</span>
        <${TimesSub}
          a=${html`<${DefaultTime} vm=${vm} field="in" cls=${TIME_SUB} tone=${tIn.replace('font-semibold ', '')} />`}
          b=${html`<${DefaultTime} vm=${vm} field="out" cls=${TIME_SUB} tone=${tOut.replace('font-semibold ', '')} />`} />
      </span>`}
    <${MoneyCells} adj=${adj} before=${before} now=${paidOut} hours=${hours} bold small hdp=${col.hdp} d=${sumDelta(vm, paidOut)} amount=${amount} />
  </div>`;
}

// Size the payouts grid from what's in it (see PAY_GRID_SHIFT): --pw = the
// widest amount (or the TIPS caption; Bills / Math's Tips width); in the
// Shift view --tmin / --vmin / --g / --nmin as described there (the time
// boxes still fill their column) — so short names leave the numbers more
// room, and a long name squeezes the numbers before it truncates.
const widest = (el, sel) => Math.max(0, ...[...el.querySelectorAll(sel)].map(x => x.getBoundingClientRect().width));
function fitShift(el, view) {
  if (!el) return;
  const pw = Math.ceil(widest(el, '[data-pw] > span, [data-pw] > button > span, [data-pwcap]'));
  if (pw > 0) el.style.setProperty('--pw', pw + 1 + 'px');
  if (view !== 'shift') return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // Content widths: times (In / Out), values (Hrs / Tips), the longest name
  // (scrollWidth: a truncated name's full width).
  const T = Math.ceil(Math.max(widest(el, '[data-tc] button > span'), widest(el, '[data-capt]')));
  const V = Math.ceil(pw);   // Tips (Hrs is a fixed 2.5rem)
  if (!(T > 0) || !(V > 0)) return;
  // (+ the closer dot after a name, when there is one)
  const N = Math.max(0, ...[...el.querySelectorAll('[data-nw]')].map(x => x.scrollWidth
    + (x.nextElementSibling?.matches('[data-closer]') ? x.nextElementSibling.offsetWidth + 6 : 0))) + 1;
  const row = el.querySelector('.li');
  let pad = 0.75 * rem, g = 0.75 * rem, nmin = N;
  if (row) {
    const cs = getComputedStyle(row);
    const avail = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const need = () => 2.75 * rem + N + 2 * T + 2.5 * rem + V + 3 * pad + 4 * g;   // tile + its gap fixed
    // Too tight for the longest name: drop the columns' padding, then
    // tighten the gaps (to 0.375rem), then let the name truncate.
    let over = need() - avail;
    if (over > 0) { pad = Math.max(0, pad - over / 3); over = need() - avail; }
    if (over > 0) { g = Math.max(0.375 * rem, g - over / 4); over = need() - avail; }
    if (over > 0) nmin = Math.max(0, N - over);
  }
  el.style.setProperty('--tmin', T + pad + 'px');
  el.style.setProperty('--vmin', V + pad + 'px');
  el.style.setProperty('--g', g + 'px');
  el.style.setProperty('--nmin', nmin + 'px');
}

// Staff-tab order: state order, grouped by role when roles are on.
function staffOrder(vm, people) {
  if (!vm.state.settings.allRoles) return people;
  const rank = { bartender: 0, server: 1, support: 2 };
  return people.map((p, i) => [p, i]).sort((x, y) => (rank[x[0].role] - rank[y[0].role]) || (x[1] - y[1])).map(x => x[0]);
}

function PayoutList({ vm, name, view }) {
  const s = vm.shares;
  const adj = !!vm.sharesBefore;
  const ordered = staffOrder(vm, s.perPerson);
  const was = id => vm.sharesBefore?.perPerson.find(x => x.id === id)?.final ?? 0;
  const { roles, tint } = rolesOf(vm, ordered);
  const hours = ordered.filter(p => !isSup(p)).reduce((t, p) => t + (p.shiftHours ?? p.hours), 0);
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  const paidBefore = adj ? vm.sharesBefore.perPerson.reduce((t, p) => t + p.final, 0) : 0;
  // Key: roles (several), closers, and the faint "follows the default" times.
  const footer = html`<span class="flex flex-wrap items-center gap-x-3 gap-y-1">
    ${tint && roles.map(r => html`<span key=${r} class="inline-flex items-center gap-1.5"><span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_PLURAL[r]}</span>`)}
    ${ordered.some(p => p.closer) && html`<span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-bad/75"></span>Closer</span>`}
    <span>Lighter times follow the shift default</span>
    ${tint && roles.includes('support') && html`<span>· support is a tip-out, not counted in hours</span>`}</span>`;
  const cap = 't-cap text-ink-3';
  // One look per column: if any time in the In (or Out) column has minutes,
  // every row shows them ("5:00p" over "5:30p"); Hrs likewise share the most
  // decimals any row needs ("6.0" over "6.5"). The Total row counts too.
  const R = vm.resolved;
  const rs = ordered.map(p => R?.staff.find(x => x.id === p.id)).filter(Boolean);
  const col = {
    inMins: hasMinutes([...rs.map(r => r.inAbs), R?.anchorAbs]),
    outMins: hasMinutes([...rs.map(r => r.outAbs), R?.closeAbs]),
    hdp: Math.max(0, ...ordered.map(p => hrsDecimals(p.shiftHours ?? p.hours)), hrsDecimals(hours)),
  };
  const box = useRef(null);
  useLayoutEffect(() => fitShift(box.current, view));
  // Re-fit whenever the measurements can change without a re-render: the
  // list's size changes (rotation, resize, Tailwind compiling the grid
  // classes on first load, the tab becoming visible), the webfont arriving,
  // and the page being revealed (html.ready) — on a fresh load the first
  // render measures before any of those, which left the defaults in place.
  useEffect(() => {
    const el = box.current;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitShift(box.current, view)); };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    if (ro && el) ro.observe(el);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-size'] });
    document.fonts?.ready?.then(on);
    window.addEventListener('resize', on);
    on();
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); mo.disconnect(); window.removeEventListener('resize', on); };
  }, [view]);
  return html`<section ref=${box} class="flex flex-col gap-2">
    <div class=${cx(gridFor(adj, view), 'min-h-5 items-end px-4')}>
      <span class=${cx(cap, 'text-center')}>#</span>
      ${view === 'shift'
        ? html`<span class=${adj ? LINE : 'contents'}><span class=${cx(cap, 'truncate')}>${name || 'Payouts'}</span><span class=${cx(cap, 'text-center')}><span data-capt>In</span></span><span class=${cx(cap, 'text-center')}><span data-capt>Out</span></span></span>`
        : html`<span class=${cx(cap, 'truncate')}>${name || 'Payouts'}</span>`}
      ${adj
        ? html`<span class=${cx(cap, 'text-right')}>Was</span><span class=${cx(cap, 'text-right')}>Now</span><span class=${cx(cap, 'text-right')}>±</span>`
        : html`${hasHrs(view) && html`<span class=${cx(cap, 'text-center')}><span data-capv>Hrs</span></span>`}<span class=${cx(cap, 'text-right')}><span data-pwcap>Tips</span></span>`}
    </div>
    <${List}>
      ${ordered.map((p, i) => html`<${PayRow} key=${p.id} vm=${vm} p=${p} n=${i + 1} tint=${tint} before=${was(p.id)} view=${view} col=${col} />`)}
      ${s.leftover > 0 && html`<${ChumpRow} vm=${vm} view=${view} />`}
      <${TotalRow} vm=${vm} hours=${hours} paidOut=${paidOut} before=${paidBefore} view=${view} col=${col} />
    <//>
    ${footer && html`<div class="t-small px-4 text-ink-2">${footer}</div>`}
  </section>`;
}

// ── Pools table (several pools — Summary's default then) ────────────────────
// One row per person: the name with their times under it ("5p – 2a", tap /
// drag to edit), then one column per pool — what that pool paid them, with
// their hours in it as small subtext under — then Total: take-home over
// their hours. A Total row with each pool's cash over its tipped hours.
// Scrolls sideways with the name column pinned. A blank cell = their role
// doesn't share that pool; "—" = it does, but they didn't work its window.
// Support: hours dimmed (a tip-out, not in the hours totals), pay in the
// support tint. Pool tips are exact shares; take-home is after rounding +
// closer bonus.
function PoolGrid({ vm }) {
  const s = vm.shares;
  const pools = s.perPool;
  const people = staffOrder(vm, s.perPerson.filter(p => p.final > 0 || Object.values(p.perPool || {}).some(x => x.hours > 0)));
  const { roles, tint } = rolesOf(vm, people);
  const shares = (pl, p) => { const r = poolRoles(vm, pl.id); return isSup(p) ? r.support : r[p.role]; };
  const TH = 'px-3 pb-2 pt-2.5 font-normal';
  const TD = 'whitespace-nowrap px-3 py-2 text-right align-top tabular-nums';
  const SEP = 'border-l border-line';
  const NAME = 'sticky left-0 z-[1] bg-inherit pl-4 pr-2 text-left';
  // A value over its hours, both right-aligned.
  const Two = ({ top, sub, subCls = 'text-ink-3' }) => html`<span class="block leading-tight">${top}</span><span class=${cx('t-small block', subCls)}>${sub}</span>`;
  const tippedHours = pools.reduce((t, pl) => t + pl.tippedHours, 0);
  const paid = people.reduce((t, p) => t + p.final, 0);
  return html`<${Card} flush>
    <div class="overflow-x-auto [scrollbar-width:thin]">
      <table class="min-w-full border-separate border-spacing-0 text-[0.9375rem]">
        <thead class="bg-surface">
          <tr class="bg-surface shadow-[0_1px_0_var(--line)]">
            <th class=${cx(NAME, TH, 't-cap z-[2] align-bottom text-ink-3')}>Name</th>
            ${pools.map((pl, i) => html`<th key=${pl.id} class=${cx(TH, SEP, 'text-right')}>
              <button class="inline-flex flex-col items-end active:opacity-60" onClick=${() => App.openPoolSummary(pl.id)}>
                <span class="t-small inline-flex items-center gap-1.5 font-semibold text-ink"><${PoolDot} i=${i} />${pl.label}</span>
                <span class="whitespace-nowrap text-[0.75rem] tabular-nums text-ink-3"><${Clock} abs=${pl.startAbs} />–<${Clock} abs=${pl.endAbs} /> · ${rate2(pl.rate)}/h</span>
              </button></th>`)}
            <th class=${cx(TH, SEP, 'pr-4 text-right align-bottom')}><span class="t-small font-semibold text-ink">Total</span></th>
          </tr>
        </thead>
        <tbody>
          ${people.map((p, i) => {
            const hrs = Object.values(p.perPool || {}).reduce((t, x) => t + x.hours, 0);
            const subCls = isSup(p) ? 'text-ink-3/70' : 'text-ink-3';
            return html`<tr key=${p.id} class=${cx(zebra(i), 'cursor-pointer active:brightness-95')} onClick=${() => App.personModal(p.id)}>
              <td class=${cx(NAME, 'py-2 align-top')}><span class="flex max-w-[9rem] flex-col">
                <span class="flex min-w-0 items-center gap-1.5">
                  ${tint && html`<${RoleDot} role=${p.role} />`}
                  <span class="truncate font-medium leading-tight">${p.name}</span>${p.closer && html`<${CloserDot} />`}</span>
                <${PersonTimes} vm=${vm} id=${p.id} sup=${isSup(p)} /></span></td>
              ${pools.map(pl => {
                const x = p.perPool?.[pl.id];
                const on = shares(pl, p);
                return html`<td key=${pl.id} class=${cx(TD, SEP, isSup(p) && SUP_TEXT)}>${
                  x ? html`<${Two} top=${r2(x.raw)} sub=${fmtHrs(x.hours) + 'h'} subCls=${subCls} />`
                    : on ? html`<span class="block leading-tight text-ink-3">—</span>` : ''}</td>`;
              })}
              <td class=${cx(TD, SEP, 'pr-4')}><${Two} top=${html`<${Money} value=${p.final} class=${cx('font-semibold', isSup(p) && SUP_TEXT)} />`} sub=${html`${fmtHrs(hrs)}h <${Delta} d=${payDelta(vm, p.id, p.final)} class="ml-1" />`} subCls=${subCls} /></td>
            </tr>`;
          })}
        </tbody>
        <tfoot>
          <tr class=${TOTAL_FILL}>
            <td class=${cx(NAME, 'py-2.5 align-top font-semibold')}>Total</td>
            ${pools.map(pl => html`<td key=${pl.id} class=${cx(TD, SEP, 'py-2.5')}><${Two} top=${html`<${Money} value=${pl.total} class="font-semibold" />`} sub=${fmtHrs(pl.tippedHours) + 'h'} subCls="font-medium text-ink-2" /></td>`)}
            <td class=${cx(TD, SEP, 'py-2.5 pr-4')}><${Two} top=${html`<${Money} value=${paid} class="font-semibold" />`} sub=${fmtHrs(tippedHours) + 'h'} subCls="font-medium text-ink-2" /></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="t-small flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-ink-3">
      <span>Each pool: what it paid · their hours in it. Pool shares are exact; take-home is rounded${s.leftover > 0 ? ' · chump ' + fmtMoney(s.leftover) : ''}.</span>
      <span>Blank = their role isn’t in that pool · — = didn’t work its window.</span>
      ${tint && roles.map(r => html`<span key=${r} class="inline-flex items-center gap-1.5"><span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_PLURAL[r]}</span>`)}
      <span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-bad/75"></span>Closer</span>
    </div>
  <//>`;
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


// Bills view: each person's envelope as a grid — Name · one column per bill
// size · Pay, chump and drawer totals (Payout's EnvelopeTable, Staff order).
function BillsTable({ vm }) {
  const ok = vm.dist && !vm.dist.error;
  return html`<${EnvelopeTable} vm=${vm} order=${staffOrder(vm, vm.shares.perPerson)}
    byPerson=${ok ? vm.dist.byPerson : {}} remBills=${ok ? vm.dist.remainderBills : {}} />`;
}

// Math view: the split as a grid — Name · Hrs × Rate = Exact · Round · Tips.
// Rate = their exact share ÷ their hours (with several pools, the blend);
// Round = take-home − exact (↑ good when rounded up — a closer bonus — else
// faint). Total row: tipped hours, the pool rate, the pool, −chump, paid.
function MathTable({ vm }) {
  const s = vm.shares;
  const people = staffOrder(vm, s.perPerson);
  const dash = html`<span class="text-ink-3/50">—</span>`;
  const round = p => {
    const d = p.final - p.exact;
    if (Math.abs(d) < 0.005) return dash;
    return d > 0 ? html`<span class="font-medium text-good">+${r2(d)}</span>` : html`<span class="text-ink-3">−${r2(-d)}</span>`;
  };
  const paid = people.reduce((t, p) => t + p.final, 0);
  return html`<${Section} footer=${'Hours × rate = exact share, rounded down to whole dollars; + is a closer bonus' + (s.perPool.length > 1 ? '. With several pools the rate is the blend.' : '.')}>
    <${Table} lines scroll stickyFirst
      cols=${[{ label: 'Name' }, { label: 'Hrs' }, { label: 'Rate' }, { label: 'Exact', align: 'right' }, { label: 'Round', align: 'right' }, { label: 'Tips', align: 'right' }]}
      rows=${people.map(p => ({ key: p.id, onClick: () => App.personModal(p.id), tone: isSup(p) ? 'muted' : '',
        cells: [html`<span class="inline-flex max-w-full items-center"><span class="truncate">${p.name}</span>${p.closer && html`<${CloserDot} />`}</span>`,
          fmtHrs(p.hours), p.hours > 0 ? r2(p.exact / p.hours) : dash, r2(p.exact), round(p),
          html`<span class="relative inline-block"><${Money} value=${p.final} class=${cx('font-semibold', isSup(p) && SUP_TEXT)} /><${Delta} d=${payDelta(vm, p.id, p.final)} under /></span>`] }))}
      foot=${['Total', fmtHrs(s.totalHours), r2(s.rate), r2(s.totalCash), s.leftover > 0 ? html`<span class="text-ink-2">−${s.leftover}</span>` : dash, html`<${Money} value=${paid} />`]} />
  <//>`;
}

// ── Payouts as a list (the page) ─────────────────────────────────────────────
// One iOS list item per person in Staff order, a single line that reads
// left to right — who, when, how long, what they take home:
//   Maya    [4|close] 10.5h            $304  ›
//   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// · the name — the loudest text on the left;
// · their time pill, a step quieter: In on a tint of their own colour, Out
//   outlined ("close" when they worked to the close — the usual case, so
//   the early outs are the ones that read). No a / p: the night says which.
//   Each half is a keypad cell (tap to type, hold for the wheel);
// · their hours, quiet;
// · the take-home, big, with its change under it, then a chevron with room
//   around it (the row opens their payout drawer);
// · under the line, sitting just above the row's hairline, their shift on
//   the night's axis in their colour (a placed break is a gap) — the same
//   colour as their In, so the colour always points at the person.
// The rows share one grid (subgrid), so every pill starts after the longest
// name and the 4s, 5s and 6s stack in a column. Then the chump and the Total
// (open | close · tipped hours · paid out — hold the amount for its wheel).
const PI_COLS = 'grid grid-cols-[minmax(0,max-content)_auto_auto_minmax(0,1fr)_auto_auto] gap-x-2';
const PI_ROW = 'relative col-span-full grid grid-cols-subgrid items-center gap-y-1.5 border-b border-line px-4 pb-1.5 pt-2.5 text-left';
const PI_NAME = 'min-w-0 truncate text-[1.0625rem] font-medium leading-snug';
const PI_MONEY = 'text-[1.125rem] font-semibold leading-tight tracking-tight';
const PI_TAIL = 'row-span-2 self-center';
// The pill: two keypad cells joined. Small, medium weight, calmer than the
// name. In sits on their colour (--hue, set on the row); Out is outlined.
const TPILL = 'flex h-6 items-center px-1.5 text-[0.75rem] font-medium leading-none tabular-nums tracking-[-0.01em] transition';
const PILL_IN = cx(TPILL, 'rounded-l-md bg-[color-mix(in_srgb,var(--hue)_16%,transparent)]');
const PILL_OUT = cx(TPILL, 'rounded-r-md border border-l-0 border-ink/15');
const IN_TONE = mv => (mv ? 'text-accent' : 'text-[color:color-mix(in_srgb,var(--hue)_72%,var(--ink-2))]');
const OUT_TONE = (mv, close) => (mv ? 'text-accent' : close ? 'text-ink-3' : 'text-ink-2');
const HRS_TEXT = 'ml-0.5 whitespace-nowrap text-[0.75rem] font-medium tabular-nums';
const CHEV = 'row-span-2 ml-1.5 size-4 self-center text-ink-3';

// Where a time sits along the night (0–100).
const posOf = (span, v) => Math.max(0, Math.min(100, ((v - span.a) / (span.b - span.a)) * 100));
const atClose = (vm, abs) => abs != null && vm.resolved?.closeAbs != null && Math.abs(abs - vm.resolved.closeAbs) < 1e-6;

// Their shift on the night's axis: a slim line in their colour over a faint
// track; a placed break is a gap. Sits just above the row's hairline.
function ShiftLine({ span, p }) {
  if (!span || p.inAbs == null || p.outAbs == null) return html`<span class="col-start-1 col-end-5 h-[3px]"></span>`;
  const a = posOf(span, p.inAbs), b = posOf(span, p.outAbs);
  const brk = p.brkLen > 0 && p.brkStart != null;
  return html`<span class="relative col-start-1 col-end-5 h-[3px] rounded-full bg-ink/[.05]" aria-hidden="true">
    <span class="absolute inset-y-0 rounded-full bg-[var(--hue)] opacity-90" style=${{ left: a + '%', width: Math.max(0, b - a) + '%' }}></span>
    ${brk && html`<span class="absolute -inset-y-px bg-bg" style=${{ left: posOf(span, p.brkStart) + '%', width: Math.max(0, posOf(span, p.brkStart + p.brkLen) - posOf(span, p.brkStart)) + '%' }}></span>`}
  </span>`;
}

// [In|Out] — the two halves are keypad cells; `close` swaps the Out for
// "close" (the real time comes back while it's edited or held).
function TimePill({ a, b }) {
  return html`<span class="ml-1 inline-flex shrink-0 items-stretch">${a}${b}</span>`;
}

function PayItem({ vm, p, before, span }) {
  const adj = !!vm.sharesBefore;
  const d = payDelta(vm, p.id, p.final);
  const sup = isSup(p);
  const ch = p.final - before;
  const close = atClose(vm, p.outAbs);
  const brk = p.brkLen > 0 ? ', ' + fmtBreak(p.brkLen) + ' break' : '';
  return html`<div role="button" tabindex="0" style=${{ '--hue': hueVar(hueIndex(vm.state, p.id)), '--inset': '1rem' }}
    class=${cx(PI_ROW, 'cursor-pointer transition active:bg-surface-2')}
    aria-label=${p.name + ', ' + fmtHrs(p.shiftHours ?? p.hours) + ' hours' + brk + ', takes home ' + fmtMoney(p.final)}
    onClick=${() => App.personModal(p.id)} onKeyDown=${e => { if (e.key === 'Enter' && e.target === e.currentTarget) App.personModal(p.id); }}>
    <span class=${PI_NAME}>${p.name}</span>
    <${TimePill}
      a=${html`<${StaffTime} vm=${vm} id=${p.id} field="in" bare cls=${PILL_IN} tone=${IN_TONE(timeMoved(vm, p.id, 'in'))} />`}
      b=${html`<${StaffTime} vm=${vm} id=${p.id} field="out" bare alt=${close ? 'close' : null} cls=${PILL_OUT} tone=${OUT_TONE(timeMoved(vm, p.id, 'out'), close)} />`} />
    <span class=${cx(HRS_TEXT, sup ? 'text-ink-3/80' : 'text-ink-3')}>${fmtHrs(p.shiftHours ?? p.hours)}h</span>
    <span></span>
    <span class=${cx(PI_TAIL, 'row-start-1 col-start-5 flex flex-col items-end gap-0.5 pl-2')}>
      <${Money} value=${p.final} class=${cx(PI_MONEY, sup ? SUP_TEXT : p.final > 0 ? 'text-money' : 'text-ink-3', d?.kind === 'preview' && '!text-accent')} />
      ${d ? html`<${Delta} d=${d} />`
        : adj && html`<span class=${cx('t-small font-medium tabular-nums', ch < 0 ? 'text-bad' : ch > 0 ? 'text-good' : 'text-ink-3')}>${ch ? signed(ch) : 'same'}</span>`}
    </span>
    <${Icon} name="chevR" class=${cx(CHEV, 'row-start-1 col-start-6')} />
    <${ShiftLine} span=${span} p=${p} />
    <${Flash} d=${d} />
  </div>`;
}

function PayItems({ vm, name }) {
  const s = vm.shares;
  const adj = !!vm.sharesBefore;
  const ordered = staffOrder(vm, s.perPerson);
  const was = id => vm.sharesBefore?.perPerson.find(x => x.id === id)?.final ?? 0;
  const hours = ordered.filter(p => !isSup(p)).reduce((t, p) => t + (p.shiftHours ?? p.hours), 0);
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  const paidBefore = adj ? vm.sharesBefore.perPerson.reduce((t, p) => t + p.final, 0) : 0;
  const span = nightSpan(vm);
  const vmPool = vm.state.pools.length === 1 ? vm.pools[0] : null;
  const total = vmPool && !adj
    ? html`<${DragAmount} value=${paidOut} min=${Math.max(0, paidOut - (vmPool.rest || 0))}
        cls="-mx-1.5" moneyCls=${cx(PI_MONEY, 'text-money')} label="Tips total"
        onSet=${(v, v0) => App.nudgeCash(v - v0)} onPreview=${(v, v0) => App.previewCash(v == null ? null : v - v0)}
        onTap=${() => App.tab('tips')} />`
    : html`<${Money} value=${paidOut} class=${cx(PI_MONEY, 'text-money')} />`;
  const td = sumDelta(vm, paidOut);
  const shiftTone = mv => (mv ? 'text-accent' : 'text-ink-2');
  const anySup = ordered.some(isSup);
  const footer = html`<span class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <span>Tap a time to type it · hold for the wheel</span>
    ${anySup && html`<span>Support is a tip-out, not counted in hours</span>`}</span>`;
  return html`<${Section} title=${name || 'Payouts'} aside=${ordered.length + (ordered.length === 1 ? ' person' : ' people')} footer=${footer}>
    <div class=${PI_COLS}>
      ${ordered.map(p => html`<${PayItem} key=${p.id} vm=${vm} p=${p} before=${was(p.id)} span=${span} />`)}
      ${s.leftover > 0 && html`<button style=${{ '--inset': '1rem' }} class=${cx(PI_ROW, 'pb-2.5 transition active:bg-surface-2')} onClick=${() => App.openBonus()}>
        <span class="text-[1.0625rem] font-medium leading-snug text-ink-2">Chump</span>
        <span class="t-small col-span-3 truncate pl-1 text-ink-3">stays in the drawer</span>
        <span class="col-start-5 pl-2 text-right text-[1.0625rem] font-semibold tabular-nums text-ink-2">${fmtMoney(s.leftover)}</span>
        <${Icon} name="chevR" class="col-start-6 ml-1.5 size-4 text-ink-3" />
      </button>`}
      <div style=${{ '--hue': 'var(--ink-3)', '--inset': '1rem' }} class=${cx(PI_ROW, 'border-b-0 pb-2.5')}>
        <span class="text-[1.0625rem] font-semibold leading-snug">Total</span>
        <${TimePill}
          a=${html`<${DefaultTime} vm=${vm} field="in" bare cls=${PILL_IN} tone=${shiftTone(defaultMoved(vm, 'in'))} />`}
          b=${html`<${DefaultTime} vm=${vm} field="out" bare cls=${PILL_OUT} tone=${shiftTone(defaultMoved(vm, 'out'))} />`} />
        <span class=${cx(HRS_TEXT, 'font-semibold text-ink-2')}>${fmtHrs(hours)}h</span>
        <span></span>
        <span class="col-start-5 flex flex-col items-end gap-0.5 pl-2">
          ${total}
          ${td ? html`<${Delta} d=${td} />` : adj && html`<span class="t-small tabular-nums text-ink-3">was ${fmtMoney(paidBefore)}</span>`}
        </span>
        <span class="col-start-6 ml-1.5 w-4"></span>
      </div>
    </div>
  <//>`;
}

const VIEWS = [
  { value: 'list', label: 'List', icon: 'menu', sub: 'Each person a row: name over their times, take-home — the page' },
  { value: 'shift', label: 'Table', icon: 'clock', sub: 'Name · In · Out · Hrs · Tips in columns' },
  { value: 'pools', label: 'Pools', icon: 'dollar', sub: 'What each pool paid each person' },
  { value: 'bills', label: 'Bills', icon: 'cash', sub: 'Each envelope, bill by bill' },
  { value: 'math', label: 'Math', icon: 'calc', sub: 'Hours × rate, and the rounding' },
];

// The view: Shift is the page (name · In · Out · Hrs · Tips, one line each).
// The others — List, Pools, Bills, Math — are kept, picked from the page
// drawer (SummaryOptions); module state, so the drawer can switch it.
let pick = 'list';
const setView = v => { pick = v; if (lastVm) renderSummary(lastVm, lastName); };
const viewOf = vm => (pick === 'pools' && !(!vm.blocked && vm.shares.perPool.length > 1) ? 'list' : pick);

// The figures: Tips · Hours · Rate · the small bills ($10 · $5 · $1 — the
// fewest that make every payout exact), each with its change after an edit.
function Figures({ vm }) {
  const sh = vm.shares;
  const need = smallBillsNeeded(vm);
  const dot = html`<span class="mx-0.5 text-ink-3">·</span>`;
  return html`<${Stats} items=${[
    { label: 'Tips', value: fmtMoney(sh.totalCash), tone: 'text-money', d: figDelta(vm, 'total') },
    { label: 'Hours', value: fmtHrs(sh.totalHours), tone: 'text-[var(--p3)]' },
    { label: 'Rate', value: '$' + sh.rate.toFixed(2), tone: 'text-good', d: figDelta(vm, 'rate') },
    { label: '$10 · $5 · $1', value: need ? need.map((c, i) => html`${i > 0 && dot}<span class="bill-col !font-semibold" data-d=${c.d}>${c.n}</span>`) : '—' },
  ]} />`;
}

// ── The page drawer's Summary part: the view, and the tools. ──────────────
export function SummaryOptions({ vm }) {
  const several = !vm.blocked && vm.shares.perPool.length > 1;
  const view = viewOf(vm);
  const close = fn => () => { App.closeSheet('sheet-page'); fn(); };
  return html`${!vm.blocked && html`<${Section} title="View"><${List}>
      ${VIEWS.filter(v => v.value !== 'pools' || several).map(v => html`<${Item} key=${v.value} icon=${v.icon} title=${v.label} sub=${v.sub}
        tone=${v.value === view ? 'active' : ''} chevron=${false} trail=${v.value === view && html`<${Icon} name="check" class="size-5 text-accent" />`}
        onClick=${close(() => setView(v.value))} />`)}
    <//><//>`}
    <${Section} title="Do"><${List}>
      <${Item} icon="clock" title="Close-time what-if" sub="Everyone’s take-home at other close times" onClick=${close(() => App.openCloseTime())} />
      <${Item} icon="gift" title="Closer bonus & chump" sub="Who gets the dollars left after rounding" onClick=${close(() => App.openBonus())} />
      <${Item} icon="copy" title="Copy as text" sub="For Notes" onClick=${close(() => App.copySummary())} />
    <//><//>`;
}

function Summary({ vm, name }) {
  const view = viewOf(vm);
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  const billsOff = view === 'bills' && (!vm.dist || vm.dist.error);
  const label = VIEWS.find(v => v.value === view)?.label;
  return html`<div class="flex flex-col gap-5">
    ${vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`)}
    <${AdjustBanner} vm=${vm} />
    <${Figures} vm=${vm} />
    <div class="flex flex-col gap-3">
      ${view !== 'list' && html`<button class="t-small flex h-9 items-center gap-1.5 self-start rounded-full bg-surface px-3 font-semibold text-ink-2 active:scale-95" onClick=${() => setView('list')}>
        ${label} view<span class="text-accent">· Back to the list</span></button>`}
      ${billsOff && html`<${Alert} tone="warn" action=${{ label: 'Payout', onClick: () => App.tab('payout') }}>The bills don’t work out yet — Payout has the swap.<//>`}
      ${view === 'pools' ? html`<${PoolGrid} vm=${vm} />`
        : view === 'bills' ? html`<${BillsTable} vm=${vm} />`
        : view === 'math' ? html`<${MathTable} vm=${vm} />`
        : view === 'shift' ? html`<${PayoutList} vm=${vm} name=${name} view="shift" />`
        : html`<${PayItems} vm=${vm} name=${name} />`}
    </div>
    ${view !== 'pools' && html`<${PoolsList} vm=${vm} />`}
  </div>`;
}

let lastName = '';
export function renderSummary(vm, sessionName = lastName) {
  lastVm = vm;
  lastName = sessionName;
  const root = $('summary-root');
  if (root) render(html`<${Summary} vm=${vm} name=${sessionName} />`, root);
  renderPoolSheet(vm);
}
