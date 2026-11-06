// Modal helpers + Person profile, Remainder split, and Default Times modals.

import { DENOMS, escapeHTML, fmtHrs } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { setBonuses, clearBonuses } from '../store.js';
import { pipStripHTML } from './tabs.js';

const $ = id => document.getElementById(id);

export function openModal(id) {
  $(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
  $(id).classList.remove('open');
  document.body.style.overflow = '';
  if (id === 'personModal') openPersonId = null;
}

export function modalBgClose(e, id) {
  if (e.target === $(id)) closeModal(id);
}

// ── Person profile modal ──────────────────────────────────────────────────────

let openPersonId = null;

export function openPersonModal(vm, id) {
  openPersonId = id;
  openModal('personModal');
  renderPersonModal(vm);
}

export function renderPersonModal(vm) {
  if (!openPersonId || !$('personModal')?.classList.contains('open')) return;
  const person = vm.shares?.perPerson.find(p => p.id === openPersonId);
  if (!person) { closeModal('personModal'); return; }

  const raw = vm.state.staff.find(p => p.id === openPersonId);
  const initials = escapeHTML(person.name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2));
  const inStr = fmtTimeAbs(person.inAbs);
  const outStr = fmtTimeAbs(person.outAbs);
  const hrsStr = fmtHrs(person.hours);
  const badges = (person.closer ? '<span class="badge badge--closer">closer</span>' : '')
    + `<span class="badge badge--${person.role}">${person.role}</span>`;

  const bills = vm.dist?.byPerson[openPersonId];
  const hasBills = bills && DENOMS.some(d => (bills[d] || 0) > 0);
  const billsHTML = hasBills
    ? '<div class="bill-chips">' + DENOMS.map(d => {
        const c = bills[d] || 0;
        return `<div class="bill-chip"><span class="d">$${d}</span><span class="c num${c ? '' : ' zero'}">${c || '—'}</span></div>`;
      }).join('') + '</div>'
    : '<div class="hint">No bill distribution yet.</div>';

  const second = person.bonus > 0
    ? `<div class="kv kv--bonus"><div class="k">Closer bonus</div><div class="v">+$${person.bonus}</div></div>`
    : `<div class="kv"><div class="k">Rate</div><div class="v">$${(vm.shares.rate || 0).toFixed(2)}</div><div class="s">per hour</div></div>`;

  $('personModalLabel').textContent = 'Payout';
  $('personModalBody').innerHTML = `
    <div class="profile">
      <span class="avatar" data-role="${person.role}">${initials}</span>
      <div>
        <div class="profile-name">${escapeHTML(person.name)}${badges}</div>
        <div class="profile-sub">${hrsStr}h · ${inStr} – ${outStr}</div>
      </div>
    </div>
    ${pipStripHTML(vm)}
    <div class="kv-grid">
      <div class="kv kv--wide"><div class="k">Takes home</div><div class="v">$${person.final}</div></div>
      <div class="kv"><div class="k">Base</div><div class="v">$${person.base}</div><div class="s">$${person.exact.toFixed(2)} exact</div></div>
      ${second}
    </div>
    <div class="card stack">
      <div class="eyebrow">Shift</div>
      <div class="field-row">
        <label class="field"><span>In</span><input value="${escapeHTML(raw?.in ?? '')}" placeholder="${inStr}" inputmode="decimal"
          onchange="App.staffField('${person.id}','in',this.value)"></label>
        <label class="field"><span>Out</span><input value="${escapeHTML(raw?.out ?? '')}" placeholder="${person.usedCloseTime ? 'close' : outStr}" inputmode="decimal"
          onchange="App.staffField('${person.id}','out',this.value)"></label>
      </div>
    </div>
    <div class="section-title">Bills</div>
    ${billsHTML}`;
}

// ── Remainder split modal ─────────────────────────────────────────────────────

export function openRemModal(vm) {
  openModal('remModal');
  renderRemModal(vm);
}

export function renderRemModal(vm) {
  const body = $('remModalBody');
  if (!body || !$('remModal')?.classList.contains('open')) return;

  if (!vm.shares || !vm.totalCash) {
    body.innerHTML = '<div class="empty">Enter cash and staff to see the remainder breakdown.</div>';
    return;
  }

  const shares = vm.shares;
  const floored = shares.perPerson.reduce((s, p) => s + p.base, 0);
  const remainder = shares.totalCash - floored;
  const bonusSum = shares.perPerson.reduce((s, p) => s + p.bonus, 0);
  const leftover = remainder - bonusSum;
  const available = Math.max(0, leftover);
  const hasOverrides = shares.bonusMode === 'manual';

  const rows = shares.perPerson.map(p => `
    <div class="rem-row">
      <div class="rem-main">
        <div class="rem-name"><span>${escapeHTML(p.name)}</span>${p.closer ? '<span class="badge badge--closer">closer</span>' : ''}</div>
        <div class="rem-calc">$${p.exact.toFixed(2)} → $${p.base}</div>
      </div>
      <div class="stepper">
        <button onclick="App.remBonus('${p.id}',-1)"${p.bonus > 0 ? '' : ' disabled'} aria-label="Less">−</button>
        <span class="v${p.bonus > 0 ? ' on' : ''}">${p.bonus > 0 ? '+' + p.bonus : '0'}</span>
        <button onclick="App.remBonus('${p.id}',1)"${available > 0 ? '' : ' disabled'} aria-label="More">+</button>
      </div>
      <span class="rem-final">$${p.final}</span>
    </div>`).join('');

  body.innerHTML = `
    ${pipStripHTML(vm)}
    <div class="card rem-top">
      <span>$${remainder} left after rounding down</span>
      ${hasOverrides ? '<span class="badge badge--manual">manual</span>' : '<span class="badge badge--auto">auto · closers</span>'}
    </div>
    <div class="card card--flush"><div class="rem-list">${rows}</div></div>
    <div class="card sum-rows">
      <div><span>Rounded-down shares</span><span>$${floored}</span></div>
      <div><span>Remainder</span><span>$${remainder}</span></div>
      <div><span>Given as bonus</span><span>${bonusSum > 0 ? '$' + bonusSum : '—'}</span></div>
      <div class="hl"><span>Chump (stays in drawer)</span><span>${leftover > 0 ? '$' + leftover : '—'}</span></div>
    </div>
    ${hasOverrides ? '<button class="btn btn--block" onclick="App.resetRemBonuses()">↺ Reset to auto (closers split)</button>' : ''}`;
}

export function adjustRemBonus(vm, id, delta) {
  if (!vm.shares) return;
  const shares = vm.shares;
  const floored = shares.perPerson.reduce((s, p) => s + p.base, 0);
  const remainder = shares.totalCash - floored;

  // Seed overrides from the current bonuses on first edit so existing closer
  // bonuses aren't silently zeroed. Zeros are kept — any key present means
  // manual mode stays sticky until reset.
  const bonuses = {};
  shares.perPerson.forEach(p => { bonuses[p.id] = p.bonus || 0; });

  const proposed = (bonuses[id] || 0) + delta;
  if (proposed < 0) return;
  const otherSum = Object.entries(bonuses)
    .filter(([pid]) => pid !== id)
    .reduce((s, [, b]) => s + b, 0);
  if (proposed + otherSum > remainder) return;

  bonuses[id] = proposed;
  setBonuses(bonuses);
}

export function resetRemBonuses() {
  clearBonuses();
}

// ── Default Times modal ───────────────────────────────────────────────────────

export function renderDefaultsModal(vm) {
  const d = vm.state.defaults;
  const setIfBlurred = (id, value) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = value;
  };
  setIfBlurred('gc-in', d.global.in);
  setIfBlurred('gc-out', d.global.out);
  setIfBlurred('gc-sup-pct', d.supportPct ?? '');
  const keys = { bartender: 'bar', server: 'srv', support: 'sup' };
  Object.entries(keys).forEach(([role, key]) => {
    setIfBlurred('rdef-modal-' + key + '-in', d.byRole[role].in);
    setIfBlurred('rdef-modal-' + key + '-out', d.byRole[role].out);
  });
}
