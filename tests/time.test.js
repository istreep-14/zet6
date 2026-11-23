import assert from 'node:assert';
import { parseTime, resolveIn, nextAfter, atOrAfter, fmtTimeAbs, setClock24, overlapHours, absToInRaw, absToOutRaw } from '../src/time.js';
import { parseWholeNumber } from '../src/util.js';

// parseWholeNumber (carried over from utils.test.js)
assert.strictEqual(parseWholeNumber('').value, 0);
assert.strictEqual(parseWholeNumber('').empty, true);
assert.strictEqual(parseWholeNumber('12').valid, true);
assert.strictEqual(parseWholeNumber('0012').value, 12);
assert.strictEqual(parseWholeNumber('1.5').valid, false);
assert.strictEqual(parseWholeNumber('5abc').valid, false);
assert.strictEqual(parseWholeNumber('-1').valid, false);

// parseTime (carried over from utils.test.js)
assert.strictEqual(parseTime('').empty, true);
assert.strictEqual(parseTime('5').value, 5);
assert.strictEqual(parseTime('5.5').value, 5.5);
assert.strictEqual(parseTime('.5').value, 0.5);
assert.strictEqual(parseTime('12').valid, true);
assert.strictEqual(parseTime('12.5').valid, true);
assert.strictEqual(parseTime('13').valid, false);
assert.strictEqual(parseTime('5abc').valid, false);
assert.strictEqual(parseTime('-1').valid, false);

// 15-minute grid: only .25 steps are valid times
assert.strictEqual(parseTime('5.25').value, 5.25);
assert.strictEqual(parseTime('10.75').value, 10.75);
assert.strictEqual(parseTime('.25').value, 0.25);
assert.strictEqual(parseTime('5.3').valid, false);
assert.strictEqual(parseTime('5.1').valid, false);
assert.strictEqual(parseTime('10.33').valid, false);

// IN times — fixed rule: 9–11:59 → AM, else PM (noon stays 12)
assert.strictEqual(resolveIn(9), 9);     // 9a
assert.strictEqual(resolveIn(11), 11);   // 11a
assert.strictEqual(resolveIn(11.5), 11.5);
assert.strictEqual(resolveIn(12), 12);   // 12p (noon)
assert.strictEqual(resolveIn(12.5), 12.5);
assert.strictEqual(resolveIn(1), 13);    // 1p
assert.strictEqual(resolveIn(5), 17);    // 5p
assert.strictEqual(resolveIn(8), 20);    // 8p

// OUT times — next occurrence of the reading after In
assert.strictEqual(nextAfter(2, 17), 26);   // 5p in, 2 out → 2a next day
assert.strictEqual(nextAfter(11, 17), 23);  // 5p in, 11 out → 11p
assert.strictEqual(nextAfter(6, 10), 18);   // 10a in, 6 out → 6p
assert.strictEqual(nextAfter(12, 17), 24);  // 5p in, 12 out → midnight

// Pool bounds — at-or-after the open (≥, so the open itself is allowed)
assert.strictEqual(atOrAfter(5, 17), 17);   // 5 == open
assert.strictEqual(atOrAfter(9, 17), 21);   // 9p
assert.strictEqual(atOrAfter(2, 17), 26);   // 2a

// Formatting on the true 24h+ axis (no anchor)
assert.strictEqual(fmtTimeAbs(17), '5:00p');
assert.strictEqual(fmtTimeAbs(22.5), '10:30p');
assert.strictEqual(fmtTimeAbs(26), '2:00a');
assert.strictEqual(fmtTimeAbs(12), '12:00p');
assert.strictEqual(fmtTimeAbs(24), '12:00a'); // midnight
assert.strictEqual(fmtTimeAbs(10), '10:00a');
assert.strictEqual(fmtTimeAbs(13), '1:00p');
assert.strictEqual(fmtTimeAbs(18), '6:00p');
setClock24(true);
assert.strictEqual(fmtTimeAbs(17), '17:00');
assert.strictEqual(fmtTimeAbs(25.5), '01:30');
assert.strictEqual(fmtTimeAbs(24), '00:00');
setClock24(false);

// Overlap math
assert.strictEqual(overlapHours(5, 14, 5, 14), 9);
assert.strictEqual(overlapHours(5, 10, 8, 14), 2);
assert.strictEqual(overlapHours(5, 8, 8, 14), 0);
assert.strictEqual(overlapHours(10, 14, 5, 9), 0);

// Slider round-trips: abs → raw string → resolve → same abs
{
  [9, 10.5, 11.75, 12, 12.75, 13, 17, 17.25, 20.75].forEach(abs => {
    assert.strictEqual(resolveIn(parseTime(absToInRaw(abs)).value), abs, 'in ' + abs);
  });
  assert.strictEqual(absToInRaw(17), '5');
  assert.strictEqual(absToInRaw(10.5), '10.5');
  const inAbs = 17; // 5p
  [17.25, 20, 23.75, 24, 24.5, 26, 29].forEach(abs => {
    const raw = absToOutRaw(abs);
    assert.ok(parseTime(raw).valid, 'valid ' + raw);
    assert.strictEqual(nextAfter(parseTime(raw).value, inAbs), abs, 'out ' + abs);
  });
  assert.strictEqual(absToOutRaw(26), '2');
  assert.strictEqual(absToOutRaw(24), '12');
  assert.strictEqual(absToOutRaw(24.5), '12.5');
}

console.log('time tests passed');

// ── Explicit meridiem + the morning boundary (any time of day works) ──
{
  const t = await import('../src/time.js');
  assert.deepStrictEqual(t.parseTime('7a'), { valid: true, empty: false, value: 7, mer: 'a' });
  assert.strictEqual(t.parseTime('9.5p').value, 9.5);
  assert.strictEqual(t.parseTime('9.5 PM').mer, 'p');
  assert.strictEqual(t.parseTime('0a').valid, false);
  assert.strictEqual(t.inAbsOf(t.parseTime('7a')), 7);          // before 9am, exact
  assert.strictEqual(t.inAbsOf(t.parseTime('9p')), 21);         // past 8:45p, exact
  assert.strictEqual(t.inAbsOf(t.parseTime('12a')), 0);
  assert.strictEqual(t.inAbsOf(t.parseTime('12p')), 12);
  assert.strictEqual(t.afterAbsOf(t.parseTime('2a'), 17), 26);  // 5p in, 2a out
  assert.strictEqual(t.afterAbsOf(t.parseTime('5p'), 11), 17);
  assert.strictEqual(t.afterAbsOf(t.parseTime('3a'), 7), 27);   // explicit a steps a whole day

  // Drags / keypad writes round-trip exactly (the old 9p → '9' → 9am bug).
  for (const abs of [6, 7.25, 9, 11.5, 12, 13, 20.75, 21, 22.5, 23.75]) {
    assert.strictEqual(t.inAbsOf(t.parseTime(t.absToInRaw(abs))), abs, 'in ' + abs);
  }
  assert.strictEqual(t.absToInRaw(17), '5');      // bare when the rule agrees
  assert.strictEqual(t.absToInRaw(21), '9p');
  assert.strictEqual(t.absToInRaw(7), '7a');
  assert.strictEqual(t.absToOutRaw(26, 17), '2');
  assert.strictEqual(t.absToOutRaw(17, 7), '5');   // 5p after a 7a open reads back bare
  assert.strictEqual(t.afterAbsOf(t.parseTime(t.absToOutRaw(17, 7)), 7), 17);

  // Morning boundary setting: 6 → bare 6–11:59 read as am.
  t.setAmFrom(6);
  assert.strictEqual(t.resolveIn(7), 7);
  assert.strictEqual(t.resolveIn(5), 17);
  assert.strictEqual(t.absToInRaw(7), '7');
  t.setAmFrom(9);
  assert.strictEqual(t.resolveIn(7), 19);

  // Keypad entry keeps a typed meridiem.
  assert.deepStrictEqual([t.parseClockEntry('730a').value, t.parseClockEntry('730a').mer], [7.5, 'a']);
  assert.strictEqual(t.parseClockEntry('9p').mer, 'p');
}
console.log('time meridiem tests passed');
