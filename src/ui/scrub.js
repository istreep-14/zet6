// The scrub bubble: while a value is being dragged (a time, the tips total)
// the value floats above the finger — never under it — with how far it has
// moved and a small ruler that slides with the drag (one tick per step).
// One element for the whole app, shown / moved / hidden by ui/dragtime.js.

let el = null;

function mount() {
  el = document.createElement('div');
  el.className = 'scrub';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="scrub-v"></div><div class="scrub-s"></div><div class="scrub-r"><i></i></div>';
  document.body.append(el);
}

// x, y: the finger (client px). text: the value; sub: the change so far;
// dx: px dragged (slides the ruler); tick: px per step.
export function showScrub({ x, y, text, sub = '', dx = 0, tick = 18 }) {
  if (!el) mount();
  el.querySelector('.scrub-v').textContent = text;
  el.querySelector('.scrub-s').textContent = sub;
  const r = el.querySelector('.scrub-r');
  r.style.setProperty('--tick', tick + 'px');
  r.style.backgroundPositionX = `calc(50% + ${dx}px)`;
  const half = Math.max(56, el.offsetWidth / 2 || 56);
  const left = Math.min(window.innerWidth - half - 8, Math.max(half + 8, x));
  el.style.left = left + 'px';
  const h = el.offsetHeight || 72;
  el.style.top = Math.max(8 + h, y - 56) + 'px';  // its bottom edge sits 56px above the finger
  el.classList.add('on');
}

export function hideScrub() {
  el?.classList.remove('on');
}
