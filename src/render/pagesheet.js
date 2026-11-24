// The page drawer (sheet-page): everything a page can do that isn't on the
// page itself — its actions, what it shows (Show switches), and Go to (every
// page and tool). Near the thumb: swipe up from the bottom (the HUD or the
// tab bar), tap the page's tab again, or More on the HUD.

import { fmtMoney } from '../util.js';
import { html, render } from '../ui/preact.js';
import { cx, Icon, Clock } from '../ui/pkit.js';
import { openSheet, isOpen, sheetBody, setSheetTitle } from '../ui/sheet.js';
import { StaffOptions } from './staff.js';
import { TipsOptions } from './tips.js';
import { PayoutOptions } from './payout.js';
import { SummaryOptions } from './summary.js';

const TITLES = { summary: 'Summary', staff: 'Staff', tips: 'Tips', payout: 'Payout' };
const OPTIONS = { summary: SummaryOptions, staff: StaffOptions, tips: TipsOptions, payout: PayoutOptions };

let last = null;

export function openPageSheet() {
  fillPageSheet();
  openSheet('sheet-page');
}
// Fill it (before a drag-open measures it, too).
export function fillPageSheet() {
  if (!last) return;
  const page = last.vm.state.ui.activeTab in OPTIONS ? last.vm.state.ui.activeTab : 'summary';
  setSheetTitle('sheet-page', TITLES[page]);
  const Options = OPTIONS[page];
  render(html`<div class="flex flex-col gap-5">
    <${Options} vm=${last.vm} />
    <${GoTo} vm=${last.vm} page=${page} sessionName=${last.sessionName} />
  </div>`, sheetBody('sheet-page'));
}
export function renderPageSheet(vm, sessionName) {
  last = { vm, sessionName: sessionName || last?.sessionName || '' };
  if (isOpen('sheet-page')) fillPageSheet();
}

// Every page and tool as a small tile (the other pages; the tools).
function GoTo({ vm, page, sessionName }) {
  const sh = !vm.blocked ? vm.shares : null;
  const named = vm.state.staff.filter(p => p.name.trim()).length;
  const go = fn => () => { App.closeSheet('sheet-page'); fn(); };
  const tile = (icon, label, sub, onClick) => html`<button class="flex min-h-[4.75rem] flex-col items-start justify-between gap-1 rounded-card bg-surface p-3 text-left transition active:scale-[.97]"
    onClick=${go(onClick)}>
    <${Icon} name=${icon} class="size-5 text-accent" />
    <span class="flex min-w-0 max-w-full flex-col leading-tight"><span class="t-small font-semibold text-ink">${label}</span>
      ${sub && html`<span class="t-small truncate text-ink-3">${sub}</span>`}</span>
  </button>`;
  const pages = [
    ['summary', 'home', 'Summary', sh ? fmtMoney(sh.totalCash) + ' paid out' : 'The checklist'],
    ['staff', 'users', 'Staff', named ? named + ' on shift' : 'Who worked'],
    ['tips', 'cash', 'Tips', vm.totalCash > 0 ? fmtMoney(vm.totalCash) : 'Enter the cash'],
    ['payout', 'envelope', 'Payout', 'The envelopes'],
  ].filter(x => x[0] !== page);
  return html`<section class="flex flex-col gap-2">
    <div class="flex items-baseline justify-between px-4"><span class="t-cap text-ink-3">Go to</span><span class="t-small truncate text-ink-3">${sessionName || 'This shift'}</span></div>
    <div class="grid grid-cols-3 gap-2">
      ${pages.map(([t, icon, label, sub]) => html`<span key=${t} class="contents">${tile(icon, label, sub, () => App.tab(t))}</span>`)}
      ${tile('clock', 'Close time', vm.resolved?.closeAbs != null ? html`What-if · <${Clock} abs=${vm.resolved.closeAbs} />` : 'What-if', () => App.openCloseTime())}
      ${tile('gift', 'Bonus & chump', sh && sh.leftover > 0 ? 'Chump ' + fmtMoney(sh.leftover) : 'After rounding', () => App.openBonus())}
      ${tile('copy', 'Copy', 'As text', () => App.copySummary())}
      ${tile('calendar', 'This shift', 'Date, times', () => App.panel('right'))}
      ${tile('menu', 'Sessions', 'Settings', () => App.panel('left'))}
    </div>
  </section>`;
}
