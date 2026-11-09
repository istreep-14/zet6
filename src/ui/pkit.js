// Component kit (Preact + htm) — every repeated piece of UI is one component
// here, styled with Tailwind classes (theme tokens live in index.html's
// @theme block). Props in, markup out; click handlers are plain functions:
// <${Button} onClick=${() => App.tab('tips')}>Tips<//>.

import { timeParts } from '../time.js';
import { html } from './preact.js';
import { PATHS } from './icons.js';

// Class list builder: cx('a', cond && 'b', ['c', 'd']) → "a b c d".
export const cx = (...xs) => xs.flat(Infinity).filter(Boolean).join(' ');

export const ROLE_TINT = {
  bartender: 'bg-bar/20 text-bar',
  server: 'bg-srv/20 text-srv',
  support: 'bg-sup/20 text-sup',
};
export const ROLE_DOT = { bartender: 'bg-bar', server: 'bg-srv', support: 'bg-sup' };
export const ROLE_TEXT = { bartender: 'text-bar', server: 'text-srv', support: 'text-sup' };
export const ROLE_PLURAL = { bartender: 'Bartenders', server: 'Servers', support: 'Support' };

export function Icon({ name, class: cls = 'size-5' }) {
  return html`<svg class=${cx(cls, 'shrink-0')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }} />`;
}

export function Card({ class: cls = '', flush = false, tone = '', children, ...rest }) {
  const toneCls = { error: 'bg-red/12 ring-1 ring-red/30', gold: 'bg-gold/10 ring-1 ring-gold/25' }[tone] || 'bg-surface';
  return html`<div class=${cx('rounded-card', toneCls, flush ? 'overflow-clip' : 'p-4', cls)} ...${rest}>${children}</div>`;
}

// Standalone section heading (same look as <${Section}>'s title row).
export function Label({ children, aside }) {
  return html`<div class="flex min-h-7 items-center justify-between gap-3 px-1 pt-2">
    <span class="text-[0.8125rem] font-bold uppercase tracking-[.08em] text-ink-2">${children}</span>
    ${aside && html`<span class="shrink-0 text-[0.875rem] font-medium text-ink-3">${aside}</span>`}</div>`;
}

const BTN_VARIANT = {
  primary: 'bg-gold text-gold-ink shadow-[0_0.5rem_1.5rem_-0.5rem_rgb(255_210_63/.55)]',
  tonal: 'bg-gold/12 text-gold',
  plain: 'bg-fill text-ink shadow-[inset_0_1px_0_rgb(255_255_255/.06)]',
  danger: 'bg-red/15 text-red',
  ghost: 'text-gold',
};
const BTN_SIZE = {
  md: 'h-12 px-5 rounded-2xl text-[1.0625rem]',
  sm: 'h-9 px-4 rounded-full text-[0.9375rem]',
  lg: 'h-14 px-6 rounded-2xl text-[1.0625rem]',
};

export function Button({ variant = 'plain', size = 'md', block = false, icon, class: cls = '', children, ...rest }) {
  return html`<button class=${cx('inline-flex items-center justify-center gap-2 font-bold tracking-[-.01em] transition active:scale-[.97] disabled:opacity-35',
    BTN_VARIANT[variant], BTN_SIZE[size], block && 'w-full', cls)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} class=${size === 'sm' ? 'size-4' : 'size-5'} />`}${children}</button>`;
}

// A clock time: "5:45p" — a slightly smaller lowercase a / p, same weight
// (24-hour: "17:45").
export function Clock({ abs }) {
  const t = timeParts(abs);
  return html`<span class="whitespace-nowrap">${t.h}${t.m ? ':' + t.m : ''}${t.ap && html`<span class="ml-[0.06em] text-[0.8em]">${t.ap}</span>`}</span>`;
}

export function Money({ value, class: cls = '' }) {
  const v = Number(value) || 0;
  return html`<span class=${cx('whitespace-nowrap tabular-nums', cls)}><small class="mr-px align-[.12em] text-[.68em] font-semibold">$</small>${(v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US')}</span>`;
}

export function Denom({ d, class: cls = '' }) {
  return html`<span class=${cx('denom', cls)} data-d=${d}>$${d}</span>`;
}

export function Alert({ tone = 'error', action, children }) {
  const t = { error: 'bg-red/12 text-red-soft', warn: 'bg-amber/12 text-amber', info: 'bg-surface text-ink-2' }[tone];
  return html`<div class=${cx('flex items-start gap-3 rounded-2xl px-4 py-3 text-[0.9375rem] leading-snug', t)}>
    ${tone !== 'info' && html`<${Icon} name="alert" class="size-5 mt-px" />`}
    <span class="flex-1">${children}</span>
    ${action && html`<button class="shrink-0 font-semibold text-ink underline underline-offset-4" onClick=${action.onClick}>${action.label}</button>`}
  </div>`;
}

export function Empty({ icon = 'dollar', title, body, action }) {
  return html`<div class="flex flex-col items-center px-6 pb-10 pt-16 text-center text-[0.9375rem] leading-relaxed text-ink-2">
    <span class="mb-4 grid size-16 place-items-center rounded-full bg-gold/12 text-gold"><${Icon} name=${icon} class="size-7" /></span>
    <div class="mb-1 text-[1.5rem] font-extrabold tracking-[-.03em] text-ink">${title}</div>
    <div>${body}</div>
    ${action && html`<div class="mt-6"><${Button} variant="primary" class="min-w-44" onClick=${action.onClick}>${action.label}<//></div>`}
  </div>`;
}

// Blocked / pristine state shared by the result tabs (Summary, Payout).
export function Blocked({ vm }) {
  const pristine = !vm.hasNamedStaff && vm.totalCash === 0;
  if (pristine) {
    return html`<${Empty} icon="users" title="No shift yet" body="Add who worked, then enter the tips."
      action=${{ label: 'Add staff', onClick: () => App.tab('staff') }} />`;
  }
  const goTips = /cash|total|count|window|support (%|\$|hours)/i.test(vm.blocked);
  return html`<div class="flex flex-col gap-3">
    <${Alert} action=${{ label: 'Fix →', onClick: () => App.tab(goTips ? 'tips' : 'staff') }}>${vm.blocked}<//>
  </div>`;
}

export const INPUT = 'h-12 w-full min-w-0 rounded-xl bg-fill px-3 text-[1.0625rem] text-ink outline-none transition placeholder:text-ink-3 focus:ring-2 focus:ring-gold';

// Segmented control: items [{ value, label }], onChange(value).
export function Seg({ items, value, onChange, size = 'md', class: cls = '' }) {
  const h = size === 'sm' ? 'h-8 text-[0.875rem]' : 'h-10 text-[0.9375rem]';
  return html`<div class=${cx('flex gap-1 rounded-xl bg-white/[.07] p-1', cls)} role="tablist">
    ${items.map(it => html`<button key=${it.value} role="tab" aria-selected=${String(it.value === value)} class=${cx(
      'flex-1 rounded-lg px-3 font-semibold transition', h,
      it.value === value ? 'bg-ink text-bg shadow-[0_0.125rem_0.625rem_rgb(0_0_0/.45)]' : 'text-ink-2 active:bg-white/10',
    )} onClick=${() => onChange(it.value)}>${it.label}</button>`)}
  </div>`;
}

export function Chip({ on, role, onClick, children }) {
  return html`<button class=${cx(
    'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[0.9375rem] font-semibold transition',
    on ? 'bg-ink text-bg' : 'bg-white/[.07] text-ink-3',
  )} aria-pressed=${String(!!on)} onClick=${onClick}>
    <span class=${cx('size-2 rounded-full', on ? ROLE_DOT[role] : 'bg-ink-3')}></span>${children}</button>`;
}

// Labelled input. Extra props (value, onInput, inputMode …) go to the <input>.
export function Field({ label, class: cls = '', inputClass = '', ...input }) {
  return html`<label class=${cx('flex min-w-0 flex-1 flex-col gap-1.5', cls)}>
    <span class="text-[0.875rem] font-medium text-ink-2">${label}</span>
    <input class=${cx(INPUT, inputClass)} ...${input} />
  </label>`;
}

export const SEP = 'border-t border-sep first:border-t-0';

export function SwitchRow({ on, disabled, onClick, label, hint }) {
  return html`<${Item} class="switch-row" role="switch" aria-checked=${String(!!on)} disabled=${disabled} onClick=${onClick}
    title=${label} sub=${hint} chevron=${false} trail=${html`<span class="switch"></span>`} />`;
}

// Kept for older call sites: an Item with an icon tile and a plain title.
export function ListRow({ onClick, icon, tone = '', chevron = true, aside, children }) {
  return html`<${Item} icon=${icon} tone=${tone} chevron=${chevron} onClick=${onClick} title=${children}
    trail=${aside && html`<span class="text-[0.9375rem] text-ink-2">${aside}</span>`} />`;
}

export function Stepper({ value, onDec, onInc, decDisabled = false, incDisabled = false, on = false }) {
  const b = 'grid size-11 place-items-center rounded-full text-[1.375rem] text-ink transition active:bg-fill disabled:opacity-30';
  return html`<div class="flex items-center rounded-full bg-fill">
    <button class=${b} onClick=${onDec} disabled=${decDisabled} aria-label="Less">−</button>
    <span class=${cx('min-w-8 text-center text-[0.9375rem] font-bold tabular-nums', on ? 'text-gold' : 'text-ink-2')}>${value}</span>
    <button class=${b} onClick=${onInc} disabled=${incDisabled} aria-label="More">+</button>
  </div>`;
}

export function Stat({ label, value, sub, tone = '', big = false }) {
  return html`<div class="rounded-2xl bg-raised px-4 py-3.5">
    <div class="text-[0.8125rem] font-medium text-ink-2">${label}</div>
    <div class=${cx('font-rounded font-bold tracking-tight tabular-nums', big ? 'text-[2.125rem]' : 'text-[1.5rem]', tone)}>${value}</div>
    ${sub && html`<div class="text-[0.8125rem] text-ink-3">${sub}</div>`}
  </div>`;
}

export function Badge({ tone = 'muted', children }) {
  const t = {
    red: 'bg-red/15 text-red', green: 'bg-green/15 text-green', amber: 'bg-amber/15 text-amber',
    gold: 'bg-gold/15 text-gold', muted: 'bg-fill text-ink-2',
    bartender: ROLE_TINT.bartender, server: ROLE_TINT.server, support: ROLE_TINT.support,
  }[tone];
  return html`<span class=${cx('inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[0.75rem] font-semibold capitalize', t)}>${children}</span>`;
}

// Rate · Pool · Chump tiles for the top of a sheet.
export function LiveStrip({ vm }) {
  if (!vm?.shares || !(vm.totalCash > 0)) return null;
  const sh = vm.shares;
  const money = n => '$' + Number(n).toLocaleString('en-US');
  return html`<${Stats} items=${[
    { label: 'per hour', value: '$' + sh.rate.toFixed(2), tone: 'text-green' },
    { label: 'pool', value: money(sh.totalCash) },
    { label: 'chump', value: sh.leftover > 0 ? money(sh.leftover) : '—', tone: 'text-ink-2' },
  ]} />`;
}

// Bottom-sheet shell: backdrop + sliding sheet with a title and close button;
// the body (and optional footer) are filled by each sheet's own render.
export function SheetShell({ id, title, tall = false, foot = false }) {
  const backdrop = e => { if (e.target === e.currentTarget) App.closeSheet(id); };
  return html`<div class="sheet-backdrop" id=${id} onClick=${backdrop}>
    <div class=${cx('sheet', tall && 'sheet--tall')} role="dialog" aria-labelledby=${id + '-title'}>
      <div class="flex shrink-0 items-center gap-2 py-1.5 pl-5 pr-2.5">
        <span class="flex-1 truncate text-[1.5rem] font-extrabold tracking-[-.03em]" id=${id + '-title'}>${title}</span>
        <button class="grid size-12 place-items-center" onClick=${() => App.closeSheet(id)} aria-label="Close">
          <span class="grid size-8 place-items-center rounded-full bg-fill text-ink-2"><${Icon} name="x" class="size-4" /></span>
        </button>
      </div>
      <div class="sheet-body" id=${id + '-body'}></div>
      ${foot && html`<div class="sheet-foot" id=${id + '-foot'}></div>`}
    </div>
  </div>`;
}

// ── Layout building blocks (use these before reaching for raw markup) ───────

// A titled group: small uppercase heading (+ optional aside) above its content.
export function Section({ title, aside, class: cls = '', children }) {
  return html`<section class=${cx('flex flex-col gap-2', cls)}>
    ${(title || aside) && html`<div class="flex min-h-7 items-center justify-between gap-3 px-1">
      <span class="flex min-w-0 items-center gap-2 text-[0.8125rem] font-bold uppercase tracking-[.08em] text-ink-2">${title}</span>
      ${aside && html`<span class="shrink-0 text-[0.875rem] font-medium text-ink-3">${aside}</span>`}
    </div>`}
    ${children}
  </section>`;
}

// ── The two list / table designs ─────────────────────────────────────────────
// 1. LIST — comfortable, multi-line items (sessions, pools, tools, settings,
//    quick add, bonus rows): <${List}> holding <${Item}>s. Items are filled
//    tiles 3px apart (fills, not hairlines); the group's outer corners are the
//    card radius, inner corners small. One Item:
//      lead (anything) or icon (tile) · title over sub · trail / value · ›
//    `value` = the big right-hand number; `tone`: 'active' (gold wash) or
//    'danger'; children render under the title row (e.g. edit buttons).
// 2. TABLE — compact data (envelopes, close-time, swaps, small bills, and the
//    Summary / Staff grids which use the same tokens): <${Table}> below.
export function List({ class: cls = '', children }) {
  return html`<div class=${cx('list-group flex flex-col gap-[3px]', cls)}>${children}</div>`;
}

export function Item({ lead, icon, title, sub, trail, value, valueTone = '', chevron, onClick, tone = '', disabled, class: cls = '', children, ...rest }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class=${cx('li-tile flex min-h-[3.75rem] w-full flex-col justify-center gap-2 px-4 py-2.5 text-left disabled:opacity-60',
      tone === 'active' ? 'bg-[color-mix(in_srgb,var(--color-gold)_9%,var(--color-surface))]' : 'bg-surface',
      onClick && 'transition active:brightness-125', cls)} onClick=${onClick} disabled=${disabled} ...${rest}>
    <span class="flex w-full items-center gap-3">
      ${icon ? html`<span class=${cx('grid size-8 shrink-0 place-items-center rounded-lg', tone === 'danger' ? 'bg-red/15 text-red' : 'bg-white/8 text-ink')}><${Icon} name=${icon} class="size-[1.125rem]" /></span>` : lead}
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class=${cx('flex min-w-0 items-center gap-1.5 text-[1.0625rem] font-semibold leading-tight', tone === 'danger' && 'text-red')}>${title}</span>
        ${sub && html`<span class="line-clamp-2 text-[0.875rem] leading-snug text-ink-2">${sub}</span>`}
      </span>
      ${trail}
      ${value != null && value !== false && html`<span class=${cx('shrink-0 font-rounded text-[1.375rem] font-bold tracking-tight tabular-nums', valueTone)}>${value}</span>`}
      ${(chevron ?? !!onClick) && html`<${Icon} name="chevR" class="size-4 shrink-0 text-ink-3" />`}
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
// a raised fill. `fixed` = table-fixed (widths from cols[].w).
export const T_HEAD = 'text-[0.6875rem] font-bold uppercase tracking-[.08em] text-ink-3';
export const TOTAL_FILL = 'bg-[color-mix(in_srgb,var(--color-raised)_60%,var(--color-surface))]';
export function Table({ cols, rows, foot, fixed = false, stickyFirst = false, scroll = false, class: cls = '', ...rest }) {
  const align = c => ({ left: 'text-left', right: 'text-right' }[c.align] || 'text-center');
  const first = cx('pl-3.5 pr-2 text-left', stickyFirst && 'sticky left-0 z-[1] bg-inherit');
  const cell = (c, i) => cx('px-1.5 tabular-nums', i === 0 ? first : align(c), i === cols.length - 1 && i > 0 && 'pr-3.5', c.hl && 'bg-gold/15');
  const table = html`<table class=${cx('w-full border-collapse whitespace-nowrap text-[0.9375rem]', fixed && 'table-fixed')}>
      ${fixed && html`<colgroup>${cols.map((c, i) => html`<col key=${i} class=${c.w || ''} />`)}</colgroup>`}
      <thead class="thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--color-sep)]"><tr>
        ${cols.map((c, i) => html`<th key=${i} class=${cx(cell(c, i), T_HEAD, 'h-9 font-bold transition-[height] group-data-[stuck]:h-7', c.onHead && 'cursor-pointer', c.hl && 'text-gold')}
          onClick=${c.onHead}>${c.head ?? c.label}</th>`)}
      </tr></thead>
      <tbody>${rows.map((r, n) => r.section
        ? html`<tr key=${'s' + n} class="bg-surface"><td colspan=${cols.length} class="px-3.5 pb-1 pt-3 text-[0.75rem] font-semibold uppercase tracking-[.06em] text-ink-3">${r.section}</td></tr>`
        : html`<tr key=${r.key ?? n} class=${cx(zebra(n), r.onClick && 'cursor-pointer transition active:bg-raised', r.tone === 'muted' && 'text-ink-2')} onClick=${r.onClick}>
            ${r.cells.map((v, i) => html`<td key=${i} class=${cx(cell(cols[i] || {}, i), 'h-11', i === 0 && 'max-w-[7rem] truncate font-semibold')}>${v}</td>`)}
          </tr>`)}</tbody>
      ${foot && html`<tfoot><tr class=${cx('border-t border-white/12 font-bold', TOTAL_FILL)}>
        ${foot.map((v, i) => html`<td key=${i} class=${cx(cell(cols[i] || {}, i), 'h-12')}>${v}</td>`)}
      </tr></tfoot>`}
    </table>`;
  return html`<${Card} flush class=${cls} ...${rest}><${Sentinel} />${scroll
    ? html`<div class="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${table}</div>` : table}<//>`;
}

// Status card: ok (green) / error (red) / warn (amber). Tappable with onClick;
// children render under the headline (e.g. the fix steps).
const BANNER = {
  ok: ['bg-green/10 ring-green/25', 'bg-green/20 text-green', 'check', 'text-ink-2'],
  error: ['bg-red/12 ring-red/30', 'bg-red/20 text-red', 'alert', 'text-red-soft'],
  warn: ['bg-amber/10 ring-amber/25', 'bg-amber/20 text-amber', 'alert', 'text-amber'],
};
export function Banner({ tone = 'ok', icon, title, sub, onClick, children }) {
  const [box, dot, ic, subTone] = BANNER[tone];
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class=${cx('flex w-full flex-col gap-3 rounded-card px-4 py-3.5 text-left ring-1', box, onClick && 'transition active:scale-[.98]')} onClick=${onClick}>
    <span class="flex w-full items-center gap-3">
      <span class=${cx('grid size-9 shrink-0 place-items-center rounded-full', dot)}><${Icon} name=${icon || ic} class="size-[1.125rem]" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-[1rem] font-semibold leading-snug text-ink">${title}</span>
        ${sub && html`<span class=${cx('block text-[0.875rem] leading-snug', subTone)}>${sub}</span>`}
      </span>
      ${onClick && html`<${Icon} name="chevR" class="size-5 text-ink-3" />`}
    </span>
    ${children}
  <//>`;
}

// A row of equal stat tiles: items [{ label, value, tone }].
export function Stats({ items, class: cls = '' }) {
  return html`<div class=${cx('grid gap-2', cls)} style=${{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
    ${items.map(it => html`<div key=${it.label} class="flex min-w-0 flex-col items-center gap-0.5 rounded-2xl bg-white/[.06] px-2 py-2.5">
      <span class=${cx('max-w-full truncate font-rounded text-[1.25rem] font-bold leading-tight tabular-nums', it.tone)}>${it.value}</span>
      <span class="text-[0.75rem] font-medium text-ink-2">${it.label}</span>
    </div>`)}
  </div>`;
}

// Summary payouts table: avatar · name · In · Out · Hours · Tips. The card
// body is one grid (TABLE) and every row a subgrid of it (TABLE_ROW), so the
// columns line up. Widths are set by useFitColumns (render/summary.js):
// each column's widest cell plus a weighted share of the spare width.
// Header cells use TABLE_HEAD (also Staff's).
export const TABLE = 'grid gap-x-1';
export const TABLE_ROW = 'relative col-span-full grid grid-cols-subgrid items-center px-3 tabular-nums';
export const TABLE_HEAD = 'text-center text-[0.6875rem] font-bold uppercase tracking-[.08em] text-ink-3';

// Every table: zebra rows (ZEBRA on odd rows, a faint lift — no hairlines
// between people) and a sticky header (THEAD after a <Sentinel />; see
// ui/sticky.js — it shrinks while stuck via data-[stuck]: / group-data-[stuck]:).
// Card flush uses overflow-clip (not hidden) so sticky still works inside it.
export const ZEBRA = 'bg-[color-mix(in_srgb,white_3.5%,var(--color-surface))]';
export const zebra = i => (i % 2 ? ZEBRA : 'bg-surface');
export const THEAD = 'thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--color-sep)] transition-[height,padding] duration-150';
export const Sentinel = ({ cls = '' }) => html`<div class=${cx('thead-sentinel h-0', cls)} aria-hidden="true"></div>`;
