// Home (Preact) — the shift at a glance, for reading only: nothing here
// edits anything (times, cash and tools live on Staff and Tips). Until the
// shift is complete it shows the close-out checklist.
//
//   sub-tabs   Pay    one row per person: name over "5p – 2a · 9.5h", their
//                     take-home; the chump; Total (hours · rate · paid out)
//              Shift  everyone's shift on one time axis
//              Bills  the envelopes, bill by bill; the small bills needed
//              Split  how it was worked out: hours × rate, the rounding,
//                     each pool
//   subpages   a person (take-home, hours, pools, envelope), a pool
//
// Support staff are paid a tip-out off the top, so their hours never count
// in hours totals and their pay shows in the support colour.

import { DENOMS, fmtHrs, fmtMoney } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Delta, Alert, Banner, List, Item, Money, Clock, Blocked, Card, Section, Stats, Table, Denom, Badge, Avatar, RoundIcon, RowLabel,
  THEAD, Sentinel, zebra, ROLE_DOT, ROLE_PLURAL, TOTAL_FILL, hueIndex, hueVar } from '../ui/pkit.js';
import { fmtBreak, nightSpan, AxisLabels, TimeCell, DefaultTime } from './staff.js';
import { DragAmount } from '../ui/dragtime.js';
import { payDelta } from '../ui/changes.js';
import { smallBillsNeeded } from './tabs.js';
import { EnvelopeTable, Worksheet } from './payout.js';
import { currentSub, currentTab, pushPage } from '../ui/nav.js';

const $ = id => document.getElementById(id);

const isSup = p => p.role === 'support';
const SUP_TEXT = 'text-sup';
const r2 = v => (Number(v) || 0).toFixed(2);
const rate2 = r => '$' + (Math.round(r * 100) / 100).toFixed(2);
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + (v ? Math.abs(v).toLocaleString('en-US') : '—');
const POOL_HUES = ['var(--accent)', 'var(--pool-2)', 'var(--pool-3)', 'var(--pool-4)'];
const PoolDot = ({ i }) => html`<span class="inline-block size-2 shrink-0 rounded-full" style=${{ background: POOL_HUES[i % POOL_HUES.length] }}></span>`;
// A pool's round tile for list rows: its first letter on its colour.
const PoolTile = ({ i, label }) => {
  const c = POOL_HUES[i % POOL_HUES.length];
  return html`<span class="grid size-10 shrink-0 place-items-center rounded-full text-[1rem] font-semibold"
    style=${{ background: `color-mix(in srgb, ${c} 20%, transparent)`, color: c }} aria-hidden="true">${(label || '?').trim()[0]?.toUpperCase()}</span>`;
};
// The closer's dot only means something while not everyone closes.
const allClose = vm => vm.shares.perPerson.filter(x => !isSup(x)).every(x => x.closer);
// A person in a table's first column: their small avatar, then the name —
// the same look as a list row.
const NameCell = ({ vm, p }) => html`<span class="inline-flex min-w-0 max-w-full items-center gap-2.5"><${PersonAv} vm=${vm} p=${p} size="sm" /><span class="truncate">${p.name}</span></span>`;
const PersonAv = ({ vm, p, size }) => html`<${Avatar} name=${p.name} i=${hueIndex(vm.state, p.id)} closer=${p.closer && (size === 'lg' || !allClose(vm))} size=${size} />`;
const RoleDot = ({ role }) => html`<span class=${cx('size-2 shrink-0 rounded-full', ROLE_DOT[role])} aria-label=${role}></span>`;
const hoursOf = p => p.shiftHours ?? p.hours;

// Staff-tab order: state order, grouped by role when roles are on.
export function staffOrder(vm, people) {
  if (!vm.state.settings.allRoles) return people;
  const rank = { bartender: 0, server: 1, support: 2 };
  return people.map((p, i) => [p, i]).sort((x, y) => (rank[x[0].role] - rank[y[0].role]) || (x[1] - y[1])).map(x => x[0]);
}
const rolesOf = (vm, people) => {
  const roles = vm.state.settings.allRoles ? ['bartender', 'server', 'support'].filter(r => people.some(p => p.role === r)) : [];
  return { roles, tint: roles.length > 1 };
};
const Times = ({ a, b }) => html`${a == null ? '—' : html`<${Clock} abs=${a} />`} – ${b == null ? '—' : html`<${Clock} abs=${b} />`}`;

// A key under a list: role dots (several roles), closer, the support note.
function Key({ vm, people }) {
  const { roles, tint } = rolesOf(vm, people);
  const items = [
    ...(tint ? roles.map(r => html`<span key=${r} class="inline-flex items-center gap-1.5"><span class=${cx('size-2 rounded-full', ROLE_DOT[r])}></span>${ROLE_PLURAL[r]}</span>`) : []),
    people.some(p => p.closer) && !allClose(vm) && html`<span key="c" class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full bg-bad"></span>Closer</span>`,
    people.some(isSup) && html`<span key="s">Support is a tip-out, not counted in hours</span>`,
  ].filter(Boolean);
  return items.length ? html`<span class="flex flex-wrap items-center gap-x-3 gap-y-1">${items}</span>` : null;
}

// The fewest $10 / $5 / $1s that make every payout exact (under Bills).
function SmallBills({ vm }) {
  const need = (smallBillsNeeded(vm) || []).filter(c => c.n > 0);
  if (!need.length) return null;
  return html`<span>Small bills needed: ${need.map((c, i) => html`${i > 0 && ' · '}<span class="bill-col !font-semibold" data-d=${c.d}>${c.n}</span> × $${c.d}`)}</span>`;
}

// Register over / short (entered on Tips): what it changed.
function AdjustNote({ vm }) {
  if (!vm.sharesBefore) return null;
  const a = vm.adjust;
  return html`<${Banner} tone=${a < 0 ? 'warn' : 'ok'} icon="swap"
    title=${'Register ' + (a < 0 ? 'short ' : 'over ') + fmtMoney(Math.abs(a))}
    sub=${'Tips re-split on ' + fmtMoney(vm.totalCash) + ' (was ' + fmtMoney(vm.totalBefore) + ')'} />`;
}

// ── What changed since you last looked ──────────────────────────────────────
// Home is read-only, so its pay only moves while you're on Staff or Tips.
// Coming back to Home, each amount that moved since Home last showed it
// carries a "+$4" / "−$3" mark (pkit Delta) for MARKS_MS; leaving Home (or
// the marks fading) makes the current amounts the new baseline.
const MARKS_MS = 8000;
let seen = null, marks = null, marksTimer = 0, onHome = false;
const keyOf = p => p.id + ':' + p.name;
function snapPay(vm) {
  const m = {};
  vm.shares.perPerson.forEach(p => { m[keyOf(p)] = p.final; });
  m.$total = vm.shares.perPerson.reduce((t, p) => t + p.final, 0) + vm.shares.leftover;
  return m;
}
function trackMarks(vm) {
  const here = currentTab() === 'home';
  if (vm.blocked || !vm.shares) { if (!here) onHome = false; return; }
  const now = snapPay(vm);
  if (!here) {
    if (onHome) { onHome = false; marks = null; clearTimeout(marksTimer); seen = now; }
    return;
  }
  if (onHome) { seen = now; return; }
  onHome = true;
  marks = null;
  if (seen) {
    const stamp = Date.now(), d = {};
    Object.keys(now).forEach(k => { if (k in seen && now[k] !== seen[k]) d[k] = { v: now[k] - seen[k], kind: 'change', stamp }; });
    if (Object.keys(d).length) marks = d;
  }
  seen = now;
  clearTimeout(marksTimer);
  if (marks) marksTimer = setTimeout(() => { marks = null; if (lastVmRef) renderHome(lastVmRef); }, MARKS_MS);
}
export function resetHomeMarks() { seen = null; marks = null; onHome = false; clearTimeout(marksTimer); }
const markOf = p => marks?.[keyOf(p)] || null;

// Their shift as a thin bar on the night's axis, under their row (read-only:
// the same picture as Home › Shift, small). A placed break is a gap.
function ShiftBar({ vm, p, span }) {
  if (!span || p.inAbs == null || p.outAbs == null || p.outAbs <= p.inAbs) return null;
  const at = t => Math.max(0, Math.min(100, (t - span.a) / (span.b - span.a) * 100));
  const a = at(p.inAbs), b = at(p.outAbs);
  const b0 = p.brkStart == null ? null : at(p.brkStart);
  const b1 = b0 == null ? null : at(p.brkStart + p.brkLen);
  return html`<span aria-hidden="true" class="relative block h-1 w-full rounded-full bg-ink/[.07]">
    <span class="absolute inset-y-0 rounded-full" style=${{ left: a + '%', width: (b - a) + '%', background: hueVar(hueIndex(vm.state, p.id)) }}></span>
    ${b0 != null && b1 > b0 && html`<span class="absolute inset-y-0 bg-[var(--zbase)]" style=${{ left: b0 + '%', width: (b1 - b0) + '%' }}></span>`}
  </span>`;
}

// ── Pay: one row per person ──────────────────────────────────────────────────
// The amount reads like the pool page's: plain "$168" in the row's value
// style (body, semibold, ink; support in its colour) — no small "$", no
// green. A register over / short adds the change under it.
const VALUE = 't-body font-semibold tabular-nums';
function PayValue({ vm, p }) {
  const before = vm.sharesBefore?.perPerson.find(x => x.id === p.id)?.final;
  const ch = before == null ? 0 : p.final - before;
  return html`<span class="flex shrink-0 flex-col items-end leading-tight">
    <span class="flex items-baseline gap-1.5"><${Delta} d=${markOf(p)} /><span class=${cx(VALUE, isSup(p) ? SUP_TEXT : p.final > 0 ? 'text-ink' : 'text-ink-3')}>${fmtMoney(p.final)}</span></span>
    ${vm.sharesBefore && html`<span class=${cx('t-small tabular-nums', ch < 0 ? 'text-bad' : ch > 0 ? 'text-good' : 'text-ink-3')}>${ch ? signed(ch) : 'same'}</span>`}
  </span>`;
}

// Pay as a list (default) or the one-line table — the switch sits in the
// caption band (settings.show.payTable, remembered for every session).
const payTable = vm => !!vm.state.settings.show?.payTable;
function ViewSwitch({ vm, count }) {
  const t = payTable(vm);
  return html`<span class="flex items-center gap-2">${count}
    <button class="-my-2 -mr-2 grid size-9 place-items-center rounded-full text-accent active:bg-surface-2" onClick=${() => App.toggleShow('payTable')}
      aria-label=${t ? 'Show as a list' : 'Show as a table'}><${Icon} name=${t ? 'list' : 'table'} class="size-5" /></button></span>`;
}

// The one-line table: Name · In · Out · Hrs · Tips, every part in its own
// column so the times, hours and amounts line up down the page.
// The table is the one place Home edits, live: each In / Out is the same
// keypad cell as Staff's (tap → keypad, hold → wheel; Next walks In → Out →
// the next person), the Total row's times are the shift's open / close, and
// with one pool the Total's tips are a tap-or-hold amount ($1 a row on the
// wheel). While a cell or the wheel is moving, the tips preview the change
// (payDelta); otherwise they carry the marks from your last visit.
// Times as plain text — "5", "2", "11:30" (no a / p, no :00 on the hour) —
// in the name's weight; the box only shows while it's being edited / held.
const CELL = 'h-8 w-full rounded-md text-[1rem] tabular-nums transition';
const TIME_TONE = set => (set ? 'text-ink' : 'text-ink-3');
function PayTable({ vm, people, total, hours }) {
  const s = vm.shares;
  const raw = id => vm.state.staff.find(x => x.id === id);
  const cell = (p, field) => (raw(p.id) ? html`<${TimeCell} vm=${vm} p=${raw(p.id)} field=${field} cls=${CELL} bare tone=${TIME_TONE} />` : '—');
  const money = (v, d, cls = '') => html`<span class="inline-flex items-baseline justify-end gap-1"><${Delta} d=${d} /><span class=${cx(VALUE, cls)}>${fmtMoney(v)}</span></span>`;
  const onePool = vm.state.pools.length === 1;
  const tipsTotal = onePool
    ? html`<span class="inline-flex items-baseline justify-end gap-1"><${Delta} d=${payDeltaSum(vm, total) || marks?.$total} />
        <${DragAmount} plain value=${total} min=${0} label="Tips total" cls="-mr-1.5" moneyCls=${VALUE}
          onSet=${v => App.nudgeCash(v - total)} onPreview=${v => App.previewCash(v == null ? null : v - total)}
          onTap=${() => App.tab('tips', { sub: 'cash' })} /></span>`
    : money(total, marks?.$total);
  return html`<${Table} fixed
    cols=${[{ label: 'Name', w: 'w-[38%]' }, { label: 'In', w: 'w-[15%]' }, { label: 'Out', w: 'w-[15%]' }, { label: 'Hrs', w: 'w-[10%]' }, { label: 'Tips', align: 'right', w: 'w-[22%]' }]}
    rows=${[
      ...people.map(p => ({ key: p.id, onClick: () => openPerson(p.id),
        cells: [html`<${NameCell} vm=${vm} p=${p} />`, cell(p, 'in'), cell(p, 'out'),
          html`<span class=${isSup(p) ? 'text-ink-3' : ''}>${fmtHrs(hoursOf(p))}</span>`,
          money(p.final, payDelta(vm, p.id, p.final) || markOf(p), isSup(p) ? SUP_TEXT : '')] })),
      ...(s.leftover > 0 ? [{ key: 'chump', cells: [html`<${RowLabel} icon="cash">Chump<//>`, '', '', '', money(s.leftover, null)] }] : []),
    ]}
    foot=${[html`<${RowLabel}>Total<//>`,
      html`<${DefaultTime} vm=${vm} field="in" cls=${CELL} tone="text-ink" bare />`,
      html`<${DefaultTime} vm=${vm} field="out" cls=${CELL} tone="text-ink" bare />`,
      fmtHrs(hours), tipsTotal]} />`;
}
// The total's change while a preview runs: everyone's pay plus the chump.
const payDeltaSum = (vm, now) => {
  if (!vm.preview) return null;
  const b = vm.preview.base;
  const was = Object.values(b.pay).reduce((t, x) => t + x, 0) + (b.chump || 0);
  const v = Math.round((now - was) * 100) / 100;
  return v ? { v, kind: 'preview', stamp: 0 } : null;
};

function Pay({ vm, name }) {
  const s = vm.shares;
  const people = staffOrder(vm, s.perPerson);
  const { tint } = rolesOf(vm, people);
  const hours = people.filter(p => !isSup(p)).reduce((t, p) => t + hoursOf(p), 0);
  // The total is all the cash: everyone's take-home plus the chump.
  const total = people.reduce((t, p) => t + p.final, 0) + s.leftover;
  const before = vm.sharesBefore && vm.sharesBefore.perPerson.reduce((t, p) => t + p.final, 0) + vm.sharesBefore.leftover;
  const R = vm.resolved;
  const count = people.length + (people.length === 1 ? ' person' : ' people');
  const span = nightSpan(vm);
  if (payTable(vm)) return html`<${Section} title=${name || 'Payouts'} aside=${html`<${ViewSwitch} vm=${vm} count=${count} />`}
    footer=${html`<${Key} vm=${vm} people=${people} />`}>
    <${PayTable} vm=${vm} people=${people} total=${total} hours=${hours} />
  <//>`;
  return html`<${Section} title=${name || 'Payouts'} aside=${html`<${ViewSwitch} vm=${vm} count=${count} />`}
    footer=${html`<${Key} vm=${vm} people=${people} />`}>
    <${List}>
      ${people.map(p => html`<${Item} key=${p.id} onClick=${() => openPerson(p.id)} lead=${html`<${PersonAv} vm=${vm} p=${p} />`}
        title=${html`${tint && html`<${RoleDot} role=${p.role} />`}<span class="truncate">${p.name}</span>`}
        sub=${html`<span class="tabular-nums"><${Times} a=${p.inAbs} b=${p.outAbs} /> · ${fmtHrs(hoursOf(p))}h</span>`}
        trail=${html`<${PayValue} vm=${vm} p=${p} />`}>
        <div class="-mt-1 pl-[3.25rem]"><${ShiftBar} vm=${vm} p=${p} span=${span} /></div>
      <//>`)}
      ${s.leftover > 0 && html`<${Item} lead=${html`<${RoundIcon} name="cash" />`} title="Chump" sub="Left after rounding · stays in the drawer"
        value=${fmtMoney(s.leftover)} />`}
      <${Item} class=${TOTAL_FILL} lead=${html`<${RoundIcon} name="sigma" />`} title="Total"
        sub=${html`<span class="tabular-nums"><${Times} a=${R?.anchorAbs} b=${R?.closeAbs} /> · ${fmtHrs(hours)}h · ${rate2(s.rate)}/h</span>`}
        trail=${html`<span class="flex shrink-0 flex-col items-end leading-tight">
          <span class="flex items-baseline gap-1.5"><${Delta} d=${marks?.$total} /><span class=${VALUE}>${fmtMoney(total)}</span></span>
          ${before != null && html`<span class="t-small tabular-nums text-ink-3">was ${fmtMoney(before)}</span>`}
        </span>`} />
    <//>
  <//>`;
}

// ── Shift: everyone on one time axis ─────────────────────────────────────────
function Shift({ vm }) {
  const span = nightSpan(vm);
  const people = staffOrder(vm, vm.shares.perPerson);
  if (!span) return html`<${Alert} tone="info">Set valid shift times to see the timeline.<//>`;
  const at = t => Math.max(0, Math.min(100, (t - span.a) / (span.b - span.a) * 100));
  return html`<${Section} title="Shift" footer="The red mark is the close. A striped gap is a break with a start time; one without counts in the hours only.">
    <div class="-mx-[var(--gutter)]">
      <${Sentinel} />
      <div class=${cx(THEAD, 'px-4 py-2')}><${AxisLabels} span=${span} /></div>
      ${people.map(p => {
        const start = p.inAbs == null ? null : at(p.inAbs), end = p.outAbs == null ? null : at(p.outAbs);
        const b0 = p.brkStart == null ? null : at(p.brkStart);
        const b1 = b0 == null ? null : at(p.brkStart + p.brkLen);
        return html`<button key=${p.id} class="flex w-full flex-col gap-2 border-b border-line px-4 py-2.5 text-left transition active:bg-surface-2" onClick=${() => openPerson(p.id)}>
          <span class="flex w-full items-center gap-2.5">
            <${PersonAv} vm=${vm} p=${p} size="sm" />
            <span class="t-body flex min-w-0 flex-1 items-center gap-1.5"><span class="truncate">${p.name}</span></span>
            <span class="t-small shrink-0 tabular-nums text-ink-3"><${Times} a=${p.inAbs} b=${p.outAbs} /> · ${fmtHrs(hoursOf(p))}h</span>
          </span>
          <span aria-hidden="true" class="relative block h-3 w-full rounded-full bg-ink/[.07]">
            ${start != null && end != null && end > start && html`<span class="absolute inset-y-0 rounded-full" style=${{ left: start + '%', width: (end - start) + '%', background: hueVar(hueIndex(vm.state, p.id)) }}></span>`}
            ${b0 != null && b1 > b0 && html`<span class="absolute inset-y-0" style=${{ left: b0 + '%', width: (b1 - b0) + '%', backgroundImage: 'repeating-linear-gradient(135deg, var(--bg) 0 2px, transparent 2px 4px)', backgroundColor: 'color-mix(in srgb, var(--bg) 60%, transparent)' }}></span>`}
            ${span.close != null && html`<span class="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-bad/70" style=${{ left: at(span.close) + '%' }}></span>`}
          </span>
        </button>`;
      })}
    </div>
  <//>`;
}

// ── Bills: the envelopes ─────────────────────────────────────────────────────
function Bills({ vm }) {
  const ok = vm.dist && !vm.dist.error;
  return html`<div class="flex flex-col gap-3">
    ${!ok && html`<${Alert} tone="warn" action=${{ label: 'Drawer', onClick: () => App.tab('tips', { sub: 'drawer' }) }}>The bills don’t work out yet — Tips › Drawer has the fix.<//>`}
    <${Section} title="Envelopes" footer=${html`<${SmallBills} vm=${vm} />`}>
      <${EnvelopeTable} vm=${vm} order=${staffOrder(vm, vm.shares.perPerson)} quiet onRow=${id => openPerson(id)}
        byPerson=${ok ? vm.dist.byPerson : {}} remBills=${ok ? vm.dist.remainderBills : {}} />
    <//>
  </div>`;
}

// ── Split: hours × rate, the rounding, the pools ────────────────────────────
function MathTable({ vm }) {
  const s = vm.shares;
  const people = staffOrder(vm, s.perPerson);
  const dash = html`<span class="text-ink-3/50">—</span>`;
  const round = p => {
    const d = p.final - p.exact;
    if (Math.abs(d) < 0.005) return dash;
    return d > 0 ? html`<span class=" text-good">+${r2(d)}</span>` : html`<span class="text-ink-3">−${r2(-d)}</span>`;
  };
  const paid = people.reduce((t, p) => t + p.final, 0);
  return html`<${Section} title="Each person" footer=${'Hours × rate = the exact share, rounded down to whole dollars; + is a closer bonus' + (s.perPool.length > 1 ? '. With several pools the rate is the blend.' : '.')}>
    <${Table} scroll stickyFirst
      cols=${[{ label: 'Name' }, { label: 'Hrs' }, { label: 'Rate' }, { label: 'Exact', align: 'right' }, { label: 'Round', align: 'right' }, { label: 'Tips', align: 'right' }]}
      rows=${people.map(p => ({ key: p.id, onClick: () => openPerson(p.id), tone: isSup(p) ? 'muted' : '',
        cells: [html`<${NameCell} vm=${vm} p=${p} />`,
          fmtHrs(p.hours), p.hours > 0 ? r2(p.exact / p.hours) : dash, r2(p.exact), round(p),
          html`<${Money} value=${p.final} class=${cx('font-semibold', isSup(p) && SUP_TEXT)} />`] }))}
      foot=${[html`<${RowLabel}>Total<//>`, fmtHrs(s.totalHours), r2(s.rate), r2(s.totalCash), s.leftover > 0 ? html`<span class="text-ink-2">−${s.leftover}</span>` : dash, html`<${Money} value=${paid} />`]} />
  <//>`;
}

// Several pools: what each pool paid each person (scrolls sideways, names
// pinned). Blank = their role isn't in that pool; — = didn't work its window.
function PoolGrid({ vm }) {
  const s = vm.shares;
  const pools = s.perPool;
  const people = staffOrder(vm, s.perPerson.filter(p => p.final > 0 || Object.values(p.perPool || {}).some(x => x.hours > 0)));
  const roleIn = (pl, p) => {
    const st = vm.state.pools.find(x => x.id === pl.id);
    if (!st) return true;
    return isSup(p) ? !!st.includeSupport : !!st.roles?.[p.role];
  };
  const TH = 'px-3 pb-2 pt-2.5 font-normal';
  const TD = 'whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums';
  const SEP = '';
  const NAME = 'sticky left-0 z-[1] bg-inherit pl-4 pr-2 text-left';
  const Two = ({ top, sub, subCls = 'text-ink-3' }) => html`<span class="block leading-tight">${top}</span><span class=${cx('t-small block', subCls)}>${sub}</span>`;
  const paid = people.reduce((t, p) => t + p.final, 0);
  return html`<${Section} title="By pool" footer="Each pool: what it paid · their hours in it (exact, before rounding). Blank = their role isn’t in that pool · — = didn’t work its window.">
    <div class="page-table"><div class="overflow-x-auto [scrollbar-width:thin]">
      <table class="min-w-full border-separate border-spacing-0 text-[1rem]">
        <thead><tr class="bg-surface shadow-[0_1px_0_var(--line)]">
          <th class=${cx(NAME, TH, 't-cap z-[2] align-bottom text-ink-3')}>Name</th>
          ${pools.map((pl, i) => html`<th key=${pl.id} class=${cx(TH, SEP, 'text-right')}>
            <span class="inline-flex flex-col items-end">
              <span class="t-small inline-flex items-center gap-1.5 font-semibold text-ink"><${PoolDot} i=${i} />${pl.label}</span>
              <span class="whitespace-nowrap text-[0.6875rem] tabular-nums text-ink-3">${rate2(pl.rate)}/h</span>
            </span></th>`)}
          <th class=${cx(TH, SEP, 'pr-4 text-right align-bottom')}><span class="t-small font-semibold text-ink">Total</span></th>
        </tr></thead>
        <tbody>
          ${people.map((p, i) => html`<tr key=${p.id} class=${cx(zebra(i), 'cursor-pointer active:brightness-95')} onClick=${() => openPerson(p.id)}>
            <td class=${cx(NAME, 'py-2 align-middle')}><span class="flex max-w-[10rem]"><${NameCell} vm=${vm} p=${p} /></span></td>
            ${pools.map(pl => {
              const x = p.perPool?.[pl.id];
              return html`<td key=${pl.id} class=${cx(TD, SEP, isSup(p) && SUP_TEXT)}>${x ? html`<${Two} top=${r2(x.raw)} sub=${fmtHrs(x.hours) + 'h'} />`
                : roleIn(pl, p) ? html`<span class="block leading-tight text-ink-3">—</span>` : ''}</td>`;
            })}
            <td class=${cx(TD, SEP, 'pr-4')}><${Two} top=${html`<${Money} value=${p.final} class=${cx('font-semibold', isSup(p) && SUP_TEXT)} />`} sub=${fmtHrs(Object.values(p.perPool || {}).reduce((t, x) => t + x.hours, 0)) + 'h'} /></td>
          </tr>`)}
        </tbody>
        <tfoot><tr class=${TOTAL_FILL}>
          <td class=${cx(NAME, 'py-2.5 align-middle')}><${RowLabel}>Total<//></td>
          ${pools.map(pl => html`<td key=${pl.id} class=${cx(TD, SEP, 'py-2.5')}><${Two} top=${html`<${Money} value=${pl.total} class="font-semibold" />`} sub=${fmtHrs(pl.tippedHours) + 'h'} subCls=" text-ink-2" /></td>`)}
          <td class=${cx(TD, SEP, 'py-2.5 pr-4')}><${Money} value=${paid} class="font-semibold" /></td>
        </tr></tfoot>
      </table>
    </div></div>
  <//>`;
}

function PoolRows({ vm }) {
  const pools = vm.shares.perPool;
  return html`<${Section} title="Pools"><${List}>${pools.map((pl, i) => html`<${Item} key=${pl.id}
    lead=${html`<${PoolTile} i=${i} label=${pl.label} />`}
    title=${pl.label} sub=${html`<span class="tabular-nums"><${Times} a=${pl.startAbs} b=${pl.endAbs} /> · ${fmtHrs(pl.tippedHours)}h · ${rate2(pl.rate)}/h</span>`}
    value=${fmtMoney(pl.total)} onClick=${() => openPool(pl.id)} />`)}<//><//>`;
}

function Split({ vm }) {
  const several = vm.shares.perPool.length > 1;
  return html`<div class="flex flex-col gap-5">
    ${several ? html`<${PoolRows} vm=${vm} /><${PoolGrid} vm=${vm} />` : html`<${Worksheet} vm=${vm} />`}
    <${MathTable} vm=${vm} />
  </div>`;
}

// ── The page ─────────────────────────────────────────────────────────────────
function Home({ vm, name }) {
  if (vm.blocked) return html`<${Blocked} vm=${vm} />`;
  const view = currentSub('home');
  return html`<div class="flex flex-col gap-5">
    ${view === 'shift' ? html`<${Shift} vm=${vm} />`
      : view === 'bills' ? html`<${Bills} vm=${vm} />`
      : view === 'split' ? html`<${Split} vm=${vm} />`
      : html`<${Pay} vm=${vm} name=${name} />`}
    <${AdjustNote} vm=${vm} />
    ${vm.shares.perPool.map(p => p.warning).filter(Boolean).map((w, i) => html`<${Alert} key=${i}>${w}<//>`)}
  </div>`;
}

let lastName = '';
let lastVmRef = null;
export function renderHome(vm, sessionName = lastName) {
  lastName = sessionName;
  lastVmRef = vm;
  trackMarks(vm);
  const root = $('home-root');
  if (root) render(html`<${Home} vm=${vm} name=${sessionName} />`, root);
}

// ── Subpages ─────────────────────────────────────────────────────────────────
const Gone = ({ what }) => html`<div class="t-body py-12 text-center text-ink-3">${what} isn’t in the split any more.</div>`;

function PersonView({ vm, id }) {
  const p = !vm.blocked && vm.shares?.perPerson.find(x => x.id === id);
  if (!p) return html`<${Gone} what="This person" />`;
  const bills = vm.dist && !vm.dist.error ? vm.dist.byPerson[p.id] : null;
  const hasBills = bills && DENOMS.some(d => (bills[d] || 0) > 0);
  const before = vm.sharesBefore?.perPerson.find(x => x.id === p.id)?.final;
  const pools = vm.shares.perPool.filter(pl => p.perPool?.[pl.id]?.hours > 0);
  return html`<div class="flex flex-col gap-5">
    <div class="flex items-center gap-4 px-0.5">
      <${PersonAv} vm=${vm} p=${p} size="lg" />
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="t-small text-ink-3">Takes home${before != null ? ' · was ' + fmtMoney(before) : ''}</span>
        <${Money} value=${p.final} class=${cx('t-display', isSup(p) ? SUP_TEXT : 'text-money')} />
      </span>
      <span class="flex shrink-0 flex-col items-end gap-1">
        <${Badge} tone=${p.role}>${p.role}<//>${p.closer && html`<${Badge} tone="red">closer<//>`}
      </span>
    </div>
    <${List}>
      <${Item} icon="clock" title="Shift" value=${html`<span class="tabular-nums"><${Times} a=${p.inAbs} b=${p.outAbs} /></span>`} valueTone="" />
      ${p.brkLen > 0 && html`<${Item} icon="coffee" title="Break" value=${fmtBreak(p.brkLen)} valueTone="" />`}
      <${Item} icon="hourglass" title="Hours" value=${fmtHrs(hoursOf(p))} valueTone="" />
      <${Item} icon="calc" title="Exact share" sub="Hours × rate" value=${'$' + r2(p.exact)} valueTone="" />
      <${Item} icon="dollar" title="Rounded down" value=${'$' + p.base} valueTone="" />
      ${p.bonus > 0 && html`<${Item} icon="gift" title="Closer bonus" sub="Dollars left after rounding" value=${'+$' + p.bonus} valueTone="text-good" />`}
    <//>
    ${pools.length > 1 && html`<${Section} title="Pools"><${List}>${pools.map(pl => html`<${Item} key=${pl.id} title=${pl.label}
      lead=${html`<${PoolTile} i=${vm.shares.perPool.indexOf(pl)} label=${pl.label} />`}
      sub=${fmtHrs(p.perPool[pl.id].hours) + 'h × ' + rate2(pl.rate) + '/h'} value=${'$' + r2(p.perPool[pl.id].raw)} valueTone="" />`)}<//><//>`}
    <${Section} title="Envelope">
      ${hasBills
        ? html`<div class="grid grid-cols-3 gap-1.5">${DENOMS.map(d => html`<div key=${d} class=${cx('flex items-center justify-between rounded-xl bg-surface px-3 py-2.5', !bills[d] && 'opacity-40')}>
            <${Denom} d=${d} /><span class="t-head tabular-nums">${bills[d] || '—'}</span></div>`)}</div>`
        : html`<div class="t-small px-4 text-ink-3">The bills don’t work out yet.</div>`}
    <//>
  </div>`;
}

function PoolView({ vm, id }) {
  const s = !vm.blocked && vm.shares;
  const i = s ? s.perPool.findIndex(p => p.id === id) : -1;
  const pool = i >= 0 ? s.perPool[i] : null;
  if (!pool) return html`<${Gone} what="This pool" />`;
  const people = staffOrder(vm, s.perPerson.filter(p => p.perPool[pool.id]?.hours > 0));
  return html`<div class="flex flex-col gap-5">
    <${Stats} items=${[
      { label: 'Tips', value: fmtMoney(pool.total), tone: 'text-money' },
      { label: 'Hours', value: fmtHrs(pool.tippedHours) },
      { label: 'Rate', value: rate2(pool.rate), tone: 'text-good' },
    ]} />
    <${Section} title=${html`<${PoolDot} i=${i} />${pool.label}`}
      aside=${html`<span class="tabular-nums"><${Times} a=${pool.startAbs} b=${pool.endAbs} /></span>`}
      footer=${pool.support?.cut > 0 ? 'Support’s tip-out (' + fmtMoney(pool.support.cut) + ') comes off the top; the rest is shared by hours. Shares are exact, before rounding.' : 'Shares are exact, before rounding.'}>
      <${List}>${people.length ? people.map(p => html`<${Item} key=${p.id} onClick=${() => openPerson(p.id)} lead=${html`<${PersonAv} vm=${vm} p=${p} />`}
        title=${html`<span class="truncate">${p.name}</span>`}
        sub=${fmtHrs(p.perPool[pool.id].hours) + 'h in this pool'}
        value=${'$' + r2(p.perPool[pool.id].raw)} valueTone=${isSup(p) ? SUP_TEXT : ''} />`)
        : html`<${Item} icon="users" title=${html`<span class="text-ink-3">Nobody worked its window</span>`} />`}<//>
    <//>
  </div>`;
}

export function openPerson(id) {
  pushPage({
    key: 'person:' + id,
    title: lastVmName(id),
    meta: vm => {
      const p = !vm.blocked && vm.shares?.perPerson.find(x => x.id === id);
      return p ? [{ v: fmtMoney(p.final), l: 'takes home' }, { v: fmtHrs(hoursOf(p)), l: 'h', tight: true }] : [];
    },
    body: vm => html`<${PersonView} vm=${vm} id=${id} />`,
  }, 'home');
}
export function openPool(id) {
  pushPage({
    key: 'pool:' + id,
    title: lastPoolName(id),
    meta: vm => {
      const pl = !vm.blocked && vm.shares?.perPool.find(x => x.id === id);
      return pl ? [{ v: fmtMoney(pl.total), l: 'in tips' }, { v: fmtHrs(pl.tippedHours), l: 'h', tight: true }, { v: rate2(pl.rate), l: '/h', tight: true }] : [];
    },
    body: vm => html`<${PoolView} vm=${vm} id=${id} />`,
  }, 'home');
}

// Titles from the latest view model (the page body keeps itself current).
const lastVmName = id => lastVmRef?.state.staff.find(p => p.id === id)?.name || 'Person';
const lastPoolName = id => lastVmRef?.state.pools.find(p => p.id === id)?.label || 'Pool';
