// Bill distribution engine — ported from the v3 engine.js pipeline.
// Pure: value in, value out. Callers' objects are never mutated; results come
// back as byPerson maps keyed by staff id.
//
// Pipeline: preflight → preferred path (proportional $100s/$50s, balanced
// sweep of lower denoms) → DFS fallback (≤100 paths, graded) → rebalancing.

import { DENOMS, parseWholeNumber, poolValue, blankBills } from './util.js';

function normalizePool(pool) {
  const out = blankBills();
  DENOMS.forEach(d => {
    const parsed = parseWholeNumber(pool?.[d] ?? '');
    out[d] = parsed.valid ? parsed.value : 0;
  });
  return out;
}

// people: [{ id, final }] — internal slots copy what they need.
function buildDistributionSlots(people, leftoverAmount) {
  const slots = people.map(p => ({
    id: p.id,
    orig: p.final,
    target: p.final,
    bills: blankBills(),
    isRemainder: false,
  }));

  if (leftoverAmount > 0) {
    slots.push({
      id: null,
      orig: leftoverAmount,
      target: leftoverAmount,
      bills: blankBills(),
      isRemainder: true,
    });
  }

  return slots;
}

// Least value that must come from $1s/$5s/$10s, given where the drawer's $100s
// and $50s can actually go. A $50 turns an odd-tens payout ($270 → $220)
// even, so it saves a $10 — but only if that person has room for it after
// their $100s, and an odd count of $50s landing on an even-tens payout costs
// a $10 instead. Exact DP over (person, $100s left, $50s left); $20s are
// treated as unlimited, same as before. Every $100/$50 must be placed; if
// they can't be, fall back to the best placement that leaves some over.
function minSmallValueAfterBigBills(targets, n100, n50) {
  const memo = new Map();
  function best(i, h, f, strict) {
    if (i === targets.length) return strict && (h || f) ? Infinity : 0;
    const key = i + ',' + h + ',' + f;
    if (memo.has(key)) return memo.get(key);
    const t = targets[i];
    let min = Infinity;
    for (let a = Math.min(h, Math.floor(t / 100)); a >= 0; a--) {
      const r100 = t - a * 100;
      for (let b = Math.min(f, Math.floor(r100 / 50)); b >= 0; b--) {
        const cost = (r100 - b * 50) % 20 + best(i + 1, h - a, f - b, strict);
        if (cost < min) min = cost;
      }
    }
    memo.set(key, min);
    return min;
  }
  const exact = best(0, n100, n50, true);
  if (exact !== Infinity) return exact;
  memo.clear();
  return best(0, n100, n50, false);
}

function getSmallBillRequirementsForSlots(slots, poolIn) {
  const pool = normalizePool(poolIn);
  const targets = slots.map(s => s.orig);
  const oddTenSlots = slots.filter(s => Math.floor(s.orig / 10) % 2 !== 0);
  const fiftyEligibleOddTenSlots = oddTenSlots.filter(s => s.orig >= 50).length;
  const minOnes = targets.reduce((sum, target) => sum + (target % 5), 0);
  const minOneFiveValue = targets.reduce((sum, target) => sum + (target % 10), 0);
  const minOneFiveTenRaw = targets.reduce((sum, target) => sum + (target % 20), 0);
  const minOneFiveTenValue = Math.max(minOneFiveValue,
    minSmallValueAfterBigBills(targets, pool[100] || 0, pool[50] || 0));
  const fiftyCoverage = (minOneFiveTenRaw - minOneFiveTenValue) / 10;
  const availableOnes = pool[1] || 0;
  const availableOneFiveValue = availableOnes + (pool[5] || 0) * 5;
  const availableOneFiveTenValue = availableOneFiveValue + (pool[10] || 0) * 10;

  return {
    minOnes,
    availableOnes,
    onesShort: Math.max(0, minOnes - availableOnes),
    minOneFiveValue,
    availableOneFiveValue,
    oneFiveShort: Math.max(0, minOneFiveValue - availableOneFiveValue),
    minOneFiveTenValue,
    availableOneFiveTenValue,
    oneFiveTenShort: Math.max(0, minOneFiveTenValue - availableOneFiveTenValue),
    oddTenCount: oddTenSlots.length,
    fiftyEligibleOddTenCount: fiftyEligibleOddTenSlots,
    fiftyCoverage,
    fiftyCoverageValue: fiftyCoverage * 10,
  };
}

export function getSmallBillRequirements(people, poolIn, leftoverAmount) {
  return getSmallBillRequirementsForSlots(buildDistributionSlots(people, leftoverAmount || 0), poolIn);
}

export function previewSmallBillTrades(people, poolIn, leftoverAmount) {
  const sourcePool = normalizePool(poolIn);
  const targetTotal = people.reduce((sum, p) => sum + (p.final || 0), 0) + (leftoverAmount || 0);
  if (poolValue(sourcePool) !== targetTotal) return null;

  const adjustedPool = normalizePool(sourcePool);
  const deltas = blankBills();
  const slots = buildDistributionSlots(people, leftoverAmount || 0);

  function applyBreak(from, bundle) {
    if ((adjustedPool[from] || 0) <= 0) return false;
    adjustedPool[from]--;
    deltas[from]--;
    DENOMS.forEach(d => {
      const count = bundle[d] || 0;
      if (count <= 0) return;
      adjustedPool[d] += count;
      deltas[d] += count;
    });
    return true;
  }

  function breakForOnes(from) {
    const bundle = blankBills();
    if (from === 5) bundle[1] = 5;
    if (from === 10) { bundle[5] = 1; bundle[1] = 5; }
    if (from === 20) { bundle[10] = 1; bundle[5] = 1; bundle[1] = 5; }
    if (from === 50) { bundle[20] = 2; bundle[5] = 1; bundle[1] = 5; }
    if (from === 100) { bundle[50] = 1; bundle[20] = 2; bundle[5] = 1; bundle[1] = 5; }
    return applyBreak(from, bundle);
  }

  function breakForFives(from) {
    const bundle = blankBills();
    if (from === 10) bundle[5] = 2;
    if (from === 20) { bundle[10] = 1; bundle[5] = 2; }
    if (from === 50) { bundle[20] = 2; bundle[5] = 2; }
    if (from === 100) { bundle[50] = 1; bundle[20] = 2; bundle[5] = 2; }
    return applyBreak(from, bundle);
  }

  function breakForTens(from) {
    const bundle = blankBills();
    if (from === 20) bundle[10] = 2;
    if (from === 50) bundle[10] = 5;
    if (from === 100) { bundle[50] = 1; bundle[10] = 5; }
    return applyBreak(from, bundle);
  }

  function chooseDonor(candidates) {
    return candidates.find(d => (adjustedPool[d] || 0) > 0) || null;
  }

  function trySolve() {
    const result = runPipeline(people, adjustedPool, leftoverAmount || 0);
    if (!result.success) return null;
    return {
      byPerson: result.byPerson,
      pool: { ...adjustedPool },
      poolAfter: result.poolAfter,
      remainderBills: result.remainderBills || blankBills(),
      deltas: { ...deltas },
      // The step-by-step breaks re-break their own change; report the net swap.
      trades: [netTrade(deltas)],
      requirementsBefore: getSmallBillRequirementsForSlots(slots, sourcePool),
      requirementsAfter: getSmallBillRequirementsForSlots(slots, adjustedPool),
    };
  }

  let guard = 0;
  while (getSmallBillRequirementsForSlots(slots, adjustedPool).onesShort > 0 && guard++ < 40) {
    const donor = chooseDonor([5, 10, 20, 50, 100]);
    if (!donor || !breakForOnes(donor)) return null;
  }

  while (getSmallBillRequirementsForSlots(slots, adjustedPool).oneFiveShort > 0 && guard++ < 80) {
    const donor = chooseDonor([10, 20, 50, 100]);
    if (!donor || !breakForFives(donor)) return null;
  }

  while (getSmallBillRequirementsForSlots(slots, adjustedPool).oneFiveTenShort > 0 && guard++ < 120) {
    const donor = chooseDonor([20, 50, 100]);
    if (!donor || !breakForTens(donor)) return null;
  }

  const solved = trySolve();
  if (solved) return solved;

  const fallbackBreaks = [
    { from: 5, bundle: { 1: 5 } },
    { from: 10, bundle: { 5: 2 } },
    { from: 20, bundle: { 10: 2 } },
    { from: 50, bundle: { 10: 5 } },
    { from: 100, bundle: { 20: 5 } },
  ];

  for (let i = 0; i < 30; i++) {
    const next = fallbackBreaks.find(item => (adjustedPool[item.from] || 0) > 0);
    if (!next || !applyBreak(next.from, { ...blankBills(), ...next.bundle })) break;
    const retry = trySolve();
    if (retry) return retry;
  }

  return null;
}

// One consolidated line from a delta map: what leaves the drawer → what comes in.
function netTrade(deltas) {
  const give = blankBills(), get = blankBills();
  DENOMS.forEach(d => { if (deltas[d] < 0) give[d] = -deltas[d]; else get[d] = deltas[d]; });
  return 'Trade ' + billList(give) + ' ($' + poolValue(give) + ') for ' + billList(get) + '.';
}

function runPipeline(people, poolIn, leftoverAmount) {
  const pool = normalizePool(poolIn);
  const slots = buildDistributionSlots(people, leftoverAmount || 0);

  const preflight = runPreflight(slots, pool);
  if (!preflight.ok) return { success: false, msg: preflight.msg, poolAfter: pool, remainderBills: blankBills(), byPerson: {} };

  const preferred = buildPreferredPath(slots, pool);
  const poolAfterSieve = preferred ? null : runCascadingSieve(slots, pool);
  const paths = preferred ? [preferred] : runDFS(slots, poolAfterSieve);
  if (!paths.length) {
    return { success: false, msg: 'Exact change impossible with current bills. Adjust bill counts in Cash.', poolAfter: poolAfterSieve, remainderBills: blankBills(), byPerson: {} };
  }

  const best = preferred || gradePaths(paths);

  const byPerson = {};
  best.slots.forEach(s => {
    if (s.isRemainder) return;
    byPerson[s.id] = { ...s.bills };
  });

  const remainderSlot = best.slots.find(s => s.isRemainder);
  return {
    success: true,
    msg: '',
    poolAfter: best.leftoverPool,
    remainderBills: remainderSlot ? { ...remainderSlot.bills } : blankBills(),
    byPerson,
  };
}

function runPreflight(slots, pool) {
  const targetTotal = slots.reduce((sum, s) => sum + s.target, 0);
  const cashTotal = poolValue(pool);
  if (cashTotal < targetTotal) {
    return { ok: false, msg: 'Cash on hand is short $' + (targetTotal - cashTotal) + '.' };
  }

  const needs = getSmallBillRequirementsForSlots(slots, pool);

  if (needs.onesShort > 0) {
    return { ok: false, msg: 'Need ' + needs.onesShort + ' more $1s.' };
  }
  if (needs.oneFiveShort > 0) {
    return { ok: false, msg: 'Need $' + needs.oneFiveShort + ' more in $1s/$5s.' };
  }
  if (needs.oneFiveTenShort > 0) {
    return { ok: false, msg: 'Need $' + needs.oneFiveTenShort + ' more in $1s/$5s/$10s after $50s.' };
  }

  return { ok: true };
}

function runCascadingSieve(slots, poolIn) {
  const p = normalizePool(poolIn);

  slots.forEach(s => {
    const ones = s.target % 5;
    if (ones > 0) {
      s.bills[1] += ones;
      p[1] -= ones;
      s.target -= ones;
    }
  });

  let bundledOnes = Math.floor((p[1] || 0) / 5);
  slots.forEach(s => {
    if (s.target % 10 !== 5) return;
    if (bundledOnes > 0) {
      s.bills[1] += 5;
      p[1] -= 5;
      bundledOnes--;
      s.target -= 5;
    } else if ((p[5] || 0) > 0) {
      s.bills[5] += 1;
      p[5] -= 1;
      s.target -= 5;
    }
  });

  let bundledFives = Math.floor(((p[5] || 0) + bundledOnes) / 2);
  slots.forEach(s => {
    const isOddTens = Math.floor(s.target / 10) % 2 !== 0;
    if (!isOddTens || bundledFives <= 0) return;
    if ((p[5] || 0) >= 2) {
      s.bills[5] += 2;
      p[5] -= 2;
      s.target -= 10;
      bundledFives--;
    } else if ((p[5] || 0) === 1 && (p[1] || 0) >= 5) {
      s.bills[5] += 1;
      p[5] -= 1;
      s.bills[1] += 5;
      p[1] -= 5;
      s.target -= 10;
      bundledFives--;
    } else if ((p[1] || 0) >= 10) {
      s.bills[1] += 10;
      p[1] -= 10;
      s.target -= 10;
      bundledFives--;
    }
  });

  function assignSmallBundle(s, value) {
    const maxFives = Math.min(Math.floor(value / 5), p[5] || 0);
    for (let fives = maxFives; fives >= 0; fives--) {
      const ones = value - fives * 5;
      if ((p[1] || 0) < ones) continue;
      s.bills[5] += fives;
      p[5] -= fives;
      s.bills[1] += ones;
      p[1] -= ones;
      s.target -= value;
      return true;
    }
    return false;
  }

  [20, 10].forEach(value => {
    let assigned = true;
    while (assigned) {
      assigned = false;
      const next = slots.filter(s => s.target >= value).sort((a, b) => a.target - b.target)[0];
      if (next && assignSmallBundle(next, value)) assigned = true;
    }
  });

  return p;
}

function cloneDistributionSlots(slots) {
  return slots.map(s => ({
    id: s.id,
    orig: s.orig,
    target: s.target,
    bills: { ...s.bills },
    isRemainder: !!s.isRemainder,
  }));
}

function apportionDenomCounts(slots, denom, available) {
  const caps = slots.map(s => Math.floor(s.target / denom));
  const totalCap = caps.reduce((sum, cap) => sum + cap, 0);
  const count = Math.min(Math.max(0, available || 0), totalCap);
  const counts = slots.map(() => 0);
  if (count <= 0) return counts;

  const totalOrig = slots.reduce((sum, s) => sum + (s.orig || 0), 0) || 1;
  const shares = slots.map((s, i) => ({
    i,
    raw: (s.orig || 0) / totalOrig * count,
  }));

  let assigned = 0;
  for (const share of shares) {
    counts[share.i] = Math.min(caps[share.i], Math.floor(share.raw));
    assigned += counts[share.i];
  }

  while (assigned < count) {
    const before = assigned;
    for (const next of shares
      .filter(share => counts[share.i] < caps[share.i])
      .sort((a, b) => {
        const aFrac = a.raw - Math.floor(a.raw);
        const bFrac = b.raw - Math.floor(b.raw);
        return bFrac - aFrac
          || (slots[b.i].orig || 0) - (slots[a.i].orig || 0)
          || (slots[b.i].target || 0) - (slots[a.i].target || 0)
          || a.i - b.i;
      })) {
      if (assigned >= count) break;
      counts[next.i]++;
      assigned++;
    }
    if (assigned === before) break;
  }

  return counts;
}

// Preferred exact path: apportion $100s/$50s first, then solve lower
// denominations in descending order so each stage leaves balanced remainders.
// If it cannot solve exactly, the DFS below still handles the edge case.
function buildPreferredPath(slotsIn, poolIn) {
  const slots = cloneDistributionSlots(slotsIn);
  const pool = normalizePool(poolIn);

  function give(s, d, n) {
    const use = Math.min(n, pool[d] || 0, Math.floor(s.target / d));
    if (use <= 0) return 0;
    s.bills[d] += use;
    pool[d] -= use;
    s.target -= use * d;
    return use;
  }

  const hundredCounts = apportionDenomCounts(slots, 100, pool[100] || 0);
  hundredCounts.forEach((count, i) => give(slots[i], 100, count));

  if (!applyBestFiftyPlan(slots, pool)) return null;

  if (!assignLowerDenomsBalanced(slots, pool)) return null;

  return {
    slots,
    leftoverPool: pool,
  };
}

function applyBestFiftyPlan(slots, pool) {
  const count = pool[50] || 0;
  if (count <= 0) return true;

  const caps = slots.map(s => Math.floor(s.target / 50));
  if (caps.reduce((sum, cap) => sum + cap, 0) < count) return false;

  const counts = slots.map(() => 0);
  let best = null;

  function lowerCapacityOk(residuals) {
    if (residuals.reduce((sum, rem) => sum + Math.floor(rem / 20), 0) < (pool[20] || 0)) return false;
    if (residuals.reduce((sum, rem) => sum + Math.floor(rem / 10), 0) < (pool[10] || 0)) return false;
    if (residuals.reduce((sum, rem) => sum + Math.floor(rem / 5), 0) < (pool[5] || 0)) return false;
    return true;
  }

  function scorePlan() {
    const staffSlots = slots.filter(s => !s.isRemainder);
    const totalOrig = staffSlots.reduce((sum, s) => sum + (s.orig || 0), 0) || 1;
    const high50 = staffSlots.map(s => {
      const i = slots.indexOf(s);
      return (s.bills[100] || 0) * 100 + counts[i] * 50;
    });
    const totalHigh50 = high50.reduce((sum, value) => sum + value, 0);
    return staffSlots.reduce((sum, s, i) => {
      const ideal = (s.orig || 0) / totalOrig * totalHigh50;
      return sum + Math.abs(high50[i] - ideal);
    }, 0);
  }

  function search(i, remaining) {
    if (i === slots.length) {
      if (remaining !== 0) return;
      const residuals = slots.map((s, idx) => s.target - counts[idx] * 50);
      if (!lowerCapacityOk(residuals)) return;
      const score = scorePlan();
      if (!best || score < best.score) best = { counts: [...counts], score };
      return;
    }

    const restCap = caps.slice(i + 1).reduce((sum, cap) => sum + cap, 0);
    const minUse = Math.max(0, remaining - restCap);
    const maxUse = Math.min(caps[i], remaining);
    for (let use = minUse; use <= maxUse; use++) {
      counts[i] = use;
      search(i + 1, remaining - use);
    }
    counts[i] = 0;
  }

  search(0, count);
  if (!best) return false;

  best.counts.forEach((n, i) => {
    slots[i].bills[50] += n;
    slots[i].target -= n * 50;
  });
  pool[50] = 0;
  return true;
}

function assignLowerDenomsBalanced(slots, pool) {
  for (const d of [20, 10, 5]) {
    if (!assignDenomBalanced(slots, pool, d)) return false;
  }

  const onesNeeded = slots.reduce((sum, s) => sum + s.target, 0);
  if (onesNeeded !== (pool[1] || 0)) return false;
  for (const s of slots) {
    if (s.target < 0) return false;
    s.bills[1] += s.target;
    pool[1] -= s.target;
    s.target = 0;
  }

  return slots.every(s => s.target === 0);
}

function assignDenomBalanced(slots, pool, denom) {
  const count = pool[denom] || 0;
  if (count <= 0) return true;

  const caps = slots.map(s => Math.floor(s.target / denom));
  if (caps.reduce((sum, cap) => sum + cap, 0) < count) return false;

  const counts = slots.map(() => 0);
  let best = null;

  function lowerCapacityOk(residuals) {
    if (denom === 20 && residuals.reduce((sum, rem) => sum + Math.floor(rem / 10), 0) < (pool[10] || 0)) return false;
    if ((denom === 20 || denom === 10) && residuals.reduce((sum, rem) => sum + Math.floor(rem / 5), 0) < (pool[5] || 0)) return false;
    return true;
  }

  function scoreResiduals(residuals) {
    const scored = residuals.filter((_, i) => !slots[i].isRemainder);
    const avg = scored.reduce((sum, rem) => sum + rem, 0) / (scored.length || 1);
    const range = Math.max(...scored) - Math.min(...scored);
    const deviation = scored.reduce((sum, rem) => sum + Math.abs(rem - avg), 0);
    const billSpread = Math.max(...counts) - Math.min(...counts);
    return range * 10000 + deviation * 100 + billSpread;
  }

  function search(i, remaining) {
    if (i === slots.length) {
      if (remaining !== 0) return;
      const residuals = slots.map((s, idx) => s.target - counts[idx] * denom);
      if (!lowerCapacityOk(residuals)) return;
      const score = scoreResiduals(residuals);
      if (!best || score < best.score) best = { counts: [...counts], score };
      return;
    }

    const restCap = caps.slice(i + 1).reduce((sum, cap) => sum + cap, 0);
    const minUse = Math.max(0, remaining - restCap);
    const maxUse = Math.min(caps[i], remaining);
    for (let use = minUse; use <= maxUse; use++) {
      counts[i] = use;
      search(i + 1, remaining - use);
    }
    counts[i] = 0;
  }

  search(0, count);
  if (!best) return false;

  best.counts.forEach((n, i) => {
    slots[i].bills[denom] += n;
    slots[i].target -= n * denom;
  });
  pool[denom] = 0;
  return true;
}

function runDFS(slots, poolIn) {
  const validPaths = [];
  const bigDenoms = [100, 50, 20, 10];
  const pool = normalizePool(poolIn);
  const sortedIdxs = slots.map((_, i) => i).sort((a, b) => slots[b].target - slots[a].target);

  function search(pIdx) {
    if (validPaths.length >= 100) return;
    if (pIdx === slots.length) {
      validPaths.push({
        slots: slots.map(s => ({ ...s, bills: { ...s.bills } })),
        leftoverPool: { ...pool },
      });
      return;
    }

    const person = slots[sortedIdxs[pIdx]];
    if (person.target === 0) {
      search(pIdx + 1);
      return;
    }

    function fillPerson(targetVal, dIdx) {
      if (targetVal === 0) {
        search(pIdx + 1);
        return;
      }
      if (dIdx >= bigDenoms.length) return;

      const d = bigDenoms[dIdx];
      const maxUse = Math.min(pool[d] || 0, Math.floor(targetVal / d));
      for (let use = maxUse; use >= 0; use--) {
        person.bills[d] += use;
        pool[d] -= use;
        fillPerson(targetVal - use * d, dIdx + 1);
        person.bills[d] -= use;
        pool[d] += use;
      }
    }

    fillPerson(person.target, 0);
  }

  search(0);
  return validPaths;
}

function gradePaths(paths) {
  let bestPath = null;
  let lowestPenalty = Infinity;

  for (const path of paths) {
    let penalty = 0;
    const totalCounts = [];
    const smallBracketCounts = [];
    const mediumBracketCounts = [];

    for (const s of path.slots) {
      const idealBig = Math.floor(s.orig / 100);
      const actualBig = (s.bills[100] || 0) + ((s.bills[50] || 0) > 1 ? 1 : 0);
      penalty += Math.abs(idealBig - actualBig) * 2;

      const count1 = s.bills[1] || 0, count5 = s.bills[5] || 0, count10 = s.bills[10] || 0;
      const count20 = s.bills[20] || 0, count50 = s.bills[50] || 0, count100 = s.bills[100] || 0;
      totalCounts.push(count1 + count5 + count10 + count20 + count50 + count100);
      smallBracketCounts.push(count1 + count5 + count10);
      mediumBracketCounts.push(count1 + count5 + count10 + count20);
    }

    penalty += (Math.max(...totalCounts) - Math.min(...totalCounts)) * 10;
    penalty += (Math.max(...smallBracketCounts) - Math.min(...smallBracketCounts)) * 8;
    penalty += (Math.max(...mediumBracketCounts) - Math.min(...mediumBracketCounts)) * 5;

    if (penalty < lowestPenalty) {
      lowestPenalty = penalty;
      bestPath = path;
    }
  }

  return bestPath;
}

// Public entry point. people: [{ id, final }], bills: bill-count pool.
// Returns { byPerson: {id → bills}, remainderBills, poolAfter, error } — never
// mutates its inputs.
export function distribute(people, bills, leftover) {
  const result = runPipeline(people, bills, leftover || 0);
  return {
    byPerson: result.byPerson,
    poolAfter: result.poolAfter || normalizePool(bills),
    remainderBills: result.remainderBills || blankBills(),
    error: result.success ? '' : result.msg,
  };
}

// ── Break-bill search ─────────────────────────────────────────────────────────
// When distribute() fails, find the fewest "break one bill into smaller bills"
// swaps that make exact change possible. Unlike previewSmallBillTrades this
// considers every denomination — e.g. three $316 payouts from 7×100 3×50 4×20
// 3×5 5×1 need nine $20s, and the fix is "break 1 × $100 into 5 × $20", not
// more $1s. Iterative deepening (1 swap, then 2, …) over unique drawers; among
// solutions with the fewest swaps, the one leaving the fewest bills wins.
// Returns the same shape as previewSmallBillTrades, or null if none ≤ maxSwaps.

const BREAKS = [
  [100, { 20: 5 }], [100, { 50: 2 }], [100, { 50: 1, 20: 2, 10: 1 }], [100, { 10: 10 }],
  [50, { 20: 2, 10: 1 }], [50, { 10: 5 }], [50, { 20: 1, 10: 3 }],
  [20, { 10: 2 }], [20, { 10: 1, 5: 2 }], [20, { 5: 4 }],
  [10, { 5: 2 }], [10, { 5: 1, 1: 5 }], [10, { 1: 10 }],
  [5, { 1: 5 }],
];

export function suggestBreaks(people, poolIn, leftoverAmount, maxSwaps = 3) {
  const start = normalizePool(poolIn);
  const leftover = leftoverAmount || 0;
  const target = people.reduce((s, p) => s + (p.final || 0), 0) + leftover;
  if (poolValue(start) !== target) return null;
  if (runPipeline(people, start, leftover).success) return null;

  const key = pool => DENOMS.map(d => pool[d]).join(',');
  const billCount = pool => DENOMS.reduce((s, d) => s + pool[d], 0);
  const seen = new Set([key(start)]);
  let frontier = [{ pool: start, moves: [] }];

  for (let depth = 1; depth <= maxSwaps; depth++) {
    const next = [];
    const solved = [];
    for (const node of frontier) {
      for (let m = 0; m < BREAKS.length; m++) {
        const [from, bundle] = BREAKS[m];
        if (node.pool[from] <= 0) continue;
        const pool = { ...node.pool };
        pool[from]--;
        Object.entries(bundle).forEach(([d, n]) => { pool[d] += n; });
        const k = key(pool);
        if (seen.has(k)) continue;
        seen.add(k);
        const child = { pool, moves: [...node.moves, m] };
        if (runPipeline(people, pool, leftover).success) solved.push(child);
        else next.push(child);
      }
    }
    if (solved.length) {
      solved.sort((a, b) => billCount(a.pool) - billCount(b.pool));
      return describeBreaks(people, start, solved[0], leftover);
    }
    frontier = next;
  }
  return null;
}

function describeBreaks(people, start, node, leftover) {
  const grouped = new Map();
  node.moves.forEach(m => grouped.set(m, (grouped.get(m) || 0) + 1));
  const trades = [...grouped].map(([m, times]) => {
    const [from, bundle] = BREAKS[m];
    const parts = DENOMS.filter(d => bundle[d]).map(d => bundle[d] * times + ' × $' + d).join(' + ');
    return 'Break ' + times + ' × $' + from + ' into ' + parts + '.';
  });
  const deltas = blankBills();
  DENOMS.forEach(d => { deltas[d] = node.pool[d] - start[d]; });
  const dist = distribute(people, node.pool, leftover);
  return { trades, deltas, pool: node.pool, byPerson: dist.byPerson, remainderBills: dist.remainderBills };
}

// ── Exchange plan ─────────────────────────────────────────────────────────────
// Constructive fix for drawers that are mostly big bills (e.g. 10×$100 7×$50
// with no small bills): pay everyone from the drawer as far as it goes, then
// the bills nobody could use are traded as ONE exchange for exactly the small
// bills the remainders need — "Trade 3 × $50 for 5 × $20 + 3 × $10 + …" —
// instead of dozens of one-bill breaks. Denominations given and received are
// disjoint by construction (a residual ≥ d only remains once $d ran out).

function fillGreedy(amount, into) {
  let rem = amount;
  DENOMS.forEach(d => { const n = Math.floor(rem / d); into[d] += n; rem -= n * d; });
}

// $100/$50 placement that strands the least cash (a $50 before a $100), then (same DP idea as
// minSmallValueAfterBigBills) leaves the least for $1s/$5s/$10s — a $50 goes
// to the odd-tens payout it evens out, not whoever is first in line.
function placeBigBills(targets, n100, n50) {
  const memo = new Map();
  function best(i, h, f) {
    // Strand the least cash; at equal cash strand $50s, not a $100.
    if (i === targets.length) return { cost: (h * 100 + f * 50) * 10000 + h * 1000, picks: [] };
    const key = i + ',' + h + ',' + f;
    if (memo.has(key)) return memo.get(key);
    const t = targets[i];
    let min = null;
    for (let a = Math.min(h, Math.floor(t / 100)); a >= 0; a--) {
      for (let b = Math.min(f, Math.floor((t - a * 100) / 50)); b >= 0; b--) {
        const rest = best(i + 1, h - a, f - b);
        const cost = (t - a * 100 - b * 50) % 20 + rest.cost;
        if (!min || cost < min.cost) min = { cost, picks: [[a, b], ...rest.picks] };
      }
    }
    memo.set(key, min);
    return min;
  }
  return best(0, n100, n50).picks;
}

// With $100s/$50s placed, everyone's remainder is ideally $20s/$10s/$5s/$1s.
// Pool those needs, let the drawer's small bills cover them (spare $1s stand
// in for $5s, etc.), and bring in only the shortfall. Stranded $100s/$50s are
// what gets traded. Returns null when spare small bills can't be absorbed.
function exchangeForPlacement(amounts, start, placement) {
  const need = blankBills();
  const stranded = { ...start };
  amounts.forEach((amount, i) => {
    const [a, b] = placement[i];
    stranded[100] -= a; stranded[50] -= b;
    fillGreedy(amount - a * 100 - b * 50, need);
  });
  if (need[100] || need[50]) return null;
  const get = blankBills();
  let carry = 0;                                  // value of spare smaller bills
  for (const d of [1, 5, 10, 20]) {
    const have = start[d];
    if (have >= need[d]) { carry += (have - need[d]) * d; continue; }
    let short = need[d] - have;
    const fromCarry = Math.min(short, Math.floor(carry / d));
    carry -= fromCarry * d; short -= fromCarry;
    get[d] = short;
  }
  if (carry) return null;
  const give = blankBills();
  give[100] = stranded[100]; give[50] = stranded[50];
  return poolValue(give) === poolValue(get) ? { give, get } : null;
}

function exchangeFor(order, start, placement) {
  if (placement) return exchangeForPlacement(order, start, placement);
  const drawer = { ...start };
  const give = blankBills();
  const get = blankBills();
  order.forEach(amount => {
    let rem = amount;
    DENOMS.forEach(d => {
      const n = Math.min(Math.floor(rem / d), drawer[d]);
      drawer[d] -= n;
      rem -= n * d;
    });
    if (rem > 0) fillGreedy(rem, get);
  });
  DENOMS.forEach(d => {
    // Same denomination on both sides just means "keep it" — cancel out.
    const both = Math.min(drawer[d], get[d]);
    give[d] = drawer[d] - both;
    get[d] -= both;
  });
  // Bills left in the drawer aren't all owed to the trade: keep the largest
  // ones that the exchange value doesn't need — give only what covers it.
  const value = poolValue(get);
  const out = blankBills();
  let need = value;
  [...DENOMS].reverse().forEach(d => {          // smallest first
    const n = Math.min(give[d], Math.floor(need / d));
    out[d] = n; need -= n * d;
  });
  if (need !== 0) DENOMS.forEach(d => { out[d] = give[d]; });
  return { give: out, get };
}

// The same cash in fewer bills: two $5s → a $10, five $1s → a $5, while
// everyone is still paid exactly. Keeps give / get disjoint (never asks back
// a size that's being handed over).
function consolidateGet(people, start, give, get, leftover) {
  const STEPS = [[5, 2, 10], [1, 5, 5]];
  let cur = { ...get };
  for (let changed = true; changed;) {
    changed = false;
    for (const [d, n, to] of STEPS) {
      if (cur[d] < n || give[to] > 0) continue;
      const next = { ...cur, [d]: cur[d] - n, [to]: cur[to] + 1 };
      const pool = { ...start };
      DENOMS.forEach(x => { pool[x] += next[x] - give[x]; });
      if (DENOMS.some(x => pool[x] < 0) || !runPipeline(people, pool, leftover).success) continue;
      cur = next;
      changed = true;
    }
  }
  return cur;
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function countBills(pool) { return DENOMS.reduce((s, d) => s + (pool[d] || 0), 0); }
function billList(pool) { return DENOMS.filter(d => pool[d] > 0).map(d => pool[d] + ' × $' + d).join(' + '); }

export function planExchange(people, poolIn, leftoverAmount) {
  const start = normalizePool(poolIn);
  const leftover = leftoverAmount || 0;
  const amounts = people.map(p => p.final || 0).concat(leftover > 0 ? [leftover] : []);
  if (poolValue(start) !== amounts.reduce((s, a) => s + a, 0)) return null;

  const orders = [
    amounts,
    [...amounts].sort((a, b) => b - a),
    [...amounts].sort((a, b) => a - b),
  ];
  const candidates = orders.map(order => [order, null]);
  candidates.unshift([amounts, placeBigBills(amounts, start[100], start[50])]);
  let best = null;
  for (const [order, placement] of candidates) {
    const plan = exchangeFor(order, start, placement);
    if (!plan) continue;
    const { give } = plan;
    if (!countBills(give)) continue;
    const pool0 = { ...start };
    DENOMS.forEach(d => { pool0[d] += plan.get[d] - give[d]; });
    if (DENOMS.some(d => pool0[d] < 0)) continue;
    if (!runPipeline(people, pool0, leftover).success) continue;
    const get = consolidateGet(people, start, give, plan.get, leftover);
    const pool = { ...start };
    DENOMS.forEach(d => { pool[d] += get[d] - give[d]; });
    // Least cash to exchange, then fewest $100s traded (break a $50 first),
    // then fewest bills handed over, then fewest bills brought back (a $10,
    // not two $5s), then fewest $10s (a $50 placed well beats a stack of
    // $10s), then the smallest drawer.
    const score = [poolValue(give), give[100], countBills(give), countBills(get), get[10], countBills(pool)];
    if (!best || compareScores(score, best.score) < 0) {
      best = { give, get, pool, score };
    }
  }
  if (!best) return null;

  const deltas = blankBills();
  DENOMS.forEach(d => { deltas[d] = best.pool[d] - start[d]; });
  const dist = distribute(people, best.pool, leftover);
  return {
    trades: [netTrade(deltas)],
    deltas, pool: best.pool, byPerson: dist.byPerson, remainderBills: dist.remainderBills,
    score: best.score,
  };
}

// Best "make change" plan: the least cash exchanged (then fewest bills), between
// single-bill breaks (suggestBreaks) and one consolidated exchange; the old
// small-bill heuristic is the last resort.
export function planMakeChange(people, poolIn, leftoverAmount) {
  const start = normalizePool(poolIn);
  const exchange = planExchange(people, start, leftoverAmount);
  const breaks = suggestBreaks(people, start, leftoverAmount);
  if (breaks && exchange) {
    const out = blankBills();
    DENOMS.forEach(d => { out[d] = Math.max(0, -breaks.deltas[d]); });
    const back = blankBills();
    DENOMS.forEach(d => { back[d] = Math.max(0, breaks.deltas[d]); });
    const breaksScore = [poolValue(out), out[100], countBills(out), countBills(back), back[10], countBills(breaks.pool)];
    // Breaks win full ties: they keep the bundles bank-standard.
    return compareScores(exchange.score, breaksScore) < 0 ? exchange : breaks;
  }
  return breaks || exchange || previewSmallBillTrades(people, start, leftoverAmount);
}

// Trade-up plan: convert excess $1s/$5s/$10s into $20s.
// Returns { newPool, delta, new20s } or null if no $20s can be gained.
export function computeTradeUp(pool, req) {
  const minFives = Math.max(0, (req.minOneFiveValue - req.minOnes) / 5);
  const minTens = Math.max(0, (req.minOneFiveTenValue - req.minOneFiveValue) / 10);

  const excessOnes = Math.max(0, (pool[1] || 0) - req.minOnes);
  const excessFives = Math.max(0, (pool[5] || 0) - minFives);
  const excessTens = Math.max(0, (pool[10] || 0) - minTens);
  const totalExcess = excessOnes + excessFives * 5 + excessTens * 10;

  const new20s = Math.floor(totalExcess / 20);
  if (new20s <= 0) return null;

  let rem = totalExcess - new20s * 20;
  const keepExtra10 = Math.min(excessTens, Math.floor(rem / 10)); rem -= keepExtra10 * 10;
  const keepExtra5 = Math.min(excessFives, Math.floor(rem / 5)); rem -= keepExtra5 * 5;

  // Remove only the excess that was traded, then add back kept amounts —
  // prevents phantom bills when pool[d] < min[d].
  const newPool = {
    100: pool[100] || 0,
    50: pool[50] || 0,
    20: (pool[20] || 0) + new20s,
    10: (pool[10] || 0) - excessTens + keepExtra10,
    5: (pool[5] || 0) - excessFives + keepExtra5,
    1: (pool[1] || 0) - excessOnes + rem,
  };

  const delta = {};
  DENOMS.forEach(d => { delta[d] = (newPool[d] || 0) - (pool[d] || 0); });

  return { newPool, delta, new20s };
}

// ── The drawer from what was entered ─────────────────────────────────────────
// Each pool holds the bills that were counted plus a "rest" that wasn't (and a
// signed register adjustment). The counted bills are kept as they are; the
// uncounted dollars are filled with the bills the payouts need most — the
// $1 / $5 / $10s still short given where the counted $100s / $50s can go —
// then $20s, then whatever is left. A negative remainder (the register is
// short more than the uncounted cash) comes off the counted bills, largest
// first; `note` says when that can't be done exactly.
export function drawerBills(pools, people, leftoverAmount) {
  const counted = blankBills();
  let loose = 0;
  pools.forEach(p => {
    DENOMS.forEach(d => { counted[d] += (p.billCounts && p.billCounts[d]) || 0; });
    loose += (p.rest || 0) + (p.adjust || 0);
  });
  const anyCounted = countBillsIn(counted) > 0;
  if (loose < 0) {
    const pool = { ...counted };
    let def = -loose;
    DENOMS.forEach(d => { const n = Math.min(pool[d], Math.floor(def / d)); pool[d] -= n; def -= n * d; });
    if (def === 0) return { bills: pool, counted: anyCounted, added: blankBills(), note: '' };
    const total = poolValue(counted) + loose;
    return { bills: fillLoose(blankBills(), Math.max(0, total), people, leftoverAmount).bills, counted: false, added: blankBills(),
      note: 'The register adjustment doesn’t match the bills you counted — recount them; bills shown are a suggestion.' };
  }
  const { bills, added } = fillLoose(counted, loose, people, leftoverAmount);
  return { bills, counted: anyCounted, added, note: '' };
}

function countBillsIn(pool) { return DENOMS.reduce((s, d) => s + (pool[d] || 0), 0); }

function fillLoose(fixed, loose, people, leftoverAmount) {
  const added = blankBills();
  let left = loose;
  const take = (d, n) => { const k = Math.max(0, Math.min(n, Math.floor(left / d))); added[d] += k; left -= k * d; };
  if (left > 0 && people.length) {
    const req = getSmallBillRequirements(people, fixed, leftoverAmount);
    take(1, req.onesShort);
    take(5, Math.ceil(Math.max(0, req.oneFiveShort - added[1]) / 5));
    take(10, Math.ceil(Math.max(0, req.oneFiveTenShort - added[1] - added[5] * 5) / 10));
  }
  [20, 10, 5, 1].forEach(d => take(d, Math.floor(left / d)));
  const bills = { ...fixed };
  DENOMS.forEach(d => { bills[d] += added[d]; });
  return { bills, added };
}
