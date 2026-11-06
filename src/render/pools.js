// Cash tab — accordion of pool cards. One pool covers a normal night; "+ Add
// pool" appends another with its own window / roles / cash. Structural changes
// re-render; keystrokes patch totals in place so inputs keep focus.

import { DENOMS, escapeHTML, parseWholeNumber, fmtHrs } from '../util.js';
import { fmtTimeAbs, overlapHours } from '../time.js';

const $ = id => document.getElementById(id);

let lastSignature = '';

const fmtAmt = v => String(parseFloat((v ?? 0).toFixed(2)));

function windowSub(pool, vmPool) {
  const start = pool.window.start.trim();
  const end = pool.window.end.trim();
  if (!start && !end) return 'Whole shift';
  const fmt = (raw, abs) => abs != null ? fmtTimeAbs(abs) : escapeHTML(raw || '?');
  return fmt(start, vmPool?.startAbs) + ' – ' + fmt(end, vmPool?.endAbs);
}

function chipsHTML(pool) {
  const chips = [
    { key: 'bartender', label: 'Bar', on: pool.roles.bartender },
    { key: 'server', label: 'Servers', on: pool.roles.server },
    { key: 'support', label: 'Support', on: pool.includeSupport },
  ];
  return chips.map(c =>
    `<button class="chip${c.on ? ' active' : ''}" data-role="${c.key}" aria-pressed="${c.on}"
      onclick="App.poolRole('${pool.id}','${c.key}')">${c.label}</button>`
  ).join('');
}

function supCutText(sPool) {
  const sup = sPool?.support;
  return sup && sup.cut > 0
    ? `−$${fmtAmt(sup.cut)} support · $${fmtAmt(sPool.tippedTotal)} bar/srv`
    : '';
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
  const ratePh = sup ? fmtAmt(sup.derivedRate) : '0';

  const rows = supStaff.map(p => {
    const auto = vmPool ? overlapHours(p.inAbs, p.outAbs, vmPool.startAbs, vmPool.endAbs) : 0;
    const typed = cfg.hours?.[p.id] ?? '';
    const part = sPool?.participants.find(x => x.id === p.id);
    return `<div class="sup-row" data-sup-row="${p.id}">
      <span class="sup-name">${escapeHTML(p.name)}</span>
      <input data-sup-hrs inputmode="decimal" placeholder="${fmtHrs(auto)}" aria-label="${escapeHTML(p.name)} hours"
        value="${escapeHTML(String(typed))}" oninput="App.poolSupportHours('${pool.id}','${p.id}',this.value)">
      <span class="muted">h</span>
      <span class="sup-amt" data-sup-amt>${part ? '$' + fmtAmt(part.raw) : '—'}</span>
    </div>`;
  }).join('');

  return `<div class="sup-box">
    <div class="sup-hdr"><span class="eyebrow">Support tip-out</span><span class="sup-cut" data-sup-cutline>${supCutText(sPool)}</span></div>
    <div class="field-row">
      <label class="field"><span>Percent</span>
        <input inputmode="decimal" data-sup-pct placeholder="${escapeHTML(pctPh)}"
          value="${escapeHTML(cfg.pct ?? '')}" oninput="App.poolSupport('${pool.id}','pct',this.value)"></label>
      <label class="field"><span>$ / hour</span>
        <input inputmode="decimal" data-sup-rate placeholder="${escapeHTML(ratePh)}"
          value="${escapeHTML(cfg.rate ?? '')}" oninput="App.poolSupport('${pool.id}','rate',this.value)"></label>
    </div>
    ${rows || '<div class="hint">No support staff named yet.</div>'}
  </div>`;
}

function billSub(raw, d) {
  const parsed = parseWholeNumber(raw ?? '');
  const sub = parsed.valid ? parsed.value * d : 0;
  return {
    text: !parsed.valid ? '!' : sub > 0 ? '$' + sub : '—',
    cls: 'bill-sub num' + (!parsed.valid ? ' err' : sub > 0 ? '' : ' zero'),
  };
}

// What a card shows depends on the session's complexity:
//   single pool             → no accordion, no window, no label
//   roles off + single pool → no "Shared by" chips either (everyone shares)
function cardHTML(pool, vm, isOpen, removable) {
  const single = vm.state.pools.length === 1;
  const showChips = vm.state.settings.allRoles || !single;
  if (single) isOpen = true;
  const vmPool = vm.pools.find(p => p.id === pool.id);
  const total = vmPool ? vmPool.total : 0;
  const mode = pool.cash.entryMode;

  const bills = `<div class="bills">${DENOMS.map(d => {
    const v = pool.cash.billCounts[d] ?? '';
    const s = billSub(v, d);
    return `<div class="bill-row">
      <span class="bill-denom">$${d}</span>
      <input type="number" min="0" step="1" placeholder="0" inputmode="numeric" enterkeyhint="next" data-bill="${d}"
        aria-label="$${d} bills" value="${escapeHTML(String(v))}"
        oninput="App.poolBill('${pool.id}','${d}',this.value)" onkeydown="App.billKey(event,'${pool.id}')">
      <span class="${s.cls}" data-sub="${d}">${s.text}</span>
    </div>`;
  }).join('')}</div>`;

  const net = `<div class="net-entry">
    <input type="number" min="0" step="1" placeholder="0" inputmode="numeric" data-net aria-label="Net total"
      value="${escapeHTML(pool.cash.netTotal)}" oninput="App.poolNet('${pool.id}',this.value)">
  </div>`;

  return `<div class="card pool${isOpen ? ' open' : ''}" data-pid="${pool.id}">
    <button class="pool-hdr" ${single ? 'disabled' : `onclick="App.selectPool('${pool.id}')"`} aria-expanded="${isOpen}">
      <span class="pool-hdr-main">
        <span class="pool-name" data-pool-name>${single ? 'Tips' : escapeHTML(pool.label)}</span>
        <span class="pool-sub" data-window-sub>${windowSub(pool, vmPool)}</span>
      </span>
      <span class="pool-total${total ? '' : ' zero'}" data-pool-total>$${total}</span>
      ${single ? '' : '<span class="chev"></span>'}
    </button>
    ${isOpen ? `<div class="pool-body">
      <div class="pool-sect">
        <div class="seg">
          <button class="seg-btn${mode === 'nettotal' ? ' active' : ''}" onclick="App.poolMode('${pool.id}','nettotal')">Net total</button>
          <button class="seg-btn${mode === 'perbill' ? ' active' : ''}" onclick="App.poolMode('${pool.id}','perbill')">Bill counts</button>
        </div>
        ${mode === 'perbill' ? bills : net}
      </div>
      ${showChips ? `<div class="pool-sect">
        <span class="eyebrow">Shared by</span>
        <div class="chips">${chipsHTML(pool)}</div>
      </div>` : ''}
      ${supportHTML(pool, vm, vmPool)}
      ${single ? '' : `<div class="pool-sect">
        <span class="eyebrow">Window <span class="aside">· blank = whole shift</span></span>
        <div class="field-row">
          <label class="field"><span>Start</span><input inputmode="decimal" placeholder="open"
            value="${escapeHTML(pool.window.start)}" oninput="App.poolWindow('${pool.id}','start',this.value)"></label>
          <label class="field"><span>End</span><input inputmode="decimal" placeholder="close"
            value="${escapeHTML(pool.window.end)}" oninput="App.poolWindow('${pool.id}','end',this.value)"></label>
        </div>
      </div>
      <label class="field field--text"><span>Label</span><input value="${escapeHTML(pool.label)}"
        oninput="App.poolLabel('${pool.id}',this.value)"></label>`}
      ${removable ? `<button class="btn btn--danger btn--sm" onclick="App.removePool('${pool.id}')">Remove pool</button>` : ''}
    </div>` : ''}
  </div>`;
}

// Ideal-bill breakdown — single-pool net-total sessions only.
function breakdownHTML(vm) {
  if (vm.state.pools.length !== 1) return '';
  if (vm.state.pools[0].cash.entryMode !== 'nettotal') return '';
  if (!vm.bills || vm.totalCash <= 0) return '';

  const notes = { 20: 'fill', 1: 'min', 5: 'min', 10: 'min' };
  const rows = [20, 10, 5, 1].map(d => {
    const n = vm.bills[d] || 0;
    if (!n) return '';
    return `<div class="ideal-row"><span class="d">$${d}</span><span class="n">× ${n}<small>${notes[d]}</small></span><span class="s">$${n * d}</span></div>`;
  }).join('');
  return `<div class="card">
    <div class="eyebrow">Ideal drawer · $${vm.totalCash}</div>
    ${rows || '<div class="hint">—</div>'}
  </div>`;
}

export function renderPools(vm) {
  const container = $('pools-content');
  if (!container) return;
  const state = vm.state;

  const errEl = $('cash-error');
  if (errEl) {
    errEl.textContent = vm.inputError && /total|count|window|support/i.test(vm.blocked) ? vm.blocked : '';
  }

  const supIds = (vm.resolved?.staff || []).filter(p => p.role === 'support').map(p => p.id).join('.');
  const signature = state.pools.map(p =>
    p.id + ':' + p.cash.entryMode + ':' + (p.roles.bartender ? 1 : 0) + (p.roles.server ? 1 : 0) + (p.includeSupport ? 1 : 0)
      + (p.includeSupport ? ':' + supIds : '')
  ).join('|') + '|' + state.ui.selectedPool
    + '|' + (state.settings.allRoles ? 'R' : 'r') + (state.settings.multiPool ? 'M' : 'm');

  if (signature !== lastSignature) {
    lastSignature = signature;
    container.innerHTML = state.pools.map(pool =>
      cardHTML(pool, vm, state.ui.selectedPool === pool.id, state.pools.length > 1)
    ).join('')
      + (state.settings.multiPool || state.pools.length > 1
        ? `<button class="btn btn--dashed btn--block" onclick="App.addPool()">+ Add pool</button>`
        : '')
      + `<div id="pool-breakdown">${breakdownHTML(vm)}</div>`;
    return;
  }

  // Patch pass: totals, subtotals, window subtitle, names, support, breakdown.
  state.pools.forEach(pool => {
    const card = container.querySelector(`[data-pid="${pool.id}"]`);
    if (!card) return;
    const vmPool = vm.pools.find(p => p.id === pool.id);
    const total = vmPool ? vmPool.total : 0;

    const totalEl = card.querySelector('[data-pool-total]');
    if (totalEl) {
      totalEl.textContent = '$' + total;
      totalEl.className = 'pool-total' + (total ? '' : ' zero');
    }
    const nameEl = card.querySelector('[data-pool-name]');
    const shown = state.pools.length === 1 ? 'Tips' : pool.label;
    if (nameEl && nameEl.textContent !== shown) nameEl.textContent = shown;
    const subEl = card.querySelector('[data-window-sub]');
    if (subEl) subEl.innerHTML = windowSub(pool, vmPool);

    if (pool.includeSupport) {
      const sPool = vm.shares?.perPool.find(p => p.id === pool.id);
      const pctEl = card.querySelector('[data-sup-pct]');
      if (pctEl) pctEl.placeholder = String(state.defaults.supportPct || '').trim() || '10';
      const rateEl = card.querySelector('[data-sup-rate]');
      if (rateEl) rateEl.placeholder = sPool?.support ? fmtAmt(sPool.support.derivedRate) : '0';
      const cutEl = card.querySelector('[data-sup-cutline]');
      if (cutEl) cutEl.textContent = supCutText(sPool);
      (vm.resolved?.staff || []).filter(p => p.role === 'support').forEach(p => {
        const row = card.querySelector(`[data-sup-row="${p.id}"]`);
        if (!row) return;
        const part = sPool?.participants.find(x => x.id === p.id);
        const amtEl = row.querySelector('[data-sup-amt]');
        if (amtEl) amtEl.textContent = part ? '$' + fmtAmt(part.raw) : '—';
        const hrsEl = row.querySelector('[data-sup-hrs]');
        if (hrsEl && vmPool) hrsEl.placeholder = fmtHrs(overlapHours(p.inAbs, p.outAbs, vmPool.startAbs, vmPool.endAbs));
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

  const bd = $('pool-breakdown');
  if (bd) bd.innerHTML = breakdownHTML(vm);
}

export function invalidatePools() {
  lastSignature = '';
}
