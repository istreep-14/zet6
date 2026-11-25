import assert from 'node:assert/strict';

// Exercise ui/nav.js — sub-tabs, subpages and their swipes — without a
// touch device: a tiny fake DOM, enough for the module.
const listeners = {};
const el = (id, extra = {}) => ({
  id, hidden: false, dataset: {}, style: {}, scrollTop: 0, clientWidth: 400,
  classList: { _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener(type, fn) { (listeners[id] ||= {})[type] = fn; },
  querySelectorAll: () => [],
  append() {}, remove() {},
  ...extra,
});
const nodes = {
  mainContent: el('mainContent'),
  subpages: el('subpages'),
  'tab-home': el('tab-home'), 'tab-staff': el('tab-staff'), 'tab-tips': el('tab-tips'), 'tab-shift': el('tab-shift'),
};
const rootClasses = el('root').classList;
globalThis.window = { innerWidth: 400 };
globalThis.requestAnimationFrame = fn => fn();
globalThis.document = {
  documentElement: { classList: rootClasses, dataset: {} },
  body: { classList: el('body').classList },
  activeElement: null,
  getElementById: id => nodes[id] || null,
  querySelectorAll: sel => (sel === '#mainContent > .panel' ? ['tab-home', 'tab-staff', 'tab-tips', 'tab-shift'].map(k => nodes[k]) : []),
  createElement: () => el('page'),
  addEventListener() {}, removeEventListener() {},
};

const nav = await import('../src/ui/nav.js');
const { dragFlags } = await import('../src/ui/dragtime.js');
// Preact's render is called on the subpage elements; keep it out of the way.
nav.renderPages(null);

let changes = 0;
nav.onNav(() => changes++);
nav.initNav({ can: () => true });

const target = { closest: () => null, matches: () => false };
function swipe(on, fromX, toX, endType = 'touchend') {
  dragFlags.lastArmed = 0;
  const h = listeners[on];
  h.touchstart({ touches: [{ clientX: fromX, clientY: 100 }], target });
  h.touchmove({ touches: [{ clientX: toX, clientY: 100 }], cancelable: true, preventDefault() {} });
  h[endType]({});
}
const wait = ms => new Promise(r => setTimeout(r, ms));

nav.showTab('home');
assert.equal(nav.currentTab(), 'home');
assert.equal(nav.currentSub(), 'pay');

// A left swipe on Home steps to the next sub-tab; never to another tab.
swipe('mainContent', 300, 100);
await wait(200);
assert.equal(nav.currentSub('home'), 'shift');
assert.equal(nav.currentTab(), 'home');

// An interrupted swipe does nothing.
swipe('mainContent', 300, 100, 'touchcancel');
await wait(200);
assert.equal(nav.currentSub('home'), 'shift', 'an interrupted gesture must not navigate');

// Past the last sub-tab: nothing (no tab change, no panel).
nav.setSub('home', 'split');
swipe('mainContent', 300, 100);
await wait(200);
assert.equal(nav.currentSub('home'), 'split');
assert.equal(nav.currentTab(), 'home', 'tabs only change from the tab bar');

// Every tab has sub-tabs; a swipe on Staff steps them, never the tab.
nav.showTab('staff');
assert.equal(nav.currentSub(), 'people');
swipe('mainContent', 300, 100);
await wait(200);
assert.equal(nav.currentTab(), 'staff');
assert.equal(nav.currentSub(), 'shift');
for (const t of nav.TABS) assert.ok(nav.SUBS[t]?.length >= 2, t + ' has sub-tabs');

// Old saved tab names.
assert.equal(nav.normalizeTab('summary'), 'home');
assert.equal(nav.normalizeTab('payout'), 'tips');
assert.equal(nav.normalizeTab('settings'), 'shift', 'Settings is a page now; its old tab opens Shift');

// Tips' sub-tabs follow the pools: replaced in place, the current one kept
// while it's still there, else the first.
nav.setSubs('tips', [{ value: 'p:1', label: 'Night' }, { value: 'drawer', label: 'Drawer' }]);
assert.equal(nav.currentSub('tips'), 'p:1');
nav.setSub('tips', 'drawer');
nav.setSubs('tips', [{ value: 'p:1', label: 'Night' }, { value: 'b:1:2', label: 'Part 2' }, { value: 'drawer', label: 'Drawer' }]);
assert.equal(nav.currentSub('tips'), 'drawer', 'still there → kept');
nav.setSubs('tips', [{ value: 'p:9', label: 'Day' }]);
assert.equal(nav.currentSub('tips'), 'p:9', 'gone → the first');

// Subpages: push, then a swipe right pops; a short one springs back.
nav.showTab('shift');
nav.pushPage({ key: 'a', title: 'A', body: () => null });
nav.pushPage({ key: 'b', title: 'B', body: () => null });
assert.equal(nav.stackOf().length, 2);
assert.ok(rootClasses.contains('sub-open'));
nav.pushPage({ key: 'b', title: 'B again', body: () => null });
assert.equal(nav.stackOf().length, 2, 'the same page on top is replaced, not stacked');

swipe('subpages', 100, 130);
await wait(250);
assert.equal(nav.stackOf().length, 2, 'a short swipe springs back');
swipe('subpages', 50, 300);
await wait(250);
assert.equal(nav.topPage().title, 'A', 'a swipe right goes back');
nav.popPage({ animate: false });
assert.equal(nav.stackOf().length, 0);
assert.ok(!rootClasses.contains('sub-open'));

// Each tab keeps its own stack.
nav.pushPage({ key: 'x', title: 'X', body: () => null });
nav.showTab('home');
assert.equal(nav.topPage(), null);
nav.showTab('shift');
assert.equal(nav.topPage().title, 'X');
nav.resetNav();
assert.equal(nav.topPage(), null);

assert.ok(changes > 0);
console.log('navigation ok');
