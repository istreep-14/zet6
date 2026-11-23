// Envelopes already made, then the register over / short changes the split:
// fix each envelope through the register instead of starting over. Per
// person, the fewest bills to take out of their envelope (with change back
// from the register when their own bills can't make it exactly) or to add
// from the register. Pure; no DOM.

const DS = [100, 50, 20, 10, 5, 1];
const value = b => DS.reduce((t, d) => t + d * (b?.[d] || 0), 0);
const count = b => DS.reduce((t, d) => t + (b?.[d] || 0), 0);

// x dollars in the fewest bills (the register can make any change).
export function fewestBills(x) {
  const out = {};
  let left = Math.max(0, Math.round(x));
  DS.forEach(d => { const k = Math.floor(left / d); if (k) out[d] = k; left -= k * d; });
  return out;
}

// Take `a` dollars out of envelope `env`: the exact amount in the fewest of
// its own bills, else the smallest amount over it (fewest bills) with the
// difference back from the register. → { out, back }.
export function takeOut(env, a) {
  if (!(a > 0)) return { out: {}, back: {} };
  const total = value(env);
  if (total < a) return { out: { ...env }, back: {} };      // can't: everything (caller flags it)
  // 0/1 knapsack over each bill copy: dp[s] = fewest bills summing to s.
  const dp = new Array(total + 1).fill(null);
  dp[0] = {};
  DS.forEach(d => {
    for (let k = 0; k < (env[d] || 0); k++) {
      for (let s = total; s >= d; s--) {
        const prev = dp[s - d];
        if (!prev) continue;
        const cand = { ...prev, [d]: (prev[d] || 0) + 1 };
        if (!dp[s] || count(cand) < count(dp[s])) dp[s] = cand;
      }
    }
  });
  if (dp[a]) return { out: dp[a], back: {} };
  for (let s = a + 1; s <= total; s++) {
    if (dp[s]) return { out: dp[s], back: fewestBills(s - a) };
  }
  return { out: { ...env }, back: fewestBills(total - a) };
}

// before: { byPerson: { id: bills }, pay: { id: $ } } — the envelopes as made;
// now: { id: $ } — what each should hold now. → { rows, register } where
// rows = [{ id, was, now, d, out, back, add }] for everyone whose pay moved
// and register = dollars into the register (negative = out of it).
export function envelopeFixes(before, now) {
  const ids = [...new Set([...Object.keys(before.pay || {}), ...Object.keys(now || {})])];
  const rows = [];
  let register = 0;
  ids.forEach(id => {
    const was = before.pay[id] || 0, is = now[id] || 0, d = is - was;
    if (!d) return;
    if (d < 0) {
      const { out, back } = takeOut(before.byPerson[id] || {}, -d);
      register += value(out) - value(back);
      rows.push({ id, was, now: is, d, out, back, add: {} });
    } else {
      const add = fewestBills(d);
      register -= d;
      rows.push({ id, was, now: is, d, out: {}, back: {}, add });
    }
  });
  return { rows, register };
}
