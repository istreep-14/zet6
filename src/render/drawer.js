// Left panel (Preact) — sessions + app-wide settings. Opens from the header menu
// button, a drag in from the left edge, or a flick right past the first
// sub-tab (ui/panels.js). Lists every saved session (tap to switch), then the
// settings shared by all sessions. Shift-specific settings live in the right
// panel (render/shiftpanel.js). Re-renders with the app while open.

import { fmtMoney } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Button, Section, Seg, SwitchRow, ListRow, List, Item } from '../ui/pkit.js';
import { todayISO } from '../sessions.js';
import { isPanelOpen, onPanel } from '../ui/panels.js';

const $ = id => document.getElementById(id);

let editing = false;
let lastArgs = null;

onPanel('left', {
  open() { editing = false; if (lastArgs) renderDrawer(...lastArgs, true); $('drawer-body')?.scrollTo?.(0, 0); },
  close() { editing = false; },
});

export function toggleDrawerEdit() {
  editing = !editing;
  if (lastArgs) renderDrawer(...lastArgs, true);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}

function dayLabel(iso) {
  const d = parseISO(iso);
  if (!d) return 'No date';
  const today = todayISO();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === today) return 'Today';
  if (iso === todayISO(y)) return 'Yesterday';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

function DateTile({ iso, active }) {
  const d = parseISO(iso);
  const wk = d ? new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d) : '—';
  return html`<span class=${cx('flex size-10 shrink-0 flex-col items-center justify-center rounded-[0.625rem] leading-none',
    active ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink')}>
    <span class=${cx('text-[0.5625rem] font-semibold uppercase tracking-[.06em]', active ? 'text-on-accent/75' : 'text-ink-3')}>${wk}</span>
    <span class="t-head mt-0.5 leading-none tabular-nums">${d ? d.getDate() : '?'}</span>
  </span>`;
}

function SessionRow({ e, active }) {
  const title = e.name || dayLabel(e.date) + (e.nth ? ' · ' + e.nth : '');
  const sub = [
    e.name ? dayLabel(e.date) : '',
    e.people ? `${e.people} ${e.people === 1 ? 'person' : 'people'}` : 'No staff yet',
  ].filter(Boolean).join(' · ');
  const iconBtn = 'grid size-9 place-items-center rounded-full';
  const t = html`<span class="truncate">${title}</span>`;
  const lead = html`<${DateTile} iso=${e.date} active=${active} />`;
  if (editing) {
    return html`<${Item} lead=${lead} title=${t} sub=${sub} tone=${active ? 'active' : ''} trail=${html`<span class="flex shrink-0 gap-1.5">
        <button class=${cx(iconBtn, 'bg-surface-2 text-ink-2 active:opacity-70')} onClick=${() => App.renameSession(e.id)} aria-label="Rename"><${Icon} name="pencil" class="size-4" /></button>
        <button class=${cx(iconBtn, 'bg-bad/12 text-bad active:opacity-70')} onClick=${() => App.deleteSession(e.id)} aria-label="Delete"><${Icon} name="trash" class="size-4" /></button>
      </span>`} />`;
  }
  return html`<${Item} lead=${lead} title=${t} sub=${sub} tone=${active ? 'active' : ''} chevron=${false}
    onClick=${() => App.switchSession(e.id)} aria-current=${active ? 'true' : 'false'}
    value=${e.total > 0 ? fmtMoney(e.total) : '—'} valueTone=${e.total > 0 ? 'text-ink' : 'text-ink-3'} />`;
}

function Drawer({ vm, sessions, currentId }) {
  const s = vm.state;
  const extraPools = s.pools.length > 1;
  const rows = sessions.map(e => e.id === currentId
    ? { ...e, date: s.meta.date, total: vm.totalCash || 0, people: s.staff.filter(p => p.name.trim()).length }
    : { ...e });
  // Unnamed sessions sharing a date read "Today", "Today · 2" … (oldest first).
  const byDate = {};
  [...rows].reverse().forEach(e => {
    if (e.name) return;
    byDate[e.date] = (byDate[e.date] || 0) + 1;
    if (byDate[e.date] > 1) e.nth = byDate[e.date];
  });
  const toggle = key => () => App.toggleSetting(key);

  return html`
    <${Button} variant="primary" block icon="plus" onClick=${() => App.newSession()}>New session<//>

    <${Section} title="Sessions" aside=${(rows.length > 1 || editing) && html`<button class="font-semibold text-accent" onClick=${() => App.drawerEdit()}>${editing ? 'Done' : 'Edit'}</button>`}
      footer=${editing && 'Deleting a session can’t be undone. Export it first to keep a copy.'}>
      <${List}>${rows.map(e => html`<${SessionRow} key=${e.id} e=${e} active=${e.id === currentId} />`)}<//>
    <//>

    <${Section} title="Appearance">
      <${List}>
        <${Item} chevron=${false} title=${html`<${Seg} class="flex-1" value=${s.settings.theme || 'system'} onChange=${v => App.setTheme(v)}
          items=${[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]} />`} />
        <${Item} title="Display size" chevron=${false}>
          <${Seg} value=${s.settings.size || 'm'} onChange=${v => App.setSize(v)}
            items=${[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} />
        <//>
      <//>
    <//>

    <${Section} title="App settings" footer="Shared by every session. Swipe in from the right edge for this shift’s date, times and tools.">
      <${List}>
        <${SwitchRow} icon="users" on=${s.settings.allRoles} onClick=${toggle('allRoles')} label="Servers & support" hint="Role sections, support tip-out, who-shares chips" />
        <${SwitchRow} icon="cash" on=${s.settings.multiPool || extraPools} disabled=${extraPools} onClick=${toggle('multiPool')} label="Multiple pools"
          hint=${extraPools ? `On while ${s.pools.length} pools exist — remove extras to turn off` : 'Split tips by time window (e.g. lunch / dinner)'} />
        <${SwitchRow} icon="clock" on=${s.settings.clock24} onClick=${toggle('clock24')} label="24-hour time" hint="Show 17:00 instead of 5:00p" />
      <//>
    <//>

    <${Section} title="More">
      <${List}>
        <${ListRow} icon="upload" chevron=${false} onClick=${() => App.triggerImport()}>Import a session (.json)<//>
        <${ListRow} icon="sliders" onClick=${() => App.panel('right')}>This shift’s settings<//>
      <//>
    <//>`;
}

// sessions: [{ id, name, date, total, people }], currentId. The current
// session's numbers come live from the view model, not the saved summary.
export function renderDrawer(vm, sessions, currentId, force = false) {
  lastArgs = [vm, sessions, currentId];
  if (!force && !isPanelOpen('left')) return;
  const body = $('drawer-body');
  if (body) render(html`<${Drawer} vm=${vm} sessions=${sessions} currentId=${currentId} />`, body);
}
