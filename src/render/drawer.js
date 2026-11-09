// Left panel (Preact) — sessions + app-wide settings. Opens from the header menu
// button, a drag in from the left edge, or a flick right past the first
// sub-tab (ui/panels.js). Lists every saved session (tap to switch), then the
// settings shared by all sessions. Shift-specific settings live in the right
// panel (render/shiftpanel.js). Re-renders with the app while open.

import { fmtMoney } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Button, Label, Seg, SwitchRow, ListRow, List, Item } from '../ui/pkit.js';
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
  return html`<span class=${cx('flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl leading-none',
    active ? 'bg-gold text-gold-ink' : 'bg-white/8 text-ink')}>
    <span class=${cx('text-[0.625rem] font-bold uppercase tracking-[.08em]', active ? 'text-gold-ink/70' : 'text-ink-3')}>${wk}</span>
    <span class="mt-0.5 font-rounded text-[1.25rem] font-bold tabular-nums">${d ? d.getDate() : '?'}</span>
  </span>`;
}

function SessionRow({ e, active }) {
  const title = e.name || dayLabel(e.date) + (e.nth ? ' · ' + e.nth : '');
  const sub = [
    e.name ? dayLabel(e.date) : '',
    e.people ? `${e.people} ${e.people === 1 ? 'person' : 'people'}` : 'No staff yet',
  ].filter(Boolean).join(' · ');
  const iconBtn = 'grid size-10 place-items-center rounded-full';
  const t = html`<span class="truncate">${title}</span>${active && html`<span class="size-1.5 shrink-0 rounded-full bg-gold"></span>`}`;
  const lead = html`<${DateTile} iso=${e.date} active=${active} />`;
  if (editing) {
    return html`<${Item} lead=${lead} title=${t} sub=${sub} tone=${active ? 'active' : ''} trail=${html`<span class="flex shrink-0 gap-1.5">
        <button class=${cx(iconBtn, 'bg-fill text-ink-2 active:bg-high')} onClick=${() => App.renameSession(e.id)} aria-label="Rename"><${Icon} name="pencil" class="size-[1.0625rem]" /></button>
        <button class=${cx(iconBtn, 'bg-red/15 text-red active:bg-red/25')} onClick=${() => App.deleteSession(e.id)} aria-label="Delete"><${Icon} name="trash" class="size-[1.0625rem]" /></button>
      </span>`} />`;
  }
  return html`<${Item} lead=${lead} title=${t} sub=${sub} tone=${active ? 'active' : ''} chevron=${false}
    onClick=${() => App.switchSession(e.id)} aria-current=${active ? 'true' : 'false'}
    value=${e.total > 0 ? fmtMoney(e.total) : '—'} valueTone=${cx('text-[1.125rem]', e.total > 0 ? (active ? 'text-gold' : 'text-ink') : 'text-ink-3')} />`;
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

    <${Label} aside=${(rows.length > 1 || editing) && html`<button class="font-semibold text-gold" onClick=${() => App.drawerEdit()}>${editing ? 'Done' : 'Edit'}</button>`}>Sessions<//>
    <${List}>${rows.map(e => html`<${SessionRow} key=${e.id} e=${e} active=${e.id === currentId} />`)}<//>
    ${editing && html`<p class="px-1 text-[0.8125rem] leading-snug text-ink-3">Deleting a session can’t be undone. Export it first to keep a copy.</p>`}

    <${Label}>App settings<//>
    <${List}>
      <${SwitchRow} on=${s.settings.allRoles} onClick=${toggle('allRoles')} label="Servers & support" hint="Role sections, support tip-out, who-shares chips" />
      <${SwitchRow} on=${s.settings.multiPool || extraPools} disabled=${extraPools} onClick=${toggle('multiPool')} label="Multiple pools"
        hint=${extraPools ? `On while ${s.pools.length} pools exist — remove extras to turn off` : 'Split tips by time window (e.g. lunch / dinner)'} />
      <${SwitchRow} on=${s.settings.clock24} onClick=${toggle('clock24')} label="24-hour time" hint="Show 17:00 instead of 5:00p" />
      <${Item} title="Display size" chevron=${false}>
        <${Seg} value=${s.settings.size || 'm'} onChange=${v => App.setSize(v)}
          items=${[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} />
      <//>
    <//>

    <${List}>
      <${ListRow} icon="upload" chevron=${false} onClick=${() => App.triggerImport()}>Import a session (.json)<//>
      <${ListRow} icon="sliders" onClick=${() => App.panel('right')}>This shift’s settings<//>
    <//>
    <p class="px-1 pt-1 text-center text-[0.8125rem] leading-snug text-ink-3">Shared by every session. Swipe in from the right edge for this shift’s date, times and tools.</p>`;
}

// sessions: [{ id, name, date, total, people }], currentId. The current
// session's numbers come live from the view model, not the saved summary.
export function renderDrawer(vm, sessions, currentId, force = false) {
  lastArgs = [vm, sessions, currentId];
  if (!force && !isPanelOpen('left')) return;
  const body = $('drawer-body');
  if (body) render(html`<${Drawer} vm=${vm} sessions=${sessions} currentId=${currentId} />`, body);
}
