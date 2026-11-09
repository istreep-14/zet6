// Component kit (Preact + htm) — every repeated piece of UI is one component
// here, styled with Tailwind classes (theme tokens live in index.html's
// @theme block). Props in, markup out; click handlers are plain functions:
// <${Button} onClick=${() => App.tab('tips')}>Tips<//>.

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

export const initials = name =>
  String(name).split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

export function Icon({ name, class: cls = 'size-5' }) {
  return html`<svg class=${cx(cls, 'shrink-0')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }} />`;
}

export function Card({ class: cls = '', flush = false, tone = '', children, ...rest }) {
  const toneCls = { error: 'bg-red/12 ring-1 ring-red/30', gold: 'bg-gold/10 ring-1 ring-gold/25' }[tone] || 'bg-surface';
  return html`<div class=${cx('rounded-card', toneCls, flush ? 'overflow-hidden' : 'p-4', cls)} ...${rest}>${children}</div>`;
}

// Standalone section heading (same look as <${Section}>'s title row).
export function Label({ children, aside }) {
  return html`<div class="flex min-h-7 items-center justify-between gap-3 px-1 pt-2">
    <span class="text-[13px] font-bold uppercase tracking-[.08em] text-ink-2">${children}</span>
    ${aside && html`<span class="shrink-0 text-[14px] font-medium text-ink-3">${aside}</span>`}</div>`;
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

// A distinct colour per person. Ordered so consecutive hues are far apart:
// pass `index` (the person's place on the shift / in the list) and the first
// 12 people never share a colour; without it the name hashes to a hue.
const AVATAR_HUES = ['#ff9f0a', '#3d9bff', '#30d158', '#ff6bb5', '#ffd23f', '#a78bfa', '#2dd4bf', '#ff5a4e', '#a3e635', '#5ac8fa', '#ff8a3d', '#e879f9'];
export function avatarColor(name, index) {
  if (Number.isInteger(index) && index >= 0) return AVATAR_HUES[index % AVATAR_HUES.length];
  let h = 0;
  for (const c of String(name).trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

// Index of a staff member among the named people on the shift (for avatarColor).
export const staffIndex = (state, id) => state.staff.filter(p => p.name.trim()).findIndex(p => p.id === id);

export function Avatar({ name, index, size = 'md' }) {
  const s = { sm: 'size-7 text-[11px]', md: 'size-9 text-[13px]', lg: 'size-12 text-[17px]', xl: 'size-14 text-[20px]' }[size];
  const c = avatarColor(name, index);
  return html`<span class=${cx('grid shrink-0 place-items-center rounded-full font-bold tracking-wide', s)} aria-hidden="true"
    style=${{ color: c, background: `color-mix(in srgb, ${c} 24%, transparent)` }}>${initials(name)}</span>`;
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
  return html`<div class=${cx('flex gap-1 rounded-xl bg-white/[.07] p-1', cls)} role="tablist">
    ${items.map(it => html`<button key=${it.value} role="tab" aria-selected=${String(it.value === value)} class=${cx(
      'flex-1 rounded-lg px-3 font-semibold transition', h,
      it.value === value ? 'bg-ink text-bg shadow-[0_2px_10px_rgb(0_0_0/.45)]' : 'text-ink-2 active:bg-white/10',
    )} onClick=${() => onChange(it.value)}>${it.label}</button>`)}
  </div>`;
}

export function Chip({ on, role, onClick, children }) {
  return html`<button class=${cx(
    'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition',
    on ? 'bg-ink text-bg' : 'bg-white/[.07] text-ink-3',
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
        <span class="flex-1 truncate text-[24px] font-extrabold tracking-[-.03em]" id=${id + '-title'}>${title}</span>
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
      <span class="flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-[.08em] text-ink-2">${title}</span>
      ${aside && html`<span class="shrink-0 text-[14px] font-medium text-ink-3">${aside}</span>`}
    </div>`}
    ${children}
  </section>`;
}

// One list row: lead (avatar / icon) · title over sub · trail · chevron.
// A button when it has onClick. Put rows inside <${Card} flush>.
export function Row({ lead, title, sub, trail, onClick, chevron, class: cls = '' }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class=${cx('flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left', SEP, onClick && 'transition active:bg-raised', cls)} onClick=${onClick}>
    ${lead}
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-1.5 text-[17px] font-semibold leading-tight">${title}</span>
      ${sub && html`<span class="truncate text-[14px] text-ink-2">${sub}</span>`}
    </span>
    ${trail}
    ${(chevron ?? !!onClick) && html`<${Icon} name="chevR" class="size-4 text-ink-3" />`}
  <//>`;
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
      <span class=${cx('grid size-9 shrink-0 place-items-center rounded-full', dot)}><${Icon} name=${icon || ic} class="size-[18px]" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-[16px] font-semibold leading-snug text-ink">${title}</span>
        ${sub && html`<span class=${cx('block text-[14px] leading-snug', subTone)}>${sub}</span>`}
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
      <span class=${cx('max-w-full truncate font-rounded text-[20px] font-bold leading-tight tabular-nums', it.tone)}>${it.value}</span>
      <span class="text-[12px] font-medium text-ink-2">${it.label}</span>
    </div>`)}
  </div>`;
}

// People tables (Summary payouts, Staff): one grid on every row — a fixed
// avatar column, then name at 2 parts and three 1-part value columns, values
// centred. Header cells use TABLE_HEAD.
export const TABLE_ROW = 'grid grid-cols-[36px_2fr_1fr_1fr_1fr] items-center gap-x-2 px-3.5 tabular-nums';
export const TABLE_HEAD = 'text-center text-[11px] font-bold uppercase tracking-[.08em] text-ink-3';
