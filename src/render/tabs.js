// Tab bar — panel switching, tab badges, and the floating live HUD
// (rate / pool / chump while editing Staff & Cash).

import { poolValue, escapeHTML } from '../util.js';

const $ = id => document.getElementById(id);

// opts.swipe = 'left' | 'right' slides the new panel in from that side and
// skips the auto-focus (a swipe shouldn't pop the keyboard).
export function switchTab(name, opts = {}) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active', 'from-left', 'from-right'));
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  const panel = $('tab-' + name);
  panel?.classList.add('active');
  if (opts.swipe) panel?.classList.add(opts.swipe === 'left' ? 'from-right' : 'from-left');
  $('tb-' + name)?.classList.add('active');
  // The HUD duplicates Payout (and Bills' own live strip) — only float it over
  // the input tabs.
  $('pipHud')?.classList.toggle('is-off', name !== 'staff' && name !== 'cash');
  requestAnimationFrame(() => { $('mainContent').scrollTop = 0; });

  // Focus synchronously — still inside the click gesture chain (iOS Safari).
  if (name === 'staff' && !opts.swipe) {
    const inputs = document.querySelectorAll('#staffList [data-field="name"]');
    for (const inp of inputs) { if (!inp.value.trim()) { inp.focus(); break; } }
  }
}

// True when the computed distribution can't actually pay everyone out.
export function distShort(vm) {
  if (!vm.dist) return false;
  const unpaid = vm.people.reduce((s, p) =>
    s + Math.max(0, p.final - poolValue(vm.dist.byPerson[p.id] || {})), 0);
  const remOk = vm.shares.leftover === 0
    || poolValue(vm.dist.remainderBills) === vm.shares.leftover;
  return !!vm.dist.error || unpaid > 0 || !remOk;
}

export function updateTabIndicators(vm) {
  const total = vm.totalCash;
  const cs = $('tab-sub-cash');
  if (cs) {
    cs.textContent = total > 0 ? '$' + total : '';
    cs.className = 'tab-sub' + (total > 0 ? ' ok' : '');
  }

  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const ss = $('tab-sub-staff');
  if (ss) {
    ss.textContent = named > 0 ? String(named) : '';
    ss.className = 'tab-sub' + (named > 0 && vm.inputError ? ' warn' : '');
  }

  const bs = $('tab-sub-bills');
  if (bs) {
    const short = !vm.blocked && distShort(vm);
    bs.textContent = short ? '!' : '';
    bs.className = 'tab-sub' + (short ? ' warn' : '');
  }

  updateHud(vm, named, total);
}

// HUD content: live numbers once the pipeline computes, the blocking reason
// otherwise. Hidden entirely on a pristine session.
function updateHud(vm, named, total) {
  const hud = $('pipHud'), vals = $('pipVals');
  if (!hud || !vals) return;

  const pristine = named === 0 && total === 0;
  hud.classList.toggle('is-empty', pristine);
  if (pristine) return;

  const warn = !!vm.blocked || distShort(vm);
  hud.classList.toggle('is-warn', warn);

  if (vm.shares && total > 0 && !vm.blocked) {
    vals.innerHTML = statsHTML(vm.shares)
      + (distShort(vm) ? '<span class="hud-msg">bills short</span>' : '');
  } else {
    vals.innerHTML = `<span class="hud-msg">${escapeHTML(vm.blocked || 'Enter cash to calculate')}</span>`;
  }
}

function statsHTML(shares) {
  return `
    <span class="stat-inline"><span class="k">Rate</span><span class="v rate">$${shares.rate.toFixed(2)}</span></span>
    <span class="stat-inline"><span class="k">Pool</span><span class="v pool">$${shares.totalCash}</span></span>
    <span class="stat-inline"><span class="k">Chump</span><span class="v chump">${shares.leftover > 0 ? '$' + shares.leftover : '—'}</span></span>`;
}

// Inline live strip for sheet tops — same numbers as the HUD, re-rendered with
// its host on every state change so edits inside the sheet update it in place.
export function pipStripHTML(vm) {
  if (!vm?.shares || !(vm.totalCash > 0)) return '';
  return `<div class="live-strip">${statsHTML(vm.shares)}</div>`;
}
