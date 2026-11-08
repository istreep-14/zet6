// Payout tab — hero totals, 2-up tool row, warnings, then either the person list
// (single pool) or the pool × person matrix (multi-pool). Same view model.

import { escapeHTML, fmtHrs, poolValue } from '../util.js';
import { fmtTimeAbs } from '../time.js';
import { renderRequirementSummary, tradeSuggestionHTML, distErrorText, smallBillsShort } from './dist.js';

const $ = id => document.getElementById(id);

const ROLE_SHORT = { bartender: 'bar', server: 'srv', support: 'sup' };

const initials = name => escapeHTML(name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2));

function emptyHTML() {
  return `<div class="empty">
    <svg viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
    <div class="empty-title">No shift yet</div>
    Add who worked, then enter the tips.
    <div><button class="btn btn--primary" onclick="App.tab('staff')">Add staff</button></div>
  </div>`;
}

function blockedHTML(vm) {
  const goCash = /cash|total|count|window|support (%|\$|hours)/i.test(vm.blocked);
  return `<div class="msg msg--error">⚠ ${escapeHTML(vm.blocked)}
    <button class="link-btn" onclick="App.tab('${goCash ? 'cash' : 'staff'}')">Fix →</button></div>`;
}

const TOOL_ICONS = {
  close: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bonus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};

export function quickActionsHTML() {
  return `<div class="tools">
    <button class="tool" onclick="App.openCloseTime()">${TOOL_ICONS.close}Close time</button>
    <button class="tool" onclick="App.openRemModal()">${TOOL_ICONS.bonus}Bonus</button>
  </div>`;
}

function dateLabel(state) {
  const [yr, mo, dy] = state.meta.date ? state.meta.date.split('-') : [];
  return mo && dy ? `${parseInt(mo)}/${parseInt(dy)}` : '';
}

function warningsHTML(vm) {
  const { shares } = vm;
  const warnMsg = distErrorText(vm);

  let html = shares.perPool.map(p => p.warning).filter(Boolean)
    .map(w => `<div class="msg msg--error">⚠ ${escapeHTML(w)}</div>`).join('');
  if (warnMsg) {
    const trade = tradeSuggestionHTML(vm);
    html += `<div class="msg msg--error">⚠ ${escapeHTML(warnMsg)}`
      + (trade ? '' : `<button class="link-btn" onclick="App.tab('cash')">Cash →</button>`)
      + `</div>`
      + (smallBillsShort(vm.req, vm.bills) ? `<div class="card">${renderRequirementSummary(vm.req, vm.bills)}</div>` : '')
      + trade;
  }
  return html;
}

function heroHTML(vm, extraStats = '') {
  const s = vm.shares;
  const date = dateLabel(vm.state);
  const paid = s.perPerson.reduce((t, p) => t + p.final, 0);
  return `<div class="card hero">
    <div class="eyebrow">Total pool${date ? ' · ' + date : ''}</div>
    <div class="hero-val">$${s.totalCash}</div>
    <div class="stats">
      <span class="stat-inline"><span class="k">Hours</span><span class="v">${fmtHrs(s.totalHours)}</span></span>
      <span class="stat-inline"><span class="k">Rate</span><span class="v rate">$${s.rate.toFixed(2)}</span></span>
      <span class="stat-inline"><span class="k">Paid</span><span class="v pool">$${paid}</span></span>
      ${s.leftover > 0 ? `<span class="stat-inline"><span class="k">Chump</span><span class="v chump">$${s.leftover}</span></span>` : ''}
      ${extraStats}
    </div>
  </div>`;
}

// ── Single pool: person list ─────────────────────────────────────────────────

// `extra` = optional second sub-line (multi-pool: "Lunch $120 · Dinner $250").
function personRowHTML(p, extra = '') {
  const badges = (p.closer ? '<span class="badge badge--closer">closer</span>' : '')
    + (p.role !== 'bartender' ? `<span class="badge badge--${p.role}">${ROLE_SHORT[p.role]}</span>` : '');
  const breakdown = p.bonus > 0 ? `${p.base}<em>+${p.bonus}</em>` : '';
  return `<button class="person" onclick="App.personModal('${p.id}')">
    <span class="avatar" data-role="${p.role}">${initials(p.name)}</span>
    <span class="person-main">
      <span class="person-name"><span>${escapeHTML(p.name)}</span>${badges}</span>
      <span class="person-sub">${fmtTimeAbs(p.inAbs)}–${fmtTimeAbs(p.outAbs)} · ${fmtHrs(p.shiftHours ?? p.hours)}h</span>
      ${extra ? `<span class="person-sub person-sub--pools">${extra}</span>` : ''}
    </span>
    <span class="person-pay"><span class="v">$${p.final}</span><span class="b">${breakdown}</span></span>
  </button>`;
}

function singlePoolHTML(vm) {
  const s = vm.shares;
  const chump = s.leftover > 0
    ? `<div class="person person--chump">
        <span class="avatar">C</span>
        <span class="person-main"><span class="person-name"><span>Chump</span></span><span class="person-sub">stays in drawer</span></span>
        <span class="person-pay"><span class="v">$${s.leftover}</span></span>
      </div>`
    : '';
  const grand = s.perPerson.reduce((t, p) => t + p.final, 0) + s.leftover;

  return heroHTML(vm)
    + quickActionsHTML()
    + warningsHTML(vm)
    + `<div class="section-title">Payouts</div>
    <div class="card card--flush">
      <div class="people">${s.perPerson.map(personRowHTML).join('')}${chump}</div>
      <div class="totals"><span>Total</span><span><span class="h">${fmtHrs(s.totalHours)}h</span><span class="v">$${grand}</span></span></div>
    </div>`;
}

// ── Multi-pool: matrix ───────────────────────────────────────────────────────

function multiPoolHTML(vm) {
  const s = vm.shares;
  const pools = s.perPool;

  const poolRows = pools.map(p => `<div class="prow">
      <div class="prow-main">
        <span class="prow-name">${escapeHTML(p.label)}</span>
        <span class="person-sub">${fmtTimeAbs(p.startAbs)}–${fmtTimeAbs(p.endAbs)} · ${fmtHrs(p.hours)}h${p.hours > 0 ? ' · $' + (p.total / p.hours).toFixed(2) + '/hr' : ''}</span>
      </div>
      <span class="prow-total">$${p.total}</span>
    </div>`).join('');

  const people = s.perPerson.map(p => {
    const parts = pools
      .filter(pool => p.perPool[pool.id]?.raw > 0)
      .map(pool => `${escapeHTML(pool.label)} $${Math.floor(p.perPool[pool.id].raw)}`)
      .join(' · ');
    return personRowHTML(p, parts);
  }).join('');

  const chump = s.leftover > 0
    ? `<div class="person person--chump">
        <span class="avatar">C</span>
        <span class="person-main"><span class="person-name"><span>Chump</span></span><span class="person-sub">stays in drawer</span></span>
        <span class="person-pay"><span class="v">$${s.leftover}</span></span>
      </div>`
    : '';
  const grand = s.perPerson.reduce((t, p) => t + p.final, 0) + s.leftover;

  return heroHTML(vm)
    + quickActionsHTML()
    + warningsHTML(vm)
    + `<div class="section-title">Pools</div>
    <div class="card card--flush">${poolRows}</div>
    <div class="section-title">Payouts</div>
    <div class="card card--flush">
      <div class="people">${people}${chump}</div>
      <div class="totals"><span>Total</span><span><span class="h">${fmtHrs(s.totalHours)}h</span><span class="v">$${grand}</span></span></div>
    </div>`;
}

export function renderSummary(vm) {
  const el = $('summary-content');
  if (!el) return;
  el.className = 'stack';

  if (vm.blocked) {
    const pristine = !vm.hasNamedStaff && vm.totalCash === 0;
    el.innerHTML = pristine ? emptyHTML() : blockedHTML(vm);
    return;
  }
  el.innerHTML = vm.state.pools.length === 1 ? singlePoolHTML(vm) : multiPoolHTML(vm);
}
