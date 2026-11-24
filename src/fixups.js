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

// The fewest of `env`'s bills summing to exactly `a`, or null.
function exact(env, a) {
  if (!(a > 0)) return {};
  const total = value(env);
  if (total < a) return null;
  const dp = new Array(a + 1).fill(null);
  dp[0] = {};
  DS.forEach(d => {
    for (let k = 0; k < (env[d] || 0); k++) {
      for (let s = a; s >= d; s--) {
        const prev = dp[s - d];
        if (!prev) continue;
        const cand = { ...prev, [d]: (prev[d] || 0) + 1 };
        if (!dp[s] || count(cand) < count(dp[s])) dp[s] = cand;
      }
    }
  });
  return dp[a];
}
const minus = (env, b) => { DS.forEach(d => { if (b[d]) env[d] = (env[d] || 0) - b[d]; }); };
const plus = (env, b) => { DS.forEach(d => { if (b[d]) env[d] = (env[d] || 0) + b[d]; }); };

// Register SHORT after the envelopes were made: the register has no change
// to give, so everything is settled from the envelopes themselves. Everyone
// whose pay dropped owes; anyone whose pay rose (a re-rounded closer bonus)
// is paid hand to hand by someone who owes; the rest goes into the register
// as exact bills from each envelope. People who can't make their own amount
// exactly put in together (the fewest of their bills that make their total
// exactly) and square up between themselves.
// → { moves: [{ from, to: id | 'register', bills }], register, notes: [text] }
export function shortFixes(before, now) {
  const ids = [...new Set([...Object.keys(before.pay || {}), ...Object.keys(now || {})])];
  const env = {};
  ids.forEach(id => { env[id] = { ...(before.byPerson[id] || {}) }; });
  const owe = {}, gain = {};
  ids.forEach(id => {
    const d = (now[id] || 0) - (before.pay[id] || 0);
    if (d < 0) owe[id] = -d; else if (d > 0) gain[id] = d;
  });
  const moves = [], notes = [];
  const move = (from, to, bills) => {
    minus(env[from], bills);
    if (to !== 'register') plus(env[to], bills);
    moves.push({ from, to, bills });
  };
  const owers = () => Object.keys(owe).filter(id => owe[id] > 0).sort((a, b) => owe[b] - owe[a]);
  // 1. Gainers, hand to hand from someone who owes.
  Object.keys(gain).forEach(g => {
    for (const o of owers()) {
      if (!(gain[g] > 0)) break;
      const amt = Math.min(gain[g], owe[o]);
      const b = exact(env[o], amt);
      if (!b) continue;
      move(o, g, b);
      owe[o] -= amt;
      gain[g] -= amt;
    }
    if (gain[g] > 0) notes.push({ id: g, text: 'still due $' + gain[g] + ' — needs change' });
  });
  // 2. Each one who owes puts their own exact bills in the register — when
  //    everyone can. If anyone can't, all of them put in together (step 3),
  //    so a $20 from one and a $5 handed over by another can cover both.
  const own = owers().map(o => [o, exact(env[o], owe[o])]);
  const stuck = own.some(([, b]) => !b) ? own.map(([o]) => o) : [];
  if (!stuck.length) own.forEach(([o, b]) => { move(o, 'register', b); owe[o] = 0; });
  // 3. Together: the fewest of their bills that make their total exactly,
  //    then square up between themselves hand to hand.
  if (stuck.length) {
    const T = stuck.reduce((t, o) => t + owe[o], 0);
    const items = [];
    stuck.forEach(o => DS.forEach(d => { for (let k = 0; k < (env[o][d] || 0); k++) items.push({ d, o }); }));
    const dp = new Array(T + 1).fill(null);
    dp[0] = [];
    items.forEach((it, i) => {
      for (let s = T; s >= it.d; s--) {
        const prev = dp[s - it.d];
        if (!prev || prev.includes(i)) continue;
        if (!dp[s] || prev.length + 1 < dp[s].length) dp[s] = [...prev, i];
      }
    });
    if (!dp[T]) {
      stuck.forEach(o => notes.push({ id: o, text: 'owes $' + owe[o] + ' — needs a bill broken' }));
    } else {
      const put = {};
      dp[T].forEach(i => { const { d, o } = items[i]; put[o] = put[o] || {}; put[o][d] = (put[o][d] || 0) + 1; });
      const bal = {};
      stuck.forEach(o => { const b = put[o] || {}; if (value(b)) move(o, 'register', b); bal[o] = value(b) - owe[o]; owe[o] = 0; });
      // bal > 0: put in more than they owed — the others pay them back.
      const cred = stuck.filter(o => bal[o] > 0), debt = stuck.filter(o => bal[o] < 0);
      debt.forEach(dbt => {
        for (const c of cred) {
          if (!(bal[dbt] < 0)) break;
          if (!(bal[c] > 0)) continue;
          const amt = Math.min(-bal[dbt], bal[c]);
          const b = exact(env[dbt], amt);
          if (b) { move(dbt, c, b); bal[dbt] += amt; bal[c] -= amt; continue; }
          // Not exact: hand over a bit more and get the difference back from
          // the one being paid (exact from their envelope).
          for (let over = amt + 1; over <= value(env[dbt]); over++) {
            const give = exact(env[dbt], over);
            if (!give) continue;
            const back = exact({ ...env[c], ...Object.fromEntries(DS.map(d => [d, (env[c][d] || 0) + (give[d] || 0)])) }, over - amt);
            if (!back) continue;
            move(dbt, c, give);
            move(c, dbt, back);
            bal[dbt] += amt;
            bal[c] -= amt;
            break;
          }
        }
        if (bal[dbt] < 0) notes.push({ id: dbt, text: 'owes $' + (-bal[dbt]) + ' to the others — needs change' });
      });
    }
  }
  const register = moves.filter(m => m.to === 'register').reduce((t, m) => t + value(m.bills), 0);
  return { moves, register, notes };
}
