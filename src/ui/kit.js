// Component kit — every repeated piece of UI is one function here, styled
// with Tailwind classes (theme tokens live in index.html's @theme block).
// Change a component once and every screen that uses it follows.
//
// Conventions: components return html`` values; the first argument is an
// options object, the last is the content. Inline handlers are strings that
// call window.App.* (module functions aren't global).

import { html, raw, cx, esc } from './html.js';
import { icon } from './icons.js';
import { fmtHrs } from '../util.js';

// ── Shared style tokens ──────────────────────────────────────────────────────

export const INPUT = 'h-12 w-full min-w-0 rounded-xl bg-fill px-3 text-[17px] text-ink outline-none transition placeholder:text-ink-3 focus:ring-2 focus:ring-gold';
export const PRESS = 'transition active:scale-[.97]';

export const ROLE_TINT = {
  bartender: 'bg-bar/20 text-bar',
  server: 'bg-srv/20 text-srv',
  support: 'bg-sup/20 text-sup',
};
export const ROLE_DOT = { bartender: 'bg-bar', server: 'bg-srv', support: 'bg-sup' };
export const ROLE_TEXT = { bartender: 'text-bar', server: 'text-srv', support: 'text-sup' };
export const ROLE_PLURAL = { bartender: 'Bartenders', server: 'Servers', support: 'Support' };
export const ROLE_ONE = { bartender: 'bartender', server: 'server', support: 'support' };

// Attribute object → ` key="value"` string. true → bare attribute; false/null → skipped.
export function attrs(obj = {}) {
  return raw(Object.entries(obj).map(([k, v]) => {
    if (v == null || v === false) return '';
    if (v === true) return ' ' + k;
    return ` ${k}="${esc(v)}"`;
  }).join(''));
}

export const initials = name =>
  String(name).split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

// ── Layout ───────────────────────────────────────────────────────────────────

export function Card({ class: cls = '', flush = false, tone = '', ...rest } = {}, ...body) {
  const toneCls = {
    error: 'bg-red/12 ring-1 ring-red/30',
    gold: 'bg-gold/10 ring-1 ring-gold/25',
  }[tone] || 'bg-surface';
  return html`<div class="${cx('rounded-card', toneCls, flush ? 'overflow-hidden' : 'p-4', cls)}"${attrs(rest)}>${body}</div>`;
}

// Small uppercase label above a group.
export function Label(text, aside = '') {
  return html`<div class="flex items-baseline justify-between gap-2 px-1 pt-3 text-[12px] font-bold uppercase tracking-[.09em] text-ink-3">
    <span>${text}</span>${aside ? html`<span class="normal-case tracking-normal font-medium">${aside}</span>` : ''}</div>`;
}

// Hairline between rows inside a flush card.
export const SEP = 'border-t border-sep first:border-t-0';

// ── Controls ─────────────────────────────────────────────────────────────────

const BTN_VARIANT = {
  primary: 'bg-gold text-gold-ink shadow-[0_8px_24px_-8px_rgb(255_210_63/.55)]',
  tonal: 'bg-gold/12 text-gold',
  plain: 'bg-fill text-ink shadow-[inset_0_1px_0_rgb(255_255_255/.06)]',
  danger: 'bg-red/15 text-red',
  ghost: 'text-gold',
  surface: 'bg-surface text-ink',
};
const BTN_SIZE = {
  md: 'h-12 px-5 rounded-2xl text-[17px]',
  sm: 'h-9 px-4 rounded-full text-[15px]',
  lg: 'h-14 px-6 rounded-2xl text-[17px]',
};

export function Button({ variant = 'plain', size = 'md', block = false, icon: ic, class: cls = '', ...rest } = {}, label = '') {
  return html`<button class="${cx(
    'inline-flex items-center justify-center gap-2 font-bold tracking-[-.01em] disabled:opacity-35',
    PRESS, BTN_VARIANT[variant], BTN_SIZE[size], block && 'w-full', cls,
  )}"${attrs(rest)}>${ic ? icon(ic, size === 'sm' ? 'size-4' : 'size-5') : ''}${label}</button>`;
}

export function IconButton({ icon: ic, label, class: cls = '', ...rest }) {
  return html`<button class="${cx('grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition active:bg-fill', cls)}" aria-label="${label}"${attrs(rest)}>${icon(ic, 'size-[22px]')}</button>`;
}

// Segmented control. items: [{ value, label }], handler(value) → onclick string.
export function Seg({ items, value, handler, size = 'md', class: cls = '' }) {
  const h = size === 'sm' ? 'h-8 text-[14px]' : 'h-10 text-[15px]';
  return html`<div class="${cx('flex gap-1 rounded-xl bg-fill-2 p-1', cls)}" role="tablist">
    ${items.map(it => html`<button role="tab" aria-selected="${String(it.value === value)}" class="${cx(
      'flex-1 rounded-lg px-3 font-semibold transition', h,
      it.value === value ? 'bg-high text-ink shadow-[0_2px_8px_rgb(0_0_0/.4),inset_0_1px_0_rgb(255_255_255/.08)]' : 'text-ink-2',
    )}" onclick="${handler(it.value)}">${it.label}</button>`)}
  </div>`;
}

// Toggle chip with a role-coloured dot.
export function Chip({ on, role, onclick }, label) {
  return html`<button class="${cx(
    'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition',
    on ? 'bg-high text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)]' : 'bg-fill-2 text-ink-2',
  )}" aria-pressed="${String(!!on)}" onclick="${onclick}">
    <span class="${cx('size-2 rounded-full', on ? ROLE_DOT[role] : 'bg-ink-3')}"></span>${label}</button>`;
}

export function Stepper({ value, dec, inc, decDisabled = false, incDisabled = false, on = false }) {
  const b = 'grid size-11 place-items-center rounded-full text-[22px] text-ink transition active:bg-fill disabled:opacity-30';
  return html`<div class="flex items-center rounded-full bg-fill">
    <button class="${b}" onclick="${dec}" ${decDisabled ? 'disabled' : ''} aria-label="Less">−</button>
    <span class="${cx('min-w-8 text-center text-[15px] font-bold tabular-nums', on ? 'text-gold' : 'text-ink-2')}">${value}</span>
    <button class="${b}" onclick="${inc}" ${incDisabled ? 'disabled' : ''} aria-label="More">+</button>
  </div>`;
}

// Labelled input. Remaining options become input attributes.
export function Field({ label, class: cls = '', inputClass = '', ...input }) {
  return html`<label class="${cx('flex min-w-0 flex-1 flex-col gap-1.5', cls)}">
    <span class="text-[14px] font-medium text-ink-2">${label}</span>
    <input class="${cx(INPUT, inputClass)}"${attrs(input)}>
  </label>`;
}

export function SwitchRow({ id, on, disabled, onclick, label, hint }) {
  return html`<button class="${cx('switch-row flex min-h-16 w-full items-center gap-4 px-4 py-2.5 text-left disabled:opacity-60', SEP)}"
    id="${id}" role="switch" aria-checked="${String(!!on)}" ${disabled ? 'disabled' : ''} onclick="${onclick}">
    <span class="flex flex-1 flex-col gap-0.5 text-[17px]">${label}${hint ? html`<small class="text-[13px] leading-snug text-ink-2">${hint}</small>` : ''}</span>
    <span class="switch"></span>
  </button>`;
}

// Tappable list row inside a flush card.
export function ListRow({ onclick, icon: ic, tone = '', chevron = true }, label, aside = '') {
  return html`<button class="${cx('flex min-h-[54px] w-full items-center gap-3 px-4 text-left text-[17px] transition active:bg-raised', SEP, tone === 'danger' && 'text-red')}" onclick="${onclick}">
    ${ic ? html`<span class="${cx('grid size-8 place-items-center rounded-lg', tone === 'danger' ? 'bg-red/15' : 'bg-white/8 text-ink')}">${icon(ic, 'size-[18px]')}</span>` : ''}
    <span class="flex-1">${label}</span>
    ${aside ? html`<span class="text-[15px] text-ink-2">${aside}</span>` : ''}
    ${chevron ? icon('chevR', 'size-4 text-ink-3') : ''}
  </button>`;
}

// ── Display ──────────────────────────────────────────────────────────────────

export function Avatar(name, role, size = 'md') {
  const s = { sm: 'size-7 text-[11px]', md: 'size-9 text-[13px]', lg: 'size-12 text-[17px]', xl: 'size-14 text-[20px]' }[size];
  return html`<span class="${cx('grid shrink-0 place-items-center rounded-full font-bold tracking-wide', s, ROLE_TINT[role] || 'bg-high text-ink')}" aria-hidden="true">${initials(name)}</span>`;
}

export const Dot = role => html`<span class="${cx('inline-block size-2 shrink-0 rounded-full', ROLE_DOT[role] || 'bg-ink-3')}"></span>`;

export function Badge(text, tone = 'muted') {
  const t = {
    red: 'bg-red/15 text-red', green: 'bg-green/15 text-green', amber: 'bg-amber/15 text-amber',
    gold: 'bg-gold/15 text-gold', muted: 'bg-fill text-ink-2',
    bartender: ROLE_TINT.bartender, server: ROLE_TINT.server, support: ROLE_TINT.support,
  }[tone];
  return html`<span class="${cx('inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[12px] font-semibold capitalize', t)}">${text}</span>`;
}

// One-line message with an optional trailing action.
export function Alert({ tone = 'error', action } = {}, text) {
  const t = { error: 'bg-red/12 text-red-soft', warn: 'bg-amber/12 text-amber', info: 'bg-surface text-ink-2' }[tone];
  return html`<div class="${cx('flex items-start gap-3 rounded-2xl px-4 py-3 text-[15px] leading-snug', t)}">
    ${tone !== 'info' ? icon('alert', 'size-5 mt-px') : ''}
    <span class="flex-1">${text}</span>
    ${action ? html`<button class="shrink-0 font-semibold text-ink underline underline-offset-4" onclick="${action.onclick}">${action.label}</button>` : ''}
  </div>`;
}

export function Empty({ icon: ic = 'dollar', title, body, action }) {
  return html`<div class="flex flex-col items-center px-6 pb-10 pt-16 text-center text-[15px] leading-relaxed text-ink-2">
    <span class="mb-4 grid size-16 place-items-center rounded-full bg-gold/12 text-gold">${icon(ic, 'size-7')}</span>
    <div class="mb-1 text-[24px] font-extrabold tracking-[-.03em] text-ink">${title}</div>
    <div>${body}</div>
    ${action ? html`<div class="mt-6">${Button({ variant: 'primary', class: 'min-w-44', onclick: action.onclick }, action.label)}</div>` : ''}
  </div>`;
}

export function Stat({ label, value, sub, tone = '', big = false }) {
  return html`<div class="rounded-2xl bg-raised px-4 py-3.5">
    <div class="text-[13px] font-medium text-ink-2">${label}</div>
    <div class="${cx('font-rounded font-bold tracking-tight tabular-nums', big ? 'text-[34px]' : 'text-[24px]', tone)}">${value}</div>
    ${sub ? html`<div class="text-[13px] text-ink-3">${sub}</div>` : ''}
  </div>`;
}

// Whole dollars with a small "$": 1,037.
export function Money(n, cls = '') {
  const v = Math.round(n);
  return html`<span class="${cx('whitespace-nowrap tabular-nums', cls)}"><small class="mr-px align-[.12em] text-[.68em] font-semibold">$</small>${(v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US')}</span>`;
}

// "8.25 hr" with a small unit.
export function Hours(h, cls = '') {
  return html`<span class="${cx('whitespace-nowrap tabular-nums', cls)}">${fmtHrs(h)}<small class="ml-0.5 text-[.72em] font-medium">hr</small></span>`;
}

// ── Money / bills ────────────────────────────────────────────────────────────

// Banknote-style tag, one tint per bill size ([data-d] → --dc in app.css).
export function Denom(d, cls = '') {
  return html`<span class="${cx('denom', cls)}" data-d="${d}">$${d}</span>`;
}

// Compact bill list: "$100 $20×2 $1×3" as tinted pills; zero counts skipped.
export function BillTags(bills, { denoms = [100, 50, 20, 10, 5, 1], cls = '' } = {}) {
  const tags = denoms.filter(d => (bills?.[d] || 0) > 0).map(d => html`<span class="billtag" data-d="${d}">$${d}${bills[d] > 1 ? html`<i>×${bills[d]}</i>` : ''}</span>`);
  return tags.length ? html`<span class="${cx('flex flex-wrap gap-1', cls)}">${tags}</span>` : '';
}

// ── Sheets (bottom modals) ───────────────────────────────────────────────────

// Shell for a bottom sheet. Body / title / foot get ids `${id}-body` etc.
export function SheetShell({ id, title, tall = false, foot = false }) {
  return html`<div class="sheet-backdrop" id="${id}" onclick="App.sheetBg(event,'${id}')">
    <div class="${cx('sheet', tall && 'sheet--tall')}" role="dialog" aria-labelledby="${id}-title">
      <div class="flex shrink-0 items-center gap-2 py-1.5 pl-5 pr-2.5">
        <span class="flex-1 truncate text-[24px] font-extrabold tracking-[-.03em]" id="${id}-title">${title}</span>
        <button class="grid size-12 place-items-center" onclick="App.closeSheet('${id}')" aria-label="Close">
          <span class="grid size-8 place-items-center rounded-full bg-fill text-ink-2">${icon('x', 'size-4')}</span>
        </button>
      </div>
      <div class="sheet-body" id="${id}-body"></div>
      ${foot ? html`<div class="sheet-foot" id="${id}-foot"></div>` : ''}
    </div>
  </div>`;
}
