# TipPool — Distribution Engine Reference

> **Purpose of this file:** Drop this into a Claude conversation *instead of* the full project
> when you're working on the bill-distribution logic, solution checking, or the math layer.
> It contains: plain-English explanations, the complete source of every relevant file,
> and a guide to what each function does and how they connect.

---

## Plain-English Overview

### What the engine actually does

At the end of a shift you have a physical pile of cash — some hundreds, fifties, twenties, tens, fives, ones. You also know how much each person is owed (whole dollars). The engine's job is to figure out **which specific bills to hand to each person** so that:

1. Everyone gets exactly their correct dollar amount.
2. The mix of bills each person gets is as fair as possible — nobody gets a wad of ones while someone else gets all hundreds.
3. It works with whatever bills are actually in the drawer. No "go make change" unless absolutely necessary.

This is harder than it sounds. With 5 people and 6 denominations, there are thousands of ways to split the bills. The engine tries the fast path first, falls back to a search if needed, and then tidies up the result.

### The pipeline — five steps

```
Step 1: PREFLIGHT  — "Can this even work?"
         Check that total cash ≥ total payouts.
         Check there are enough small bills ($1s, $5s, $10s) to cover
         the odd-dollar parts of each payout.
         If not → stop with a clear error message.

Step 2: PREFERRED PATH  — "Try the smart fast route"
         Hand out $100s proportionally by payout size.
         Solve the $50s with a small search (there are rarely more than 4-5).
         Fill $20s, $10s, $5s in a balanced sweep that minimizes variance.
         Fill $1s last (they always land exactly).
         → If this produces an exact solution: done.

Step 3: DFS FALLBACK  — "Try up to 100 random-ish paths"
         If the preferred path can't find an exact answer (rare edge case),
         explore combinations using depth-first search, stop at 100 paths.
         → Grade the paths and pick the least-uneven one.

Step 4: REBALANCING  — (handled inside preferred path's scoring)
         The $50 and $20/$10/$5 solvers already score residuals for evenness,
         so the result comes out balanced without a separate pass.

Step 5: TRADE PREVIEW  — "Could breaking a big bill help?"
         Separate helper: if the drawer is short on small bills,
         show the user which bill to break and what that gives them.
```

### Solution checking — what "preflight" actually checks

Three things must be true before any distribution attempt:

| Check | What it means in plain English |
|-------|-------------------------------|
| Cash covers payouts | Total dollar value in drawer ≥ sum of all payouts |
| Enough $1s | Count of $1s in drawer ≥ sum of (each payout mod 5) |
| Enough $1s+$5s | Total value of $1s+$5s ≥ sum of (each payout mod 10) |
| Enough $1s+$5s+$10s | Total value of $1s+$5s+$10s ≥ sum of (each payout mod 20), minus any $50s that can cover a $10 gap |

If any check fails the engine stops immediately with a message like "Need 3 more $1s." or "Need $15 more in $1s/$5s." — it never attempts a distribution it knows will fail.

### What "balanced" means

The engine scores every proposed allocation and picks the one with the lowest "penalty." The penalty is:

- **High** if big-bill counts are uneven between people (one person gets 2 × $100, another gets 0)
- **Medium** if small-bill counts are uneven (one person gets 8 × $1, another gets 1)
- **Low** if only medium bills are uneven

The goal is that everyone's envelope feels roughly similar to hold — not that the math is different, just that the physical bills are fairly distributed.

---

## File Map (engine zone only)

```
src/
  util.js        ← DENOMS, blankBills(), poolValue(), parseWholeNumber()
  engine.js      ← The whole distribution pipeline (666 lines)
  shares.js      ← computeShares() — calculates HOW MUCH each person gets
  ideal.js       ← idealBills() — for net-total mode, figure out a good bill mix
  viewmodel.js   ← buildViewModel() — calls engine.js and packages results

tests/
  engine.test.js ← Tests for distribute() scenarios
  shares.test.js ← Tests for computeShares()
```

**Data flow:**
```
computeShares(pools, staff) → { perPerson: [{id, final}], leftover }
       ↓
distribute(people, bills, leftover) → { byPerson, remainderBills, poolAfter, error }
       ↓
getSmallBillRequirements(people, bills, leftover) → requirement details for UI
```

---

## Source: `src/util.js`

```js
// Shared primitives — no DOM access.

export const DENOMS = [100, 50, 20, 10, 5, 1];

export function parseWholeNumber(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { valid: true, empty: true, value: 0 };
  if (!/^\d+$/.test(text)) return { valid: false, empty: false, value: 0 };
  const value = Number(text);
  return {
    valid: Number.isSafeInteger(value),
    empty: false,
    value: Number.isSafeInteger(value) ? value : 0,
  };
}

export function blankBills() {
  return { 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 };
}

// Total dollar value of a bill-count object.
export function poolValue(pool) {
  return DENOMS.reduce((s, d) => s + (pool?.[d] || 0) * d, 0);
}

export function escapeHTML(v) {
  return String(v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  )[c]);
}

export function fmtHrs(h) {
  return parseFloat(h.toFixed(2)).toString();
}
```

---

## Source: `src/engine.js`

```js
// Bill distribution engine — pure: value in, value out.
// Pipeline: preflight → preferred path → DFS fallback → grading.

import { DENOMS, parseWholeNumber, poolValue, blankBills } from './util.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Coerce any bill-count object to a clean {100,50,20,10,5,1} map with ints.
function normalizePool(pool) {
  const out = blankBills();
  DENOMS.forEach(d => {
    const parsed = parseWholeNumber(pool?.[d] ?? '');
    out[d] = parsed.valid ? parsed.value : 0;
  });
  return out;
}

// Build the internal "slots" array — one slot per person, plus an optional
// "remainder" slot for the leftover dollar that stays in the drawer.
function buildDistributionSlots(people, leftoverAmount) {
  const slots = people.map(p => ({
    id: p.id,
    orig: p.final,     // original payout amount (never changes)
    target: p.final,   // remaining amount to fill (decremented as bills assigned)
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

// ─── Small-bill requirement math ──────────────────────────────────────────────
//
// This is the core of "preflight". For exact change to be possible:
//   • Each payout mod 5 must be covered by $1s.
//   • Each payout mod 10 must be covered by $1s + $5s combined.
//   • Each payout mod 20 must be covered by $1s + $5s + $10s combined
//     (with partial relief if $50s cover some $10 gaps).
//
// Returns: minimum bills needed, available bills, and the shortfall for each tier.

function getSmallBillRequirementsForSlots(slots, poolIn) {
  const pool = normalizePool(poolIn);
  const targets = slots.map(s => s.orig);

  // How many "odd ten" slots are there — slots where (payout / 10) is odd?
  // Each such slot needs a $10 in its payout. A $50 can sometimes substitute.
  const oddTenSlots = slots.filter(s => Math.floor(s.orig / 10) % 2 !== 0);
  const fiftyEligibleOddTenSlots = oddTenSlots.filter(s => s.orig >= 50).length;
  const fiftyCoverage = Math.min(pool[50] || 0, fiftyEligibleOddTenSlots);

  const minOnes           = targets.reduce((sum, t) => sum + (t % 5),  0);
  const minOneFiveValue   = targets.reduce((sum, t) => sum + (t % 10), 0);
  const minOneFiveTenRaw  = targets.reduce((sum, t) => sum + (t % 20), 0);
  const minOneFiveTenValue = Math.max(minOneFiveValue, minOneFiveTenRaw - fiftyCoverage * 10);

  const availableOnes          = pool[1] || 0;
  const availableOneFiveValue  = availableOnes + (pool[5] || 0) * 5;
  const availableOneFiveTenValue = availableOneFiveValue + (pool[10] || 0) * 10;

  return {
    minOnes,
    availableOnes,
    onesShort:        Math.max(0, minOnes - availableOnes),
    minOneFiveValue,
    availableOneFiveValue,
    oneFiveShort:     Math.max(0, minOneFiveValue - availableOneFiveValue),
    minOneFiveTenValue,
    availableOneFiveTenValue,
    oneFiveTenShort:  Math.max(0, minOneFiveTenValue - availableOneFiveTenValue),
    oddTenCount:                oddTenSlots.length,
    fiftyEligibleOddTenCount:   fiftyEligibleOddTenSlots,
    fiftyCoverage,
    fiftyCoverageValue:         fiftyCoverage * 10,
  };
}

// ─── Public: requirement check ────────────────────────────────────────────────

// Returns requirement details for UI display (warning rows, trade previews).
export function getSmallBillRequirements(people, poolIn, leftoverAmount) {
  return getSmallBillRequirementsForSlots(
    buildDistributionSlots(people, leftoverAmount || 0),
    poolIn
  );
}

// ─── Public: trade preview ────────────────────────────────────────────────────
//
// "If we break some big bills into smaller ones, can we solve the distribution?"
// Returns: { byPerson, pool, poolAfter, remainderBills, deltas, trades,
//            requirementsBefore, requirementsAfter }  — or null if still unsolvable.

export function previewSmallBillTrades(people, poolIn, leftoverAmount) {
  const sourcePool  = normalizePool(poolIn);
  const targetTotal = people.reduce((sum, p) => sum + (p.final || 0), 0) + (leftoverAmount || 0);
  if (poolValue(sourcePool) !== targetTotal) return null;

  const adjustedPool = normalizePool(sourcePool);
  const deltas  = blankBills();
  const trades  = [];
  const slots   = buildDistributionSlots(people, leftoverAmount || 0);

  function describeBundle(bundle) {
    return DENOMS
      .filter(d => (bundle[d] || 0) > 0)
      .map(d => (bundle[d] || 0) + ' x $' + d)
      .join(' + ');
  }

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
    trades.push('Break 1 x $' + from + ' into ' + describeBundle(bundle) + '.');
    return true;
  }

  function breakForOnes(from) {
    const bundle = blankBills();
    if (from === 5)   bundle[1] = 5;
    if (from === 10)  { bundle[5] = 1; bundle[1] = 5; }
    if (from === 20)  { bundle[10] = 1; bundle[5] = 1; bundle[1] = 5; }
    if (from === 50)  { bundle[20] = 2; bundle[5] = 1; bundle[1] = 5; }
    if (from === 100) { bundle[50] = 1; bundle[20] = 2; bundle[5] = 1; bundle[1] = 5; }
    return applyBreak(from, bundle);
  }

  function breakForFives(from) {
    const bundle = blankBills();
    if (from === 10)  bundle[5] = 2;
    if (from === 20)  { bundle[10] = 1; bundle[5] = 2; }
    if (from === 50)  { bundle[20] = 2; bundle[5] = 2; }
    if (from === 100) { bundle[50] = 1; bundle[20] = 2; bundle[5] = 2; }
    return applyBreak(from, bundle);
  }

  function breakForTens(from) {
    const bundle = blankBills();
    if (from === 20)  bundle[10] = 2;
    if (from === 50)  bundle[10] = 5;
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
      byPerson:            result.byPerson,
      pool:                { ...adjustedPool },
      poolAfter:           result.poolAfter,
      remainderBills:      result.remainderBills || blankBills(),
      deltas:              { ...deltas },
      trades:              [...trades],
      requirementsBefore:  getSmallBillRequirementsForSlots(slots, sourcePool),
      requirementsAfter:   getSmallBillRequirementsForSlots(slots, adjustedPool),
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

  // Fallback: aggressive breaking
  const fallbackBreaks = [
    { from: 5,   bundle: { 1: 5 } },
    { from: 10,  bundle: { 5: 2 } },
    { from: 20,  bundle: { 10: 2 } },
    { from: 50,  bundle: { 10: 5 } },
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

// ─── Internal pipeline ────────────────────────────────────────────────────────

function runPipeline(people, poolIn, leftoverAmount) {
  const pool  = normalizePool(poolIn);
  const slots = buildDistributionSlots(people, leftoverAmount || 0);

  const preflight = runPreflight(slots, pool);
  if (!preflight.ok) {
    return { success: false, msg: preflight.msg, poolAfter: pool, remainderBills: blankBills(), byPerson: {} };
  }

  const preferred      = buildPreferredPath(slots, pool);
  const poolAfterSieve = preferred ? null : runCascadingSieve(slots, pool);
  const paths          = preferred ? [preferred] : runDFS(slots, poolAfterSieve);

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
    poolAfter:      best.leftoverPool,
    remainderBills: remainderSlot ? { ...remainderSlot.bills } : blankBills(),
    byPerson,
  };
}

// ─── Step 1: Preflight ────────────────────────────────────────────────────────

function runPreflight(slots, pool) {
  const targetTotal = slots.reduce((sum, s) => sum + s.target, 0);
  const cashTotal   = poolValue(pool);

  if (cashTotal < targetTotal) {
    return { ok: false, msg: 'Cash on hand is short $' + (targetTotal - cashTotal) + '.' };
  }

  const needs = getSmallBillRequirementsForSlots(slots, pool);
  if (needs.onesShort > 0)        return { ok: false, msg: 'Need ' + needs.onesShort + ' more $1s.' };
  if (needs.oneFiveShort > 0)     return { ok: false, msg: 'Need $' + needs.oneFiveShort + ' more in $1s/$5s.' };
  if (needs.oneFiveTenShort > 0)  return { ok: false, msg: 'Need $' + needs.oneFiveTenShort + ' more in $1s/$5s/$10s after $50s.' };

  return { ok: true };
}

// ─── Step 2a: Cascading sieve (pre-DFS) ──────────────────────────────────────
//
// When the preferred path fails, this strips small bills first so the DFS
// only has to search across $100/$50/$20/$10.

function runCascadingSieve(slots, poolIn) {
  const p = normalizePool(poolIn);

  // Assign $1s for the ones-digit of each payout
  slots.forEach(s => {
    const ones = s.target % 5;
    if (ones > 0) { s.bills[1] += ones; p[1] -= ones; s.target -= ones; }
  });

  // Assign $5s (or 5x$1s) for the fives-digit
  let bundledOnes = Math.floor((p[1] || 0) / 5);
  slots.forEach(s => {
    if (s.target % 10 !== 5) return;
    if (bundledOnes > 0) {
      s.bills[1] += 5; p[1] -= 5; bundledOnes--; s.target -= 5;
    } else if ((p[5] || 0) > 0) {
      s.bills[5] += 1; p[5] -= 1; s.target -= 5;
    }
  });

  // Assign $10s for odd-ten slots
  let bundledFives = Math.floor(((p[5] || 0) + bundledOnes) / 2);
  slots.forEach(s => {
    const isOddTens = Math.floor(s.target / 10) % 2 !== 0;
    if (!isOddTens || bundledFives <= 0) return;
    if ((p[5] || 0) >= 2) {
      s.bills[5] += 2; p[5] -= 2; s.target -= 10; bundledFives--;
    } else if ((p[5] || 0) === 1 && (p[1] || 0) >= 5) {
      s.bills[5] += 1; p[5] -= 1; s.bills[1] += 5; p[1] -= 5; s.target -= 10; bundledFives--;
    } else if ((p[1] || 0) >= 10) {
      s.bills[1] += 10; p[1] -= 10; s.target -= 10; bundledFives--;
    }
  });

  function assignSmallBundle(s, value) {
    const maxFives = Math.min(Math.floor(value / 5), p[5] || 0);
    for (let fives = maxFives; fives >= 0; fives--) {
      const ones = value - fives * 5;
      if ((p[1] || 0) < ones) continue;
      s.bills[5] += fives; p[5] -= fives;
      s.bills[1] += ones;  p[1] -= ones;
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

// ─── Step 2b: Preferred path ──────────────────────────────────────────────────
//
// Smart fast route. Tries to solve without DFS by:
//   1. Apportioning $100s by payout share
//   2. Searching $50 combinations (small search, usually ≤5 bills)
//   3. Filling $20/$10/$5 in a balanced sweep
//   4. Filling $1s exactly

function cloneDistributionSlots(slots) {
  return slots.map(s => ({ id: s.id, orig: s.orig, target: s.target, bills: { ...s.bills }, isRemainder: !!s.isRemainder }));
}

// Apportion `available` bills of denomination `denom` across slots proportionally
// to payout size, respecting each slot's capacity (floor(target/denom)).
// Uses fractional remainder assignment to reach exact count.
function apportionDenomCounts(slots, denom, available) {
  const caps       = slots.map(s => Math.floor(s.target / denom));
  const totalCap   = caps.reduce((sum, cap) => sum + cap, 0);
  const count      = Math.min(Math.max(0, available || 0), totalCap);
  const counts     = slots.map(() => 0);
  if (count <= 0) return counts;

  const totalOrig = slots.reduce((sum, s) => sum + (s.orig || 0), 0) || 1;
  const shares    = slots.map((s, i) => ({ i, raw: (s.orig || 0) / totalOrig * count }));

  let assigned = 0;
  for (const share of shares) {
    counts[share.i] = Math.min(caps[share.i], Math.floor(share.raw));
    assigned += counts[share.i];
  }

  // Assign remaining bills by largest fractional remainder, then largest payout
  while (assigned < count) {
    const before = assigned;
    for (const next of shares
      .filter(share => counts[share.i] < caps[share.i])
      .sort((a, b) => {
        const aFrac = a.raw - Math.floor(a.raw);
        const bFrac = b.raw - Math.floor(b.raw);
        return bFrac - aFrac || (slots[b.i].orig || 0) - (slots[a.i].orig || 0) || (slots[b.i].target || 0) - (slots[a.i].target || 0) || a.i - b.i;
      })) {
      if (assigned >= count) break;
      counts[next.i]++;
      assigned++;
    }
    if (assigned === before) break;
  }

  return counts;
}

function buildPreferredPath(slotsIn, poolIn) {
  const slots = cloneDistributionSlots(slotsIn);
  const pool  = normalizePool(poolIn);

  function give(s, d, n) {
    const use = Math.min(n, pool[d] || 0, Math.floor(s.target / d));
    if (use <= 0) return 0;
    s.bills[d] += use; pool[d] -= use; s.target -= use * d;
    return use;
  }

  const hundredCounts = apportionDenomCounts(slots, 100, pool[100] || 0);
  hundredCounts.forEach((count, i) => give(slots[i], 100, count));

  if (!applyBestFiftyPlan(slots, pool)) return null;
  if (!assignLowerDenomsBalanced(slots, pool)) return null;

  return { slots, leftoverPool: pool };
}

// Find the best way to distribute all $50s across slots.
// Searches all valid combinations and scores by how proportional the
// high-value bills ($100+$50) are to each person's payout.
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
    if (residuals.reduce((sum, rem) => sum + Math.floor(rem / 5),  0) < (pool[5]  || 0)) return false;
    return true;
  }

  function scorePlan() {
    const staffSlots = slots.filter(s => !s.isRemainder);
    const totalOrig  = staffSlots.reduce((sum, s) => sum + (s.orig || 0), 0) || 1;
    const totalHigh50 = staffSlots.reduce((sum, s) => {
      const i = slots.indexOf(s);
      return sum + (s.bills[100] || 0) * 100 + counts[i] * 50;
    }, 0);
    const high50 = staffSlots.map(s => {
      const i = slots.indexOf(s);
      return (s.bills[100] || 0) * 100 + counts[i] * 50;
    });
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
    for (let use = Math.max(0, remaining - restCap); use <= Math.min(caps[i], remaining); use++) {
      counts[i] = use;
      search(i + 1, remaining - use);
    }
    counts[i] = 0;
  }

  search(0, count);
  if (!best) return false;

  best.counts.forEach((n, i) => { slots[i].bills[50] += n; slots[i].target -= n * 50; });
  pool[50] = 0;
  return true;
}

// Fill $20/$10/$5 in sequence, then $1s.
// Each denomination uses a balanced search that minimizes the spread
// of remaining amounts across slots.
function assignLowerDenomsBalanced(slots, pool) {
  for (const d of [20, 10, 5]) {
    if (!assignDenomBalanced(slots, pool, d)) return false;
  }

  const onesNeeded = slots.reduce((sum, s) => sum + s.target, 0);
  if (onesNeeded !== (pool[1] || 0)) return false;
  for (const s of slots) {
    if (s.target < 0) return false;
    s.bills[1] += s.target; pool[1] -= s.target; s.target = 0;
  }
  return slots.every(s => s.target === 0);
}

function assignDenomBalanced(slots, pool, denom) {
  const count = pool[denom] || 0;
  if (count <= 0) return true;

  const caps     = slots.map(s => Math.floor(s.target / denom));
  if (caps.reduce((sum, cap) => sum + cap, 0) < count) return false;

  const counts = slots.map(() => 0);
  let best = null;

  function lowerCapacityOk(residuals) {
    if (denom === 20 && residuals.reduce((sum, rem) => sum + Math.floor(rem / 10), 0) < (pool[10] || 0)) return false;
    if ((denom === 20 || denom === 10) && residuals.reduce((sum, rem) => sum + Math.floor(rem / 5), 0) < (pool[5] || 0)) return false;
    return true;
  }

  function scoreResiduals(residuals) {
    const scored    = residuals.filter((_, i) => !slots[i].isRemainder);
    const avg       = scored.reduce((sum, rem) => sum + rem, 0) / (scored.length || 1);
    const range     = Math.max(...scored) - Math.min(...scored);
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
    for (let use = Math.max(0, remaining - restCap); use <= Math.min(caps[i], remaining); use++) {
      counts[i] = use;
      search(i + 1, remaining - use);
    }
    counts[i] = 0;
  }

  search(0, count);
  if (!best) return false;

  best.counts.forEach((n, i) => { slots[i].bills[denom] += n; slots[i].target -= n * denom; });
  pool[denom] = 0;
  return true;
}

// ─── Step 3: DFS fallback ─────────────────────────────────────────────────────
//
// When the preferred path can't find an exact solution, search up to 100 paths
// through the big-bill space ($100/$50/$20/$10). Small bills are already
// stripped by the cascading sieve before this runs.

function runDFS(slots, poolIn) {
  const validPaths = [];
  const bigDenoms  = [100, 50, 20, 10];
  const pool       = normalizePool(poolIn);
  const sortedIdxs = slots.map((_, i) => i).sort((a, b) => slots[b].target - slots[a].target);

  function search(pIdx) {
    if (validPaths.length >= 100) return;
    if (pIdx === slots.length) {
      validPaths.push({ slots: slots.map(s => ({ ...s, bills: { ...s.bills } })), leftoverPool: { ...pool } });
      return;
    }

    const person = slots[sortedIdxs[pIdx]];
    if (person.target === 0) { search(pIdx + 1); return; }

    function fillPerson(targetVal, dIdx) {
      if (targetVal === 0) { search(pIdx + 1); return; }
      if (dIdx >= bigDenoms.length) return;

      const d      = bigDenoms[dIdx];
      const maxUse = Math.min(pool[d] || 0, Math.floor(targetVal / d));
      for (let use = maxUse; use >= 0; use--) {
        person.bills[d] += use; pool[d] -= use;
        fillPerson(targetVal - use * d, dIdx + 1);
        person.bills[d] -= use; pool[d] += use;
      }
    }

    fillPerson(person.target, 0);
  }

  search(0);
  return validPaths;
}

// ─── Step 4: Grade paths ──────────────────────────────────────────────────────
//
// Pick the least-uneven path from the DFS results.
// Penalty weights: total bill count spread (×10) > small bills (×8) > medium (×5) > big bills (×2).

function gradePaths(paths) {
  let bestPath = null, lowestPenalty = Infinity;

  for (const path of paths) {
    let penalty = 0;
    const totalCounts = [], smallBracketCounts = [], mediumBracketCounts = [];

    for (const s of path.slots) {
      const idealBig  = Math.floor(s.orig / 100);
      const actualBig = (s.bills[100] || 0) + ((s.bills[50] || 0) > 1 ? 1 : 0);
      penalty += Math.abs(idealBig - actualBig) * 2;

      const c1 = s.bills[1]||0, c5=s.bills[5]||0, c10=s.bills[10]||0;
      const c20=s.bills[20]||0, c50=s.bills[50]||0, c100=s.bills[100]||0;
      totalCounts.push(c1+c5+c10+c20+c50+c100);
      smallBracketCounts.push(c1+c5+c10);
      mediumBracketCounts.push(c1+c5+c10+c20);
    }

    penalty += (Math.max(...totalCounts)  - Math.min(...totalCounts))  * 10;
    penalty += (Math.max(...smallBracketCounts) - Math.min(...smallBracketCounts)) * 8;
    penalty += (Math.max(...mediumBracketCounts) - Math.min(...mediumBracketCounts)) * 5;

    if (penalty < lowestPenalty) { lowestPenalty = penalty; bestPath = path; }
  }

  return bestPath;
}

// ─── Public entry points ──────────────────────────────────────────────────────

/**
 * distribute(people, bills, leftover)
 *
 * Main public function. Never mutates inputs.
 *
 * @param {Array<{id: string, final: number}>} people  - Staff with dollar payouts
 * @param {Object} bills  - {100, 50, 20, 10, 5, 1} bill counts in the drawer
 * @param {number} leftover  - Remainder dollar(s) that stay in the drawer
 * @returns {{ byPerson: Object, remainderBills: Object, poolAfter: Object, error: string }}
 */
export function distribute(people, bills, leftover) {
  const result = runPipeline(people, bills, leftover || 0);
  return {
    byPerson:       result.byPerson,
    poolAfter:      result.poolAfter  || normalizePool(bills),
    remainderBills: result.remainderBills || blankBills(),
    error:          result.success ? '' : result.msg,
  };
}

/**
 * computeTradeUp(pool, req)
 *
 * Trade-up plan: convert excess $1s/$5s/$10s into $20s.
 * Used in the "Trade Up" button in the dist tab.
 *
 * @returns {{ newPool, delta, new20s }} or null if no $20s can be gained.
 */
export function computeTradeUp(pool, req) {
  const minFives = Math.max(0, (req.minOneFiveValue - req.minOnes) / 5);
  const minTens  = Math.max(0, (req.minOneFiveTenValue - req.minOneFiveValue) / 10);

  const excessOnes  = Math.max(0, (pool[1]  || 0) - req.minOnes);
  const excessFives = Math.max(0, (pool[5]  || 0) - minFives);
  const excessTens  = Math.max(0, (pool[10] || 0) - minTens);
  const totalExcess = excessOnes + excessFives * 5 + excessTens * 10;

  const new20s = Math.floor(totalExcess / 20);
  if (new20s <= 0) return null;

  let rem = totalExcess - new20s * 20;
  const keepExtra10 = Math.min(excessTens,  Math.floor(rem / 10)); rem -= keepExtra10 * 10;
  const keepExtra5  = Math.min(excessFives, Math.floor(rem / 5));  rem -= keepExtra5  * 5;

  const newPool = {
    100: pool[100] || 0,
    50:  pool[50]  || 0,
    20:  (pool[20] || 0) + new20s,
    10:  (pool[10] || 0) - excessTens  + keepExtra10,
    5:   (pool[5]  || 0) - excessFives + keepExtra5,
    1:   (pool[1]  || 0) - excessOnes  + rem,
  };

  const delta = {};
  DENOMS.forEach(d => { delta[d] = (newPool[d] || 0) - (pool[d] || 0); });

  return { newPool, delta, new20s };
}
```

---

## Source: `src/shares.js`

```js
// computeShares — calculates HOW MUCH each person gets (not which bills).
// Pure function. Same function used everywhere: live calc, sidebar, ideal targets.

import { poolParticipants } from './resolve.js';

export function computeShares(pools, staff, overrides = {}) {
  const perPerson = staff.map(p => ({
    id: p.id, name: p.name, role: p.role,
    inAbs: p.inAbs, outAbs: p.outAbs, shiftHours: p.hours,
    closer: p.closer, autoCloser: p.autoCloser,
    usedDefaults: p.usedDefaults, usedCloseTime: p.usedCloseTime,
    perPool: {}, hours: 0, exact: 0, base: 0, bonus: 0, final: 0,
  }));
  const byId = new Map(perPerson.map(p => [p.id, p]));

  const perPool = pools.map(pool => {
    const parts  = poolParticipants(pool, staff);
    const hours  = parts.reduce((s, x) => s + x.hours, 0);
    const rate   = hours > 0 ? pool.total / hours : 0;

    const participants = parts.map(({ person, hours: h }) => {
      const raw = h * rate;
      const pp  = byId.get(person.id);
      pp.perPool[pool.id] = { hours: h, raw };
      pp.hours += h;
      pp.exact  += raw;
      return { id: person.id, name: person.name, role: person.role, hours: h, raw };
    });

    return {
      id: pool.id, label: pool.label,
      startAbs: pool.startAbs, endAbs: pool.endAbs,
      total: pool.total, hours, rate, participants,
      warning: pool.total > 0 && !participants.length
        ? pool.label + ' has cash but no participants — its total falls into the remainder.'
        : '',
    };
  });

  // Single-floor fairness: floor ONCE across all pools, not per-pool.
  perPerson.forEach(p => { p.base = Math.floor(p.exact); });

  const totalCash  = pools.reduce((s, p) => s + p.total, 0);
  const totalHours = perPool.reduce((s, p) => s + p.hours, 0);
  const remainder  = totalCash - perPerson.reduce((s, p) => s + p.base, 0);

  const bonuses = overrides.bonuses || {};
  const hasOverrides = Object.keys(bonuses).length > 0;
  let leftover;

  if (hasOverrides) {
    let bonusSum = 0;
    perPerson.forEach(p => { p.bonus = bonuses[p.id] || 0; bonusSum += p.bonus; });
    leftover = Math.max(0, remainder - bonusSum);
  } else {
    // Auto: split remainder among closers, any residual stays in drawer.
    const closers   = perPerson.filter(p => p.closer);
    const perCloser = closers.length ? Math.floor(remainder / closers.length) : 0;
    closers.forEach(p => { p.bonus = perCloser; });
    leftover = remainder - perCloser * closers.length;
  }

  perPerson.forEach(p => { p.final = p.base + p.bonus; });

  return {
    perPerson, perPool, totalCash, totalHours,
    rate: totalHours > 0 ? totalCash / totalHours : 0,
    remainder, leftover,
    bonusMode: hasOverrides ? 'manual' : 'auto',
  };
}

// Distribution targets: all positive payouts + the chump leftover (if any).
export function shareTargets(shares) {
  const targets = shares.perPerson.map(p => p.final).filter(v => v > 0);
  if (shares.leftover > 0) targets.push(shares.leftover);
  return targets;
}
```

---

## Key data shapes

```js
// Bill count object (used everywhere)
bills = { 100: 2, 50: 1, 20: 3, 10: 0, 5: 4, 1: 7 }

// Input to distribute()
people = [
  { id: 's1', final: 87 },   // owes $87
  { id: 's2', final: 63 },   // owes $63
]

// Output from distribute()
result = {
  byPerson: {
    's1': { 100: 0, 50: 1, 20: 1, 10: 1, 5: 1, 1: 2 },  // $87 in bills
    's2': { 100: 0, 50: 1, 20: 1, 10: 0, 5: 0, 1: 3 },  // $63 in bills
  },
  poolAfter:      { 100: 2, 50: 0, 20: 1, 10: 0, 5: 3, 1: 2 },  // remaining
  remainderBills: { 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 1 },  // leftover $
  error: '',  // empty string = success
}

// Input to computeShares()
pools = [
  { id: 'p1', label: 'Bar', total: 150, startAbs: 17, endAbs: 26,
    roles: { bartender: true, server: false }, includeSupport: false }
]
staff = [
  { id: 's1', inAbs: 17, outAbs: 26, hours: 9, role: 'bartender', closer: true, ... }
]
```

---

## What to change and where

| Want to... | File | Function |
|------------|------|----------|
| Change the preflight error messages | `engine.js` | `runPreflight` |
| Change how $1/$5/$10 minimums are calculated | `engine.js` | `getSmallBillRequirementsForSlots` |
| Change how $100s are distributed | `engine.js` | `apportionDenomCounts` |
| Change how $50s are distributed | `engine.js` | `applyBestFiftyPlan` |
| Change what "balanced" means for $20/$10/$5 | `engine.js` | `scoreResiduals` inside `assignDenomBalanced` |
| Change the grading logic for DFS paths | `engine.js` | `gradePaths` |
| Change how the closer bonus works | `shares.js` | `computeShares` (bottom section) |
| Change how hours are split per pool | `shares.js` | `computeShares` (perPool loop) |
| Add a new bill denomination | `util.js` | `DENOMS` array (and update all callers) |