// Tab bar — panel switching, tab badges, and the floating live HUD
// (rate / pool / chump while editing Staff & Tips).

import { poolValue, fmtMoney, fmtMoneyShort } from '../util.js';
import { html, cx, mount } from '../ui/html.js';
import { icon } from '../ui/icons.js';

const $ = id => document.getElementById(id);

export const TAB_ORDER = ['staff', 'tips', 'payout'];
const TITLES = { staff: 'Staff', tips: 'Tips', payout: 'Payout' };

// Older snapshots stored the five-tab names.
export function normalizeTab(name) {
  const legacy = { summary: 'payout', bills: 'payout', more: 'payout', cash: 'tips' };
  return legacy[name] || (TAB_ORDER.includes(name) ? name : 'payout');
}

// opts.swipe = 'left' | 'right' slides the new panel in from that side and
// skips the auto-focus (a swipe shouldn't pop the keyboard).
export function switchTab(name, opts = {}) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active', 'from-left', 'from-right'));
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  const panel = $('tab-' + name);
  panel?.classList.add('active');
  if (opts.swipe) panel?.classList.add(opts.swipe === 'left' ? 'from-right' : 'from-left');
  $('tb-' + name)?.classList.add('active');
  const title = $('hdrTitle');
  if (title) title.textContent = TITLES[name] || 'Tip Pool';
  $('pipHud')?.classList.toggle('is-off', name === 'payout');
  requestAnimationFrame(() => { $('mainContent').scrollTop = 0; });

  // Focus synchronously — still inside the click gesture chain (iOS Safari).
  if (name === 'staff' && !opts.swipe) {
    for (const inp of document.querySelectorAll('#staffList [data-field="name"]')) {
      if (!inp.value.trim()) { inp.focus(); break; }
    }
  }
}

// True when the computed distribution can't actually pay everyone out.
export function distShort(vm) {
  if (!vm.dist) return false;
  const unpaid = vm.people.reduce((s, p) => s + Math.max(0, p.final - poolValue(vm.dist.byPerson[p.id] || {})), 0);
  const remOk = vm.shares.leftover === 0 || poolValue(vm.dist.remainderBills) === vm.shares.leftover;
  return !!vm.dist.error || unpaid > 0 || !remOk;
}

function badge(id, text, tone) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = cx('tab-sub', tone);
}

export function updateTabIndicators(vm) {
  const total = vm.totalCash;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const short = !vm.blocked && distShort(vm);
  badge('tab-sub-staff', named > 0 ? String(named) : '', named > 0 && vm.inputError ? 'warn' : '');
  badge('tab-sub-tips', total > 0 ? fmtMoneyShort(total) : '', total > 0 ? 'ok' : '');
  badge('tab-sub-payout', short ? '!' : '', short ? 'warn' : '');
  updateHud(vm, named, total, short);
}

function stats(shares) {
  const s = (k, v, cls) => html`<span class="flex min-w-0 flex-col items-center gap-0.5 leading-tight">
    <span class="text-[12px] font-medium text-ink-2">${k}</span>
    <span class="${cx('font-rounded text-[18px] font-semibold tabular-nums', cls)}">${v}</span></span>`;
  return html`${s('Rate', '$' + shares.rate.toFixed(2), 'text-green')}
    ${s('Pool', fmtMoney(shares.totalCash))}
    ${s('Chump', shares.leftover > 0 ? fmtMoney(shares.leftover) : '—', 'text-ink-2')}`;
}

// HUD: live numbers once the pipeline computes, the blocking reason otherwise.
// Hidden on a pristine session.
function updateHud(vm, named, total, short) {
  const hud = $('pipHud');
  if (!hud) return;
  const pristine = named === 0 && total === 0;
  hud.classList.toggle('is-empty', pristine);
  if (pristine) return;
  hud.classList.toggle('is-warn', !!vm.blocked || short);
  const msg = t => html`<span class="truncate text-[14px] font-medium ${vm.blocked || short ? 'text-red' : 'text-ink-2'}">${t}</span>`;
  mount(hud, html`<span class="flex min-w-0 flex-1 items-center justify-around gap-2">
      ${vm.shares && total > 0 && !vm.blocked ? html`${stats(vm.shares)}${short && msg('bills short')}` : msg(vm.blocked || 'Enter cash to calculate')}
    </span>
    <span class="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2">${icon('chevR', 'size-[18px]')}</span>`);
}

// Same numbers as the HUD, for the top of a sheet.
export function liveStrip(vm) {
  if (!vm?.shares || !(vm.totalCash > 0)) return '';
  return html`<div class="flex justify-around rounded-2xl bg-raised px-2 py-3">${stats(vm.shares)}</div>`;
}
