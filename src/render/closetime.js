// Close-time what-if sheet: the same split re-run for close times around the
// current one, side by side. Tap a column head to make it the close time;
// pinch the table to widen / narrow the range.

import { parseTime } from '../time.js';
import { buildCloseTimeColumn } from '../viewmodel.js';
import { setGlobalDefault } from '../store.js';
import { html, cx, mount } from '../ui/html.js';
import { openSheet, isOpen, sheetBody } from '../ui/sheet.js';
import { liveStrip } from './tabs.js';

let vmRef = null;
let ctRange = 3;
let ctCenter = 2;

export function openCloseTime(vm) {
  vmRef = vm;
  if (!vm?.shares || !vm.totalCash) return;
  const gcOut = parseTime(vm.state.defaults.global.out);
  ctCenter = gcOut.valid && !gcOut.empty ? gcOut.value : 2;
  openSheet('sheet-close');
  renderCloseTime(vm);
}

export function selectCloseTime(t) {
  setGlobalDefault('out', String(t));
  ctCenter = t;
}

function fmtCloseTime(t) {
  let hr = Math.floor(t), mn = Math.round((t - hr) * 60);
  if (mn === 60) { hr++; mn = 0; }
  return (hr % 12 || 12) + (mn > 0 ? ':' + (mn < 10 ? '0' : '') + mn : '') + (t <= 5 ? 'a' : 'p');
}

export function renderCloseTime(vm) {
  vmRef = vm;
  if (!isOpen('sheet-close')) return;
  const body = sheetBody('sheet-close');
  if (!vm.shares || !vm.bills) {
    mount(body, html`<div class="py-10 text-center text-ink-2">${vm.blocked || 'Enter cash and staff first.'}</div>`);
    return;
  }

  const times = [];
  for (let i = -ctRange; i <= ctRange; i++) {
    const t = Math.round((ctCenter + i * 0.25) * 4) / 4;
    if (t > 0 && t <= 12) times.push(t);
  }
  const cols = times.map(t => buildCloseTimeColumn(vm.state, t, vm.bills));
  const nowIdx = times.findIndex(t => Math.abs(t - ctCenter) < 0.01);

  mount(body, html`${liveStrip(vm)}
    <p class="text-[14px] leading-snug text-ink-3">Tap a time to make it the close. Pinch the table to widen or narrow the range.</p>
    ${tableHTML(vm, times, cols, vm.bills, nowIdx)}`);

  const wrap = body.querySelector('[data-pinch]');
  let d0 = 0;
  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  wrap.addEventListener('touchstart', e => { if (e.touches.length === 2) d0 = dist(e); }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !d0) return;
    const d = dist(e);
    if (Math.abs(d - d0) < 28) return;
    ctRange = d > d0 ? Math.min(ctRange + 1, 9) : Math.max(ctRange - 1, 1);
    d0 = d;
    renderCloseTime(vmRef);
  }, { passive: true });
  wrap.addEventListener('touchend', () => { d0 = 0; }, { passive: true });
}

function tableHTML(vm, times, cols, pool, nowIdx) {
  const people = vm.shares.perPerson;
  const now = i => i === nowIdx && 'bg-gold/15';
  const td = 'whitespace-nowrap px-1.5 py-3 text-center tabular-nums';
  const name = 'sticky left-0 z-[1] max-w-[100px] truncate bg-raised py-3 pl-3.5 pr-2 text-left font-semibold';
  const dash = i => html`<td class="${cx(td, 'text-ink-3', now(i))}">—</td>`;

  const avail15 = (pool[1] || 0) + (pool[5] || 0) * 5;
  const avail1510 = avail15 + (pool[10] || 0) * 10;
  const reqRow = (label, get) => html`<tr class="border-t border-sep">
    <td class="${cx(name, 'font-normal text-ink-2')}">${label}</td>
    ${cols.map((c, i) => {
      if (!c) return dash(i);
      const { ok, val } = get(c);
      return html`<td class="${cx(td, ok ? 'text-green' : 'font-bold text-red', now(i))}">${val}</td>`;
    })}</tr>`;

  return html`<div class="overflow-x-auto rounded-card bg-raised" data-pinch>
    <table class="w-full border-collapse text-[15px]">
      <thead><tr>
        <th class="${cx(name, 'text-[12px] font-medium text-ink-2')}">Close</th>
        ${times.map((t, i) => html`<th class="${cx(td, 'min-w-[60px] cursor-pointer font-semibold', i === nowIdx ? 'bg-gold/15 text-gold' : 'text-ink')}" onclick="App.selectCloseTime(${t})">${fmtCloseTime(t)}</th>`)}
      </tr></thead>
      <tbody>
        ${people.map(person => html`<tr class="border-t border-sep">
          <td class="${name}">${person.name}</td>
          ${cols.map((col, i) => {
            const p = col?.shares.perPerson.find(x => x.id === person.id);
            if (!p || p.final <= 0) return dash(i);
            return html`<td class="${cx(td, p.closer && 'font-bold text-red', now(i))}">$${p.final}</td>`;
          })}</tr>`)}
        <tr class="border-t border-sep text-ink-2">
          <td class="${name}">Chump</td>
          ${cols.map((c, i) => c?.shares.leftover ? html`<td class="${cx(td, now(i))}">$${c.shares.leftover}</td>` : dash(i))}
        </tr>
        <tr class="border-t border-sep"><td colspan="${times.length + 1}" class="px-3.5 pb-1.5 pt-4 text-[13px] font-semibold text-ink-2">Small bills needed</td></tr>
        ${reqRow('$1s', c => ({ ok: c.req.minOnes <= (pool[1] || 0), val: c.req.minOnes }))}
        ${reqRow('$1+5', c => ({ ok: c.req.minOneFiveValue <= avail15, val: '$' + c.req.minOneFiveValue }))}
        ${reqRow('$1+5+10', c => ({ ok: c.req.minOneFiveTenValue <= avail1510, val: '$' + c.req.minOneFiveTenValue }))}
      </tbody>
    </table>
  </div>`;
}
