// Unified time model — decimal 12-hour entry resolved onto one true 24h+ axis.
//
// Entry is decimal 12-hour ('5', '10.5', '2'), optionally with an explicit
// meridiem ('7a', '9.5p') — then it means exactly that time, any time of day.
// Without one, resolution follows a fixed rule (not anchor-relative):
//
//   IN times:  amFrom ≤ t < 12 → AM (t);  else → PM (t < 12 ? t+12 : t).
//              amFrom is a setting (default 9): 9–11:59 read as morning, 12 as
//              noon, 1–8:59 as 1p–8:59p. Set it to 6 and 6–8:59 read as AM.
//   OUT times: the next occurrence of that clock reading after the person's own
//              In — nextAfter(reading, inAbs). 5p in, 2 out → 2a (next day).
//
// The axis is real hours past midnight on the open day: 9–11 = 9a–11a, 12 = noon,
// 13–23 = 1p–11p, 24 = midnight, 25–32 = 1a–8a next day.

// → { valid, empty, value (12-hour reading, 0 ≤ v < 13), mer ('a' | 'p' | null) }
export function parseTime(raw) {
  let text = String(raw ?? '').trim().toLowerCase();
  if (!text) return { valid: true, empty: true, value: null, mer: null };
  let mer = null;
  const m = /^(.*?)\s*([ap])m?$/.exec(text);
  if (m) { mer = m[2]; text = m[1]; }
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return { valid: false, empty: false, value: null, mer: null };
  const value = Number(text);
  // 15-minute grid: every time sits on a .25 step, so scrub/stepper UIs can
  // assume a finite set of positions and snapping is lossless.
  const inRange = Number.isFinite(value) && value >= 0 && value < 13;
  const onQuarter = Number.isInteger(value * 4);
  const valid = inRange && onQuarter && (!mer || value >= 1);
  return {
    valid,
    empty: false,
    value: valid ? value : null,
    mer: valid ? mer : null,
  };
}

// Morning boundary for readings without a meridiem (settings.amFrom, 1–11).
let amFrom = 9;
export function setAmFrom(h) { amFrom = Number.isFinite(+h) && +h >= 1 && +h <= 11 ? +h : 9; }
export const getAmFrom = () => amFrom;

// A reading with an explicit meridiem → hour of day (0–23.75): 12a → 0, 12p → 12.
export function hour24(t, mer) {
  const h = t >= 12 ? t - 12 : t;
  return mer === 'a' ? h : h + 12;
}

// Parsed time → absolute axis. In: the reading's own time (explicit) or the
// am/pm rule. After / at-or-after: the next occurrence after a point (an
// explicit meridiem steps by 24h, a bare reading by 12h).
export function inAbsOf(p) {
  return p.mer ? hour24(p.value, p.mer) : resolveIn(p.value);
}
export function afterAbsOf(p, afterAbs) {
  if (!p.mer) return nextAfter(p.value, afterAbs);
  let v = hour24(p.value, p.mer);
  while (v <= afterAbs) v += 24;
  return v;
}
export function atOrAfterOf(p, fromAbs) {
  if (!p.mer) return atOrAfter(p.value, fromAbs);
  let v = hour24(p.value, p.mer);
  while (v < fromAbs) v += 24;
  return v;
}

// Reading + meridiem → the raw string stored ('7', '7a', '9.5p').
export const rawOf = (v, mer) => String(v) + (mer || '');

// Absolute time → its clock reading (1–12.75) and meridiem.
export function readingOf(abs) {
  const r = ((abs % 12) + 12) % 12;
  return r < 1 ? r + 12 : r;
}
export const merOf = abs => ((((abs % 24) + 24) % 24) < 12 ? 'a' : 'p');

// Keypad / free entry → a decimal 12-hour reading on the 15-min grid
// (a trailing a / p / am / pm is returned as `mer`).
// Accepts what people actually type for a clock time:
//   "5" → 5 · "10" → 10 · "17" → 5 (24-hour hours fold to 12-hour)
//   "530" → 5.5 · "1045" → 10.75 · "1730" → 5.5
//   "5:30" / "5:3" → 5.5 · "5:" → 5 · "5.5" / "5.25" → decimal hours
// Minutes snap to the nearest quarter hour (5:20 → 5:15, 5:55 → 6).
// Returns { valid, empty, value } like parseTime; value ∈ [1, 12.75].
export function parseClockEntry(raw) {
  let text = String(raw ?? '').trim().toLowerCase();
  if (!text) return { valid: true, empty: true, value: null, mer: null };
  const bad = { valid: false, empty: false, value: null, mer: null };
  let mer = null;
  const mm = /^(.*?)\s*([ap])m?$/.exec(text);
  if (mm) { mer = mm[2]; text = mm[1]; }
  let h, m;
  let mt;
  if ((mt = /^(\d{1,2}):(\d{0,2})$/.exec(text))) {
    h = +mt[1];
    m = mt[2] === '' ? 0 : mt[2].length === 1 ? +mt[2] * 10 : +mt[2];
  } else if ((mt = /^(\d{1,2})?\.(\d{0,2})$/.exec(text))) {
    h = +(mt[1] || 0);
    m = Math.round(Number('0.' + (mt[2] || '0')) * 60);
  } else if (/^\d{1,4}$/.test(text)) {
    if (text.length <= 2) { h = +text; m = 0; }
    else { h = +text.slice(0, text.length - 2); m = +text.slice(-2); }
  } else return bad;
  if (m > 59) return bad;
  if (h === 0 || h === 24) h = 12;
  else if (h > 12 && h < 24) h -= 12;
  if (h < 1 || h > 12) return bad;
  let q = Math.round(m / 15) * 0.25;
  let value = h + q;
  if (value >= 13) value -= 12;          // 12:55 → 1
  return { valid: true, empty: false, value, mer };
}

// Resolve an IN time (decimal 12-hour reading) to the absolute axis.
// amFrom–11:59 → AM; everything else → PM (noon stays 12, 1–8:59 → 13–20:59).
export function resolveIn(t) {
  if (t >= amFrom && t < 12) return t;   // 9a–11:59a by default
  if (t >= 12) return t;            // 12p–12:59p (noon hour)
  return t + 12;                    // 1p–8:59p (and <1, an edge)
}

// First absolute time matching clock reading `t` that is strictly after `afterAbs`.
// Used for OUT times: the next time that clock reads `t` after the person clocks in.
export function nextAfter(t, afterAbs) {
  let v = t;
  while (v <= afterAbs) v += 12;
  return v;
}

// First absolute time matching reading `t` at or after `fromAbs` (≥, not >).
// Used for pool window bounds, which may sit exactly on the shift open.
export function atOrAfter(t, fromAbs) {
  let v = t;
  while (v < fromAbs) v += 12;
  return v;
}

// Format an absolute-axis time for display: "5p", "10:30a", "2a", "12a" (midnight).
// Display clock: 12-hour "h:mma/p" (5:00p, 1:30a) or 24-hour "HH:MM" (17:00,
// 01:30). Set once per render from state.settings.clock24 (main.js).
let clock24 = false;
export function setClock24(on) { clock24 = !!on; }

export function fmtTimeAbs(tAbs) {
  let h = ((tAbs % 24) + 24) % 24;
  let hr = Math.floor(h), mn = Math.round((h - hr) * 60);
  if (mn === 60) { hr = (hr + 1) % 24; mn = 0; }
  const mm = (mn < 10 ? '0' : '') + mn;
  if (clock24) return (hr < 10 ? '0' : '') + hr + ':' + mm;
  const h12 = hr % 12 || 12;
  return h12 + ':' + mm + (hr < 12 ? 'a' : 'p');
}

// Same reading as fmtTimeAbs, split so the hour can be set large and the
// minutes / a-p small: { h: '5', m: '' | '30', ap: 'a' | 'p' | '' }.
// On-the-hour times drop the minutes; 24-hour mode keeps them and has no ap.
export function timeParts(tAbs) {
  let h = ((tAbs % 24) + 24) % 24;
  let hr = Math.floor(h), mn = Math.round((h - hr) * 60);
  if (mn === 60) { hr = (hr + 1) % 24; mn = 0; }
  const mm = (mn < 10 ? '0' : '') + mn;
  if (clock24) return { h: (hr < 10 ? '0' : '') + hr, m: mm, ap: '' };
  return { h: String(hr % 12 || 12), m: mn ? mm : '', ap: hr < 12 ? 'a' : 'p' };
}

// Compact clock for tables: no ":00" — "5p", "10:30p" (24-hour: "17:00").
export function fmtClockShort(tAbs) {
  const t = timeParts(tAbs);
  return t.h + (t.m ? ':' + t.m : '') + t.ap;
}

// Absolute IN time → the string to store: the bare reading when the am/pm rule
// reads it back to the same time, else the reading with its meridiem ('7a',
// '9p'). Any time of day works.
export const IN_MIN_ABS = 0;
export const IN_MAX_ABS = 23.75;
export function absToInRaw(abs) {
  const r = Math.round(readingOf(abs) * 4) / 4;
  return resolveIn(r) === abs ? String(r) : rawOf(r, merOf(abs));
}

// Absolute OUT time → a string that maps back to it. Bare reading when that
// round-trips (next occurrence after `afterAbs`, or within 12h of any In when
// no anchor is given), else with its meridiem. Readings under 1 are written
// as 12.x (12:30a → '12.5') so they stay human-readable.
export function absToOutRaw(abs, afterAbs = null) {
  const r = Math.round(readingOf(abs) * 4) / 4;
  if (afterAbs == null || nextAfter(r, afterAbs) === abs) return String(r);
  return rawOf(r, merOf(abs));
}

// Absolute pool-window edge → string that atOrAfter(…, fromAbs) maps back.
export function absToEdgeRaw(abs, fromAbs) {
  const r = Math.round(readingOf(abs) * 4) / 4;
  return atOrAfter(r, fromAbs) === abs ? String(r) : rawOf(r, merOf(abs));
}

// Overlap of [inAbs, outAbs) with [startAbs, endAbs) in hours.
export function overlapHours(inAbs, outAbs, startAbs, endAbs) {
  const start = Math.max(inAbs, startAbs);
  const end = Math.min(outAbs, endAbs);
  return Math.max(0, end - start);
}
