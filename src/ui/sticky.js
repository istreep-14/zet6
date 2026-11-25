// Sticky table headers. A table's header row carries THEAD (pkit.js) and is
// preceded by a zero-height <Sentinel />; it sticks at the top of its
// scroller (--thead-top on .panel in app.css) and gets
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
  // Header: the small title fades in (and a hairline shows) once the page's
  // big title has scrolled away.
  const sc = document.getElementById(SCROLLER);
  if (sc) document.documentElement.classList.toggle('scrolled', sc.scrollTop > 2.5 * rem());
  document.querySelectorAll('.thead').forEach(th => {
    const table = th.closest('table');
    const wrap = table?.parentElement;
    const s = th.previousElementSibling || (wrap?.classList.contains('page-table') ? table.previousElementSibling : null)
      || (wrap?.parentElement?.classList.contains('page-table') ? wrap.previousElementSibling : null);
    if (!s || !s.classList.contains('thead-sentinel')) return;
    const stuck = s.getBoundingClientRect().top < th.getBoundingClientRect().top - 1;
    if (stuck !== th.hasAttribute('data-stuck')) th.toggleAttribute('data-stuck', stuck);
  });
}

// After every render: the stuck state. Binds the scroll listeners on first
// call — the pages' scroller.
export function refreshSticky() {
  const sc = document.getElementById(SCROLLER);
  if (!sc) return;
  if (!bound) {
    bound = true;
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    sc.addEventListener('scroll', on, { passive: true });
  }
  update();
}
