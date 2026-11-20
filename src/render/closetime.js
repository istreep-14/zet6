// Close-time what-if sheet (Preact): the same split re-run for close times around the
// current one, side by side. Tap a column head to make it the close time;
// pinch the table to widen / narrow the range.

import { parseTime } from '../time.js';
import { buildCloseTimeColumn } from '../viewmodel.js';
import { setGlobalDefault } from '../store.js';
import { html, render } from '../ui/preact.js';
import { cx, LiveStrip, Table } from '../ui/pkit.js';
import { openSheet, isOpen, sheetBody } from '../ui/sheet.js';

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

// Pinch on the table widens / narrows the range of close times.
let d0 = 0;
const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
const pinch = {
  onTouchStart: e => { if (e.touches.length === 2) d0 = dist(e); },
  onTouchMove: e => {
    if (e.touches.length !== 2 || !d0) return;
    const d = dist(e);
    if (Math.abs(d - d0) < 28) return;
    ctRange = d > d0 ? Math.min(ctRange + 1, 9) : Math.max(ctRange - 1, 1);
    d0 = d;
    renderCloseTime(vmRef);
  },
  onTouchEnd: () => { d0 = 0; },
};

function CloseTable({ vm, times, cols, pool, nowIdx }) {
  const people = vm.shares.perPerson;
  const dash = html`<span class="text-ink-3">—</span>`;
  const avail15 = (pool[1] || 0) + (pool[5] || 0) * 5;
  const avail1510 = avail15 + (pool[10] || 0) * 10;
  const req = (label, get) => ({ key: label, tone: 'muted', cells: [label, ...cols.map(c => {
    if (!c) return dash;
    const { ok, val } = get(c);
    return html`<span class=${ok ? 'text-good' : 'font-semibold text-bad'}>${val}</span>`;
  })] });
  return html`<div ...${pinch}><${Table} scroll stickyFirst
    cols=${[{ label: 'Close' }, ...times.map((t, i) => ({ head: fmtCloseTime(t), hl: i === nowIdx, onHead: () => App.selectCloseTime(t) }))]}
    rows=${[
      ...people.map(person => ({ key: person.id, cells: [person.name, ...cols.map(col => {
        const p = col?.shares.perPerson.find(x => x.id === person.id);
        return !p || p.final <= 0 ? dash : html`<span class=${p.closer ? 'font-semibold text-bad' : ''}>$${p.final}</span>`;
      })] })),
      { key: 'chump', tone: 'muted', cells: ['Chump', ...cols.map(c => c?.shares.leftover ? '$' + c.shares.leftover : dash)] },
      { section: 'Small bills needed' },
      req('$1s', c => ({ ok: c.req.minOnes <= (pool[1] || 0), val: c.req.minOnes })),
      req('$1+5', c => ({ ok: c.req.minOneFiveValue <= avail15, val: '$' + c.req.minOneFiveValue })),
      req('$1+5+10', c => ({ ok: c.req.minOneFiveTenValue <= avail1510, val: '$' + c.req.minOneFiveTenValue })),
    ]} /></div>`;
}

function CloseTime({ vm }) {
  if (!vm.shares || !vm.bills) {
    return html`<div class="py-10 text-center text-ink-2">${vm.blocked || 'Enter cash and staff first.'}</div>`;
  }
  const times = [];
  for (let i = -ctRange; i <= ctRange; i++) {
    const t = Math.round((ctCenter + i * 0.25) * 4) / 4;
    if (t > 0 && t <= 12) times.push(t);
  }
  const cols = times.map(t => buildCloseTimeColumn(vm.state, t, vm.bills));
  const nowIdx = times.findIndex(t => Math.abs(t - ctCenter) < 0.01);
  return html`<${LiveStrip} vm=${vm} />
    <p class="t-small px-1 text-ink-3">Tap a time to make it the close. Pinch the table to widen or narrow the range.</p>
    <${CloseTable} vm=${vm} times=${times} cols=${cols} pool=${vm.bills} nowIdx=${nowIdx} />`;
}

export function renderCloseTime(vm) {
  vmRef = vm;
  if (isOpen('sheet-close')) render(html`<${CloseTime} vm=${vm} />`, sheetBody('sheet-close'));
}
