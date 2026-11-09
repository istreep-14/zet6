// Staff tab (Preact) — rebuilt simple:
//   note line (count · close · closers, warnings)
//   → Add card: type a name + Enter (keeps focus for the next), role chips
//     when roles are on, and saved names as one-tap chips (filtered while
//     typing; Edit forgets names)
//   → people, one card per role (roles on, "Everyone") or one card: a row is
//     avatar · name · "5:00p – 2:00a" · hours. Default times are faded, a
//     closer's out time is red.
//   → tap a row → the person editor sheet: name, role, In / Out pickers
//     (±15 min steppers + a row of half-hour chips, "Default" resets),
//     closer switch, reset, delete.
//
// Times are written as the same raw strings typing would store, '' when they
// equal the default (resolve.js does the rest).

import { ROLES } from '../store.js';
import { fmtHrs } from '../util.js';
import { parseTime, fmtTimeAbs, resolveIn, nextAfter, absToInRaw, absToOutRaw, IN_MIN_ABS, IN_MAX_ABS } from '../time.js';
import { getRoster } from '../roster.js';
import { html, render, useState, useRef, useLayoutEffect } from '../ui/preact.js';
import { cx, Icon, Card, Button, Avatar, Alert, Seg, SwitchRow, INPUT, ROLE_DOT, ROLE_PLURAL } from '../ui/pkit.js';
import { openSheet, closeSheet, isOpen, sheetBody, setSheetTitle, onSheetClose } from '../ui/sheet.js';
import { activeSub } from './tabs.js';

const $ = id => document.getElementById(id);
const ADD_PH = { bartender: 'Add a bartender…', server: 'Add a server…', support: 'Add support staff…' };
const ROLE_SHORT = { bartender: 'Bar', server: 'Server', support: 'Support' };

// ── Times ────────────────────────────────────────────────────────────────────

function roleDefaults(state, role) {
  const r = state.defaults.byRole[role] || {};
  return { in: r.in || state.defaults.global.in || '', out: r.out || state.defaults.global.out || '' };
}

// In / Out on the absolute axis for any row (named or not), plus flags.
function times(state, person, vm) {
  const def = roleDefaults(state, person.role);
  const res = vm?.resolved?.staff.find(p => p.id === person.id);
  const inP = parseTime(person.in.trim() || def.in);
  const outP = parseTime(person.out.trim() || def.out);
  const inAbs = res?.inAbs ?? (inP.value != null ? resolveIn(inP.value) : null);
  const outAbs = res?.outAbs ?? (outP.value != null && inAbs != null ? nextAfter(outP.value, inAbs) : null);
  const bad = !inP.valid || !outP.valid;
  const hrs = inAbs != null && outAbs != null && outAbs > inAbs && outAbs - inAbs <= 12 ? outAbs - inAbs : null;
  return {
    def, inAbs, outAbs, hrs, bad,
    inSet: !!person.in.trim(), outSet: !!person.out.trim(),
    closer: !!res?.closer, forced: !!person.closerOverride,
  };
}

function inRaw(abs, def) {
  const raw = absToInRaw(Math.min(IN_MAX_ABS, Math.max(IN_MIN_ABS, abs)));
  return parseTime(def.in).value === Number(raw) ? '' : raw;
}
function outRaw(abs, def) {
  const raw = absToOutRaw(abs);
  return parseTime(def.out).value === Number(raw) ? '' : raw;
}

function defaultsLabel(def) {
  const i = parseTime(def.in), o = parseTime(def.out);
  const inAbs = i.value != null ? resolveIn(i.value) : null;
  return (inAbs != null ? fmtTimeAbs(inAbs) : '—') + ' – ' + (o.value != null ? fmtTimeAbs(nextAfter(o.value, inAbs ?? 17)) : '—');
}

// ── Note line ────────────────────────────────────────────────────────────────

function Note({ vm }) {
  const named = vm.state.staff.filter(p => p.name.trim());
  if (!named.length) return null;
  const parts = [named.length + ' on shift'];
  const closeAbs = vm.resolved.closeAbs;
  if (closeAbs !== null) parts.push('close ' + fmtTimeAbs(closeAbs));
  const closers = vm.resolved.staff.filter(p => p.closer).length;
  if (closers) parts.push(closers + (closers === 1 ? ' closer' : ' closers'));
  const warnings = [];
  if (vm.inputError && vm.blocked) warnings.push(vm.blocked);
  if (closeAbs !== null) {
    vm.resolved.staff.forEach(p => {
      if (!p.usedDefaults.out && p.outAbs !== null && p.outAbs > closeAbs + 0.001) warnings.push(p.name + ' is out after the close time');
    });
  }
  return html`<div class="px-1 text-[14px] text-ink-2">${parts.join(' · ')}</div>
    ${warnings.map(w => html`<${Alert} key=${w} tone="warn">${w}<//>`)}`;
}

// ── Add card ─────────────────────────────────────────────────────────────────

function AddCard({ vm, sub }) {
  const state = vm.state;
  const rolesOn = state.settings.allRoles;
  const fixedRole = rolesOn && ROLES.includes(sub) ? sub : null;
  const [text, setText] = useState('');
  const [pickRole, setPickRole] = useState('bartender');
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const role = !rolesOn ? 'bartender' : fixedRole || pickRole;

  const onShift = new Set(state.staff.map(p => p.name.trim().toLowerCase()).filter(Boolean));
  const q = text.trim().toLowerCase();
  const saved = getRoster().filter(r => !onShift.has(r.name.toLowerCase())
    && (!fixedRole || r.role === fixedRole || !rolesOn)
    && (!q || r.name.toLowerCase().includes(q)));
  const LIMIT = 12;
  const shown = showAll || q ? saved : saved.slice(0, LIMIT);

  const add = () => {
    const name = text.trim();
    if (!name) return;
    App.addPerson(name, role);
    setText('');
  };

  return html`<${Card} class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <input id="staffAdd" class=${cx(INPUT, 'h-[52px] flex-1 rounded-2xl text-[18px] font-semibold')} placeholder=${ADD_PH[fixedRole] || 'Add someone…'}
        value=${text} onInput=${e => setText(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="done" aria-label="Name to add" />
      <button class="grid size-[52px] shrink-0 place-items-center rounded-2xl bg-gold text-gold-ink transition active:scale-95 disabled:opacity-35"
        disabled=${!text.trim()} onClick=${add} aria-label="Add"><${Icon} name="plus" class="size-6" /></button>
    </div>
    ${rolesOn && !fixedRole && html`<${Seg} size="sm" value=${pickRole} onChange=${setPickRole}
      items=${ROLES.map(r => ({ value: r, label: ROLE_SHORT[r] }))} />`}
    ${(saved.length > 0 || editing) && html`<div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between px-0.5">
        <span class="text-[13px] font-semibold text-ink-2">${editing ? 'Tap × to forget a name' : q ? 'Saved names matching' : 'Saved · tap to add'}</span>
        <button class="text-[14px] font-semibold text-gold" onClick=${() => setEditing(!editing)}>${editing ? 'Done' : 'Edit'}</button>
      </div>
      <div class="flex flex-wrap gap-2">
        ${shown.map(r => html`<button key=${r.name} class=${cx('inline-flex h-10 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[15px] font-semibold transition active:scale-95',
            editing ? 'bg-red/12 text-red' : 'bg-fill text-ink')}
          onClick=${() => editing ? App.forgetName(r.name) : App.addPerson(r.name, fixedRole || (rolesOn ? r.role : 'bartender'))}>
          <${Avatar} name=${r.name} role=${rolesOn ? r.role : 'bartender'} size="sm" />${r.name}${editing && html`<${Icon} name="x" class="size-4" />`}
        </button>`)}
        ${!q && !showAll && saved.length > LIMIT && html`<button class="h-10 rounded-full px-3.5 text-[15px] font-semibold text-gold" onClick=${() => setShowAll(true)}>+${saved.length - LIMIT} more</button>`}
      </div>
    </div>`}
    ${!getRoster().length && html`<p class="px-0.5 text-[13px] text-ink-3">Names you add are saved for one-tap adding next shift.</p>`}
  <//>`;
}

// ── People list ──────────────────────────────────────────────────────────────

function PersonRow({ vm, p }) {
  const t = times(vm.state, p, vm);
  return html`<button data-staff-row class="flex min-h-[64px] w-full items-center gap-3 border-t border-sep px-4 py-2 text-left transition first:border-t-0 active:bg-raised"
    onClick=${() => App.editStaff(p.id)}>
    <${Avatar} name=${p.name} role=${p.role} />
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-[17px] font-semibold">${p.name}</span>
        ${t.forced && html`<span class="size-1.5 shrink-0 rounded-full bg-red" title="forced closer"></span>`}
      </span>
      <span class="text-[14px] tabular-nums text-ink-2">${t.bad ? html`<span class="text-red">check times</span>` : html`
        <span class=${t.inSet ? 'text-ink' : ''}>${t.inAbs != null ? fmtTimeAbs(t.inAbs) : 'In'}</span> – <span class=${cx(t.outSet && 'text-ink', t.closer && 'font-semibold text-red')}>${t.outAbs != null ? fmtTimeAbs(t.outAbs) : 'Out'}</span>`}</span>
    </span>
    <span class=${cx('font-rounded text-[17px] font-semibold tabular-nums', t.hrs == null ? 'text-red' : 'text-ink-2')}>${t.hrs != null ? fmtHrs(t.hrs) + 'h' : '?'}</span>
    <${Icon} name="chevR" class="size-4 text-ink-3" />
  </button>`;
}

function Group({ vm, role, people, title }) {
  const def = roleDefaults(vm.state, role || 'bartender');
  return html`<${Card} flush>
    <div class="flex items-center gap-2 py-2.5 pl-4 pr-3">
      ${role && html`<span class=${cx('size-2 rounded-full', ROLE_DOT[role])}></span>`}
      <span class="text-[17px] font-semibold">${title}</span>
      <span class="text-[15px] font-semibold tabular-nums text-ink-3">${people.length || ''}</span>
      <button class="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-fill px-3 text-[14px] font-semibold tabular-nums text-ink-2 active:bg-high"
        onClick=${() => App.openDefaults()} aria-label="Default times"><${Icon} name="clock" class="size-4" />${defaultsLabel(def)}</button>
    </div>
    ${people.length
      ? people.map(p => html`<${PersonRow} key=${p.id} vm=${vm} p=${p} />`)
      : html`<div class="border-t border-sep px-4 py-4 text-[15px] text-ink-3">No ${role ? ROLE_PLURAL[role].toLowerCase() : 'one'} yet.</div>`}
  <//>`;
}

function Staff({ vm }) {
  const state = vm.state;
  const sub = activeSub('staff', state);
  const named = state.staff.filter(p => p.name.trim());
  const groups = !state.settings.allRoles
    ? [{ role: null, title: 'On shift', people: named }]
    : ROLES.filter(r => !sub || sub === 'all' || sub === r)
      .map(r => ({ role: r, title: ROLE_PLURAL[r], people: named.filter(p => p.role === r) }))
      .filter(g => g.people.length || sub === g.role);
  return html`<div class="flex flex-col gap-3">
    <${Note} vm=${vm} />
    <${AddCard} vm=${vm} sub=${sub} />
    ${groups.map(g => html`<${Group} key=${g.role || 'all'} vm=${vm} ...${g} />`)}
    ${named.length > 0 && html`<p class="px-6 pt-1 text-center text-[13px] leading-snug text-ink-3">Tap someone to set their times, make them a closer or remove them. Faded times are the defaults.</p>`}
  </div>`;
}

// ── Person editor sheet ──────────────────────────────────────────────────────

let editId = null;
let lastVm = null;
onSheetClose('sheet-staff', () => { editId = null; });

export function openStaffEditor(id) {
  editId = id;
  openSheet('sheet-staff');
  if (lastVm) renderEditor(lastVm);
}

// A row of half-hour chips around the default, scrolled to the current value.
function ChipRow({ values, current, onPick, fmt }) {
  const row = useRef(null);
  useLayoutEffect(() => {
    const el = row.current;
    const sel = el?.querySelector('[aria-pressed="true"]');
    if (el && sel) el.scrollLeft = sel.offsetLeft - el.clientWidth / 2 + sel.offsetWidth / 2;
  }, [current]);
  return html`<div ref=${row} class="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <div class="flex w-max gap-1.5 px-0.5 py-0.5">
      ${values.map(v => {
        const on = current != null && Math.abs(v - current) < 0.01;
        return html`<button key=${v} aria-pressed=${String(on)} onClick=${() => onPick(v)}
          class=${cx('h-10 rounded-full px-3.5 text-[15px] font-semibold tabular-nums transition active:scale-95', on ? 'bg-gold text-gold-ink' : 'bg-fill text-ink-2')}>${fmt(v)}</button>`;
      })}
    </div>
  </div>`;
}

function TimePicker({ label, abs, isSet, defAbs, min, max, onSet, onReset }) {
  const step = d => { if (abs != null) onSet(Math.min(max, Math.max(min, abs + d))); };
  const chips = [];
  const center = defAbs ?? abs ?? min;
  for (let v = Math.ceil((center - 3) * 2) / 2; v <= center + 3; v += 0.5) if (v >= min && v <= max) chips.push(v);
  const sb = 'grid size-12 shrink-0 place-items-center rounded-full bg-fill text-[26px] text-ink transition active:bg-high disabled:opacity-30';
  return html`<div class="flex flex-col gap-2.5 rounded-2xl bg-raised p-3.5">
    <div class="flex items-center gap-3">
      <span class="w-10 text-[13px] font-bold uppercase tracking-wider text-ink-2">${label}</span>
      <button class=${sb} onClick=${() => step(-0.25)} disabled=${abs == null || abs <= min} aria-label=${label + ' 15 minutes earlier'}>−</button>
      <span class=${cx('flex-1 text-center font-rounded text-[34px] font-bold tabular-nums tracking-tight', !isSet && 'text-ink-2')}>${abs != null ? fmtTimeAbs(abs) : '—'}</span>
      <button class=${sb} onClick=${() => step(0.25)} disabled=${abs == null || abs >= max} aria-label=${label + ' 15 minutes later'}>+</button>
    </div>
    <${ChipRow} values=${chips} current=${abs} onPick=${onSet} fmt=${fmtTimeAbs} />
    <div class="flex items-center justify-between px-0.5 text-[13px]">
      <span class="text-ink-3">${isSet ? 'Set for this person' : 'Using the default'}</span>
      ${isSet && html`<button class="font-semibold text-gold" onClick=${onReset}>Use default${defAbs != null ? ' · ' + fmtTimeAbs(defAbs) : ''}</button>`}
    </div>
  </div>`;
}

function Editor({ vm, p }) {
  const state = vm.state;
  const t = times(state, p, vm);
  const def = t.def;
  const defIn = parseTime(def.in).value;
  const defInAbs = defIn != null ? resolveIn(defIn) : null;
  const defOut = parseTime(def.out).value;
  const defOutAbs = defOut != null && t.inAbs != null ? nextAfter(defOut, t.inAbs) : null;
  const share = vm.shares?.perPerson.find(x => x.id === p.id);
  const set = (field, raw) => App.staffField(p.id, field, raw, true);

  return html`
    <input class=${cx(INPUT, 'h-14 rounded-2xl text-[22px] font-bold')} value=${p.name} placeholder="Name"
      autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="done" aria-label="Name"
      onInput=${e => App.staffField(p.id, 'name', e.target.value)} onChange=${() => App.rememberStaff(p.id)}
      onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
    ${state.settings.allRoles && html`<${Seg} value=${p.role} onChange=${r => App.staffField(p.id, 'role', r, true)}
      items=${ROLES.map(r => ({ value: r, label: ROLE_SHORT[r] }))} />`}
    <${TimePicker} label="In" abs=${t.inAbs} isSet=${t.inSet} defAbs=${defInAbs} min=${IN_MIN_ABS} max=${IN_MAX_ABS}
      onSet=${abs => set('in', inRaw(abs, def))} onReset=${() => set('in', '')} />
    <${TimePicker} label="Out" abs=${t.outAbs} isSet=${t.outSet} defAbs=${defOutAbs}
      min=${(t.inAbs ?? 17) + 0.25} max=${(t.inAbs ?? 17) + 12}
      onSet=${abs => set('out', outRaw(abs, def))} onReset=${() => set('out', '')} />
    <div class="flex items-center justify-between rounded-2xl bg-raised px-4 py-3">
      <span class="text-[15px] text-ink-2">${t.hrs != null ? fmtHrs(t.hrs) + ' hours' : 'Check the times'}</span>
      ${share && html`<span class="text-[15px] text-ink-2">takes home <b class="font-rounded text-[20px] text-gold">$${share.final}</b></span>`}
    </div>
    <div class="overflow-hidden rounded-card bg-raised">
      <${SwitchRow} on=${t.forced} onClick=${() => App.toggleCloser(p.id)} label="Closer"
        hint=${t.forced ? 'Forced — shares the closer bonus' : t.closer ? 'Auto: out at the close time' : 'Shares the dollars left after rounding'} />
    </div>
    <div class="flex gap-2">
      <${Button} class="flex-1" disabled=${!t.inSet && !t.outSet} onClick=${() => { set('in', ''); set('out', ''); }}>Reset times<//>
      <${Button} variant="danger" class="flex-1" icon="trash" onClick=${() => { App.removePerson(p.id); }}>Remove<//>
    </div>`;
}

function renderEditor(vm) {
  if (!editId || !isOpen('sheet-staff')) return;
  const p = vm.state.staff.find(x => x.id === editId);
  if (!p) { closeSheet('sheet-staff'); return; }
  setSheetTitle('sheet-staff', p.name.trim() || 'New person');
  render(html`<${Editor} vm=${vm} p=${p} />`, sheetBody('sheet-staff'));
}

// ── Render ───────────────────────────────────────────────────────────────────

export function renderStaff(vm) {
  lastVm = vm;
  const root = $('staff-root');
  if (root) render(html`<${Staff} vm=${vm} />`, root);
  renderEditor(vm);
}
