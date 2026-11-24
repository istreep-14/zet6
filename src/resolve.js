// resolveStaff / resolvePools — raw state strings → absolute-axis numbers.
//
// Resolution order per person:
//   in  = explicit || roleDefault.in  || global.in   → resolveIn (fixed am/pm)
//   out = explicit || roleDefault.out || closeTime   → nextAfter(reading, inAbs)
// In times use the fixed 9–11:59=AM rule; out times are the next occurrence of
// their reading after that person's own In (so they always fall after In).
// Closers (hybrid rule): closerOverride || out ≥ peak out across tipped staff.
// Breaks: hours = Out − In − brk; in a pool, a placed break (brkAt) comes off
// the pool it falls in, an unplaced one off each pool pro rata.
// Blank-out people sit at close time, so they're closers via latest-out
// naturally — someone typed *past* close becomes the closer, ties share.

import { parseTime, resolveIn, inAbsOf, afterAbsOf, atOrAfterOf, overlapHours } from './time.js';
import { parseWholeNumber, parseDecimalNumber, poolValue, DENOMS } from './util.js';

const EPS = 1e-9;

function parseField(raw, label, errors) {
  const p = parseTime(raw);
  if (!p.valid) errors.push(label + ' is not a valid time — use 15-min steps (e.g. 5, 5.25, 10.5, 7a, 9.5p).');
  return p;
}

// opts.closeOverride: raw decimal close time replacing defaults.global.out
// (the Close Time sidebar varies this one value and re-runs the pipeline).
export function resolveStaff(state, opts = {}) {
  const errors = [];
  const defaults = state.defaults;

  const globalIn = parseField(defaults.global.in, 'Default In', errors);
  const globalOutRaw = opts.closeOverride != null ? String(opts.closeOverride) : defaults.global.out;
  const globalOut = parseField(globalOutRaw, 'Default Out', errors);

  const named = state.staff.filter(p => (p.name || '').trim());

  // Effective raw in per person (explicit → role default → global)
  const effIns = named.map(p => {
    const roleDef = defaults.byRole[p.role] || {};
    return String(p.in || '').trim() || String(roleDef.in || '').trim() || (globalIn.empty ? '' : String(defaults.global.in));
  });

  // Anchor (shift open) on the absolute axis: resolved global In, else earliest
  // resolved staff In, else 5p.
  let anchorAbs;
  if (globalIn.valid && !globalIn.empty) {
    anchorAbs = inAbsOf(globalIn);
  } else {
    const ins = effIns
      .map(s => parseTime(s))
      .filter(p => p.valid && !p.empty)
      .map(p => inAbsOf(p));
    anchorAbs = ins.length ? Math.min(...ins) : resolveIn(5);
  }

  // Pass 1: resolve each person's In (fixed am/pm rule) and any explicit/role
  // Out (next occurrence of its reading after that person's own In).
  const partial = named.map((p, idx) => {
    const roleDef = defaults.byRole[p.role] || {};
    const name = p.name.trim();
    const explicitIn = String(p.in || '').trim();
    const explicitOut = String(p.out || '').trim();
    const outRaw = explicitOut || String(roleDef.out || '').trim();

    const inParsed = parseField(effIns[idx], name + "'s In time", errors);
    let inAbs = null;
    if (inParsed.valid && !inParsed.empty) inAbs = inAbsOf(inParsed);
    else if (inParsed.valid && inParsed.empty) errors.push(name + ' needs an In time (or set a default).');

    let outAbs = null;
    if (outRaw) {
      const outParsed = parseField(outRaw, name + "'s Out time", errors);
      if (outParsed.valid && !outParsed.empty) {
        outAbs = inAbs !== null ? afterAbsOf(outParsed, inAbs) : inAbsOf(outParsed);
      }
    }
    // A break: brk = its length in hours ('0.5'), brkAt = when it began
    // ('' = not placed — then it comes off every pool in proportion).
    const brk = parseDecimalNumber(p.brk);
    if (!brk.valid) errors.push(name + "'s break must be a number of hours, e.g. 0.5.");
    let brkStart = null;
    const atRaw = String(p.brkAt || '').trim();
    if (brk.valid && brk.value > 0 && atRaw) {
      const at = parseField(atRaw, name + "'s break time", errors);
      if (at.valid && !at.empty) brkStart = inAbs !== null ? atOrAfterOf(at, inAbs) : inAbsOf(at);
    }
    return { p, name, role: p.role, explicitIn, explicitOut, hasOut: !!outRaw, inAbs, outAbs, brkLen: brk.valid ? brk.value : 0, brkStart };
  });

  // Close time = resolved global Out (next occurrence after the anchor). Fallback:
  // latest explicit out across staff, so a session without a Default Out works.
  let closeAbs = null;
  if (globalOut.valid && !globalOut.empty) {
    closeAbs = afterAbsOf(globalOut, anchorAbs);
  } else {
    for (const r of partial) {
      if (r.hasOut && r.outAbs !== null && (closeAbs === null || r.outAbs > closeAbs)) closeAbs = r.outAbs;
    }
  }

  // Pass 2: blank-out people inherit the close time; finalize hours.
  const staff = partial.map(r => {
    let outAbs = r.outAbs;
    let usedCloseTime = false;
    if (!r.hasOut) {
      if (closeAbs !== null) { outAbs = closeAbs; usedCloseTime = true; }
      else errors.push(r.name + ' needs an Out time (or set a close time).');
    }

    let hours = 0, brkLen = r.brkLen, brkStart = r.brkStart;
    if (r.inAbs !== null && outAbs !== null) {
      const span = outAbs - r.inAbs;
      if (span <= 0 || span > 12) {
        errors.push(r.name + ' has invalid shift hours (' + parseFloat(span.toFixed(2)) + 'h). Check In/Out times.');
      }
      if (brkLen > 0 && span > 0) {
        if (brkLen >= span) { errors.push(r.name + "'s break is as long as their shift."); brkLen = 0; }
        else if (brkStart !== null && (brkStart < r.inAbs - EPS || brkStart + brkLen > outAbs + EPS)) {
          errors.push(r.name + "'s break falls outside their shift.");
          brkStart = null;
        }
      }
      hours = span - (brkLen > 0 && brkLen < span ? brkLen : 0);
    } else brkStart = null;

    return {
      id: r.p.id,
      name: r.name,
      role: r.role,
      inAbs: r.inAbs,
      outAbs,
      hours,                       // worked: Out − In − the break
      brkLen: brkLen > 0 ? brkLen : 0,
      brkStart: brkLen > 0 ? brkStart : null,
      closerOverride: !!r.p.closerOverride,
      usedDefaults: { in: !r.explicitIn, out: !r.explicitOut },
      usedCloseTime,
      closer: false,
    };
  });

  // Closer rule: latest effective out across tipped staff; ties → all.
  const tipped = staff.filter(p => p.role !== 'support' && p.outAbs !== null);
  const peak = tipped.length ? Math.max(...tipped.map(p => p.outAbs)) : null;
  staff.forEach(p => {
    const auto = p.role !== 'support' && peak !== null && p.outAbs !== null && p.outAbs >= peak - EPS;
    p.autoCloser = auto;
    p.closer = p.closerOverride || auto;
  });

  return { staff, anchorAbs, closeAbs, errors };
}

// Pool windows resolve onto the same axis. Each edge is one of:
//   ''     start: earliest resolved in · end: close time
//   '3.5'  a clock reading → next occurrence at/after the open
//   'srv'  when the servers are out  = latest server Out on shift
//   'bar'  when the bar is out       = latest bartender Out on shift
// A role edge with nobody of that role named falls back to the role's default
// Out, then the close time. Day shifts use them: Day = open → 'srv' (bar +
// servers), Mid = 'srv' → 'bar' (bar only), so the switch follows the floor.
export const EDGE_TOKENS = { srv: 'server', bar: 'bartender' };

export function resolvePools(state, resolved) {
  const { staff, anchorAbs, closeAbs } = resolved;
  const errors = [];

  const ins = staff.filter(p => p.inAbs !== null).map(p => p.inAbs);
  const earliestIn = ins.length ? Math.min(...ins) : anchorAbs;
  const closeOr = closeAbs !== null ? closeAbs : earliestIn;

  // Latest Out of a role, else its default Out, else the close time.
  const roleEnd = role => {
    const outs = staff.filter(p => p.role === role && p.outAbs !== null).map(p => p.outAbs);
    if (outs.length) return Math.max(...outs);
    const d = parseTime(state.defaults.byRole?.[role]?.out);
    if (d.valid && !d.empty) return afterAbsOf(d, anchorAbs);
    return closeOr;
  };

  const pools = state.pools.map(pool => {
    const label = pool.label || 'Pool';

    // → { abs, derived } for one edge.
    const edge = (raw, which, fallback) => {
      const str = String(raw || '').trim();
      if (!str) return { abs: fallback, derived: true };
      if (EDGE_TOKENS[str]) return { abs: roleEnd(EDGE_TOKENS[str]), derived: true };
      const p = parseField(str, label + ' window ' + which, errors);
      return { abs: p.valid && !p.empty ? atOrAfterOf(p, anchorAbs) : fallback, derived: false };
    };
    const st = edge(pool.window.start, 'start', earliestIn);
    const en = edge(pool.window.end, 'end', closeOr);
    let startAbs = st.abs, endAbs = en.abs;

    // A typed window must run forward. A derived one may collapse (e.g. Mid
    // when the servers stay to close) — then it's just an empty pool.
    if (endAbs <= startAbs) {
      if (st.derived && en.derived) endAbs = startAbs;
      else errors.push(label + ' window end must be after its start.');
    }

    // Cash = the bills counted + the rest that wasn't counted (netTotal), then
    // the signed register adjustment (adjust, e.g. "-50" when the register is
    // short). Old 'perbill' / 'nettotal' pools only read their own field.
    const mode = pool.cash.entryMode;
    const billCounts = {};
    DENOMS.forEach(d => {
      const parsed = parseWholeNumber(mode === 'nettotal' ? '' : pool.cash.billCounts[d]);
      if (!parsed.valid) errors.push(label + ' $' + d + ' count must be a whole number.');
      billCounts[d] = parsed.valid ? parsed.value : 0;
    });
    // netTotal is either the uncounted rest, or (restMode 'total') the whole
    // amount including the counted bills — then rest = total − counted.
    const counted = poolValue(billCounts);
    const restParsed = parseWholeNumber(mode === 'perbill' ? '' : pool.cash.netTotal);
    if (!restParsed.valid) errors.push(label + ' cash must be a whole-dollar amount.');
    const typed = restParsed.valid ? restParsed.value : 0;
    const asTotal = pool.cash.restMode === 'total' && String(pool.cash.netTotal ?? '').trim() !== '';
    if (asTotal && typed < counted) errors.push(label + ': the counted bills come to more than the total cash.');
    const rest = asTotal ? Math.max(0, typed - counted) : typed;
    const adjParsed = parseSignedWhole(pool.cash.adjust);
    if (!adjParsed.valid) errors.push(label + ' register over / short must be whole dollars, e.g. -50.');
    const adjust = adjParsed.valid ? adjParsed.value : 0;
    const totalBefore = counted + rest;
    const total = totalBefore + adjust;
    if (total < 0) errors.push(label + ' is short more than it holds.');

    // Support tip-out config. Pct chain: pool override → global default → 10.
    // A non-blank rate replaces the pct-derived $/hr; hours entries replace
    // a support person's overlap with the window (their In/Out is untouched).
    const supRaw = pool.support || {};
    const pctStr = String(supRaw.pct ?? '').trim() || String(state.defaults.supportPct ?? '').trim() || '10';
    const pctParsed = parseDecimalNumber(pctStr);
    if (!pctParsed.valid) errors.push(label + ' support % must be a number.');
    const rateParsed = parseDecimalNumber(supRaw.rate);
    if (!rateParsed.valid) errors.push(label + ' support $/hr must be a number.');
    const hoursOverrides = {};
    Object.entries(supRaw.hours || {}).forEach(([sid, v]) => {
      if (!String(v ?? '').trim()) return;
      const h = parseDecimalNumber(v);
      if (!h.valid) { errors.push(label + ' support hours must be a number.'); return; }
      hoursOverrides[sid] = h.value;
    });

    return {
      id: pool.id,
      label,
      kind: pool.kind || '',
      startAbs,
      endAbs,
      startRef: EDGE_TOKENS[String(pool.window.start || '').trim()] ? String(pool.window.start).trim() : '',
      endRef: EDGE_TOKENS[String(pool.window.end || '').trim()] ? String(pool.window.end).trim() : '',
      roles: { ...pool.roles },
      includeSupport: !!pool.includeSupport,
      support: {
        pct: pctParsed.valid ? pctParsed.value : 10,
        pctOverridden: !!String(supRaw.pct ?? '').trim(),
        rateOverride: rateParsed.valid && !rateParsed.empty ? rateParsed.value : null,
        hoursOverrides,
      },
      total: Math.max(0, total),
      totalBefore,
      counted,
      rest,
      adjust,
      billCounts,
    };
  });

  return { pools, errors };
}

// "-50", "+20", "−50", "$-50", "" → { valid, value } (blank = 0).
export function parseSignedWhole(raw) {
  const s = String(raw ?? '').trim().replace(/[$\s]/g, '').replace('−', '-');
  if (!s) return { valid: true, value: 0 };
  if (!/^[+-]?\d+$/.test(s)) return { valid: false, value: 0 };
  return { valid: true, value: Number(s) };
}

export function poolParticipants(pool, staff) {
  return staff
    .filter(p => pool.roles[p.role] || (p.role === 'support' && pool.includeSupport))
    .map(p => {
      let hours = overlapHours(p.inAbs, p.outAbs, pool.startAbs, pool.endAbs);
      // A break comes off the pool it fell in (placed), or off every pool in
      // proportion to the time worked in it (not placed).
      if (p.brkLen > 0 && hours > 0) {
        const cut = p.brkStart != null
          ? overlapHours(p.brkStart, p.brkStart + p.brkLen, pool.startAbs, pool.endAbs)
          : p.brkLen * hours / Math.max(EPS, p.outAbs - p.inAbs);
        hours = Math.max(0, hours - cut);
      }
      if (p.role === 'support') {
        const override = pool.support?.hoursOverrides?.[p.id];
        if (override != null) hours = override;
      }
      return { person: p, hours };
    })
    .filter(x => x.hours > 0);
}
