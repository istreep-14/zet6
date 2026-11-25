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

// Keep the selected tab visible after a swipe without scrolling the page.
export function revealSelectedTab(selector) {
  requestAnimationFrame(() => {
    const strip = document.querySelector(selector);
    const selected = strip?.querySelector('[role="tab"][aria-selected="true"]');
    if (!selected) return;
    const outer = strip.getBoundingClientRect(), inner = selected.getBoundingClientRect();
    const left = inner.left - outer.left - 8, right = inner.right - outer.right + 8;
    if (left < 0) strip.scrollLeft += left;
    else if (right > 0) strip.scrollLeft += right;
  });
}

export function subtabKeys(e) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.target.getAttribute('role') !== 'tab') return;
  const tabs = [...e.currentTarget.querySelectorAll('[role="tab"]')];
  const i = tabs.indexOf(e.target);
  if (i < 0 || !tabs.length) return;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

export const ROLE_TINT = {
  bartender: 'bg-bar/18 text-bar',
  server: 'bg-srv/18 text-srv',
  support: 'bg-sup/18 text-sup',
};
// A colour per person, by their place among the named staff (css --p1…--p8):
// their number tile and timeline. Stable across pages.
export const hueVar = i => `var(--p${(((i % 8) + 8) % 8) + 1})`;
export const hueIndex = (state, id) => state.staff.filter(p => (p.name || '').trim()).findIndex(p => p.id === id);
export const hueTile = i => ({ background: `color-mix(in srgb, ${hueVar(i)} 20%, transparent)`, color: hueVar(i) });

// A person's round avatar: their initials on their colour (hueTile). `closer`
// puts a red dot on its shoulder (solid = forced). Sizes: sm 2rem (Staff's
// rows), md 2.5rem (list rows), lg 3.5rem (a person's page).
const AV = { sm: 'size-8 text-[0.8125rem]', md: 'size-10 text-[1rem]', lg: 'size-14 text-[1.25rem]' };
export const initials = name => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};
export function Avatar({ name, i = 0, closer = false, forced = true, size = 'md', class: cls = '' }) {
  return html`<span class=${cx('relative grid shrink-0 place-items-center rounded-full font-semibold tracking-tight', AV[size] || AV.md, cls)} style=${hueTile(i)} aria-hidden="true">
    ${initials(name)}
    ${closer && html`<span class=${cx('absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-bg', forced ? 'bg-bad' : 'bg-bad/70')}></span>`}
  </span>`;
}

// An icon in a round tile the size of an avatar — for the non-person rows of a
// person list (Chump, Total) so every row's text starts at the same place.
export function RoundIcon({ name, small = false, class: cls = 'bg-surface-2 text-ink-2' }) {
  return html`<span class=${cx('grid shrink-0 place-items-center rounded-full', small ? 'size-8' : 'size-10', cls)} aria-hidden="true"><${Icon} name=${name} class=${small ? 'size-4' : 'size-5'} /></span>`;
}
// A table's first column for a non-person row (Total, Chump): the small
// round icon, then the label — lined up with the people's avatars above it.
export const RowLabel = ({ icon = 'sigma', children }) => html`<span class="inline-flex min-w-0 items-center gap-2.5"><${RoundIcon} name=${icon} small /><span class="truncate">${children}</span></span>`;

// Derived figures as one quiet line, the way a profile shows its counts:
// each value in ink, its label after it in ink-3 ("5 people  45h  $26.24/h").
// items: [{ v, l, tone, tight }] (falsy items are skipped; l is optional;
// tight = no space before it: "$26.24/h").
export function Meta({ items, class: cls = '' }) {
  return html`<span class=${cx('t-small block min-w-0 truncate text-ink-3', cls)}>
    ${items.filter(Boolean).map((it, k) => html`<span key=${k} class="mr-3 last:mr-0"><span class=${cx('font-semibold tabular-nums', it.tone || 'text-ink-2')}>${it.v}</span>${it.l && html`<span>${(it.tight ? '' : ' ') + it.l}</span>`}</span>`)}
  </span>`;
}

export const ROLE_DOT = { bartender: 'bg-bar', server: 'bg-srv', support: 'bg-sup' };
export const ROLE_TEXT = { bartender: 'text-bar', server: 'text-srv', support: 'text-sup' };
export const ROLE_PLURAL = { bartender: 'Bartenders', server: 'Servers', support: 'Support' };

export function Icon({ name, class: cls = 'size-5' }) {
  return html`<svg class=${cx(cls, 'shrink-0')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }} />`;
}

// A rounded block on the page (groups / cards are `surface`, no borders).
export function Card({ class: cls = '', flush = false, tone = '', children, ...rest }) {
  const toneCls = { error: 'bg-bad/10', gold: 'bg-accent/10', accent: 'bg-accent/10' }[tone] || 'bg-surface shadow-[var(--card-ring,none)]';
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
  sm: 'h-9 px-3.5 rounded-full t-small',
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
// `bare`: no a / p at all ("6", "10:45") — for tight spots where the
// context says which (a shift's bar).
export function Clock({ abs, full = false, mins = false, bare = false }) {
  const t = timeParts(abs);
  if (full) {
    return html`<span class="whitespace-nowrap">${t.h}:${t.m || '00'}${t.ap && html`<span class="ml-[0.2em] text-[0.85em]">${t.ap === 'a' ? 'am' : 'pm'}</span>`}</span>`;
  }
  return html`<span class="whitespace-nowrap">${t.h}${t.m ? ':' + t.m : mins ? ':00' : ''}${t.ap && !bare && html`<span class="ml-[0.06em] text-[0.8em]">${t.ap}</span>`}</span>`;
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
  return html`<div class=${cx('t-small flex items-start gap-3 rounded-card px-4 py-3', t)}>
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

// Blocked / pristine state shared by the result pages (Home, Tips › Drawer): the
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
    { tab: 'home', ok: false, title: 'Who gets what', sub: 'Payouts and the bills for each envelope' },
  ];
  const next = steps.find(x => !x.ok);
  return html`<div class="flex flex-col gap-4">
    ${pristine && html`<${Empty} logo title="No shift yet" body="Three steps to close out — start with who worked." />`}
    <${List}>${steps.map((x, i) => html`<${Item} key=${x.tab} onClick=${() => App.tab(x.tab === 'home' ? (next?.tab || 'home') : x.tab)}
      tone=${x === next ? 'active' : ''}
      lead=${html`<span class=${cx('grid size-8 shrink-0 place-items-center rounded-full text-[0.8125rem] font-semibold',
        x.ok ? 'bg-good/15 text-good' : err(x.tab) ? 'bg-bad/12 text-bad' : x === next ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-3')}>
        ${x.ok ? html`<${Icon} name="check" class="size-4" />` : err(x.tab) ? '!' : i + 1}</span>`}
      title=${x.title} sub=${html`<span class=${err(x.tab) ? 'text-bad' : ''}>${x.sub}</span>`} />`)}<//>
  </div>`;
}

// The input tabs end with the next step in the close-out order
// (Staff → Tips → Home). Shown only once this step is done.
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
const INPUT_BASE = 'h-11 w-full min-w-0 rounded-xl px-3 text-[1rem] text-ink outline-none transition placeholder:text-ink-3 focus:ring-2 focus:ring-accent/40';
export const INPUT = cx(INPUT_BASE, 'bg-surface-2');
export const INPUT_PAGE = cx(INPUT_BASE, 'bg-surface');

// Segmented control: items [{ value, label, icon }], onChange(value).
// Sizes (SEG_H): sm (inside a card row) · md (default) · lg — a view switch
// you hit with a thumb (Summary's List · Shift · Pools · Bills · Math).
const SEG_H = { sm: 'h-8 t-small', md: 'h-10 t-small', lg: 'h-11 text-[0.8125rem] leading-tight' };
export function Seg({ items, value, onChange, size = 'md', class: cls = '' }) {
  const h = SEG_H[size] || SEG_H.md;
  return html`<div class=${cx('flex rounded-xl bg-surface-2 p-0.5', size === 'lg' && 'rounded-[0.875rem] p-1', cls)} role="tablist">
    ${items.map(it => html`<button key=${it.value} role="tab" aria-selected=${String(it.value === value)} class=${cx(
      'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] px-2 font-semibold transition active:scale-[.97]', h,
      it.value === value ? 'bg-raised text-ink shadow-[0_1px_3px_rgb(0_0_0/.14)]' : 'text-ink-3',
    )} onClick=${() => onChange(it.value)}>${it.icon && html`<${Icon} name=${it.icon} class="size-4" />`}${it.label}</button>`)}
  </div>`;
}

// Role toggle chip ("Shared by"): on = accent tint, off = a plain fill.
export function Chip({ on, role, onClick, children }) {
  return html`<button class=${cx(
    't-small inline-flex h-[var(--tap)] flex-1 items-center justify-center gap-1.5 rounded-full font-semibold transition active:scale-95',
    on ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-ink-3',
  )} aria-pressed=${String(!!on)} onClick=${onClick}>
    <span class=${cx('size-2 rounded-full', on ? ROLE_DOT[role] : 'bg-ink-3/50')}></span>${children}</button>`;
}

// Labelled input. Extra props (value, onInput, inputMode …) go to the <input>.
// `page`: the field stands on the page / a sheet, not inside a card.
export function Field({ label, page = false, class: cls = '', inputClass = '', ...input }) {
  return html`<label class=${cx('flex min-w-0 flex-1 flex-col gap-1.5', cls)}>
    <span class="t-small text-ink-2">${label}</span>
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

// Press and hold a −/+ button to keep stepping: one step on the press, then
// repeating — faster the longer it's held — until the finger lifts or slides
// off. A keyboard press (click with detail 0) steps once. One hold at a time,
// so one shared timer (a re-render mid-hold can't orphan it).
let repeatTimer = 0;
const stopRepeat = () => { clearTimeout(repeatTimer); repeatTimer = 0; };
export function holdRepeat(fn) {
  return {
    onPointerDown: e => {
      if (e.button > 0) return;
      e.preventDefault();
      stopRepeat();
      fn();
      let n = 0;
      const tick = () => { fn(); n++; repeatTimer = setTimeout(tick, n < 4 ? 170 : n < 12 ? 90 : 45); };
      repeatTimer = setTimeout(tick, 420);
    },
    onPointerUp: stopRepeat, onPointerLeave: stopRepeat, onPointerCancel: stopRepeat,
    onClick: e => { if (e.detail === 0) fn(); },
    onContextMenu: e => e.preventDefault(),
  };
}

// − value + : a small number control for a row's trail (hold to repeat).
export function Stepper({ value, onDec, onInc, decDisabled = false, incDisabled = false, on = false }) {
  const b = 'grid size-10 select-none place-items-center rounded-full bg-surface-2 text-[1.25rem] leading-none text-ink transition active:scale-95 disabled:opacity-30 [-webkit-touch-callout:none]';
  return html`<span class="flex shrink-0 items-center gap-1">
    <button class=${b} ...${holdRepeat(onDec)} disabled=${decDisabled} aria-label="Less">−</button>
    <span class=${cx('t-body min-w-8 text-center font-semibold tabular-nums', on ? 'text-accent' : 'text-ink-2')}>${value}</span>
    <button class=${b} ...${holdRepeat(onInc)} disabled=${incDisabled} aria-label="More">+</button>
  </span>`;
}

// One figure: value over a small label — the HUD's cells, Stats, LiveStrip.
// `d`: a Delta shown after the label while a change is fresh or being
// previewed ("Rate +$0.54").
export function Figure({ v, k, tone = '', d = null }) {
  return html`<span class="flex min-w-0 flex-1 flex-col items-center px-1.5 text-center leading-tight">
    <span class=${cx('t-head max-w-full truncate tabular-nums', tone)}>${v}</span>
    <span class="t-small max-w-full truncate text-ink-3">${k}${d && html` <${Delta} d=${d} class="!text-[0.8125rem]" />`}</span>
  </span>`;
}

// A change in money: "+$4" (good) / "−$3" (bad), from ui/changes.js
// ({ v, kind, stamp }). kind 'change' = just landed (fades in, then main.js
// clears it), 'preview' = an edit in progress (shown while you drag / type).
// `under`: absolutely under the figure in its (relative) parent, so it never
// moves the layout. `unit`: '$' (default), '' or e.g. '/h'.
const fmtD = v => (Number.isInteger(v) ? Math.abs(v).toLocaleString('en-US') : Math.abs(v).toFixed(2));
export function Delta({ d, under = false, unit = '$', class: cls = '' }) {
  if (!d || !d.v) return null;
  const txt = (d.v > 0 ? '+' : '−') + (unit === '$' ? '$' + fmtD(d.v) : fmtD(d.v) + unit);
  return html`<span key=${d.stamp} class=${cx('delta', d.kind === 'preview' ? 'delta--preview' : 'delta--change',
    d.v > 0 ? 'text-good' : 'text-bad', under && 'delta--under', cls)}>${txt}</span>`;
}
// A row's highlight when its figures just changed (a fading accent wash over
// the row; the row must be position: relative).
export const Flash = ({ d }) => (d?.kind === 'change'
  ? html`<span key=${'f' + d.stamp} class="flash pointer-events-none absolute inset-0" aria-hidden="true"></span>` : null);

// Shift tools as thumb-sized chips in one sideways row (Summary, Payout):
// items [{ icon, label, value, onClick }]. The tools that used to sit at the
// bottom of a page (Close-time what-if, Closer bonus & chump, Copy).
export function ToolChips({ items, class: cls = '' }) {
  return html`<div class=${cx('-mx-[var(--gutter)] overflow-x-auto px-[var(--gutter)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', cls)}>
    <div class="flex w-max gap-2">${items.filter(Boolean).map(it => html`<button key=${it.label}
      class="t-small inline-flex h-[var(--tap)] items-center gap-1.5 rounded-full bg-surface pl-3 pr-3.5 font-semibold text-ink transition active:scale-95"
      onClick=${it.onClick}><${Icon} name=${it.icon} class="size-4 text-accent" />${it.label}${it.value != null && it.value !== '' && html`<span class=" text-ink-3">${it.value}</span>`}</button>`)}</div>
  </div>`;
}

export function Stat({ label, value, sub, tone = '', big = false }) {
  return html`<div class="rounded-card bg-surface px-4 py-3">
    <div class="t-small text-ink-3">${label}</div>
    <div class=${cx('font-semibold tracking-tight tabular-nums', big ? 't-display' : 'text-[1.25rem] leading-tight', tone)}>${value}</div>
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
  return html`<section class=${cx('ui-section flex flex-col gap-2', cls)}>
    ${(title || aside) && html`<div class="section-heading flex min-h-5 items-end justify-between gap-3">
      <span class="t-cap flex min-w-0 items-center gap-2 text-ink-3">${title}</span>
      ${aside && html`<span class="t-small shrink-0 text-ink-3">${aside}</span>`}
    </div>`}
    ${children}
    ${footer && html`<div class="section-foot t-small text-ink-3">${footer}</div>`}
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
  const inset = lead ? '4.25rem' : icon ? '3.75rem' : '1rem';     // where the text starts (px-4 + lead + gap-3)
  return html`<${Tag} class=${cx('li flex min-h-12 w-full flex-col justify-center gap-2.5 px-4 py-2.5 text-left disabled:opacity-50',
      tone === 'active' && 'bg-accent/8', cls)} style=${{ '--inset': inset }} onClick=${onClick} disabled=${disabled} ...${rest}>
    <span class="flex w-full items-center gap-3">
      ${icon ? html`<span class=${cx('grid size-8 shrink-0 place-items-center rounded-lg', tone === 'danger' ? 'bg-bad/12 text-bad' : 'bg-surface-2 text-ink-2')}><${Icon} name=${icon} class="size-[1.125rem]" /></span>` : lead}
      <span class="flex min-w-0 flex-1 flex-col">
        <span class=${cx('t-body flex min-w-0 items-center gap-1.5', tone === 'danger' && 'text-bad')}>${title}</span>
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
// The total row: the same band as a list's Total (opaque, so a pinned first
// column stays solid while the table scrolls sideways).
export const TOTAL_FILL = 'bg-[color-mix(in_srgb,var(--surface-2)_60%,var(--zbase))]';
// `lines`: hairlines between columns too (a grid — envelopes, math).
export function Table({ cols, rows, foot, fixed = false, stickyFirst = false, scroll = false, lines = false, class: cls = '', ...rest }) {
  const align = c => ({ left: 'text-left', right: 'text-right' }[c.align] || 'text-center');
  const first = cx('pl-4 pr-2 text-left', stickyFirst && 'sticky left-0 z-[1] bg-inherit');
  const cell = (c, i) => cx('px-1.5 tabular-nums', i === 0 ? first : align(c), i === cols.length - 1 && i > 0 && 'pr-4', c.hl && 'bg-accent/12');
  const table = html`<table class=${cx('t-body w-full border-collapse whitespace-nowrap', fixed && 'table-fixed')}>
      ${fixed && html`<colgroup>${cols.map((c, i) => html`<col key=${i} class=${c.w || ''} />`)}</colgroup>`}
      <thead class="thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--line)] transition-[top] duration-200"><tr>
        ${cols.map((c, i) => html`<th key=${i} class=${cx(cell(c, i), T_HEAD, 'h-9 transition-[height] group-data-[stuck]:h-7', c.onHead && 'cursor-pointer', c.hl && 'text-accent')}
          onClick=${c.onHead}>${c.head ?? c.label}</th>`)}
      </tr></thead>
      <tbody>${rows.map((r, n) => r.section
        ? html`<tr key=${'s' + n} class="bg-[var(--zbase)]"><td colspan=${cols.length} class="t-cap px-4 pb-1 pt-3 text-ink-3">${r.section}</td></tr>`
        : html`<tr key=${r.key ?? n} class=${cx(zebra(n), r.onClick && 'cursor-pointer transition active:bg-surface-2', r.tone === 'muted' && 'text-ink-2')} onClick=${r.onClick}>
            ${r.cells.map((v, i) => html`<td key=${i} class=${cx(cell(cols[i] || {}, i), 'h-12', i === 0 && 'max-w-[9rem] truncate')}>${v}</td>`)}
          </tr>`)}</tbody>
      ${foot && html`<tfoot><tr class=${TOTAL_FILL}>
        ${foot.map((v, i) => html`<td key=${i} class=${cx(cell(cols[i] || {}, i), 'h-14')}>${v}</td>`)}
      </tr></tfoot>`}
    </table>`;
  return html`<div class=${cx('page-table', cls)} ...${rest}><${Sentinel} />${scroll
    ? html`<div class="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${table}</div>` : table}</div>`;
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
    ${items.map(it => html`<${Figure} key=${it.label} v=${it.value} k=${it.label} tone=${it.tone} d=${it.d} />`)}
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
// --zbase is what the rows sit on: the page (on a page) or the card (in a sheet).
export const ZEBRA = 'bg-[color-mix(in_srgb,var(--ink)_4%,var(--zbase))]';
export const zebra = i => (i % 2 ? ZEBRA : 'bg-[var(--zbase)]');
export const THEAD = 'thead group sticky top-[var(--thead-top,0px)] z-[3] bg-surface shadow-[0_1px_0_var(--line)] transition-[top,height,padding] duration-200';
export const Sentinel = ({ cls = '' }) => html`<div class=${cx('thead-sentinel h-0', cls)} aria-hidden="true"></div>`;
