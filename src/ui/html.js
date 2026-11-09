// Tiny templating: html`...` tagged templates that escape every interpolated
// value unless it is itself html`` (or raw()). Arrays are joined, and
// null / undefined / false / true render nothing — so `${cond && html`…`}`
// and `${list.map(x => html`…`)}` just work.
//
//   const row = p => html`<li class="truncate">${p.name}</li>`;
//   el.innerHTML = html`<ul>${people.map(row)}</ul>`;

class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v).replace(/[&<>"']/g, c => ESC[c]);

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Html(out);
}

// Trusted markup (SVG paths, pre-built strings).
export const raw = s => new Html(String(s ?? ''));

// Class list builder: cx('a', cond && 'b', ['c', 'd']) → "a b c d".
export const cx = (...xs) => xs.flat(Infinity).filter(Boolean).join(' ');

// A JS string literal safe to drop into an inline handler attribute:
// onclick="App.pick(${js(name)})".
export const js = v => raw(esc(JSON.stringify(String(v))));

export function mount(el, view) {
  if (el) el.innerHTML = part(view);
}
