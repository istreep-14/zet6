// Component kit for Preact views — same look as ui/kit.js (which still serves
// the string-template views until they're migrated). Props in, markup out;
// click handlers are plain functions: <${Button} onClick=${() => App.tab('tips')}>.

import { html } from './preact.js';
import { cx } from './html.js';
import { PATHS } from './icons.js';
import { ROLE_TINT, ROLE_DOT, ROLE_TEXT, initials } from './kit.js';

export { cx, ROLE_TINT, ROLE_DOT, ROLE_TEXT };

export function Icon({ name, class: cls = 'size-5' }) {
  return html`<svg class=${cx(cls, 'shrink-0')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }} />`;
}

export function Card({ class: cls = '', flush = false, tone = '', children, ...rest }) {
  const toneCls = { error: 'bg-red/12 ring-1 ring-red/30', gold: 'bg-gold/10 ring-1 ring-gold/25' }[tone] || 'bg-surface';
  return html`<div class=${cx('rounded-card', toneCls, flush ? 'overflow-hidden' : 'p-4', cls)} ...${rest}>${children}</div>`;
}

export function Label({ children, aside }) {
  return html`<div class="flex items-baseline justify-between gap-2 px-1 pt-3 text-[12px] font-bold uppercase tracking-[.09em] text-ink-3">
    <span>${children}</span>${aside && html`<span class="normal-case tracking-normal font-medium">${aside}</span>`}</div>`;
}

const BTN_VARIANT = {
  primary: 'bg-gold text-gold-ink shadow-[0_8px_24px_-8px_rgb(255_210_63/.55)]',
  tonal: 'bg-gold/12 text-gold',
  plain: 'bg-fill text-ink shadow-[inset_0_1px_0_rgb(255_255_255/.06)]',
  danger: 'bg-red/15 text-red',
  ghost: 'text-gold',
};
const BTN_SIZE = {
  md: 'h-12 px-5 rounded-2xl text-[17px]',
  sm: 'h-9 px-4 rounded-full text-[15px]',
  lg: 'h-14 px-6 rounded-2xl text-[17px]',
};

export function Button({ variant = 'plain', size = 'md', block = false, icon, class: cls = '', children, ...rest }) {
  return html`<button class=${cx('inline-flex items-center justify-center gap-2 font-bold tracking-[-.01em] transition active:scale-[.97] disabled:opacity-35',
    BTN_VARIANT[variant], BTN_SIZE[size], block && 'w-full', cls)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} class=${size === 'sm' ? 'size-4' : 'size-5'} />`}${children}</button>`;
}

export function Avatar({ name, role, size = 'md' }) {
  const s = { sm: 'size-7 text-[11px]', md: 'size-9 text-[13px]', lg: 'size-12 text-[17px]', xl: 'size-14 text-[20px]' }[size];
  return html`<span class=${cx('grid shrink-0 place-items-center rounded-full font-bold tracking-wide', s, ROLE_TINT[role] || 'bg-high text-ink')} aria-hidden="true">${initials(name)}</span>`;
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
  return html`<div class=${cx('flex items-start gap-3 rounded-2xl px-4 py-3 text-[15px] leading-snug', t)}>
    ${tone !== 'info' && html`<${Icon} name="alert" class="size-5 mt-px" />`}
    <span class="flex-1">${children}</span>
    ${action && html`<button class="shrink-0 font-semibold text-ink underline underline-offset-4" onClick=${action.onClick}>${action.label}</button>`}
  </div>`;
}

export function Empty({ icon = 'dollar', title, body, action }) {
  return html`<div class="flex flex-col items-center px-6 pb-10 pt-16 text-center text-[15px] leading-relaxed text-ink-2">
    <span class="mb-4 grid size-16 place-items-center rounded-full bg-gold/12 text-gold"><${Icon} name=${icon} class="size-7" /></span>
    <div class="mb-1 text-[24px] font-extrabold tracking-[-.03em] text-ink">${title}</div>
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

export const INPUT = 'h-12 w-full min-w-0 rounded-xl bg-fill px-3 text-[17px] text-ink outline-none transition placeholder:text-ink-3 focus:ring-2 focus:ring-gold';

// Segmented control: items [{ value, label }], onChange(value).
export function Seg({ items, value, onChange, size = 'md', class: cls = '' }) {
  const h = size === 'sm' ? 'h-8 text-[14px]' : 'h-10 text-[15px]';
  return html`<div class=${cx('flex gap-1 rounded-xl bg-fill-2 p-1', cls)} role="tablist">
    ${items.map(it => html`<button key=${it.value} role="tab" aria-selected=${String(it.value === value)} class=${cx(
      'flex-1 rounded-lg px-3 font-semibold transition', h,
      it.value === value ? 'bg-high text-ink shadow-[0_2px_8px_rgb(0_0_0/.4),inset_0_1px_0_rgb(255_255_255/.08)]' : 'text-ink-2',
    )} onClick=${() => onChange(it.value)}>${it.label}</button>`)}
  </div>`;
}

export function Chip({ on, role, onClick, children }) {
  return html`<button class=${cx(
    'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition',
    on ? 'bg-high text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)]' : 'bg-fill-2 text-ink-2',
  )} aria-pressed=${String(!!on)} onClick=${onClick}>
    <span class=${cx('size-2 rounded-full', on ? ROLE_DOT[role] : 'bg-ink-3')}></span>${children}</button>`;
}

// Labelled input. Extra props (value, onInput, inputMode …) go to the <input>.
export function Field({ label, class: cls = '', inputClass = '', ...input }) {
  return html`<label class=${cx('flex min-w-0 flex-1 flex-col gap-1.5', cls)}>
    <span class="text-[14px] font-medium text-ink-2">${label}</span>
    <input class=${cx(INPUT, inputClass)} ...${input} />
  </label>`;
}

export const SEP = 'border-t border-sep first:border-t-0';

export function SwitchRow({ on, disabled, onClick, label, hint }) {
  return html`<button class=${cx('switch-row flex min-h-16 w-full items-center gap-4 px-4 py-2.5 text-left disabled:opacity-60', SEP)}
    role="switch" aria-checked=${String(!!on)} disabled=${disabled} onClick=${onClick}>
    <span class="flex flex-1 flex-col gap-0.5 text-[17px]">${label}${hint && html`<small class="text-[13px] leading-snug text-ink-2">${hint}</small>`}</span>
    <span class="switch"></span>
  </button>`;
}

export function ListRow({ onClick, icon, tone = '', chevron = true, aside, children }) {
  return html`<button class=${cx('flex min-h-[54px] w-full items-center gap-3 px-4 text-left text-[17px] transition active:bg-raised', SEP, tone === 'danger' && 'text-red')} onClick=${onClick}>
    ${icon && html`<span class=${cx('grid size-8 place-items-center rounded-lg', tone === 'danger' ? 'bg-red/15' : 'bg-white/8 text-ink')}><${Icon} name=${icon} class="size-[18px]" /></span>`}
    <span class="flex-1">${children}</span>
    ${aside && html`<span class="text-[15px] text-ink-2">${aside}</span>`}
    ${chevron && html`<${Icon} name="chevR" class="size-4 text-ink-3" />`}
  </button>`;
}

export function Stepper({ value, onDec, onInc, decDisabled = false, incDisabled = false, on = false }) {
  const b = 'grid size-11 place-items-center rounded-full text-[22px] text-ink transition active:bg-fill disabled:opacity-30';
  return html`<div class="flex items-center rounded-full bg-fill">
    <button class=${b} onClick=${onDec} disabled=${decDisabled} aria-label="Less">−</button>
    <span class=${cx('min-w-8 text-center text-[15px] font-bold tabular-nums', on ? 'text-gold' : 'text-ink-2')}>${value}</span>
    <button class=${b} onClick=${onInc} disabled=${incDisabled} aria-label="More">+</button>
  </div>`;
}

export function Stat({ label, value, sub, tone = '', big = false }) {
  return html`<div class="rounded-2xl bg-raised px-4 py-3.5">
    <div class="text-[13px] font-medium text-ink-2">${label}</div>
    <div class=${cx('font-rounded font-bold tracking-tight tabular-nums', big ? 'text-[34px]' : 'text-[24px]', tone)}>${value}</div>
    ${sub && html`<div class="text-[13px] text-ink-3">${sub}</div>`}
  </div>`;
}

export function Badge({ tone = 'muted', children }) {
  const t = {
    red: 'bg-red/15 text-red', green: 'bg-green/15 text-green', amber: 'bg-amber/15 text-amber',
    gold: 'bg-gold/15 text-gold', muted: 'bg-fill text-ink-2',
    bartender: ROLE_TINT.bartender, server: ROLE_TINT.server, support: ROLE_TINT.support,
  }[tone];
  return html`<span class=${cx('inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[12px] font-semibold capitalize', t)}>${children}</span>`;
}

// Rate · Pool · Chump strip for the top of a sheet.
export function LiveStrip({ vm }) {
  if (!vm?.shares || !(vm.totalCash > 0)) return null;
  const sh = vm.shares;
  const S = (k, v, c = '') => html`<span class="flex min-w-0 flex-col items-center gap-0.5 leading-tight">
    <span class="text-[12px] font-medium text-ink-2">${k}</span>
    <span class=${cx('font-rounded text-[18px] font-semibold tabular-nums', c)}>${v}</span></span>`;
  const money = n => '$' + Number(n).toLocaleString('en-US');
  return html`<div class="flex justify-around rounded-2xl bg-raised px-2 py-3">
    ${S('Rate', '$' + sh.rate.toFixed(2), 'text-green')}${S('Pool', money(sh.totalCash))}${S('Chump', sh.leftover > 0 ? money(sh.leftover) : '—', 'text-ink-2')}</div>`;
}
