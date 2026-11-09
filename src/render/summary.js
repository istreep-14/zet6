// Summary tab (Preact) — the shift at a glance, no bills. The live HUD
// (rate · pool · chump) floats over it like on Staff / Tips, so there's no
// hero card:
//   payouts table in a card. One pool: name · In · Out (draggable) ·
//     Hours · Tips. Several pools: the Total table; tap a pool's header to
//     open that pool's own table in a sheet. Every table: zebra rows, a sticky header that shrinks
//     while stuck, a role dot before names when several roles share it.
//     Support staff are paid a tip-out off the top, so their hours never count
//     in hours totals and their pay shows in the support colour.
//   → close time / bonus tools.
// Tap a person → Person sheet.

import { fmtHrs, payoutOrder } from '../util.js';
import { html, render, useRef, useLayoutEffect } from '../ui/preact.js';
import { cx, Icon, Alert, Money, Clock, Blocked, Card, TABLE, TABLE_ROW, TABLE_HEAD, THEAD, Sentinel, zebra, ROLE_DOT, ROLE_PLURAL } from '../ui/pkit.js';
import { StaffTime, DefaultTime } from './staff.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';

const $ = id => document.getElementById(id);


// ── Shared table pieces ──────────────────────────────────────────────────────
// Every table is one grid (TABLE) with a subgrid per row (TABLE_ROW), so the
// columns line up; useFitColumns sets the widths.
const GRID = TABLE_ROW;
const HOURS = 'text-center font-rounded text-[1.125rem] font-medium leading-none text-ink/85';
// Pay cells carry pl-3: a fixed gap after Hours.
const TIPS = 'font-rounded text-[1.25rem] font-bold leading-none tracking-tight';
const PILL = 'h-9 w-full rounded-md px-2 text-center text-[0.9375rem] tracking-[-0.035em] tabular-nums transition';
const QUIET = 'font-medium text-ink-2';
const SUB = 'text-[0.75rem] font-medium leading-tight text-ink-3 tabular-nums';
// Sits on the In / Out boundary: absolutely placed in the Out column's area,
// pulled back half a gap and centred on that line. The time cells' own
// px-2 keeps the text clear of it; nudged up to the digits' middle.
const DASH = html`<span class="pointer-events-none absolute inset-y-0 left-[-0.125rem] col-start-3 row-start-1 flex -translate-x-1/2 items-center pb-[0.2em] text-[0.9375rem] text-ink-3" aria-hidden="true">–</span>`;
// One colour per pool (max 3 in practice) for its dot.
const POOL_HUES = ['var(--color-gold)', '#2dd4bf', '#ff6bb5', '#a78bfa'];
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
  return html`<div class="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-sep px-3 py-2 text-[0.75rem] text-ink-3">
    ${roles.map(r => html`<span key=${r} class="inline-flex items-center gap-1.5"><span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_PLURAL[r]}</span>`)}
    ${roles.includes('support') && html`<span class="text-ink-3">· support is a tip-out, not counted in hours</span>`}
  </div>`;
}

// Header label in the name column: never widens it.
const HeadLabel = ({ children }) => html`<span class="w-0 min-w-full truncate text-[0.6875rem] font-bold uppercase tracking-[.08em] text-ink-3">${children}</span>`;

// Small role dot before a name — only when several roles share the table
// (the role key at the foot explains the colours). No avatars.
const RoleDot = ({ role }) => html`<span class=${cx('size-2 shrink-0 rounded-full', ROLE_DOT[role])} aria-label=${role}></span>`;

function Lead({ p, tint, sub }) {
  return html`<span class="flex min-w-0 items-center gap-2">
    ${tint && html`<${RoleDot} role=${p.role} />`}
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-[1.125rem] font-semibold leading-tight">${p.name}</span>
      ${sub}
    </span>
  </span>`;
}

const rowCls = 'min-h-[3.25rem] py-1.5 transition active:bg-raised';
const TOTAL_ROW = 'h-13 border-t border-white/12 bg-raised/60';

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

// ── One pool: name · In · Out · Hrs · Tips ─────────────────────────
// In / Out are the Staff tab's draggable times; the Total row's In / Out are
// the shift's default open / close (DefaultTime: drag, or tap → shift panel).
function SinglePool({ vm, name }) {
  const s = vm.shares;
  const ordered = payoutOrder(s.perPerson);
  const { roles, tint } = rolesOf(vm, ordered);
  const hours = ordered.filter(p => !isSup(p)).reduce((t, p) => t + (p.shiftHours ?? p.hours), 0);
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  const table = useFitColumns([1, 0.55, 0.55, 0.35, 1.2]);
  const head = TABLE_HEAD;
  return html`<${Card} flush><div ref=${table} class=${TABLE}>
    <${Sentinel} cls="col-span-full" />
    <div class=${cx(GRID, THEAD, 'h-9 data-[stuck]:h-7')}>
      <${HeadLabel}>${name || 'Payouts'}<//>
      <span class=${head}>In</span><span class=${head}>Out</span><span class=${head}>Hrs</span>
      <span class=${cx(head, 'pl-3')}>Tips</span>
    </div>
    ${ordered.map((p, i) => html`<div key=${p.id} role="button" class=${cx(GRID, rowCls, zebra(i))} onClick=${() => App.personModal(p.id)}>
      <${Lead} p=${p} tint=${tint} />
      <${StaffTime} vm=${vm} id=${p.id} field="in" cls=${PILL} tone=${QUIET} />
      <${StaffTime} vm=${vm} id=${p.id} field="out" cls=${PILL} tone=${QUIET} />
      ${DASH}
      <span class=${cx(HOURS, isSup(p) && 'text-ink-3')}>${fmtHrs(p.shiftHours ?? p.hours)}</span>
      <span class="pl-3 text-center"><${Money} value=${p.final} class=${cx(TIPS, isSup(p) && SUP_TEXT, !(p.final > 0) && 'text-ink-3')} /></span>
    </div>`)}
    <div class=${cx(GRID, TOTAL_ROW)}>
      <span class="text-[1rem] font-bold">Total</span>
      <${DefaultTime} vm=${vm} field="in" cls=${PILL} />
      <${DefaultTime} vm=${vm} field="out" cls=${PILL} />
      ${DASH}
      <span class=${cx(HOURS, 'font-semibold text-ink')}>${fmtHrs(hours)}</span>
      <span class="pl-3 text-center"><${Money} value=${paidOut} class=${cx(TIPS, 'text-gold')} /></span>
    </div>
  </div>${tint && html`<${RoleKey} roles=${roles} />`}<//>`;
}

// ── Several pools, Total tab ────────────────────────────────────────────────
// A wide table that scrolls sideways (the name column stays put), one line
// per person:
//   name (role dot when several roles; kept as narrow as it can be)
//   · Shift group: In · Out (draggable, like Staff; the Total row has the
//     default open / close) · Hrs
//   · per pool a group Hrs · Tips (hours like the Shift hours, pay with 2
//     decimals, no $), set apart by a faint fill in the pool's colour; header =
//     pool name in its colour, then window, rate, support cut and which roles
//     share it (those lines hide while the header is stuck). People whose role
//     isn't in a pool get blank, unfilled cells there (a gap in the band);
//     in the pool but not working its window → a dash.
//   · Total · net $/h.
// Two total rows — Total (cash) and Hours (support excluded) — whose pool
// cells span the Hrs · Tips pair, so a wide total never stretches Hrs.
// The header lives outside the sideways scroller (so it can stick to the
// page) and follows its scroll; both grids share the fitted columns.
const FLUSH_ROW = 'relative col-span-full grid grid-cols-subgrid items-stretch tabular-nums';
const STICKY = 'sticky left-0 z-[1] flex items-center bg-inherit pl-3 pr-3';
const TOTAL_BG = 'bg-[color-mix(in_srgb,var(--color-raised)_60%,var(--color-surface))]';
const C = 'flex items-center justify-center';
const GAP = 'ml-1';                                      // between column groups
const tintOf = i => ({ background: `color-mix(in srgb, ${POOL_HUES[i % POOL_HUES.length]} 9%, transparent)` });
const hueOf = i => ({ color: POOL_HUES[i % POOL_HUES.length] });
const shortRate = r => '$' + (Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : r.toFixed(2)) + '/h';
const dec2 = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIPS_SM = 'font-rounded text-[1.125rem] font-bold leading-none tracking-tight';
// Hours read like the $/h column: small, quiet.
const HRS = 'px-1.5 text-[0.8125rem] font-medium text-ink-3 tabular-nums';
const HRS_TOTAL = 'px-1.5 text-[0.8125rem] font-semibold text-ink-2 tabular-nums';
const T_PILL = 'h-8 w-full rounded-md px-1.5 text-center text-[0.8125rem] tabular-nums transition';
const SHIFT_FILL = { background: 'rgb(255 255 255 / .035)' };

// Hours with small decimals: 8.75 → 8 + ".75" smaller.
function Hrs({ value }) {
  const [w, d] = fmtHrs(value).split('.');
  return html`<span class="whitespace-nowrap">${w}${d && html`<span class="text-[.72em]">.${d}</span>`}</span>`;
}

function TotalTable({ vm, name }) {
  const s = vm.shares;
  const pools = s.perPool;
  const ordered = payoutOrder(s.perPerson);
  const { roles, tint } = rolesOf(vm, ordered);
  const rolesOn = vm.state.settings.allRoles;
  const conf = Object.fromEntries(pools.map(pl => [pl.id, poolRoles(vm, pl.id)]));
  const paidOut = ordered.reduce((t, p) => t + p.final, 0);
  const tipped = ordered.filter(p => !isSup(p));
  const shiftHours = tipped.reduce((t, p) => t + (p.shiftHours ?? 0), 0);
  const tippedHours = pools.reduce((t, pl) => t + pl.tippedHours, 0);
  const tippedPaid = tipped.reduce((t, p) => t + p.final, 0);
  const headRef = useRef(null), headWrap = useRef(null), bodyWrap = useRef(null);
  const table = useFitColumns([0.5, 0, 0, 0, ...pools.flatMap(() => [0, 0]), 1, 0.5], { scroll: true, head: headRef });
  const head = 'text-[0.625rem] font-bold uppercase tracking-[.08em] text-ink-3';
  const num = 'font-rounded text-[0.9375rem]';
  const extra = 'whitespace-nowrap text-[0.6875rem] font-medium tabular-nums group-data-[stuck]:hidden';
  const net = p => p.hours > 0 ? rate2(p.final / p.hours) : '—';
  const sync = () => { if (headWrap.current && bodyWrap.current) headWrap.current.scrollLeft = bodyWrap.current.scrollLeft; };
  useLayoutEffect(sync);
  return html`<${Card} flush>
    <${Sentinel} />
    <div ref=${headWrap} class=${cx(THEAD, 'overflow-hidden')}><div ref=${headRef} class="grid">
      <div class=${cx(FLUSH_ROW, 'bg-surface')}>
        <span class=${cx(STICKY, 'row-span-2 text-[0.6875rem] font-bold uppercase tracking-[.08em] text-ink-3')}><span class="w-0 min-w-full truncate">Name</span></span>
        <span class=${cx('col-span-3 flex items-end justify-center px-2 pt-1.5 text-[0.8125rem] font-bold leading-tight text-ink-2 group-data-[stuck]:pt-1', GAP)} style=${SHIFT_FILL}>Shift</span>
        ${pools.map((pl, i) => {
          const r = conf[pl.id];
          return html`<button key=${pl.id} class=${cx('col-span-2 flex flex-col items-center px-2 pt-1.5 leading-tight transition active:opacity-60 group-data-[stuck]:pt-1', GAP)} style=${tintOf(i)}
            onClick=${() => App.openPoolSummary(pl.id)} aria-label=${'Open ' + pl.label}>
            <span class="flex items-center gap-0.5 whitespace-nowrap text-[0.8125rem] font-bold" style=${hueOf(i)}>${pl.label}<${Icon} name="chevR" class="size-3 opacity-70" /></span>
            <span class=${cx(extra, 'text-ink-2')}><${Clock} abs=${pl.startAbs} />–<${Clock} abs=${pl.endAbs} /></span>
            <span class=${cx(extra, 'text-ink-3')}>${shortRate(pl.rate)}</span>
            ${pl.support && pl.support.cut > 0 && html`<span class=${cx(extra, SUP_TEXT)}>−${dec2(pl.support.cut)} sup</span>`}
            ${rolesOn && html`<span class=${cx('flex items-center gap-1 py-0.5 group-data-[stuck]:hidden')} aria-label="shared by">
              ${['bartender', 'server', 'support'].filter(k => r[k]).map(k => html`<span key=${k} class=${cx('size-1.5 rounded-full', ROLE_DOT[k])}></span>`)}
            </span>`}
          </button>`;
        })}
        <span class=${cx(head, C, 'row-span-2 pl-3 pr-2')}>Total</span>
        <span class=${cx(head, C, 'row-span-2 pr-3')}>$/h</span>
        <span class=${cx(head, C, GAP, 'px-1.5 pb-1.5')} style=${SHIFT_FILL}>In</span>
        <span class=${cx(head, C, 'px-1.5 pb-1.5')} style=${SHIFT_FILL}>Out</span>
        <span class=${cx(head, C, 'px-1.5 pb-1.5')} style=${SHIFT_FILL}>Hrs</span>
        ${pools.map((pl, i) => html`
          <span key=${pl.id + 'h'} class=${cx(head, C, GAP, 'px-1.5 pb-1.5')} style=${tintOf(i)}>Hrs</span>
          <span key=${pl.id + 't'} class=${cx(head, C, 'px-1.5 pb-1.5')} style=${tintOf(i)}>Tips</span>`)}
      </div>
    </div></div>
    <div ref=${bodyWrap} onScroll=${sync} class="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><div ref=${table} class="grid">
    ${ordered.map((p, n) => html`<div key=${p.id} role="button" class=${cx(FLUSH_ROW, 'min-h-10 transition active:bg-raised', zebra(n))} onClick=${() => App.personModal(p.id)}>
      <span class=${cx(STICKY, 'py-1')}>
        <span class="flex min-w-0 items-center gap-1.5">
          ${tint && html`<${RoleDot} role=${p.role} />`}
          <span class="truncate text-[1rem] font-semibold leading-tight">${p.name}</span>
        </span>
      </span>
      <span class=${cx(C, GAP, 'px-0.5')} style=${SHIFT_FILL}><${StaffTime} vm=${vm} id=${p.id} field="in" cls=${T_PILL} tone=${QUIET} /></span>
      <span class=${cx(C, 'px-0.5')} style=${SHIFT_FILL}><${StaffTime} vm=${vm} id=${p.id} field="out" cls=${T_PILL} tone=${QUIET} /></span>
      <span class=${cx(C, HRS)} style=${SHIFT_FILL}><span class=${isSup(p) ? 'opacity-55' : ''}><${Hrs} value=${p.shiftHours ?? p.hours} /></span></span>
      ${pools.map((pl, i) => {
        if (!conf[pl.id][p.role]) return html`
          <span key=${pl.id + 'h'} class=${cx(GAP)} aria-label=${'not in ' + pl.label}></span>
          <span key=${pl.id + 't'}></span>`;
        const x = p.perPool[pl.id];
        const on = x && x.hours > 0;
        return html`
          <span key=${pl.id + 'h'} class=${cx(C, GAP, HRS)} style=${tintOf(i)}><span class=${isSup(p) ? 'opacity-55' : ''}>${on ? html`<${Hrs} value=${x.hours} />` : '—'}</span></span>
          <span key=${pl.id + 't'} class=${cx(C, num, 'px-1.5 font-semibold', !on ? 'text-ink-3' : isSup(p) ? SUP_TEXT : 'text-ink')} style=${tintOf(i)}>${on ? dec2(x.raw) : '—'}</span>`;
      })}
      <span class=${cx(C, 'pl-3 pr-2')}><${Money} value=${p.final} class=${cx(TIPS_SM, isSup(p) && SUP_TEXT, !(p.final > 0) && 'text-ink-3')} /></span>
      <span class=${cx(C, 'pr-3 text-[0.8125rem] font-medium text-ink-3')}>${net(p)}</span>
    </div>`)}
    <div class=${cx(FLUSH_ROW, 'min-h-11 border-t border-white/12', TOTAL_BG)}>
      <span class=${cx(STICKY, 'text-[1rem] font-bold')}>Total</span>
      <span class=${cx(C, GAP, 'px-0.5')} style=${SHIFT_FILL}><${DefaultTime} vm=${vm} field="in" cls=${T_PILL} /></span>
      <span class=${cx(C, 'px-0.5')} style=${SHIFT_FILL}><${DefaultTime} vm=${vm} field="out" cls=${T_PILL} /></span>
      <span style=${SHIFT_FILL}></span>
      ${pools.map((pl, i) => html`<span key=${pl.id} class=${cx(C, GAP, num, 'col-span-2 px-1.5 font-bold')} style=${tintOf(i)}>${dec2(pl.total)}</span>`)}
      <span class=${cx(C, 'pl-3 pr-2')}><${Money} value=${paidOut} class=${cx(TIPS_SM, 'text-gold')} /></span>
      <span class=${cx(C, 'pr-3 text-[0.8125rem] font-semibold text-ink-2')}>${tippedHours > 0 ? rate2(tippedPaid / tippedHours) : '—'}</span>
    </div>
    <div class=${cx(FLUSH_ROW, 'min-h-8 pb-1', TOTAL_BG)}>
      <span class=${cx(STICKY, 'text-[0.8125rem] font-medium text-ink-3')}>Hours</span>
      <span class=${cx(C, GAP, HRS_TOTAL, 'col-span-3 justify-end')} style=${SHIFT_FILL}><${Hrs} value=${shiftHours} /></span>
      ${pools.map((pl, i) => html`<span key=${pl.id} class=${cx(C, GAP, HRS_TOTAL, 'col-span-2')} style=${tintOf(i)}><${Hrs} value=${pl.tippedHours} /></span>`)}
      <span class=${cx(C, 'pl-3 pr-2', HRS_TOTAL)}><${Hrs} value=${tippedHours} /></span>
      <span></span>
    </div>
  </div></div>
  ${tint && html`<${RoleKey} roles=${roles} />`}
  <//>`;
}

// ── Several pools, one pool's tab ───────────────────────────────────────────
// Who's in that pool: name · In · Out (draggable) · Hrs in the pool · pay from
// it (exact, before rounding). Header = pool + rate (+ support cut, roles that
// share it; those lines hide while stuck); Total row = the pool's window,
// hours (support excluded) and cash.
function PoolTable({ vm, pool, index }) {
  const s = vm.shares;
  const people = payoutOrder(s.perPerson.filter(p => p.perPool[pool.id]?.hours > 0));
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
        <span class="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[.08em] text-ink-3"><${PoolDot} i=${index} /><span class="truncate">${pool.label}</span></span>
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
      <span class="text-[1rem] font-bold">Total</span>
      <span class="text-center text-[0.9375rem] font-semibold"><${Clock} abs=${pool.startAbs} /></span>
      <span class="text-center text-[0.9375rem] font-semibold"><${Clock} abs=${pool.endAbs} /></span>
      ${DASH}
      <span class=${cx(HOURS, 'font-semibold text-ink')}>${fmtHrs(pool.tippedHours)}</span>
      <span class="pl-3 text-center"><${Money} value=${pool.total} class=${cx(TIPS, 'text-gold')} /></span>
    </div>
  </div>${tint && html`<${RoleKey} roles=${roles} />`}<//>`;
}

// One pool: the plain table. Several: the Total table; tapping a pool's
// header opens that pool's own table in a sheet.
function Payouts({ vm, name }) {
  return vm.shares.perPool.length < 2
    ? html`<${SinglePool} vm=${vm} name=${name} />`
    : html`<${TotalTable} vm=${vm} name=${name} />`;
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
  const tool = 'flex h-12 items-center justify-center gap-2.5 rounded-card bg-surface text-[1rem] font-semibold transition active:scale-[.97] active:bg-raised';
  return html`<div class="grid grid-cols-2 gap-2">
    <button class=${tool} onClick=${() => App.openCloseTime()}><${Icon} name="clock" class="size-5 text-ink-2" />Close time</button>
    <button class=${tool} onClick=${() => App.openBonus()}><${Icon} name="gift" class="size-5 text-ink-2" />Bonus</button>
  </div>`;
}

function Summary({ vm, name }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  return html`<div class="flex flex-col gap-4">
    ${vm.shares.perPool.map(p => p.warning).filter(Boolean).map(w => html`<${Alert}>${w}<//>`)}
    <${Payouts} vm=${vm} name=${name} />
    <${Tools} />
  </div>`;
}

export function renderSummary(vm, sessionName = '') {
  lastVm = vm;
  const root = $('summary-root');
  if (root) render(html`<${Summary} vm=${vm} name=${sessionName} />`, root);
  renderPoolSheet(vm);
}
