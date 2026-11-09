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
