// Component kit (Preact + htm) — every repeated piece of UI is one component
// here, styled with Tailwind classes. Same design system as barlog: colour
// tokens are CSS variables (css/app.css, light + dark) named in index.html;
// text sizes come from the .t-* scale; accent = tappable / active, good / bad
// = fine / wrong, figures plain ink. Props in, markup out; click handlers are
// plain functions: <${Button} onClick=${() => App.tab('tips')}>Tips<//>.

import { timeParts } from '../time.js';
import { html } from './preact.js';
import { PATHS } from './icons.js';

// Class list builder: cx('a', cond && 'b', ['c', 'd']) → "a b c d".
export const cx = (...xs) => xs.flat(Infinity).filter(Boolean).join(' ');

export const ROLE_TINT = {
  bartender: 'bg-bar/14 text-bar',
  server: 'bg-srv/14 text-srv',
  support: 'bg-sup/14 text-sup',
};
export const ROLE_DOT = { bartender: 'bg-bar', server: 'bg-srv', support: 'bg-sup' };
export const ROLE_TEXT = { bartender: 'text-bar', server: 'text-srv', support: 'text-sup' };
export const ROLE_PLURAL = { bartender: 'Bartenders', server: 'Servers', support: 'Support' };

export function Icon({ name, class: cls = 'size-5' }) {
  return html`<svg class=${cx(cls, 'shrink-0')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }} />`;
}

// A rounded block on the page (groups / cards are `surface`, no borders).
export function Card({ class: cls = '', flush = false, tone = '', children, ...rest }) {
  const toneCls = { error: 'bg-bad/10', gold: 'bg-accent/10', accent: 'bg-accent/10' }[tone] || 'bg-surface';
  return html`<div class=${cx('rounded-card', toneCls, flush ? 'overflow-clip' : 'p-4', cls)} ...${rest}>${children}</div>`;
}

// Standalone group caption (same look as <${Section}>'s title row).
export function Label({ children, aside }) {
  return html`<div class="flex min-h-5 items-end justify-between gap-3 px-4 pt-2">
    <span class="t-cap text-ink-3">${children}</span>
    ${aside && html`<span class="t-small shrink-0 text-ink-3">${aside}</span>`}</div>`;
}

const BTN_VARIANT = {
  primary: 'bg-accent text-on-accent',
  tonal: 'bg-accent/12 text-accent',
  plain: 'bg-surface text-ink',
  danger: 'bg-bad/12 text-bad',
  ghost: 'text-accent',
};
const BTN_SIZE = {
  sm: 'h-8 px-3 rounded-full t-small',
  md: 'h-11 px-4 rounded-xl t-body',
  lg: 'h-12 px-5 rounded-xl t-body',
};

export function Button({ variant = 'plain', size = 'md', block = false, icon, class: cls = '', children, ...rest }) {
  return html`<button class=${cx('inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold transition active:scale-[.98] disabled:opacity-40',
    BTN_VARIANT[variant], BTN_SIZE[size], block && 'w-full', cls)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} class=${size === 'sm' ? 'size-4' : 'size-[1.125rem]'} />`}${children}</button>`;
}

// A clock time: "5:45p" — a slightly smaller lowercase a / p, same weight
// (24-hour: "17:45"). `full`: "5:00 pm" (minutes always, a smaller lowercase am / pm).
// `mins`: always show the minutes ("5:00p") — a column where some time
// has minutes shows them on every row.
export function Clock({ abs, full = false, mins = false }) {
  const t = timeParts(abs);
  if (full) {
    return html`<span class="whitespace-nowrap">${t.h}:${t.m || '00'}${t.ap && html`<span class="ml-[0.2em] text-[0.85em]">${t.ap === 'a' ? 'am' : 'pm'}</span>`}</span>`;
  }
  return html`<span class="whitespace-nowrap">${t.h}${t.m ? ':' + t.m : mins ? ':00' : ''}${t.ap && html`<span class="ml-[0.06em] text-[0.8em]">${t.ap}</span>`}</span>`;
}

export function Money({ value, class: cls = '' }) {
  const v = Number(value) || 0;
  return html`<span class=${cx('whitespace-nowrap tabular-nums', cls)}><small class="mr-px align-[.12em] text-[.68em] font-semibold">$</small>${(v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US')}</span>`;
}

export function Denom({ d, class: cls = '' }) {
  return html`<span class=${cx('denom', cls)} data-d=${d}>$${d}</span>`;
}

export function Alert({ tone = 'error', action, children }) {
  const t = { error: 'bg-bad/10 text-bad', warn: 'bg-warn/12 text-warn', info: 'bg-surface text-ink-2' }[tone];
  return html`<div class=${cx('t-small flex items-start gap-3 rounded-card px-4 py-3 font-medium', t)}>
    ${tone !== 'info' && html`<${Icon} name="alert" class="size-[1.125rem] mt-px" />`}
    <span class="flex-1">${children}</span>
    ${action && html`<button class="shrink-0 font-semibold text-accent" onClick=${action.onClick}>${action.label}</button>`}
  </div>`;
}

export function Empty({ icon = 'dollar', logo = false, title, body, action }) {
  return html`<div class="t-body flex flex-col items-center px-6 pb-10 pt-12 text-center text-ink-3">
    ${logo
      ? html`<img src="icon-192.png" alt="" class="mb-5 size-20 rounded-[1.375rem] shadow-[0_0.75rem_2rem_-0.75rem_rgb(0_0_0/.45)]" />`
      : html`<span class="mb-4 grid size-14 place-items-center rounded-full bg-accent/12 text-accent"><${Icon} name=${icon} class="size-6" /></span>`}
    <div class="t-head mb-1 text-ink">${title}</div>
    <div>${body}</div>
    ${action && html`<div class="mt-6"><${Button} variant="primary" class="min-w-44" onClick=${action.onClick}>${action.label}<//></div>`}
  </div>`;
}

// Blocked / pristine state shared by the result tabs (Summary, Payout): the
// close-out steps as a checklist — Staff → Tips → the payout — each tappable,
// with what's missing (or the error to fix) under it.
export function Blocked({ vm }) {
  const pristine = !vm.hasNamedStaff && vm.totalCash === 0;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const staffOk = vm.hasNamedStaff && vm.blockedTab !== 'staff';
  const tipsOk = vm.totalCash > 0 && vm.blockedTab !== 'tips';
  const err = tab => vm.inputError && vm.blockedTab === tab ? vm.blocked : '';
  const steps = [
    { tab: 'staff', ok: staffOk, title: 'Who worked', sub: err('staff') || (named ? named + ' on shift' : 'Add names and times') },
    { tab: 'tips', ok: tipsOk, title: 'The tips', sub: err('tips') || (vm.totalCash > 0 ? '$' + vm.totalCash.toLocaleString('en-US') + ' in' : 'Enter the cash') },
    { tab: 'payout', ok: false, title: 'Who gets what', sub: 'Payouts and the bills for each envelope' },
  ];
  const next = steps.find(x => !x.ok);
  return html`<div class="flex flex-col gap-4">
    ${pristine && html`<${Empty} logo title="No shift yet" body="Three steps to close out — start with who worked." />`}
    <${List}>${steps.map((x, i) => html`<${Item} key=${x.tab} onClick=${() => App.tab(x.tab === 'payout' ? (next?.tab || 'payout') : x.tab)}
      tone=${x === next ? 'active' : ''}
      lead=${html`<span class=${cx('grid size-8 shrink-0 place-items-center rounded-full text-[0.875rem] font-semibold',
        x.ok ? 'bg-good/15 text-good' : err(x.tab) ? 'bg-bad/12 text-bad' : x === next ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-3')}>
        ${x.ok ? html`<${Icon} name="check" class="size-4" />` : err(x.tab) ? '!' : i + 1}</span>`}
      title=${x.title} sub=${html`<span class=${err(x.tab) ? 'text-bad' : ''}>${x.sub}</span>`} />`)}<//>
  </div>`;
}

// The input tabs end with the next step in the close-out order
// (Staff → Tips → Summary). Shown only once this step is done.
export function NextStep({ label, sub, tab }) {
  return html`<button class="flex w-full items-center gap-3 rounded-card bg-accent px-4 py-3 text-left text-on-accent transition active:scale-[0.98]"
    onClick=${() => App.tab(tab)}>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="t-body font-semibold">${label}</span>
      ${sub && html`<span class="t-small truncate opacity-80">${sub}</span>`}
    </span>
    <${Icon} name="chevR" class="size-5 shrink-0" />
  </button>`;
}

// Boxed input. INPUT sits inside a card (surface-2 fill); INPUT_PAGE stands
// on the page / a sheet (surface fill).
const INPUT_BASE = 'h-11 w-full min-w-0 rounded-xl px-3 text-[1.0625rem] text-ink outline-none transition placeholder:text-ink-3 focus:ring-2 focus:ring-accent/40';
export const INPUT = cx(INPUT_BASE, 'bg-surface-2');
export const INPUT_PAGE = cx(INPUT_BASE, 'bg-surface');

// Segmented control: items [{ value, label }], onChange(value).
export function Seg({ items, value, onChange, size = 'md', class: cls = '' }) {
  const h = size === 'sm' ? 'h-7' : 'h-8';
  return html`<div class=${cx('flex rounded-xl bg-surface-2 p-0.5', cls)} role="tablist">
    ${items.map(it => html`<button key=${it.value} role="tab" aria-selected=${String(it.value === value)} class=${cx(
      't-small flex flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] px-2 font-semibold transition', h,
      it.value === value ? 'bg-raised text-ink shadow-[0_1px_3px_rgb(0_0_0/.14)]' : 'text-ink-3',
    )} onClick=${() => onChange(it.value)}>${it.icon && html`<${Icon} name=${it.icon} class="size-4" />`}${it.label}</button>`)}
  </div>`;
}

// Role toggle chip ("Shared by"): on = accent tint, off = a plain fill.
export function Chip({ on, role, onClick, children }) {
  return html`<button class=${cx(
    't-small inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full font-semibold transition active:scale-95',
    on ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-ink-3',
  )} aria-pressed=${String(!!on)} onClick=${onClick}>
    <span class=${cx('size-2 rounded-full', on ? ROLE_DOT[role] : 'bg-ink-3/50')}></span>${children}</button>`;
}

// Labelled input. Extra props (value, onInput, inputMode …) go to the <input>.
// `page`: the field stands on the page / a sheet, not inside a card.
export function Field({ label, page = false, class: cls = '', inputClass = '', ...input }) {
  return html`<label class=${cx('flex min-w-0 flex-1 flex-col gap-1.5', cls)}>
    <span class="t-small font-medium text-ink-2">${label}</span>
    <input class=${cx(page ? INPUT_PAGE : INPUT, inputClass)} ...${input} />
  </label>`;
}

export const SEP = 'border-t border-line first:border-t-0';

export function SwitchRow({ on, disabled, onClick, label, hint, icon }) {
  return html`<${Item} class="switch-row" role="switch" aria-checked=${String(!!on)} disabled=${disabled} onClick=${onClick}
    icon=${icon} title=${label} sub=${hint} chevron=${false} trail=${html`<span class="switch"></span>`} />`;
}

// Kept for older call sites: an Item with an icon tile and a plain title.
export function ListRow({ onClick, icon, tone = '', chevron = true, aside, children }) {
  return html`<${Item} icon=${icon} tone=${tone} chevron=${chevron} onClick=${onClick} title=${children}
    trail=${aside && html`<span class="t-small text-ink-3">${aside}</span>`} />`;
}

// − value + : a small number control for a row's trail.
export function Stepper({ value, onDec, onInc, decDisabled = false, incDisabled = false, on = false }) {
  const b = 'grid size-8 place-items-center rounded-full bg-surface-2 text-[1.125rem] leading-none text-ink transition active:scale-95 disabled:opacity-30';
  return html`<span class="flex shrink-0 items-center gap-1.5">
    <button class=${b} onClick=${onDec} disabled=${decDisabled} aria-label="Less">−</button>
    <span class=${cx('t-body min-w-8 text-center font-semibold tabular-nums', on ? 'text-accent' : 'text-ink-2')}>${value}</span>
    <button class=${b} onClick=${onInc} disabled=${incDisabled} aria-label="More">+</button>
  </span>`;
}

export function Stat({ label, value, sub, tone = '', big = false }) {
  return html`<div class="rounded-card bg-surface px-4 py-3">
    <div class="t-small font-medium text-ink-3">${label}</div>
    <div class=${cx('font-semibold tracking-tight tabular-nums', big ? 't-display' : 'text-[1.375rem] leading-tight', tone)}>${value}</div>
    ${sub && html`<div class="t-small text-ink-3">${sub}</div>`}
  </div>`;
}

export function Badge({ tone = 'muted', children }) {
  const t = {
    red: 'bg-bad/14 text-bad', green: 'bg-good/14 text-good', amber: 'bg-warn/14 text-warn',
    gold: 'bg-accent/14 text-accent', muted: 'bg-surface-2 text-ink-2',
    bartender: ROLE_TINT.bartender, server: ROLE_TINT.server, support: ROLE_TINT.support,
  }[tone];
  return html`<span class=${cx('t-small inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 font-semibold capitalize', t)}>${children}</span>`;
}

// Rate · Pool · Chump figures for the top of a sheet.
export function LiveStrip({ vm }) {
  if (!vm?.shares || !(vm.totalCash > 0)) return null;
  const sh = vm.shares;
  const money = n => '$' + Number(n).toLocaleString('en-US');
  return html`<${Stats} items=${[
    { label: 'per hour', value: '$' + sh.rate.toFixed(2), tone: 'text-good' },
    { label: 'pool', value: money(sh.totalCash) },
    { label: 'chump', value: sh.leftover > 0 ? money(sh.leftover) : '—', tone: 'text-ink-2' },
  ]} />`;
}

// Bottom-sheet shell: backdrop + sliding sheet with a grab bar, a title and a
// close button; the body (and optional footer) are filled by each sheet's own render.
export function SheetShell({ id, title, tall = false, foot = false }) {
  const backdrop = e => { if (e.target === e.currentTarget) App.closeSheet(id); };
  return html`<div class="sheet-backdrop" id=${id} onClick=${backdrop}>
    <div class=${cx('sheet', tall && 'sheet--tall')} role="dialog" aria-labelledby=${id + '-title'}>
      <div class="flex shrink-0 items-center gap-3 px-4 pb-3 pt-2.5">
        <span class="t-head min-w-0 flex-1 truncate" id=${id + '-title'}>${title}</span>
        <button class="icon-btn" onClick=${() => App.closeSheet(id)} aria-label="Close"><${Icon} name="x" class="size-4" /></button>
      </div>
      <div class="sheet-body" id=${id + '-body'}></div>
      ${foot && html`<div class="sheet-foot" id=${id + '-foot'}></div>`}
    </div>
  </div>`;
}

// ── Layout building blocks (use these before reaching for raw markup) ───────

// A captioned group: small uppercase caption (+ optional aside) above its content.
export function Section({ title, aside, footer, class: cls = '', children }) {
  return html`<section class=${cx('flex flex-col gap-2', cls)}>
    ${(title || aside) && html`<div class="flex min-h-5 items-end justify-between gap-3 px-4">
      <span class="t-cap flex min-w-0 items-center gap-2 text-ink-3">${title}</span>
      ${aside && html`<span class="t-small shrink-0 text-ink-3">${aside}</span>`}
    </div>`}
    ${children}
    ${footer && html`<div class="t-small px-4 text-ink-3">${footer}</div>`}
  </section>`;
}

// ── The two list / table designs ─────────────────────────────────────────────
// 1. LIST — comfortable rows (sessions, pools, tools, settings, quick add,
//    bonus rows): <${List}> holding <${Item}>s. A List is one rounded
//    `surface` group; hairlines between its rows, inset past the lead. One Item:
//      lead (anything) or icon (tile) · title over sub · trail / value · ›
//    `value` = the right-hand figure; `tone`: 'active' (accent wash) or
//    'danger'; children render under the title row (e.g. a Seg).
// 2. TABLE — compact data (envelopes, close-time, swaps, small bills, and the
//    Summary / Staff grids which use the same tokens): <${Table}> below.
export function List({ class: cls = '', children }) {
  return html`<div class=${cx('lgroup flex flex-col', cls)}>${children}</div>`;
}

export function Item({ lead, icon, title, sub, trail, value, valueTone = '', chevron, onClick, tone = '', disabled, class: cls = '', children, ...rest }) {
  const Tag = onClick ? 'button' : 'div';
  const inset = lead ? '4.25rem' : icon ? '3.5rem' : '1rem';
  return html`<${Tag} class=${cx('li flex min-h-12 w-full flex-col justify-center gap-2.5 px-4 py-2.5 text-left disabled:opacity-50',
      tone === 'active' && 'bg-accent/8', cls)} style=${{ '--inset': inset }} onClick=${onClick} disabled=${disabled} ...${rest}>
    <span class="flex w-full items-center gap-3">
      ${icon ? html`<span class=${cx('grid size-8 shrink-0 place-items-center rounded-lg', tone === 'danger' ? 'bg-bad/12 text-bad' : 'bg-surface-2 text-ink-2')}><${Icon} name=${icon} class="size-[1.125rem]" /></span>` : lead}
      <span class="flex min-w-0 flex-1 flex-col">
        <span class=${cx('t-body flex min-w-0 items-center gap-1.5 font-medium', tone === 'danger' && 'text-bad')}>${title}</span>
        ${sub && html`<span class="t-small line-clamp-2 text-ink-3">${sub}</span>`}
      </span>
      ${trail}
      ${value != null && value !== false && html`<span class=${cx('t-body shrink-0 font-semibold tabular-nums', valueTone)}>${value}</span>`}
      ${(chevron ?? !!onClick) && html`<${Icon} name="chevR" class="size-4 shrink-0 text-ink-3/70" />`}
    </span>
    ${children}
  <//>`;
}
// Older name.
export const Row = Item;

// Compact table. cols: [{ label, align: 'left'|'center'|'right', w, head
// (custom header node), onHead, hl (highlight column) }]; rows: [{ key,
// cells: [...], onClick, tone: 'muted' } | { section: 'Label' }]; foot:
// cells for the total row. First column = the label column (left, bold,
// truncates; `stickyFirst` pins it when the table scrolls sideways). Zebra
// rows, a sticky header that shrinks while stuck (ui/sticky.js), total row on
// a surface-2 fill. `fixed` = table-fixed (widths from cols[].w).
export const T_HEAD = 't-cap text-ink-3';
export const TOTAL_FILL = 'bg-surface-2';
export function Table({ cols, rows, foot, fixed = false, stickyFirst = false, scroll = false, class: cls = '', ...rest }) {
  const align = c => ({ left: 'text-left', right: 'text-right' }[c.align] || 'text-center');
  const first = cx('pl-4 pr-2 text-left', stickyFirst && 'sticky left-0 z-[1] bg-inherit');
  const cell = (c, i) => cx('px-1.5 tabular-nums', i === 0 ? first : align(c), i === cols.length - 1 && i > 0 && 'pr-4', c.hl && 'bg-accent/12');
  const table = html`<table class=${cx('t-body w-full border-collapse whitespace-nowrap', fixed && 'table-fixed')}>
      ${fixed && html`<colgroup>${cols.map((c, i) => html`<col key=${i} class=${c.w || ''} />`)}</colgroup>`}
      <thead class="thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--line)]"><tr>
        ${cols.map((c, i) => html`<th key=${i} class=${cx(cell(c, i), T_HEAD, 'h-9 transition-[height] group-data-[stuck]:h-7', c.onHead && 'cursor-pointer', c.hl && 'text-accent')}
          onClick=${c.onHead}>${c.head ?? c.label}</th>`)}
      </tr></thead>
      <tbody>${rows.map((r, n) => r.section
        ? html`<tr key=${'s' + n} class="bg-surface"><td colspan=${cols.length} class="t-cap px-4 pb-1 pt-3 text-ink-3">${r.section}</td></tr>`
        : html`<tr key=${r.key ?? n} class=${cx(zebra(n), r.onClick && 'cursor-pointer transition active:bg-surface-2', r.tone === 'muted' && 'text-ink-2')} onClick=${r.onClick}>
            ${r.cells.map((v, i) => html`<td key=${i} class=${cx(cell(cols[i] || {}, i), 'h-11', i === 0 && 'max-w-[7rem] truncate font-medium')}>${v}</td>`)}
          </tr>`)}</tbody>
      ${foot && html`<tfoot><tr class=${cx('font-semibold', TOTAL_FILL)}>
        ${foot.map((v, i) => html`<td key=${i} class=${cx(cell(cols[i] || {}, i), 'h-12')}>${v}</td>`)}
      </tr></tfoot>`}
    </table>`;
  return html`<${Card} flush class=${cls} ...${rest}><${Sentinel} />${scroll
    ? html`<div class="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${table}</div>` : table}<//>`;
}

// Status card: ok (good) / error (bad) / warn. Tappable with onClick;
// children render under the headline (e.g. the fix steps).
const BANNER = {
  ok: ['bg-good/10', 'bg-good/15 text-good', 'check', 'text-ink-2'],
  error: ['bg-bad/10', 'bg-bad/15 text-bad', 'alert', 'text-bad'],
  warn: ['bg-warn/12', 'bg-warn/20 text-warn', 'alert', 'text-warn'],
};
export function Banner({ tone = 'ok', icon, title, sub, onClick, children }) {
  const [box, dot, ic, subTone] = BANNER[tone];
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class=${cx('flex w-full flex-col gap-3 rounded-card px-4 py-3.5 text-left', box, onClick && 'transition active:scale-[.98]')} onClick=${onClick}>
    <span class="flex w-full items-center gap-3">
      <span class=${cx('grid size-9 shrink-0 place-items-center rounded-full', dot)}><${Icon} name=${icon || ic} class="size-[1.125rem]" /></span>
      <span class="min-w-0 flex-1">
        <span class="t-body block font-semibold text-ink">${title}</span>
        ${sub && html`<span class=${cx('t-small block', subTone)}>${sub}</span>`}
      </span>
      ${onClick && html`<${Icon} name="chevR" class="size-4 text-ink-3" />`}
    </span>
    ${children}
  <//>`;
}

// 2–4 figures side by side in one block, split by hairlines: items [{ label, value, tone }].
export function Stats({ items, class: cls = '' }) {
  return html`<div class=${cx('figures', cls)}>
    ${items.map(it => html`<div key=${it.label} class="flex min-w-0 flex-col items-center px-1.5 text-center">
      <span class=${cx('t-head max-w-full truncate tabular-nums', it.tone)}>${it.value}</span>
      <span class="t-small max-w-full truncate text-ink-3">${it.label}</span>
    </div>`)}
  </div>`;
}

// Summary payouts table: name · In · Out · Hours · Tips. The card
// body is one grid (TABLE) and every row a subgrid of it (TABLE_ROW), so the
// columns line up. Widths are set by useFitColumns (render/summary.js):
// each column's widest cell plus a weighted share of the spare width.
// Header cells use TABLE_HEAD (also Staff's).
export const TABLE = 'grid gap-x-1';
export const TABLE_ROW = 'relative col-span-full grid grid-cols-subgrid items-center px-3 tabular-nums';
export const TABLE_HEAD = 't-cap text-center text-ink-3';

// Every table: zebra rows (ZEBRA on odd rows, a faint tint — no hairlines
// between people) and a sticky header (THEAD after a <Sentinel />; see
// ui/sticky.js — it shrinks while stuck via data-[stuck]: / group-data-[stuck]:).
// Card flush uses overflow-clip (not hidden) so sticky still works inside it.
export const ZEBRA = 'bg-[color-mix(in_srgb,var(--ink)_3%,var(--surface))]';
export const zebra = i => (i % 2 ? ZEBRA : 'bg-surface');
export const THEAD = 'thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--line)] transition-[height,padding] duration-150';
export const Sentinel = ({ cls = '' }) => html`<div class=${cx('thead-sentinel h-0', cls)} aria-hidden="true"></div>`;
