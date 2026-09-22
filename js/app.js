/* RepTracker — main UI. Vanilla JS, no build step. */
(function () {
  'use strict';

  const { todayKey, addDays, fromKey, dailyTotals, weekStart, streaks } = window.RepStats;
  const DB = window.RepDB;
  const CONFIG = window.REPTRACKER_CONFIG || {};

  const PALETTE = ['#f97316', '#38bdf8', '#4ade80', '#f472b6', '#a78bfa', '#facc15', '#2dd4bf', '#fb7185'];
  const HISTORY_PAGE = 30;

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => c != null && node.append(c));
    return node;
  };

  const state = {
    view: 'log',
    date: todayKey(),
    lastSeenToday: todayKey(),
    exercises: [],     // active only, ordered
    allExercises: [],  // including archived
    entries: [],       // all entries, cached in memory
    freezes: [],       // permanent streak freezes { date, reason, createdAt }
    chartSelected: null, // Set of exercise ids
    chartRange: '30',
    chartTrend: false,
    historyLimit: HISTORY_PAGE,
    settings: { reminderEnabled: true, reminderTime: '19:00' },
  };

  let chart = null;
  let reminderTimer = null;
  const saveTimers = new Map();

  /* ================= helpers ================= */

  function colorFor(exId) {
    const i = state.allExercises.findIndex((e) => e.id === exId);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }

  function exName(exId) {
    const ex = state.allExercises.find((e) => e.id === exId);
    return ex ? ex.name : 'Removed exercise';
  }

  function repsFor(date, exId) {
    const e = state.entries.find((x) => x.date === date && x.exerciseId === exId);
    return e ? e.reps : 0;
  }

  function formatDate(key, { long = false } = {}) {
    const today = todayKey();
    if (key === today) return 'Today';
    if (key === addDays(today, -1)) return 'Yesterday';
    const d = fromKey(key);
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (long || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  const fmt = (n) => Math.round(n).toLocaleString();

  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    if (action) {
      t.append(el('button', { onclick: () => { t.hidden = true; action.fn(); } }, action.label));
    }
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, action ? 10000 : 2600);
  }

  /**
   * Modal with arbitrary buttons. Resolves with the chosen value (or null).
   * With `input`, shows a textarea; action buttons stay disabled until it has
   * at least `input.minLength` characters, and the resolved value is
   * { value, text }.
   */
  function ask({ title, body, actions, input }) {
    const dlg = $('#dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body || '';
    const box = $('#dialog-actions');
    const buttons = actions.map((a) => el('button', { class: 'btn ' + (a.cls || ''), value: a.value }, a.label));
    box.replaceChildren(...buttons);
    box.append(el('button', { class: 'btn secondary', value: '' }, actions.length ? 'Cancel' : 'OK'));

    const ta = $('#dialog-input');
    const count = $('#dialog-count');
    ta.hidden = count.hidden = !input;
    ta.oninput = null;
    if (input) {
      ta.value = '';
      ta.placeholder = input.placeholder || '';
      ta.maxLength = input.maxLength || 280;
      const sync = () => {
        const n = ta.value.trim().length;
        buttons.forEach((b) => { b.disabled = n < (input.minLength || 1); });
        count.textContent = `${ta.value.length}/${ta.maxLength}`;
      };
      ta.oninput = sync;
      sync();
    }
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => {
        const value = dlg.returnValue || null;
        resolve(input ? (value ? { value, text: ta.value.trim() } : null) : value);
      }, { once: true });
      dlg.returnValue = '';
      dlg.showModal();
      if (input) ta.focus();
    });
  }

  function isStandalone() {
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  }

  /* ================= data loading ================= */

  async function loadAll() {
    const [all, entries, freezes, reminderEnabled, reminderTime] = await Promise.all([
      DB.getExercises({ includeArchived: true }),
      DB.getAllEntries(),
      DB.getFreezes(),
      DB.getMeta('reminderEnabled', true),
      DB.getMeta('reminderTime', '19:00'),
    ]);
    state.allExercises = all;
    state.exercises = all.filter((e) => !e.archived);
    state.entries = entries;
    state.freezes = freezes;
    state.settings.reminderEnabled = reminderEnabled;
    state.settings.reminderTime = reminderTime;
    if (!state.chartSelected) {
      state.chartSelected = new Set(state.exercises.map((e) => e.id));
    } else {
      // Drop ids that no longer exist.
      state.chartSelected = new Set([...state.chartSelected].filter((id) => all.some((e) => e.id === id)));
    }
  }

  function updateCache(date, exId, reps) {
    const idx = state.entries.findIndex((x) => x.date === date && x.exerciseId === exId);
    if (reps > 0) {
      if (idx >= 0) state.entries[idx].reps = reps;
      else state.entries.push({ id: date + '|' + exId, date, exerciseId: exId, reps });
    } else if (idx >= 0) {
      state.entries.splice(idx, 1);
    }
  }

  /* ================= navigation ================= */

  const TITLES = { log: 'RepTracker', progress: 'Progress', settings: 'Settings' };

  function showView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.tabbar button').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('#screen-title').textContent = TITLES[view];
    window.scrollTo(0, 0);
    if (view === 'progress') renderProgress();
    if (view === 'settings') renderSettings();
  }

  /* ================= streak + reminder banner ================= */

  function renderStreak() {
    const s = streaks(state.entries, state.freezes);
    $('#streak-current').textContent = s.current;
    $('#streak-longest').textContent = s.longest;
    $('#streak-card').classList.toggle('cold', s.current === 0);
    let status;
    if (s.current === 0) status = s.activeDays ? 'Log something today to start a new streak' : 'Log something today to start a streak';
    else if (s.frozenToday && !s.loggedToday) status = 'Today is covered by a streak freeze ❄️';
    else if (s.loggedToday) status = s.current === s.longest && s.current > 1 ? 'Personal best — keep going!' : 'Done for today ✓';
    else status = 'Log today to keep it going';
    $('#streak-status').textContent = status;
    const used = freezeInWeek(todayKey());
    $('#streak-freeze').textContent = used
      ? `❄️ This week's freeze is used (${formatDate(used.date)})`
      : '❄️ 1 streak freeze available this week';

    const banner = $('#reminder-banner');
    banner.hidden = s.loggedToday || s.frozenToday || !state.settings.reminderEnabled;
    $('#reminder-text').textContent = s.current > 0
      ? `Nothing logged today yet — don't lose your ${s.current}-day streak!`
      : 'Nothing logged today yet — start a streak!';
    return s;
  }

  /* ================= LOG view ================= */

  function renderDateBar() {
    const today = todayKey();
    $('#date-label').textContent = formatDate(state.date);
    $('#next-day').disabled = state.date >= today;
    $('#jump-today').hidden = state.date === today;
  }

  /* ================= calendar picker ================= */

  let calMonth = null; // "YYYY-MM-01" of the month being shown

  function openCalendar() {
    calMonth = state.date.slice(0, 8) + '01';
    renderCalendar();
    $('#cal-dialog').showModal();
  }

  function shiftCalMonth(n) {
    const d = fromKey(calMonth);
    d.setMonth(d.getMonth() + n);
    const next = window.RepStats.toKey(d);
    if (next > todayKey()) return; // no browsing into future months
    calMonth = next;
    renderCalendar();
  }

  function renderCalendar() {
    const today = todayKey();
    const first = fromKey(calMonth);
    $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('#cal-next').disabled = calMonth === today.slice(0, 8) + '01';

    const withReps = new Set(dailyTotals(state.entries).keys());
    const frozen = new Set(state.freezes.map((f) => f.date));
    const lead = (first.getDay() + 6) % 7; // Monday-first, matching freeze weeks
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el('span'));
    for (let day = 1; day <= daysInMonth; day++) {
      const key = addDays(calMonth, day - 1);
      const cls = ['cal-day'];
      if (withReps.has(key)) cls.push('has-reps');
      if (frozen.has(key)) cls.push('frozen');
      if (key === today) cls.push('today');
      if (key === state.date) cls.push('selected');
      const label = fromKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
        (withReps.has(key) ? ', reps logged' : '') + (frozen.has(key) ? ', streak freeze' : '');
      cells.push(el('button', {
        class: cls.join(' '), disabled: key > today, 'aria-label': label,
        'aria-current': key === state.date ? 'date' : false,
        onclick: () => { setDate(key); $('#cal-dialog').close(); },
      }, String(day)));
    }
    $('#cal-grid').replaceChildren(...cells);
  }

  function renderLog() {
    renderDateBar();
    const list = $('#exercise-list');
    if (state.exercises.length === 0) {
      list.replaceChildren(el('div', { class: 'empty-state' }, 'No exercises yet. Add one in Settings.'));
      $('#day-total').textContent = '';
      return;
    }
    list.replaceChildren(...state.exercises.map(exerciseCard));
    renderDayTotal();
  }

  function renderDayTotal() {
    const total = state.entries.filter((e) => e.date === state.date).reduce((s, e) => s + e.reps, 0);
    $('#day-total').textContent = total ? `${fmt(total)} total reps` : '';
    renderFreezeBox(total);
  }

  /* ================= streak freezes ================= */

  function freezeFor(date) {
    return state.freezes.find((f) => f.date === date);
  }

  function freezeInWeek(date) {
    const wk = weekStart(date);
    return state.freezes.find((f) => weekStart(f.date) === wk);
  }

  function weekLabel(date) {
    const start = weekStart(date);
    const o = { month: 'short', day: 'numeric' };
    return `${fromKey(start).toLocaleDateString(undefined, o)}–${fromKey(addDays(start, 6)).toLocaleDateString(undefined, o)}`;
  }

  function freezeCard(f) {
    const added = new Date(f.createdAt);
    return el('div', { class: 'freeze-card' },
      el('div', { class: 'freeze-card-h' }, '❄️ Streak freeze'),
      el('p', { class: 'freeze-reason' }, f.reason),
      el('div', { class: 'freeze-meta' },
        `Added ${added.toLocaleDateString()} ${added.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · permanent`));
  }

  function renderFreezeBox(total) {
    const box = $('#freeze-box');
    const f = freezeFor(state.date);
    if (f) { box.replaceChildren(freezeCard(f)); return; }
    if (total > 0 || state.exercises.length === 0) { box.replaceChildren(); return; }
    const used = freezeInWeek(state.date);
    if (used) {
      box.replaceChildren(el('div', { class: 'freeze-note' },
        `❄️ The freeze for ${weekLabel(state.date)} was already used on ${formatDate(used.date)}.`));
      return;
    }
    const label = ['Today', 'Yesterday'].includes(formatDate(state.date))
      ? formatDate(state.date).toLowerCase() : formatDate(state.date);
    box.replaceChildren(el('button', { class: 'btn freeze-btn', onclick: () => useFreeze(state.date) },
      `❄️ Use streak freeze for ${label}`));
  }

  async function useFreeze(date) {
    const res = await ask({
      title: `Freeze ${formatDate(date)}?`,
      body: `This keeps your streak alive across this day and uses your one freeze for ${weekLabel(date)}. ` +
        'Write down why. The freeze and its reason are permanent and can\'t be edited or removed.',
      input: { placeholder: 'Reason (e.g. sick, travelling, sore shoulder)', minLength: 3, maxLength: 280 },
      actions: [{ label: 'Use freeze permanently', value: 'freeze' }],
    });
    if (!res) return;
    try {
      await flushSaves();
      const f = await DB.addFreeze(date, res.text);
      state.freezes.push(f);
      renderStreak();
      renderDayTotal();
      toast('Streak freeze saved ❄️');
    } catch (err) {
      await ask({ title: 'Couldn\'t add freeze', body: err.message, actions: [] });
    }
  }

  function renderFreezeList() {
    const list = $('#freeze-list');
    if (!state.freezes.length) {
      list.replaceChildren(el('li', { class: 'fl-empty' }, 'No freezes used yet.'));
      return;
    }
    list.replaceChildren(...[...state.freezes].reverse().map((f) => el('li', {},
      el('span', { class: 'fl-date' }, formatDate(f.date, { long: true })),
      el('span', { class: 'fl-reason' }, f.reason))));
  }

  function exerciseCard(ex) {
    const value = repsFor(state.date, ex.id);
    const best = state.entries.filter((e) => e.exerciseId === ex.id).reduce((m, e) => Math.max(m, e.reps), 0);

    const input = el('input', {
      type: 'number', inputmode: 'numeric', pattern: '[0-9]*', min: '0', step: '1',
      value: value || '', placeholder: '0', 'aria-label': ex.name + ' reps',
    });
    const card = el('div', { class: 'ex-card' + (value ? ' has-reps' : '') });
    const meta = el('span', { class: 'ex-meta' }, best ? `best ${fmt(best)}` : '');

    const set = (n) => {
      n = Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));
      input.value = n || '';
      card.classList.toggle('has-reps', n > 0);
      queueSave(state.date, ex.id, n);
    };
    const bump = (d) => set((Number(input.value) || 0) + d);

    input.addEventListener('input', () => set(input.value));
    input.addEventListener('focus', () => input.select());

    card.append(
      el('div', { class: 'ex-head' }, el('span', { class: 'ex-name' }, ex.name), meta),
      el('div', { class: 'stepper' },
        el('button', { class: 'minus', 'aria-label': 'Decrease ' + ex.name, onclick: () => bump(-1) }, '−'),
        input,
        el('button', { class: 'plus', 'aria-label': 'Increase ' + ex.name, onclick: () => bump(1) }, '+')),
      el('div', { class: 'quick-add' },
        [5, 10, 20].map((n) => el('button', { class: 'chip-add', onclick: () => bump(n) }, '+' + n)),
        el('button', { class: 'chip-add', onclick: () => set(0), 'aria-label': 'Clear ' + ex.name }, 'Clear')),
    );
    return card;
  }

  function queueSave(date, exId, reps) {
    updateCache(date, exId, reps);
    renderStreak();
    renderDayTotal();
    const key = date + '|' + exId;
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(async () => {
      saveTimers.delete(key);
      try {
        await DB.setReps(date, exId, reps);
      } catch (err) {
        console.error(err);
        toast('Could not save — ' + err.message);
      }
    }, 350));
  }

  async function flushSaves() {
    // Called when the app is being hidden, so nothing is lost on swipe-away.
    const pending = [...saveTimers.keys()];
    pending.forEach((key) => clearTimeout(saveTimers.get(key)));
    saveTimers.clear();
    await Promise.all(pending.map((key) => {
      const [date, exId] = key.split('|');
      return DB.setReps(date, exId, repsFor(date, exId));
    }));
  }

  function setDate(key) {
    const today = todayKey();
    if (!key || key > today) key = today;
    state.date = key;
    renderLog();
  }

  /* ================= PROGRESS view ================= */

  function rangeKeys() {
    const today = todayKey();
    let start;
    if (state.chartRange === 'all') {
      const first = state.entries.reduce((m, e) => (e.date < m ? e.date : m), today);
      start = first < addDays(today, -13) ? first : addDays(today, -13);
    } else {
      start = addDays(today, -(Number(state.chartRange) - 1));
    }
    const keys = [];
    for (let d = start; d <= today; d = addDays(d, 1)) keys.push(d);
    return keys;
  }

  function renderProgress() {
    // Exercise chips
    const chips = $('#chart-exercises');
    chips.replaceChildren(...state.exercises.map((ex) => {
      const on = state.chartSelected.has(ex.id);
      return el('button', {
        class: 'chip' + (on ? ' on' : ''), style: '--c:' + colorFor(ex.id), 'aria-pressed': on,
        onclick: () => {
          if (state.chartSelected.has(ex.id)) state.chartSelected.delete(ex.id);
          else state.chartSelected.add(ex.id);
          renderProgress();
        },
      }, el('span', { class: 'dot' }), ex.name);
    }));
    document.querySelectorAll('#chart-range button').forEach((b) =>
      b.classList.toggle('active', b.dataset.range === state.chartRange));
    $('#chart-trend').checked = state.chartTrend;

    renderChart();
    renderStats();
    renderHistory();
  }

  function renderChart() {
    const keys = rangeKeys();
    const selected = state.exercises.filter((e) => state.chartSelected.has(e.id));
    const byKey = new Map(state.entries.map((e) => [e.date + '|' + e.exerciseId, e.reps]));
    const labels = keys.map((k) => { const d = fromKey(k); return (d.getMonth() + 1) + '/' + d.getDate(); });

    const datasets = [];
    let anyData = false;
    selected.forEach((ex) => {
      const c = colorFor(ex.id);
      const data = keys.map((k) => byKey.get(k + '|' + ex.id) ?? null);
      if (data.some((v) => v != null)) anyData = true;
      datasets.push({
        label: ex.name, data, borderColor: c, backgroundColor: c + '33',
        borderWidth: 2.5, tension: 0.3, spanGaps: true,
        pointRadius: keys.length > 60 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: c,
      });
      if (state.chartTrend) {
        // Trailing 7-day average over the days that were actually logged.
        const avg = keys.map((_, i) => {
          const win = data.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null);
          return win.length ? win.reduce((s, v) => s + v, 0) / win.length : null;
        });
        datasets.push({
          label: ex.name + ' (7-day avg)', data: avg, borderColor: c, borderDash: [6, 5],
          borderWidth: 1.5, pointRadius: 0, tension: 0.35, spanGaps: true,
        });
      }
    });

    $('#chart-empty').hidden = anyData;
    $('#chart-empty').textContent = selected.length ? 'No reps logged in this range yet.' : 'Pick an exercise above.';

    if (typeof window.Chart === 'undefined') {
      $('#chart-empty').hidden = false;
      $('#chart-empty').textContent = 'Chart library failed to load.';
      return;
    }

    const options = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => formatDate(keys[items[0].dataIndex]),
            label: (item) => ` ${item.dataset.label}: ${item.raw == null ? '—' : fmt(item.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 6, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.12)' }, ticks: { color: '#94a3b8', precision: 0 } },
      },
    };

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.options = options;
      chart.update();
    } else {
      chart = new window.Chart($('#chart'), { type: 'line', data: { labels, datasets }, options });
    }
  }

  function renderStats() {
    const keys = rangeKeys();
    const start = keys[0];
    const grid = $('#stats-grid');
    grid.replaceChildren(...state.exercises.filter((e) => state.chartSelected.has(e.id)).map((ex) => {
      const inRange = state.entries.filter((e) => e.exerciseId === ex.id && e.date >= start);
      const total = inRange.reduce((s, e) => s + e.reps, 0);
      const best = inRange.reduce((m, e) => Math.max(m, e.reps), 0);
      const avg = inRange.length ? total / inRange.length : 0;
      const line = (label, v) => el('div', { class: 'stat-line' }, el('span', {}, label), el('b', {}, v));
      return el('div', { class: 'stat', style: '--c:' + colorFor(ex.id) },
        el('div', { class: 'stat-name' }, ex.name),
        line('Total', fmt(total)),
        line('Best day', fmt(best)),
        line('Avg / day', avg ? avg.toFixed(1) : '0'),
        line('Days', String(inRange.length)));
    }));
  }

  function renderHistory() {
    const totals = dailyTotals(state.entries);
    const days = [...new Set([...totals.keys(), ...state.freezes.map((f) => f.date)])].sort().reverse();
    const list = $('#history');
    if (!days.length) {
      list.replaceChildren(el('li', { class: 'h-empty' }, 'Nothing logged yet.'));
      $('#history-more').hidden = true;
      return;
    }
    const shown = days.slice(0, state.historyLimit);
    list.replaceChildren(...shown.map((d) => {
      const parts = state.entries
        .filter((e) => e.date === d)
        .sort((a, b) => exOrder(a.exerciseId) - exOrder(b.exerciseId))
        .map((e) => `${exName(e.exerciseId)} ${fmt(e.reps)}`);
      const fz = freezeFor(d);
      const detail = parts.length
        ? el('span', { class: 'h-detail' }, parts.join(' · '))
        : el('span', { class: 'h-detail h-freeze' }, '❄️ ' + (fz ? fz.reason : ''));
      return el('li', {}, el('button', {
        onclick: () => { setDate(d); showView('log'); },
      }, el('span', { class: 'h-date' }, formatDate(d)), detail));
    }));
    $('#history-more').hidden = days.length <= state.historyLimit;
  }

  function exOrder(id) {
    const i = state.allExercises.findIndex((e) => e.id === id);
    return i < 0 ? 999 : i;
  }

  /* ================= SETTINGS view ================= */

  function renderSettings() {
    renderExerciseEditor();
    renderFreezeList();
    renderLockStatus();
    $('#reminder-enabled').checked = state.settings.reminderEnabled;
    $('#reminder-time').value = state.settings.reminderTime;
    renderNotifStatus();
    renderPushStatus();
    renderBackupStatus();
  }

  function renderExerciseEditor() {
    const list = $('#ex-edit-list');
    const active = state.exercises;
    const archived = state.allExercises.filter((e) => e.archived);

    const rows = active.map((ex, i) => {
      const input = el('input', { type: 'text', value: ex.name, maxlength: '60', 'aria-label': 'Exercise name' });
      input.addEventListener('change', async () => {
        const name = input.value.trim();
        if (!name) { input.value = ex.name; return; }
        ex.name = name;
        await DB.putExercise(ex);
        toast('Renamed to ' + name);
        renderLog();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      return el('li', {},
        el('span', { class: 'swatch', style: 'background:' + colorFor(ex.id) }),
        input,
        el('button', { class: 'mini-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => moveExercise(i, -1) }, '↑'),
        el('button', { class: 'mini-btn', 'aria-label': 'Move down', disabled: i === active.length - 1, onclick: () => moveExercise(i, 1) }, '↓'),
        el('button', { class: 'mini-btn danger', 'aria-label': 'Remove ' + ex.name, onclick: () => removeExercise(ex) }, '✕'));
    });

    archived.forEach((ex) => {
      rows.push(el('li', {},
        el('span', { class: 'swatch', style: 'background:' + colorFor(ex.id) + ';opacity:.4' }),
        el('span', { style: 'flex:1;color:var(--muted)' }, ex.name + ' (hidden)'),
        el('button', { class: 'btn secondary', style: 'height:36px;padding:0 12px', onclick: async () => {
          ex.archived = false;
          await DB.putExercise(ex);
          await refreshAll();
          state.chartSelected.add(ex.id);
          toast(ex.name + ' restored');
        } }, 'Restore')));
    });

    if (!rows.length) rows.push(el('li', { style: 'color:var(--muted)' }, 'No exercises. Add one below.'));
    list.replaceChildren(...rows);
  }

  async function moveExercise(i, dir) {
    const list = [...state.exercises];
    const j = i + dir;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((ex, idx) => { ex.order = idx; return DB.putExercise(ex); }));
    await refreshAll();
  }

  async function removeExercise(ex) {
    const count = state.entries.filter((e) => e.exerciseId === ex.id).length;
    const choice = await ask({
      title: `Remove ${ex.name}?`,
      body: count
        ? `It has ${count} logged day${count === 1 ? '' : 's'}. Hiding keeps that history (and your streak) and you can restore it later.`
        : 'It has no logged history.',
      actions: count
        ? [{ label: 'Hide, keep history', value: 'hide' }, { label: 'Delete forever', value: 'delete', cls: 'danger' }]
        : [{ label: 'Remove', value: 'delete', cls: 'danger' }],
    });
    if (!choice) return;
    if (choice === 'hide') {
      ex.archived = true;
      await DB.putExercise(ex);
    } else {
      await DB.deleteExercise(ex.id);
    }
    state.chartSelected.delete(ex.id);
    await refreshAll();
    toast(`${ex.name} ${choice === 'hide' ? 'hidden' : 'deleted'}`);
  }

  async function refreshAll() {
    await loadAll();
    renderStreak();
    renderLog();
    if (state.view === 'settings') renderSettings();
    if (state.view === 'progress') renderProgress();
  }

  /* ================= backup ================= */

  async function renderBackupStatus() {
    const last = await DB.getMeta('lastBackup', null);
    const days = state.entries.length ? new Set(state.entries.map((e) => e.date)).size : 0;
    let text = `${days} logged day${days === 1 ? '' : 's'} on this device. `;
    if (last) {
      const ago = Math.floor((Date.now() - last) / 86400000);
      text += `Last export: ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago'}.`;
    } else {
      text += 'Never exported.';
    }
    $('#backup-status').textContent = text;
  }

  async function exportData() {
    await flushSaves();
    const data = await DB.exportAll();
    const json = JSON.stringify(data, null, 2);
    const name = `reptracker-backup-${todayKey()}.json`;
    const file = new File([json], name, { type: 'application/json' });

    // On iPhone the share sheet ("Save to Files") is the most reliable path,
    // especially when running as a home-screen app.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'RepTracker backup' });
        await DB.setMeta('lastBackup', Date.now());
        renderBackupStatus();
        toast('Backup exported');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Otherwise fall through to a normal download.
      }
    }
    const url = URL.createObjectURL(file);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await DB.setMeta('lastBackup', Date.now());
    renderBackupStatus();
    toast('Backup downloaded');
  }

  async function importData(file) {
    let data;
    try {
      data = DB.validateBackup(JSON.parse(await file.text()));
    } catch (err) {
      await ask({ title: 'Import failed', body: err.message, actions: [] });
      return;
    }
    const days = new Set(data.entries.map((e) => e.date)).size;
    const mode = await ask({
      title: 'Import backup?',
      body: `This file has ${data.exercises.length} exercise(s) and ${days} logged day(s)` +
        (data.exportedAt ? `, exported ${new Date(data.exportedAt).toLocaleDateString()}` : '') +
        '. Merge adds it to what\'s here (the file wins on conflicts). Replace wipes this device\'s reps first.' +
        ' Streak freezes are permanent either way: existing ones are kept and the file can only add new ones.',
      actions: [
        { label: 'Merge', value: 'merge' },
        { label: 'Replace everything', value: 'replace', cls: 'danger' },
      ],
    });
    if (!mode) return;
    await flushSaves();
    await DB.importAll(data, mode);
    state.chartSelected = null;
    await refreshAll();
    toast('Import complete');
  }

  /* ================= reminders (in-app / same session) ================= */

  function reminderDue() {
    const [h, m] = state.settings.reminderTime.split(':').map(Number);
    const due = new Date();
    due.setHours(h, m || 0, 0, 0);
    return due;
  }

  async function checkReminder() {
    clearTimeout(reminderTimer);
    if (!unlocked) return;
    const s = renderStreak();
    if (!state.settings.reminderEnabled || s.loggedToday || s.frozenToday) return;

    const due = reminderDue();
    const now = new Date();
    if (now < due) {
      // App is open before the reminder time: fire when the time arrives.
      reminderTimer = setTimeout(checkReminder, Math.min(due - now + 1000, 2 ** 31 - 1));
      return;
    }
    const today = todayKey();
    if ((await DB.getMeta('lastNotified', null)) === today) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.ready;
      const body = s.current > 0
        ? `You haven't logged any reps today. Keep your ${s.current}-day streak alive!`
        : 'You haven\'t logged any reps today.';
      if (reg && reg.showNotification) {
        await reg.showNotification('RepTracker reminder', { body, icon: 'icons/icon-192-v2.png', badge: 'icons/icon-192-v2.png', tag: 'daily-reminder' });
      } else {
        new Notification('RepTracker reminder', { body, icon: 'icons/icon-192-v2.png' });
      }
      await DB.setMeta('lastNotified', today);
    } catch (err) {
      console.warn('Notification failed', err);
    }
  }

  function renderNotifStatus() {
    const btn = $('#notif-permission');
    const status = $('#notif-status');
    if (!('Notification' in window)) {
      btn.hidden = true;
      status.textContent = isStandalone()
        ? 'Notifications aren\'t supported here. On iPhone they need iOS 16.4 or newer.'
        : 'On iPhone, notifications only work after you add RepTracker to your Home Screen (iOS 16.4+). The in-app banner still works.';
      return;
    }
    const p = Notification.permission;
    btn.hidden = p === 'granted';
    btn.disabled = p === 'denied';
    status.textContent = p === 'granted' ? 'Notifications are allowed ✓'
      : p === 'denied' ? 'Notifications are blocked. Enable them in iOS Settings → Notifications → RepTracker.'
      : '';
  }

  async function requestNotifPermission() {
    try {
      await Notification.requestPermission();
    } catch (err) { console.warn(err); }
    renderNotifStatus();
    renderPushStatus();
    checkReminder();
  }

  /* ================= Web Push (optional, needs the GitHub Actions cron) ================= */

  function urlB64ToUint8Array(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function renderPushStatus() {
    const btn = $('#push-subscribe');
    const details = $('#push-details');
    const status = $('#push-status');
    if (CONFIG.repoUrl) $('#push-secrets-link').href = CONFIG.repoUrl + '/settings/secrets/actions';

    if (!CONFIG.vapidPublicKey) {
      btn.hidden = true; details.hidden = true;
      status.textContent = 'Push isn\'t configured for this deployment (no VAPID public key in js/config.js).';
      return;
    }
    if (!pushSupported()) {
      btn.hidden = true; details.hidden = true;
      status.textContent = 'Push needs iOS 16.4+ and RepTracker opened from your Home Screen icon.';
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    btn.hidden = !!sub;
    details.hidden = !sub;
    if (sub) {
      $('#push-sub-json').value = JSON.stringify(sub.toJSON());
      status.textContent = `Subscribed on this device. Reminders are sent ${CONFIG.pushScheduleLabel || 'daily'} by the GitHub Actions workflow.`;
    } else {
      status.textContent = '';
    }
  }

  async function subscribePush() {
    const btn = $('#push-subscribe');
    btn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notification permission was not granted');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(CONFIG.vapidPublicKey),
      });
      await DB.setMeta('pushSubscription', sub.toJSON());
      toast('Subscribed — now copy it into the repo secret');
    } catch (err) {
      await ask({ title: 'Couldn\'t enable push', body: err.message, actions: [] });
    } finally {
      btn.disabled = false;
      renderNotifStatus();
      renderPushStatus();
    }
  }

  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await DB.setMeta('pushSubscription', null);
    toast('Push reminders turned off on this device');
    renderPushStatus();
  }

  async function copyPushSub() {
    const ta = $('#push-sub-json');
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch (_) {
      ta.select();
      document.execCommand('copy');
    }
    toast('Copied');
  }

  /* ================= service worker ================= */

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const promptUpdate = (worker) => {
        toast('A new version is ready', {
          label: 'Update',
          fn: () => worker.postMessage({ type: 'SKIP_WAITING' }),
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  }

  /* ================= app lock =================
   * A local lock screen: there is no server, so this protects the app on this
   * device (someone picking up your phone), it isn't an online account. The
   * password is never stored — only a salted PBKDF2-SHA256 hash.
   */
  const PBKDF2_ITERATIONS = 600000;
  const RELOCK_AFTER_MS = 60 * 1000;   // re-lock after a minute in the background
  const FREE_ATTEMPTS = 5;             // then 30s, 60s, 120s… (max 15 min) timeouts
  let unlocked = false;
  let hiddenAt = null;
  let unlockResolve = null;

  const enc = new TextEncoder();
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const normUser = (u) => String(u || '').trim().toLowerCase();

  async function hashPassword(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return new Uint8Array(bits);
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function makeAuth(username, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt, PBKDF2_ITERATIONS);
    return { username: String(username).trim(), salt: b64(salt), hash: b64(hash), iterations: PBKDF2_ITERATIONS };
  }

  async function passwordMatches(auth, password) {
    return sameBytes(await hashPassword(password, unb64(auth.salt), auth.iterations), unb64(auth.hash));
  }

  function validateNew(username, password, confirm) {
    if (!String(username).trim()) return 'Choose a username.';
    if (password.length < 4) return 'Password must be at least 4 characters.';
    if (password !== confirm) return 'The passwords don\'t match.';
    return null;
  }

  async function lockoutRemaining() {
    const f = await DB.getMeta('authFails', { count: 0, until: 0 });
    return Math.max(0, (f.until || 0) - Date.now());
  }

  async function recordFailure() {
    const f = await DB.getMeta('authFails', { count: 0, until: 0 });
    f.count = (f.count || 0) + 1;
    if (f.count >= FREE_ATTEMPTS) {
      f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.count - FREE_ATTEMPTS)) * 1000;
    }
    await DB.setMeta('authFails', f);
    return f;
  }

  const fmtWait = (ms) => {
    const secs = Math.ceil(ms / 1000);
    return secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs}s`;
  };

  function showLockForm(mode) {
    const setup = mode === 'setup';
    $('#lock-sub').textContent = setup
      ? 'Create a username and password. You\'ll need them every time you open the app.'
      : 'Enter your username and password.';
    $('#lock-form').dataset.mode = mode;
    $('#lock-form').hidden = false;
    $('#lock-pass2').hidden = !setup;
    $('#lock-pass2').required = setup;
    $('#lock-pass').autocomplete = setup ? 'new-password' : 'current-password';
    $('#lock-submit').textContent = setup ? 'Create & open' : 'Unlock';
    $('#lock-forgot').hidden = setup;
  }

  /** Show the lock screen; resolves once the user has unlocked. */
  async function requireUnlock() {
    unlocked = false;
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (document.activeElement) document.activeElement.blur();
    document.body.classList.add('locked');
    window.scrollTo(0, 0);
    $('#lock-pass').value = '';
    $('#lock-pass2').value = '';
    $('#lock-error').textContent = '';
    if (!(window.crypto && crypto.subtle)) {
      $('#lock-sub').textContent = 'This browser can\'t run the app lock (it needs a secure https page).';
      return new Promise(() => {});
    }
    const auth = await DB.getMeta('auth', null);
    showLockForm(auth ? 'login' : 'setup');
    return new Promise((resolve) => { unlockResolve = resolve; });
  }

  async function onLockSubmit(e) {
    e.preventDefault();
    const btn = $('#lock-submit');
    const err = $('#lock-error');
    const user = $('#lock-user').value;
    const pass = $('#lock-pass').value;
    err.textContent = '';
    btn.disabled = true;
    try {
      if ($('#lock-form').dataset.mode === 'setup') {
        const problem = validateNew(user, pass, $('#lock-pass2').value);
        if (problem) { err.textContent = problem; return; }
        await DB.setMeta('auth', await makeAuth(user, pass));
      } else {
        const wait = await lockoutRemaining();
        if (wait > 0) { err.textContent = `Too many wrong tries. Try again in ${fmtWait(wait)}.`; return; }
        const auth = await DB.getMeta('auth', null);
        // Hash first either way, so a wrong username takes as long as a wrong password.
        const ok = auth && (await passwordMatches(auth, pass)) && normUser(user) === normUser(auth.username);
        if (!ok) {
          const f = await recordFailure();
          const left = FREE_ATTEMPTS - f.count;
          err.textContent = left > 0
            ? `Wrong username or password. ${left} ${left === 1 ? 'try' : 'tries'} left before a timeout.`
            : `Wrong username or password. Try again in ${fmtWait(f.until - Date.now())}.`;
          $('#lock-pass').value = '';
          return;
        }
        await DB.setMeta('authFails', { count: 0, until: 0 });
      }
      $('#lock-pass').value = '';
      $('#lock-pass2').value = '';
      $('#lock-form').hidden = true;
      unlocked = true;
      document.body.classList.remove('locked');
      if (unlockResolve) { unlockResolve(); unlockResolve = null; }
    } catch (ex) {
      err.textContent = 'Something went wrong: ' + ex.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function onForgotPassword() {
    const res = await ask({
      title: 'Forgot your password?',
      body: 'There\'s no server, so the password can\'t be recovered or reset by email. The only way back in is to ' +
        'erase ALL RepTracker data on this device (reps, exercises, freezes and settings), then create a new ' +
        'password and import a backup if you have one. Type ERASE to confirm.',
      input: { placeholder: 'Type ERASE', minLength: 5, maxLength: 5 },
      actions: [{ label: 'Erase everything', value: 'erase', cls: 'danger' }],
    });
    if (!res) return;
    if (res.text.toUpperCase() !== 'ERASE') {
      $('#lock-error').textContent = 'Nothing was erased (you need to type ERASE).';
      return;
    }
    await DB.eraseEverything();
    location.reload();
  }

  async function lockNow() {
    await flushSaves().catch(() => {});
    await requireUnlock();
    afterUnlock();
  }

  /** Re-render after a re-lock so the screen is fresh (day may have changed). */
  function afterUnlock() {
    renderStreak();
    renderLog();
    if (state.view === 'progress') renderProgress();
    if (state.view === 'settings') renderSettings();
    checkReminder();
  }

  async function renderLockStatus() {
    const auth = await DB.getMeta('auth', null);
    $('#lock-status').textContent = auth ? `Locked with username “${auth.username}”.` : '';
    if (auth && document.activeElement !== $('#ca-user')) $('#ca-user').value = auth.username;
  }

  async function onChangeAuth(e) {
    e.preventDefault();
    const auth = await DB.getMeta('auth', null);
    const user = $('#ca-user').value;
    const current = $('#ca-current').value;
    const n1 = $('#ca-new').value;
    const n2 = $('#ca-new2').value;
    if (!auth || !(await passwordMatches(auth, current))) {
      await ask({ title: 'Not saved', body: 'Your current password is wrong.', actions: [] });
      return;
    }
    const problem = n1 ? validateNew(user, n1, n2) : (!user.trim() ? 'Choose a username.' : null);
    if (problem) {
      await ask({ title: 'Not saved', body: problem, actions: [] });
      return;
    }
    await DB.setMeta('auth', await makeAuth(user, n1 || current));
    ['#ca-current', '#ca-new', '#ca-new2'].forEach((sel) => { $(sel).value = ''; });
    document.activeElement && document.activeElement.blur();
    renderLockStatus();
    toast(n1 ? 'Username & password updated' : 'Username updated');
  }

  /* ================= wiring ================= */

  function bindEvents() {
    $('#lock-form').addEventListener('submit', onLockSubmit);
    $('#lock-forgot').addEventListener('click', onForgotPassword);
    $('#change-auth-form').addEventListener('submit', onChangeAuth);
    $('#lock-now').addEventListener('click', lockNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (unlocked && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) {
        lockNow();
      }
    });

    document.querySelectorAll('.tabbar button').forEach((b) =>
      b.addEventListener('click', () => showView(b.dataset.view)));

    $('#prev-day').addEventListener('click', () => setDate(addDays(state.date, -1)));
    $('#next-day').addEventListener('click', () => setDate(addDays(state.date, 1)));
    $('#jump-today').addEventListener('click', () => setDate(todayKey()));
    $('#date-btn').addEventListener('click', openCalendar);
    $('#cal-prev').addEventListener('click', () => shiftCalMonth(-1));
    $('#cal-next').addEventListener('click', () => shiftCalMonth(1));
    $('#cal-today').addEventListener('click', () => { setDate(todayKey()); $('#cal-dialog').close(); });
    $('#cal-close').addEventListener('click', () => $('#cal-dialog').close());
    // Tap outside the calendar to dismiss it.
    $('#cal-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    // Swipe left/right inside the calendar to change month.
    let cx = null;
    $('#cal-grid').addEventListener('touchstart', (e) => { cx = e.touches[0].clientX; }, { passive: true });
    $('#cal-grid').addEventListener('touchend', (e) => {
      if (cx == null) return;
      const dx = e.changedTouches[0].clientX - cx;
      cx = null;
      if (Math.abs(dx) > 60) shiftCalMonth(dx > 0 ? -1 : 1);
    }, { passive: true });

    // Swipe left/right on the log view to change day.
    let sx = null, sy = null;
    const list = $('#exercise-list');
    list.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    list.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        if (dx > 0) setDate(addDays(state.date, -1));
        else if (state.date < todayKey()) setDate(addDays(state.date, 1));
      }
    }, { passive: true });

    document.querySelectorAll('#chart-range button').forEach((b) => b.addEventListener('click', () => {
      state.chartRange = b.dataset.range;
      renderProgress();
    }));
    $('#chart-trend').addEventListener('change', (e) => { state.chartTrend = e.target.checked; renderChart(); });
    $('#history-more').addEventListener('click', () => { state.historyLimit += HISTORY_PAGE; renderHistory(); });

    $('#add-exercise-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#new-exercise');
      const name = input.value.trim();
      if (!name) return;
      const ex = await DB.addExercise(name);
      input.value = '';
      input.blur();
      await refreshAll();
      state.chartSelected.add(ex.id);
      toast(name + ' added');
    });

    $('#reminder-enabled').addEventListener('change', async (e) => {
      state.settings.reminderEnabled = e.target.checked;
      await DB.setMeta('reminderEnabled', e.target.checked);
      checkReminder();
    });
    $('#reminder-time').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      state.settings.reminderTime = e.target.value;
      await DB.setMeta('reminderTime', e.target.value);
      await DB.setMeta('lastNotified', null);
      checkReminder();
    });
    $('#notif-permission').addEventListener('click', requestNotifPermission);

    $('#push-subscribe').addEventListener('click', subscribePush);
    $('#push-unsubscribe').addEventListener('click', unsubscribePush);
    $('#push-copy').addEventListener('click', copyPushSub);

    $('#export-btn').addEventListener('click', () => exportData().catch((err) => toast('Export failed: ' + err.message)));
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await importData(file);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushSaves().catch(console.error);
        return;
      }
      // Came back to the foreground: handle a day rollover and re-check reminders.
      const today = todayKey();
      if (today !== state.lastSeenToday) {
        if (state.date === state.lastSeenToday) state.date = today;
        state.lastSeenToday = today;
        renderLog();
        if (state.view === 'progress') renderProgress();
      }
      checkReminder();
    });
    window.addEventListener('pagehide', () => { flushSaves().catch(() => {}); });
  }

  async function init() {
    $('#app-version').textContent = 'v' + (CONFIG.version || 'dev');
    bindEvents();
    registerSW();
    try {
      await DB.open();
    } catch (err) {
      $('#lock-sub').textContent = 'Could not open storage: ' + err.message + '. Private Browsing can block it.';
      return;
    }
    // Nothing is loaded or rendered until the lock screen is passed.
    await requireUnlock();
    try {
      await DB.ensureDefaults();
      await loadAll();
    } catch (err) {
      console.error(err);
      $('#exercise-list').replaceChildren(el('div', { class: 'empty-state' },
        'Could not open storage: ' + err.message + '. Private Browsing can block it.'));
      return;
    }
    renderStreak();
    renderLog();
    checkReminder();
    // Ask the browser not to evict our data (best effort; helps on some platforms).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // Deep link from a notification: ?view=log
    const view = new URLSearchParams(location.search).get('view');
    if (view && TITLES[view]) showView(view);
  }

  init();
})();
