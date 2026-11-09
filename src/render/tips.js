// Tips tab — one pool's card at a time. A normal night is one pool; its
// Net total / Count bills choice is the tab's swipeable sub-tab header. With
// several pools, the header lists the pools (swipe between them) and each
// card has its own entry mode, time window, roles and cash. Structural changes re-render;
// keystrokes patch totals in place so inputs keep focus.

import { DENOMS, parseWholeNumber, fmtHrs, fmtMoney } from '../util.js';
import { fmtTimeAbs, overlapHours } from '../time.js';
import { html, cx, mount } from '../ui/html.js';
import { activeSub } from './tabs.js';
import { Card, Seg, Chip, Field, Button, Denom, Alert, INPUT } from '../ui/kit.js';

const $ = id => document.getElementById(id);

let lastSignature = '';

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));
const SUB = 'flex flex-col gap-2.5';
const EYEBROW = 'text-[14px] font-medium text-ink-2';

function windowSub(pool, vmPool) {
  const start = pool.window.start.trim();
  const end = pool.window.end.trim();
  if (!start && !end) return 'Whole shift';
  const fmt = (raw, abs) => abs != null ? fmtTimeAbs(abs) : (raw || '?');
  return fmt(start, vmPool?.startAbs) + ' – ' + fmt(end, vmPool?.endAbs);
}

function chipsHTML(pool) {
  return html`<div class="${SUB}">
    <span class="${EYEBROW}">Shared by</span>
    <div class="flex gap-2">
      ${Chip({ on: pool.roles.bartender, role: 'bartender', onclick: `App.poolRole('${pool.id}','bartender')` }, 'Bar')}
      ${Chip({ on: pool.roles.server, role: 'server', onclick: `App.poolRole('${pool.id}','server')` }, 'Servers')}
      ${Chip({ on: pool.includeSupport, role: 'support', onclick: `App.poolRole('${pool.id}','support')` }, 'Support')}
    </div>
  </div>`;
}

function supCutText(sPool) {
  const sup = sPool?.support;
  return sup && sup.cut > 0 ? `−$${fmtAmt(sup.cut)} support · $${fmtAmt(sPool.tippedTotal)} bar/srv` : '';
}

// Support tip-out — shown when the Support chip is on. % and $/hr inherit as
// placeholders; per-person hours default to their overlap with the window.
function supportHTML(pool, vm, vmPool) {
  if (!pool.includeSupport) return '';
  const sPool = vm.shares?.perPool.find(p => p.id === pool.id);
  const sup = sPool?.support;
  const supStaff = (vm.resolved?.staff || []).filter(p => p.role === 'support');
  const cfg = pool.support || { pct: '', rate: '', hours: {} };
  const pctPh = String(vm.state.defaults.supportPct || '').trim() || '10';

  const rows = supStaff.map(p => {
    const auto = vmPool ? overlapHours(p.inAbs, p.outAbs, vmPool.startAbs, vmPool.endAbs) : 0;
    const part = sPool?.participants.find(x => x.id === p.id);
    return html`<div class="grid grid-cols-[minmax(0,1fr)_64px_14px_72px] items-center gap-2 text-[15px]" data-sup-row="${p.id}">
      <span class="truncate">${p.name}</span>
      <input class="${cx(INPUT, 'h-10 text-center font-semibold')}" data-sup-hrs inputmode="decimal" placeholder="${fmtHrs(auto)}"
        aria-label="${p.name} hours" value="${cfg.hours?.[p.id] ?? ''}" oninput="App.poolSupportHours('${pool.id}','${p.id}',this.value)">
      <span class="text-ink-2">h</span>
      <span class="text-right font-semibold tabular-nums" data-sup-amt>${part ? '$' + fmtAmt(part.raw) : '—'}</span>
    </div>`;
  });

  return html`<div class="flex flex-col gap-3 rounded-2xl bg-sup/8 p-4 ring-1 ring-sup/20">
    <div class="flex items-baseline justify-between gap-2">
      <span class="${EYEBROW}">Support tip-out</span>
      <span class="text-right text-[13px] font-medium text-sup" data-sup-cutline>${supCutText(sPool)}</span>
    </div>
    <div class="flex gap-3">
      ${Field({ label: 'Percent', inputmode: 'decimal', 'data-sup-pct': true, placeholder: pctPh, value: cfg.pct ?? '', oninput: `App.poolSupport('${pool.id}','pct',this.value)` })}
      ${Field({ label: '$ / hour', inputmode: 'decimal', 'data-sup-rate': true, placeholder: sup ? fmtAmt(sup.derivedRate) : '0', value: cfg.rate ?? '', oninput: `App.poolSupport('${pool.id}','rate',this.value)` })}
    </div>
    ${rows.length ? rows : html`<div class="text-[14px] text-ink-3">No support staff named yet.</div>`}
  </div>`;
}

function billSub(raw, d) {
  const parsed = parseWholeNumber(raw ?? '');
  const sub = parsed.valid ? parsed.value * d : 0;
  return {
    text: !parsed.valid ? '!' : sub > 0 ? fmtMoney(sub) : '—',
    cls: cx('text-right text-[18px] font-semibold tabular-nums', !parsed.valid ? 'text-red' : sub > 0 ? 'text-ink' : 'text-ink-3'),
  };
}

function billsHTML(pool) {
  return html`<div class="flex flex-col divide-y divide-sep rounded-2xl bg-fill-2 px-3.5 py-1">
    ${DENOMS.map(d => {
      const v = pool.cash.billCounts[d] ?? '';
      const s = billSub(v, d);
      return html`<div class="grid grid-cols-[56px_minmax(0,1fr)_76px] items-center gap-3 py-1.5 max-[400px]:grid-cols-[50px_minmax(0,1fr)_64px] max-[400px]:gap-2.5">
        ${Denom(d)}
        <div class="flex items-center rounded-full bg-fill focus-within:ring-2 focus-within:ring-gold">
          <button class="grid size-[46px] shrink-0 place-items-center rounded-full text-[24px] active:bg-fill" onclick="App.billStep('${pool.id}','${d}',-1)" aria-label="One fewer $${d}" tabindex="-1">−</button>
          <input class="h-[46px] w-full min-w-0 bg-transparent text-center text-[20px] font-semibold text-ink outline-none placeholder:text-ink-3"
            type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint="next" data-bill="${d}"
            aria-label="$${d} bills" value="${v}" oninput="App.poolBill('${pool.id}','${d}',this.value)" onkeydown="App.billKey(event,'${pool.id}')">
          <button class="grid size-[46px] shrink-0 place-items-center rounded-full text-[24px] active:bg-fill" onclick="App.billStep('${pool.id}','${d}',1)" aria-label="One more $${d}" tabindex="-1">+</button>
        </div>
        <span class="${s.cls}" data-sub="${d}">${s.text}</span>
      </div>`;
    })}
  </div>`;
}

function netHTML(pool) {
  return html`<div class="relative">
    <span class="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 font-rounded text-[32px] font-semibold text-ink-3">$</span>
    <input class="${cx(INPUT, 'h-[84px] rounded-2xl pl-12 font-rounded text-[42px] font-bold tracking-tight')}"
      type="number" min="0" step="1" placeholder="0" inputmode="numeric" data-net aria-label="Net total"
      value="${pool.cash.netTotal}" oninput="App.poolNet('${pool.id}',this.value)">
  </div>`;
}

// What a card shows depends on the session's complexity:
//   single pool             → always open, no window, no label
//   roles off + single pool → no "Shared by" chips either (everyone shares)
function cardHTML(pool, vm, removable) {
  const single = vm.state.pools.length === 1;
  const showChips = vm.state.settings.allRoles || !single;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const mode = pool.cash.entryMode;

  return Card({ flush: true, 'data-pid': pool.id },
    html`<div class="flex w-full items-center gap-3 px-4 pb-3 pt-4 text-left">
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[17px] font-semibold" data-pool-name>${single ? 'Tonight’s tips' : pool.label}</span>
        <span class="text-[14px] text-ink-2" data-window-sub>${windowSub(pool, vmPool)}</span>
      </span>
      <span class="${cx('font-rounded text-[30px] font-bold tracking-tight tabular-nums', !total && 'text-ink-3')}" data-pool-total>${fmtMoney(total)}</span>
    </div>
    ${html`<div class="flex flex-col gap-5 px-4 pb-4 pt-1">
      <div class="${SUB}">
        ${!single && Seg({ items: [{ value: 'nettotal', label: 'Net total' }, { value: 'perbill', label: 'Count bills' }], value: mode, handler: v => `App.poolMode('${pool.id}','${v}')` })}
        ${mode === 'perbill' ? billsHTML(pool) : netHTML(pool)}
      </div>
      ${showChips && chipsHTML(pool)}
      ${supportHTML(pool, vm, vmPool)}
      ${!single && html`<div class="${SUB}">
        <span class="${EYEBROW}">Window <span class="font-normal text-ink-3">· blank = whole shift</span></span>
        <div class="flex gap-3">
          ${Field({ label: 'Start', inputmode: 'decimal', placeholder: 'open', value: pool.window.start, oninput: `App.poolWindow('${pool.id}','start',this.value)` })}
          ${Field({ label: 'End', inputmode: 'decimal', placeholder: 'close', value: pool.window.end, oninput: `App.poolWindow('${pool.id}','end',this.value)` })}
        </div>
      </div>
      ${Field({ label: 'Label', value: pool.label, oninput: `App.poolLabel('${pool.id}',this.value)` })}`}
      ${removable && Button({ variant: 'danger', size: 'sm', class: 'self-start', onclick: `App.removePool('${pool.id}')` }, 'Remove pool')}
    </div>`}`);
}

// Suggested drawer — single-pool net-total sessions: which bills to pull.
function breakdownHTML(vm) {
  if (vm.state.pools.length !== 1 || vm.state.pools[0].cash.entryMode !== 'nettotal') return '';
  if (!vm.bills || vm.totalCash <= 0) return '';
  const notes = { 20: 'fill', 10: 'min', 5: 'min', 1: 'min' };
  const rows = [20, 10, 5, 1].filter(d => vm.bills[d]).map(d => html`<div class="grid grid-cols-[56px_1fr_auto] items-center gap-3 py-2.5">
    ${Denom(d)}<span class="text-[15px] text-ink-2">× ${vm.bills[d]} <small class="ml-1 text-[13px] text-ink-3">${notes[d]}</small></span>
    <span class="text-[17px] font-semibold tabular-nums">${fmtMoney(vm.bills[d] * d)}</span></div>`);
  return Card({},
    html`<div class="mb-1 text-[14px] font-medium text-ink-2">Suggested bills for ${fmtMoney(vm.totalCash)}</div>
    <div class="divide-y divide-sep">${rows}</div>`);
}

export function renderTips(vm) {
  const root = $('tips-root');
  if (!root) return;
  const state = vm.state;

  const supIds = (vm.resolved?.staff || []).filter(p => p.role === 'support').map(p => p.id).join('.');
  const signature = state.pools.map(p =>
    p.id + ':' + p.cash.entryMode + ':' + (p.roles.bartender ? 1 : 0) + (p.roles.server ? 1 : 0) + (p.includeSupport ? 1 : 0)
      + (p.includeSupport ? ':' + supIds : '')
  ).join('|') + '|' + state.ui.selectedPool + '|' + activeSub('tips', state)
    + '|' + (state.settings.allRoles ? 'R' : 'r') + (state.settings.multiPool ? 'M' : 'm');

  const sel = activeSub('tips', state);
  const err = vm.inputError && /total|count|window|support/i.test(vm.blocked) ? vm.blocked : '';

  if (signature !== lastSignature) {
    lastSignature = signature;
    mount(root, html`<div class="flex flex-col gap-3">
      <div id="tips-error" class="empty:hidden">${err && Alert({}, err)}</div>
      ${state.pools.filter(p => state.pools.length === 1 || p.id === sel).map(pool => cardHTML(pool, vm, state.pools.length > 1))}
      ${(state.settings.multiPool || state.pools.length > 1) && Button({ variant: 'tonal', block: true, icon: 'plus', onclick: 'App.addPool()' }, 'Add pool')}
      <div id="tips-breakdown" class="empty:hidden">${breakdownHTML(vm)}</div>
    </div>`);
    return;
  }

  // Patch pass: error, totals, subtotals, window subtitle, names, support, breakdown.
  mount($('tips-error'), err && Alert({}, err));
  state.pools.forEach(pool => {
    const card = root.querySelector(`[data-pid="${pool.id}"]`);
    if (!card) return;
    const vmPool = vm.pools.find(p => p.id === pool.id);
    const total = vmPool ? vmPool.total : 0;

    const totalEl = card.querySelector('[data-pool-total]');
    totalEl.textContent = fmtMoney(total);
    totalEl.classList.toggle('text-ink-3', !total);
    const nameEl = card.querySelector('[data-pool-name]');
    const shown = state.pools.length === 1 ? 'Tonight’s tips' : pool.label;
    if (nameEl.textContent !== shown) nameEl.textContent = shown;
    card.querySelector('[data-window-sub]').textContent = windowSub(pool, vmPool);

    if (pool.includeSupport) {
      const sPool = vm.shares?.perPool.find(p => p.id === pool.id);
      const q = s => card.querySelector(s);
      if (q('[data-sup-pct]')) q('[data-sup-pct]').placeholder = String(state.defaults.supportPct || '').trim() || '10';
      if (q('[data-sup-rate]')) q('[data-sup-rate]').placeholder = sPool?.support ? fmtAmt(sPool.support.derivedRate) : '0';
      if (q('[data-sup-cutline]')) q('[data-sup-cutline]').textContent = supCutText(sPool);
      (vm.resolved?.staff || []).filter(p => p.role === 'support').forEach(p => {
        const row = card.querySelector(`[data-sup-row="${p.id}"]`);
        if (!row) return;
        const part = sPool?.participants.find(x => x.id === p.id);
        row.querySelector('[data-sup-amt]').textContent = part ? '$' + fmtAmt(part.raw) : '—';
        if (vmPool) row.querySelector('[data-sup-hrs]').placeholder = fmtHrs(overlapHours(p.inAbs, p.outAbs, vmPool.startAbs, vmPool.endAbs));
      });
    }

    if (pool.cash.entryMode === 'perbill') {
      DENOMS.forEach(d => {
        const cell = card.querySelector(`[data-sub="${d}"]`);
        if (!cell) return;
        const s = billSub(pool.cash.billCounts[d], d);
        cell.textContent = s.text;
        cell.className = s.cls;
      });
    }
  });
  mount($('tips-breakdown'), breakdownHTML(vm));
}

export function invalidateTips() {
  lastSignature = '';
}
