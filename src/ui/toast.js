// A short message over the tab bar ("Copied — paste into Notes"), with an
// optional action button (Undo). One at a time.

let el = null;
let timer = 0;

// opts: a number (ms), or { ms, action: { label, onClick } } — a button in
// the toast (e.g. Undo after an edit).
export function toast(text, opts = {}) {
  const { ms = opts.action ? 5000 : 1800, action = null } = typeof opts === 'number' ? { ms: opts } : opts;
  if (!el) {
    el = Object.assign(document.createElement('div'), { className: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = '';
  el.append(Object.assign(document.createElement('span'), { className: 'toast-text', textContent: text }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { className: 'toast-action', type: 'button', textContent: action.label });
    b.onclick = () => { el.classList.remove('show'); action.onClick(); };
    el.append(b);
  }
  el.classList.toggle('has-action', !!action);
  el.classList.remove('show');
  void el.offsetWidth;                 // restart the animation
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), ms);
}

// Clipboard write with a fallback for older WebKit / non-secure origins.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
