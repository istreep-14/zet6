// Payout tab — a plain tally (total · rate · hours), then the payout table
// (name · hours · pay), then the 2-up tool row. Bill problems get one line
// here that points to the Bills tab, where the details and fixes live.
// Multi-pool adds a Pools list and a per-pool line under each name.

import { escapeHTML, fmtHrs, fmtMoney, payoutOrder } from '../util.js';
import { fmtTimeAbs, timeParts } from '../time.js';
import { distErrorText } from './dist.js';

const $ = id => document.getElementById(id);

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
  const [, mo, dy] = state.meta.date ? state.meta.date.split('-') : [];
  return mo && dy ? `${parseInt(mo)}/${parseInt(dy)}` : '';
}

// Pool warnings, plus one line when the drawer can't pay everyone out. The
// small-bill card and trade suggestions live on the Bills tab.
function warningsHTML(vm) {
  let html = vm.shares.perPool.map(p => p.warning).filter(Boolean)
    .map(w => `<div class="msg msg--error">⚠ ${escapeHTML(w)}</div>`).join('');
  const warnMsg = distErrorText(vm);
  if (warnMsg) {
    html += `<div class="msg msg--error">⚠ ${escapeHTML(warnMsg)}
      <button class="link-btn" onclick="App.tab('bills')">Fix in Bills →</button></div>`;
  }
  return html;
}

// Tally: the total on the left, rate and hours stacked on the right. No card —
// the payout table below is the main thing on this page.
function tallyHTML(vm) {
  const s = vm.shares;
  const date = dateLabel(vm.state);
  const paidCount = s.perPerson.filter(p => p.final > 0).length;
  // One pool: the bar/server rate the worksheet derives (support is paid apart).
  const rate = vm.state.pools.length === 1 && s.perPool[0] ? s.perPool[0].rate : s.rate;
  return `<div class="tally">
    <div class="tally-main">
      <span class="tally-k">Total pool${date ? ' · ' + date : ''}</span>
      <span class="tally-v">${fmtMoney(s.totalCash)}</span>
    </div>
    <div class="tally-side">
      <span class="tally-rate">$${rate.toFixed(2)}<small>/hr</small></span>
      <span class="tally-sub">${fmtHrs(s.totalHours)}h · ${paidCount} ${paidCount === 1 ? 'person' : 'people'}</span>
    </div>
  </div>`;
}

// ── Payout table ─────────────────────────────────────────────────────────────

// Every hours value in the table and worksheet uses the same number of
// decimals — as many as the most precise value needs (quarter hours → 2),
// at least 1 — so the column reads 9.0 / 6.5 / 45.5 or 9.00 / 6.25 / 45.25.
function hoursDecimals(values) {
  const need = values.reduce((m, h) => {
    const frac = fmtHrs(h).split('.')[1] || '';
    return Math.max(m, frac.length);
  }, 0);
  return Math.max(1, need);
}

// Whole dollars without the "$" — the column head says Pay, the total keeps it.
const payNum = n => Math.round(n).toLocaleString('en-US');
const cents = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

// Shift after the name, read like a calendar event: "5–11:45PM",
// "5PM–2AM". Minutes only when off the hour; AM/PM once when both ends share
// it. 24-hour mode: "17:00–02:00".
function shiftHTML(inAbs, outAbs) {
  const a = timeParts(inAbs), b = timeParts(outAbs);
  const t = x => x.h + (x.m ? ':' + x.m : '');
  const ap = x => x.ap ? `<small>${x.ap.toUpperCase()}M</small>` : '';
  const text = a.ap === b.ap ? `${t(a)}–${t(b)}${ap(b)}` : `${t(a)}${ap(a)}–${t(b)}${ap(b)}`;
  return `<span class="pshift" aria-label="${fmtTimeAbs(inAbs)} to ${fmtTimeAbs(outAbs)}">${text}</span>`;
}

// Hours with decimals only when needed (9 / 8.25 / 5.5) and a small "hr".
// The whole hours sit in a fixed-width slot (--hi) so the ones digits line up.
function hrsHTML(h) {
  const [w, f] = fmtHrs(h).split('.');
  return `<span class="phrs-v"><span>${w}</span><span>${f ? '.' + f : ''}<small>hr</small></span></span>`;
}

// Whole dollars with a small "$" in front.
const payHTML = n => `<small>$</small>${payNum(n)}`;

// Row = role-tinted initials · name + shift on one line · hours · pay.
// `extra` = optional per-pool split (multi-pool).
function personRowHTML(p, extra = '') {
  return `<button class="prow-p${p.final > 0 ? '' : ' is-zero'}" onclick="App.personModal('${p.id}')">
    <span class="pname-col">
      <span class="pav av--${p.role}" aria-hidden="true">${escapeHTML(initials(p.name))}</span>
      <span class="pname-txt">
        <span class="pname-line"><span class="pname">${escapeHTML(p.name)}</span>${shiftHTML(p.inAbs, p.outAbs)}</span>
        ${extra ? `<span class="ptime--pools">${extra}</span>` : ''}
      </span>
    </span>
    <span class="phrs">${hrsHTML(p.shiftHours ?? p.hours)}</span>
    <span class="ppay">${payHTML(p.final)}</span>
  </button>`;
}

function chumpRowHTML(s) {
  return s.leftover > 0
    ? `<div class="pchump"><span>Chump · stays in the drawer</span><span>${payNum(s.leftover)}</span></div>`
    : '';
}

// Key line under the table: what bonus is folded in, and the role colours.
function keyHTML(people, showRole) {
  const parts = [];
  const bonuses = people.filter(p => p.bonus > 0);
  if (bonuses.length) {
    const same = bonuses.every(p => p.closer && p.bonus === bonuses[0].bonus);
    parts.push(same ? `closer pay includes +${fmtMoney(bonuses[0].bonus)} bonus` : 'pay includes bonuses');
  }
  if (showRole) {
    parts.push('<span class="pkey-roles"><i data-role="bartender"></i>bar <i data-role="server"></i>srv <i data-role="support"></i>sup</span>');
  }
  return parts.length ? `<p class="pkey">${parts.join(' · ')}</p>` : '';
}

// ── Worksheet: how the split was worked out (single pool) ────────────────────
// Mirrors computeShares step by step: add the hours → (support cut) → pool ÷
// hours = rate → hours × rate, rounded down → leftover to closers / chump.
function worksheetHTML(vm, ordered, dp) {
  const s = vm.shares;
  const pool = s.perPool[0];
  if (!pool || vm.state.pools.length !== 1) return '';

  const sup = pool.support && pool.support.hours > 0 ? pool.support : null;
  const tipped = ordered.filter(p => p.hours > 0 && !(sup && p.role === 'support'));
  const supPeople = sup ? ordered.filter(p => p.role === 'support' && p.hours > 0) : [];
  const h = v => v.toFixed(dp);

  const step = (n, label, body) => `<li class="ws-step"><span class="ws-n">${n}</span><div class="ws-body"><div class="ws-k">${label}</div>${body}</div></li>`;
  const sum = list => `<div class="ws-v">${list.map(p => h(p.hours)).join(' + ')} = <b>${h(list.reduce((t, p) => t + p.hours, 0))} h</b></div>`;

  let n = 1;
  let html = step(n++, sup ? 'Add up bar &amp; server hours' : 'Add up everyone’s hours', sum(tipped));

  if (sup) {
    html += step(n++, 'Take out the support tip-out',
      `<div class="ws-v">$${sup.rate.toFixed(4)}/hr × ${h(sup.hours)} h = <b>−$${cents(sup.cut)}</b></div>`
      + `<div class="ws-v">$${cents(pool.total)} − $${cents(sup.cut)} = <b>$${cents(pool.tippedTotal)}</b> to share</div>`);
  }

  html += step(n++, 'Divide the pool by the hours',
    `<div class="ws-v">$${cents(sup ? pool.tippedTotal : pool.total)} ÷ ${h(pool.tippedHours)} h = <b>$${pool.rate.toFixed(4)}/hr</b></div>`);

  const line = (p, rate) => `<div class="ws-row"><span class="ws-name">${escapeHTML(p.name)}</span>`
    + `<span class="ws-m">${h(p.hours)} × ${rate.toFixed(4)}</span><span class="ws-m">= ${cents(p.exact)}</span>`
    + `<span class="ws-res">${p.base}${p.bonus > 0 ? `<em>+${p.bonus}</em>` : ''}</span></div>`;
  html += step(n++, 'Hours × rate, rounded down to whole dollars',
    `<div class="ws-rows">${tipped.map(p => line(p, pool.rate)).join('')}${supPeople.map(p => line(p, sup.rate)).join('')}</div>`);

  const bonusSum = ordered.reduce((t, p) => t + p.bonus, 0);
  if (s.remainder > 0) {
    const closers = ordered.filter(p => p.bonus > 0);
    const where = [
      bonusSum > 0 ? `${fmtMoney(bonusSum)} to ${s.bonusMode === 'manual' ? 'bonuses' : closers.length === 1 ? 'the closer' : `the closers (${fmtMoney(closers[0].bonus)} each)`}` : '',
      s.leftover > 0 ? `${fmtMoney(s.leftover)} stays in the drawer` : '',
    ].filter(Boolean).join(' · ');
    html += step(n++, 'Share out the dollars left over',
      `<div class="ws-v">${fmtMoney(s.totalCash)} − ${fmtMoney(ordered.reduce((t, p) => t + p.base, 0))} rounded = <b>${fmtMoney(s.remainder)}</b></div><div class="ws-v">${where}</div>`);
  }

  return `<details class="card ws">
    <summary><span>How the split was worked out</span><span class="ws-rate">$${pool.rate.toFixed(2)}/hr</span></summary>
    <ol class="ws-steps">${html}</ol>
  </details>`;
}

function payoutsHTML(vm, extraFor = () => '') {
  const s = vm.shares;
  const ordered = payoutOrder(s.perPerson);
  const showRole = new Set(ordered.map(p => p.role)).size > 1;
  const grand = s.perPerson.reduce((t, p) => t + p.final, 0) + s.leftover;
  const dp = hoursDecimals([...ordered.map(p => p.shiftHours ?? p.hours), ...ordered.map(p => p.hours), s.totalHours]);

  const intW = Math.max(...[...ordered.map(p => p.shiftHours ?? p.hours), s.totalHours]
    .map(h => String(Math.floor(h)).length));
  return `<div class="card card--flush ptable" style="--hi:${intW}ch">
      <div class="phead"><span>Payouts</span><span>Hrs</span><span>Pay</span></div>
      ${ordered.map(p => personRowHTML(p, extraFor(p))).join('')}
      ${chumpRowHTML(s)}
      <div class="pfoot"><span>Total</span><span class="phrs">${hrsHTML(s.totalHours)}</span><span class="ppay">${payHTML(grand)}</span></div>
    </div>${keyHTML(ordered, showRole)}${worksheetHTML(vm, ordered, dp)}`;
}

function singlePoolHTML(vm) {
  return tallyHTML(vm)
    + warningsHTML(vm)
    + payoutsHTML(vm)
    + quickActionsHTML();
}

// ── Multi-pool: payouts, then the pools they came from ───────────────────────

function multiPoolHTML(vm) {
  const pools = vm.shares.perPool;

  const poolRows = pools.map(p => `<div class="prow">
      <div class="prow-main">
        <span class="prow-name">${escapeHTML(p.label)}</span>
        <span class="person-sub">${fmtTimeAbs(p.startAbs)}–${fmtTimeAbs(p.endAbs)} · ${fmtHrs(p.hours)}h${p.hours > 0 ? ' · $' + (p.total / p.hours).toFixed(2) + '/hr' : ''}</span>
      </div>
      <span class="prow-total">${fmtMoney(p.total)}</span>
    </div>`).join('');

  const perPoolLine = p => pools
    .filter(pool => p.perPool[pool.id]?.raw > 0)
    .map(pool => `${escapeHTML(pool.label)} ${fmtMoney(Math.floor(p.perPool[pool.id].raw))}`)
    .join(' · ');

  return tallyHTML(vm)
    + warningsHTML(vm)
    + payoutsHTML(vm, perPoolLine)
    + `<div class="section-title">Pools</div>
    <div class="card card--flush">${poolRows}</div>`
    + quickActionsHTML();
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

  // Keep the worksheet open across re-renders once someone opens it.
  const ws = el.querySelector('details.ws');
  if (ws) {
    ws.open = worksheetOpen;
    ws.addEventListener('toggle', () => { worksheetOpen = ws.open; });
  }
}

let worksheetOpen = false;
