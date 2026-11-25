// Shift (Preact) — this session's setup, the bottom tab after Tips. Two
// sub-tabs (the header):
//   Shift   the session's name and date, the shift type (Night / Day — the
//           first thing to pick on a new session: it lays out the pools),
//           Servers & support, export / delete
//   Pools   the shift's tip pools as a list; tap one → its own page (pushed
//           from the right): name, preset (Night · Day · Mid · Party), the
//           window (not for Night — it has none: first In → last Out), who
//           shares it, the support tip-out, the register over / short,
//           remove. + Party / + Pool under the list. The pools' cash is the
//           Tips tab; this is only what the pools are.

import { fmtMoney } from '../util.js';
import { SHIFT_TYPES, SHIFT_LABEL, PRESETS, PRESET_LABEL, PRESET_HINT } from '../shifts.js';
import { html, render, useState } from '../ui/preact.js';
import { cx, Icon, Field, Section, List, Item, SwitchRow, Button, RoundIcon } from '../ui/pkit.js';
import { currentSub, currentTab, pushPage } from '../ui/nav.js';
import { SessionDate, sessionInfo, SupportDefault } from './settings.js';
import { WindowEdge, SharedBy, SupportBox, FormRow, windowSub, openCashSheet } from './tips.js';
import { ShiftDefaults } from './staff.js';
import { fmtDay } from './tabs.js';

const $ = id => document.getElementById(id);
const POOL_HUES = ['var(--accent)', 'var(--pool-2)', 'var(--pool-3)', 'var(--pool-4)'];
const TYPE_ICON = { night: 'moon', day: 'sun' };
const TYPE_HINT = { night: 'One pool, the whole shift · bar', day: 'Day + Mid pools · bar + servers' };
const PRESET_ICON = { night: 'moon', day: 'sun', mid: 'clock', party: 'gift' };

// A big two- or four-way choice: cards in a row, the picked one accent.
function Choice({ items, value, onPick, cols = 2 }) {
  return html`<div class=${cx('grid gap-2', cols === 2 ? 'grid-cols-2' : 'grid-cols-2')}>
    ${items.map(it => {
      const on = it.value === value;
      return html`<button key=${it.value} aria-pressed=${String(on)} onClick=${() => onPick(it.value)}
        class=${cx('flex min-h-[4.5rem] flex-col items-start gap-1 rounded-card p-3 text-left transition active:scale-[0.98]',
          on ? 'bg-accent/14 ring-2 ring-inset ring-accent' : 'bg-surface')}>
        <span class=${cx('flex items-center gap-2', on ? 'text-accent' : 'text-ink')}><${Icon} name=${it.icon} class="size-5" /><span class="t-head">${it.label}</span></span>
        <span class="t-small text-ink-3">${it.hint}</span>
      </button>`;
    })}
  </div>`;
}

const PoolTile = ({ i, label }) => {
  const c = POOL_HUES[i % POOL_HUES.length];
  return html`<span class="grid size-10 shrink-0 place-items-center rounded-full text-[1rem] font-semibold"
    style=${{ background: `color-mix(in srgb, ${c} 20%, transparent)`, color: c }} aria-hidden="true">${(String(label || '?').trim()[0] || '?').toUpperCase()}</span>`;
};

const sharedBy = pool => [pool.roles.bartender && 'Bar', pool.roles.server && 'Servers', pool.includeSupport && 'Support'].filter(Boolean).join(' + ') || 'Nobody';

// ── Shift ────────────────────────────────────────────────────────────────────
function ShiftInfo({ vm }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const s = vm.state;
  const { sessions, currentId } = sessionInfo();
  const entry = sessions.find(e => e.id === currentId) || {};
  const type = s.meta.shiftType || 'night';
  return html`<div class="flex flex-col gap-6">
    <${Section} title="Date">
      <${List}><${Item} icon="calendar" title=${fmtDay(s.meta.date)} sub="Shift date" aria-expanded=${String(calendarOpen)} onClick=${() => setCalendarOpen(!calendarOpen)} /><//>
      ${calendarOpen && html`<${SessionDate} vm=${vm} />`}
    <//>
    <${Section} title="Shift type" footer="Lays out the pools: Night is one pool for the whole shift; Day is Day (bar + servers until the servers are out) then Mid (the bar’s). Change a pool on Pools.">
      <${Choice} value=${type} onPick=${t => App.setShiftType(t)}
        items=${SHIFT_TYPES.map(t => ({ value: t, label: SHIFT_LABEL[t], icon: TYPE_ICON[t], hint: TYPE_HINT[t] }))} />
    <//>
    <${Section} title="Settings"><${List}>
      <${SwitchRow} icon="users" on=${s.settings.allRoles} onClick=${() => App.toggleSetting('allRoles')} label="Servers & support"
        hint=${s.settings.allRoles ? 'Role sections on Staff, who shares each pool, the support tip-out' : 'Everyone’s a bartender (a night’s usual)'} />
    <//><//>
    <${Field} page label="Session name" value=${entry.name || ''} placeholder="e.g. Brunch, Private party" maxlength="40" enterkeyhint="done"
      onChange=${e => App.renameCurrent(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
    ${currentTab() === 'shift' && html`<${ShiftDefaults} vm=${vm} />`}
    <${Section} title="This session"><${List}>
      <${Item} icon="download" title="Export JSON" chevron=${false} onClick=${() => App.exportSession()} />
      <${Item} icon="trash" tone="danger" title="Delete session" chevron=${false} onClick=${() => App.deleteSession(currentId)} />
    <//><//>
  </div>`;
}

// ── Pools ────────────────────────────────────────────────────────────────────
function Pools({ vm }) {
  const s = vm.state;
  return html`<div class="flex flex-col gap-6">
    <${Section} title="Tip pools" aside=${s.pools.length + (s.pools.length === 1 ? ' pool' : ' pools')}
      footer="A pool is a pile of tips split by the hours worked inside its window. Tap one to change it; its cash goes in on Tips.">
      <${List}>
        ${s.pools.map((pool, i) => {
          const vp = vm.pools.find(p => p.id === pool.id);
          return html`<${Item} key=${pool.id} lead=${html`<${PoolTile} i=${i} label=${pool.label} />`} title=${pool.label || 'Pool'}
            sub=${(pool.kind === 'night' ? 'Whole shift' : windowSub(pool, vp)) + ' · ' + sharedBy(pool)}
            value=${vp && vp.total > 0 ? fmtMoney(vp.total) : '—'} valueTone=${vp && vp.total > 0 ? '' : 'text-ink-3'}
            onClick=${() => openPool(pool.id)} />`;
        })}
        <${Item} icon="gift" title=${html`<span class="text-accent">Add a party</span>`} sub="A private event’s own tips over its own window" chevron=${false} onClick=${() => App.addParty()} />
        <${Item} icon="plus" title=${html`<span class="text-accent">Add a pool</span>`} chevron=${false} onClick=${() => App.addPool()} />
      <//>
    <//>
    <${SupportDefault} vm=${vm} />
    <${List}>
      <${Item} icon="gift" title="Closer bonus & chump" sub="Who gets the dollars left after rounding" onClick=${() => App.tab('pay', { sub: 'bonus' })} />
    <//>
  </div>`;
}

// A pool's own page: what it is (not its cash).
function PoolPage({ vm, id }) {
  const pool = vm.state.pools.find(p => p.id === id);
  if (!pool) return html`<div class="t-body py-12 text-center text-ink-3">This pool was removed.</div>`;
  const vmPool = vm.pools.find(p => p.id === id);
  const adj = vmPool?.adjust || 0;
  const kind = PRESETS.includes(pool.kind) ? pool.kind : '';
  return html`<div class="flex flex-col gap-6">
    <${Field} page label="Name" value=${pool.label} placeholder="Night" onInput=${e => App.poolLabel(pool.id, e.target.value)} />
    <${Section} title="Preset" footer=${kind ? PRESET_HINT[kind] + '. Pick another to reset the window and who shares it.' : 'Custom: set the window and who shares it below, or pick a preset.'}>
      <${Choice} value=${kind} onPick=${k => App.poolPreset(pool.id, k)}
        items=${PRESETS.map(k => ({ value: k, label: PRESET_LABEL[k], icon: PRESET_ICON[k], hint: PRESET_HINT[k] }))} />
    <//>
    ${kind !== 'night' && html`<${Section} title="Window" footer="Only hours inside the window share this pool. Tap a time to type it; a chip makes the edge follow the floor.">
      <div class="flex flex-col gap-3 rounded-card bg-surface p-3">
        ${kind === 'party' && !pool.window.start.trim() && !pool.window.end.trim()
          && html`<span class="t-small text-warn">Set when the party started and ended.</span>`}
        <${WindowEdge} vm=${vm} pool=${pool} vmPool=${vmPool} which="start" />
        <${WindowEdge} vm=${vm} pool=${pool} vmPool=${vmPool} which="end" />
      </div>
    <//>`}
    <div class="flex flex-col overflow-clip rounded-card bg-surface">
      <${SharedBy} pool=${pool} />
      ${pool.includeSupport && html`<div class="border-t border-line"><${SupportBox} pool=${pool} vm=${vm} vmPool=${vmPool} /></div>`}
    </div>
    <${List}>
      <${Item} icon="swap" title="Register over / short" sub="After counting the register — the split is redone"
        value=${adj ? (adj < 0 ? '−' : '+') + fmtMoney(Math.abs(adj)) : 'None'} valueTone=${adj ? (adj < 0 ? 'text-bad' : 'text-good') : 'text-ink-3'}
        onClick=${() => openCashSheet('adjust', pool.id)} />
      ${vm.state.pools.length > 1 && html`<${Item} icon="trash" tone="danger" title="Remove this pool" chevron=${false} onClick=${() => App.removePool(pool.id)} />`}
    <//>
  </div>`;
}

export function openPool(id) {
  pushPage({
    key: 'pool:' + id,
    title: lastVm?.state.pools.find(p => p.id === id)?.label || 'Pool',
    meta: vm => {
      const vp = vm.pools.find(p => p.id === id);
      const st = vm.state.pools.find(p => p.id === id);
      return st ? [{ v: fmtMoney(vp?.total || 0), l: 'in tips' }, { v: sharedBy(st) }] : [];
    },
    body: vm => html`<${PoolPage} vm=${vm} id=${id} />`,
  }, 'shift');
}

function Shift({ vm }) {
  return currentSub('shift') === 'pools' ? html`<${Pools} vm=${vm} />` : html`<${ShiftInfo} vm=${vm} />`;
}

let lastVm = null;
export function renderShift(vm) {
  lastVm = vm;
  const root = $('shift-root');
  if (root) render(html`<${Shift} vm=${vm} />`, root);
}
