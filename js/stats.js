/* Date helpers and streak math. Plain script, shared with the service worker.
 * Dates are local calendar days as "YYYY-MM-DD" strings. Exposes `self.RepStats`.
 */
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  function toKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d); // local midnight
  }

  function todayKey() {
    return toKey(new Date());
  }

  /** Add n calendar days (DST-safe because we move by calendar date, not ms). */
  function addDays(key, n) {
    const d = fromKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  function daysBetween(a, b) {
    // Round to absorb DST hour shifts.
    return Math.round((fromKey(b) - fromKey(a)) / 86400000);
  }

  /** Map of date -> total reps, counting only days with reps > 0. */
  function dailyTotals(entries) {
    const totals = new Map();
    entries.forEach((e) => {
      if (e.reps > 0) totals.set(e.date, (totals.get(e.date) || 0) + e.reps);
    });
    return totals;
  }

  /**
   * current: consecutive active days ending today — or ending yesterday if
   *          today isn't logged yet (the streak is still alive until midnight).
   * longest: longest run of consecutive active days ever.
   */
  function streaks(entries, today = todayKey()) {
    const active = new Set(dailyTotals(entries).keys());
    let current = 0;
    let cursor = active.has(today) ? today : addDays(today, -1);
    while (active.has(cursor)) { current++; cursor = addDays(cursor, -1); }

    let longest = 0;
    let run = 0;
    let prev = null;
    [...active].sort().forEach((d) => {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = d;
    });

    return { current, longest, loggedToday: active.has(today), activeDays: active.size };
  }

  global.RepStats = { toKey, fromKey, todayKey, addDays, daysBetween, dailyTotals, streaks };
})(typeof self !== 'undefined' ? self : window);
