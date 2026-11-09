// Sticky table headers. A table's header row carries THEAD (pkit.js) and is
// preceded by a zero-height <Sentinel />; it sticks just under the tab's
// sub-tab bar (or the top of the page when there are no sub-tabs) and gets
// `data-stuck` while stuck, which the header uses to shrink
// (`data-[stuck]:h-7`, `group-data-[stuck]:hidden` on its extra lines).
//
// Stuck = the header has been pushed below its sentinel. Measuring against
// the sentinel (not the header) means the header shrinking can't flip the
// state back and forth.

const SCROLLER = 'mainContent';
let bound = false;
let raf = 0;

const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function update() {
  raf = 0;
  document.querySelectorAll('.thead').forEach(th => {
    const s = th.previousElementSibling;
    if (!s || !s.classList.contains('thead-sentinel')) return;
    const stuck = s.getBoundingClientRect().top < th.getBoundingClientRect().top - 1;
    if (stuck !== th.hasAttribute('data-stuck')) th.toggleAttribute('data-stuck', stuck);
  });
}

// After every render: where headers stick (per tab, under its sub-tab bar),
// then the stuck state. Binds the scroll listener on first call.
export function refreshSticky() {
  const sc = document.getElementById(SCROLLER);
  if (!sc) return;
  if (!bound) {
    bound = true;
    sc.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  }
  document.querySelectorAll('.panel').forEach(panel => {
    const sub = panel.querySelector('.subtabs');
    const h = sub ? sub.offsetHeight : 0;
    // .content has 0.5rem top padding that the sub-tab bar already tucks into
    panel.style.setProperty('--thead-top', (h - 0.5 * rem()) + 'px');
  });
  update();
}
