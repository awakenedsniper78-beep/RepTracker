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

  /** Monday of the week containing `key` (weeks run Monday–Sunday). */
  function weekStart(key) {
    const dow = (fromKey(key).getDay() + 6) % 7; // Mon=0 … Sun=6
    return addDays(key, -dow);
  }

  /**
   * Streak freezes bridge a gap (the streak survives the frozen day) but a
   * frozen day doesn't add to the count — only days with reps do.
   *
   * current: consecutive covered days ending today — or ending yesterday if
   *          today isn't covered yet (the streak is still alive until midnight).
   * longest: most rep-days in any unbroken run of covered days.
   */
  function streaks(entries, freezes = [], today = todayKey()) {
    const active = new Set(dailyTotals(entries).keys());
    const frozen = new Set(freezes.map((f) => f.date));
    const covered = (d) => active.has(d) || frozen.has(d);

    let current = 0;
    let cursor = covered(today) ? today : addDays(today, -1);
    while (covered(cursor)) {
      if (active.has(cursor)) current++;
      cursor = addDays(cursor, -1);
    }

    let longest = 0;
    let run = 0;
    let prev = null;
    [...new Set([...active, ...frozen])].sort().forEach((d) => {
      if (!(prev && addDays(prev, 1) === d)) run = 0;
      if (active.has(d)) run++;
      if (run > longest) longest = run;
      prev = d;
    });

    return {
      current,
      longest,
      loggedToday: active.has(today),
      frozenToday: frozen.has(today),
      activeDays: active.size,
    };
  }

  global.RepStats = { toKey, fromKey, todayKey, addDays, daysBetween, dailyTotals, weekStart, streaks };
})(typeof self !== 'undefined' ? self : window);
