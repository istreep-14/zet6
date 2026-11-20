// Plain-text summary for the clipboard (paste into Notes, screenshot it):
// title, then tips · hours · rate, then one row per person — name · in · out ·
// hours · tips — and a Total row (what was paid out; the chump is the
// difference to the tips), then who gets which bills (when they work out).
// Columns are padded with spaces, so they line up in a monospaced font
// (Notes: Aa → Monospaced). No rounding or closers. Pure.

import { fmtHrs } from './util.js';
import { fmtTimeAbs } from './time.js';

const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const rank = { bartender: 0, server: 1, support: 2 };

// Staff-tab order: state order, grouped by role when roles are on.
function staffOrder(people, rolesOn) {
  if (!rolesOn) return people;
  return people.map((p, i) => [p, i]).sort((x, y) => (rank[x[0].role] - rank[y[0].role]) || (x[1] - y[1])).map(x => x[0]);
}

export function summaryText(vm, title = '') {
  const s = vm.shares;
  if (!s) return '';
  const people = staffOrder(s.perPerson, vm.state.settings.allRoles);
  const t = abs => (abs == null ? '—' : fmtTimeAbs(abs));
  const rows = people.map(p => [p.name, t(p.inAbs), t(p.outAbs), fmtHrs(p.shiftHours ?? p.hours), money(p.final)]);
  const tipped = people.filter(p => p.role !== 'support');
  const hours = tipped.reduce((a, p) => a + (p.shiftHours ?? p.hours), 0);
  const paid = people.reduce((a, p) => a + p.final, 0);
  const head = ['Name', 'In', 'Out', 'Hrs', 'Tips'];
  const total = ['Total', '', '', fmtHrs(hours), money(paid)];
  const all = [head, ...rows, total];
  const w = head.map((_, c) => Math.max(...all.map(r => r[c].length)));
  // name left, the rest right-aligned, two spaces between columns
  const line = r => r.map((v, c) => (c === 0 ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  ').trimEnd();
  const rule = '-'.repeat(w.reduce((a, b) => a + b, 0) + 2 * (w.length - 1));
  const lab = ['Tips', 'Hours', 'Rate'];
  const lw = Math.max(...lab.map(x => x.length));
  const out = [
    title,
    '',
    'Tips'.padEnd(lw) + '  ' + money(s.totalCash),
    'Hours'.padEnd(lw) + '  ' + fmtHrs(hours),
    'Rate'.padEnd(lw) + '  $' + (s.rate || 0).toFixed(2) + '/h',
  ];
  if (vm.adjust) out.push('Register ' + (vm.adjust < 0 ? 'short ' : 'over ') + money(Math.abs(vm.adjust)) + ' (tips were ' + money(vm.totalBefore) + ')');
  out.push('', line(head), rule, ...rows.map(line), rule, line(total));
  const bills = billsTable(vm, people);
  if (bills.length) out.push('', ...bills);
  return out.filter((x, i) => i > 0 || x).join('\n');
}

// Who gets which bills: a column per bill size actually used, the chump, and
// the drawer totals. Nothing when the bills don't work out yet.
function billsTable(vm, people) {
  const d = vm.dist;
  if (!d || d.error) return [];
  const DEN = [100, 50, 20, 10, 5, 1];
  const of = id => d.byPerson[id] || {};
  const chump = vm.shares.leftover > 0 ? (d.remainderBills || {}) : null;
  const used = DEN.filter(x => people.some(p => (of(p.id)[x] || 0) > 0) || (chump && (chump[x] || 0) > 0));
  if (!used.length) return [];
  const cell = n => (n > 0 ? String(n) : '-');
  const rows = people.filter(p => p.final > 0).map(p => [p.name, ...used.map(x => cell(of(p.id)[x] || 0))]);
  if (chump) rows.push(['Chump', ...used.map(x => cell(chump[x] || 0))]);
  const sum = x => people.reduce((t, p) => t + (of(p.id)[x] || 0), 0) + ((chump && chump[x]) || 0);
  const head = ['Bills', ...used.map(x => '$' + x)];
  const total = ['Total', ...used.map(x => String(sum(x)))];
  const all = [head, ...rows, total];
  const w = head.map((_, c) => Math.max(...all.map(r => r[c].length)));
  const line = r => r.map((v, c) => (c === 0 ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  ').trimEnd();
  const rule = '-'.repeat(w.reduce((a, b) => a + b, 0) + 2 * (w.length - 1));
  return [line(head), rule, ...rows.map(line), rule, line(total)];
}
