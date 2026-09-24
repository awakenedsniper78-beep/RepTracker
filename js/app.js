/* RepTracker — main UI. Vanilla JS, no build step. */
(function () {
  'use strict';

  const { todayKey, addDays, fromKey, toKey, dailyTotals, weekStart, streaks } = window.RepStats;
  const DB = window.RepDB;
  const L = window.RepLessons;
  const FIG = window.RepFigures;
  const GEM_REWARD = 5;      // gems per finished lesson
  const BOOST = 1.5;         // gem multiplier for a lesson started within BOOST_MS of finishing one
  const BOOST_MS = 20 * 60 * 1000;
  const FREEZE_COST = 20;    // gems for one bonus streak freeze
  const CONFIG = window.REPTRACKER_CONFIG || {};

  // Each exercise's chart line has its own color (--series-1…8 in styles.css, a palette checked
  // for color-blind separation and contrast in both themes), assigned in exercise order so it
  // stays put when other lines are toggled. Colors that are hard to tell apart side by side
  // (orange/red, aqua/magenta, …) also differ in dash pattern; past 8 exercises the colors
  // come round again with the next pattern.
  const DASHES = [[], [7, 6], [2, 5], [12, 5, 3, 5]]; // solid, dashed, dotted, dash-dot
  const SERIES_DASH = [0, 0, 0, 1, 1, 2, 2, 3];      // pattern for each --series-N color
  const RING_C = 2 * Math.PI * 20; // ring radius 20 in a 48 viewBox

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k === 'html') node.innerHTML = v; // only ever used with static SVG strings
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => c != null && node.append(c));
    return node;
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const ICONS = {
    minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    gem: '<svg viewBox="0 0 24 24"><path d="M6.5 4h11L21 9l-9 11L3 9z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/></svg>',
    play: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9v6l5-3z"/></svg>',
    flake: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/></svg>',
  };

  const state = {
    view: 'today',
    date: todayKey(),        // day selected in History
    calMonth: todayKey().slice(0, 8) + '01',
    lastSeenToday: todayKey(),
    exercises: [],           // active only, ordered
    allExercises: [],        // including hidden
    entries: [],             // all entries, cached in memory
    freezes: [],             // permanent streak freezes { date, reason, createdAt }
    chartSelected: null,     // Set of exercise ids
    chartRange: '30',
    settings: { reminderEnabled: true, reminderTime: '19:00' },
    lessonAreas: L.AREAS.map(([a]) => a), // focus areas picked on the body map
    lessonsDone: [],         // { id, name, date, total, unit, feel }
    lessonAdjust: 0,         // -2..2, nudged by "too easy / too hard"
    lessonSkip: new Set(),   // suggestions skipped this session
    lesson: null,            // the lesson in progress
    gems: 0,
    gemBoostUntil: 0,        // ms timestamp; a lesson started before it earns BOOST × gems
    bonusFreezes: 0,         // bought with gems; each lifts the one-per-week freeze limit once
  };

  let chart = null;
  let ready = false; // true once data is loaded and the first screen rendered
  let reminderTimer = null;
  const saveTimers = new Map();

  /* ================= helpers ================= */

  function exName(exId) {
    const ex = state.allExercises.find((e) => e.id === exId);
    return ex ? ex.name : 'Removed exercise';
  }

  function repsFor(date, exId) {
    const e = state.entries.find((x) => x.date === date && x.exerciseId === exId);
    return e ? e.reps : 0;
  }

  function dayTotal(date) {
    return state.entries.filter((e) => e.date === date).reduce((s, e) => s + e.reps, 0);
  }

  function formatDate(key, { long = false } = {}) {
    const today = todayKey();
    if (!long && key === today) return 'Today';
    if (!long && key === addDays(today, -1)) return 'Yesterday';
    const d = fromKey(key);
    const opts = long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  const fmt = (n) => Math.round(n).toLocaleString();
  const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    if (action) t.append(el('button', { onclick: () => { t.hidden = true; action.fn(); } }, action.label));
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, action ? 10000 : 2600);
  }

  /**
   * Modal with arbitrary buttons. Resolves with the chosen value (or null).
   * With `input`, shows a textarea; action buttons stay disabled until it has
   * at least `input.minLength` characters, and the resolved value is { value, text }.
   */
  function ask({ title, body, actions, input }) {
    const dlg = $('#dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body || '';
    const box = $('#dialog-actions');
    const buttons = actions.map((a) => el('button', { class: a.cls || '', value: a.value }, a.label));
    box.replaceChildren(...buttons);
    box.append(el('button', { class: actions.length ? 'secondary' : '', value: '' }, actions.length ? 'Cancel' : 'OK'));

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

  /* ================= data ================= */

  async function loadAll() {
    const [all, entries, freezes, reminderEnabled, reminderTime, areas, done, adjust, gems, boostUntil, bonus] = await Promise.all([
      DB.getExercises({ includeArchived: true }),
      DB.getAllEntries(),
      DB.getFreezes(),
      DB.getMeta('reminderEnabled', true),
      DB.getMeta('reminderTime', '19:00'),
      DB.getMeta('lessonAreas', null),
      DB.getMeta('lessonsDone', []),
      DB.getMeta('lessonAdjust', 0),
      DB.getMeta('gems', 0),
      DB.getMeta('gemBoostUntil', 0),
      DB.getMeta('bonusFreezes', 0),
    ]);
    state.gems = Number(gems) || 0;
    state.gemBoostUntil = Number(boostUntil) || 0;
    state.bonusFreezes = Number(bonus) || 0;
    if (Array.isArray(areas) && areas.length) state.lessonAreas = areas;
    state.lessonsDone = Array.isArray(done) ? done : [];
    state.lessonAdjust = Number(adjust) || 0;
    state.allExercises = all;
    state.exercises = all.filter((e) => !e.archived);
    state.entries = entries;
    state.freezes = freezes;
    state.settings.reminderEnabled = reminderEnabled;
    state.settings.reminderTime = reminderTime;
    if (!state.chartSelected) {
      state.chartSelected = new Set(state.exercises.slice(0, 2).map((e) => e.id));
    } else {
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

  function queueSave(date, exId, reps) {
    updateCache(date, exId, reps);
    onRepsChanged();
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
    // Called when the app is hidden, so nothing is lost on swipe-away.
    const pending = [...saveTimers.keys()];
    pending.forEach((key) => clearTimeout(saveTimers.get(key)));
    saveTimers.clear();
    await Promise.all(pending.map((key) => {
      const [date, exId] = key.split('|');
      return DB.setReps(date, exId, repsFor(date, exId));
    }));
  }

  /** Refresh the summary parts of the visible screen without touching inputs. */
  function onRepsChanged() {
    if (state.view === 'today') renderTodaySummary();
    if (state.view === 'history') { renderCalendar(); renderDayHead(); renderDayFreeze(); }
  }

  /* ================= navigation ================= */

  const TAB_FOR = { today: 'today', history: 'history', progress: 'progress', learn: 'learn', settings: 'settings', exercises: 'settings', areas: 'settings' };

  function showView(view) {
    if (!TAB_FOR[view]) view = 'today';
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.tabbar button').forEach((b) => {
      const on = b.dataset.view === (view === 'areas' ? $('#areas-back').dataset.back : TAB_FOR[view]);
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    document.documentElement.classList.toggle('grouped-bg', $('#view-' + view).classList.contains('grouped'));
    window.scrollTo(0, 0);
    renderView();
  }

  function renderView() {
    const v = state.view;
    if (v === 'today') renderToday();
    else if (v === 'history') renderHistory();
    else if (v === 'progress') renderProgress();
    else if (v === 'settings') renderSettings();
    else if (v === 'exercises') renderExerciseEditor();
    else if (v === 'learn') renderLearn();
    else if (v === 'areas') renderAreas();
  }

  /**
   * Move "today" along when the date changes: the app came back on a new day, or was left open
   * past midnight (a timer checks again just after each midnight). Without this, Today's
   * steppers would keep logging to yesterday.
   */
  let dayTimer = null;
  function syncToday() {
    clearTimeout(dayTimer);
    const today = todayKey();
    if (today !== state.lastSeenToday) {
      if (state.date === state.lastSeenToday) state.date = today;
      state.calMonth = state.date.slice(0, 8) + '01';
      state.lastSeenToday = today;
      if (ready) renderView();
    }
    dayTimer = setTimeout(() => { syncToday(); checkReminder(); }, fromKey(addDays(today, 1)) - Date.now() + 1000);
  }

  /* ================= stepper (shared by Today and History) ================= */

  function stepper(date, ex) {
    const value = repsFor(date, ex.id);
    const minus = el('button', { class: 'step-btn minus', 'aria-label': 'Decrease ' + ex.name, disabled: value <= 0, html: ICONS.minus });
    const plus = el('button', { class: 'step-btn plus', 'aria-label': 'Increase ' + ex.name, html: ICONS.plus });
    const input = el('input', {
      class: 'count', type: 'number', inputmode: 'numeric', pattern: '[0-9]*', min: '0', step: '1',
      value: String(value), 'aria-label': ex.name + ' reps',
    });

    const set = (n, { fromInput = false } = {}) => {
      n = Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));
      if (!fromInput) input.value = String(n);
      minus.disabled = n <= 0;
      queueSave(date, ex.id, n);
    };
    const bump = (d) => set((Number(input.value) || 0) + d);

    minus.addEventListener('click', () => bump(-1));
    plus.addEventListener('click', () => bump(1));
    input.addEventListener('input', () => set(input.value, { fromInput: true }));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => { if (input.value === '') input.value = '0'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

    return { node: el('div', { class: 'stepper' }, minus, input, plus), bump };
  }

  /* ================= TODAY ================= */

  function renderToday() {
    const today = todayKey();
    $('#today-date').textContent = fromKey(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    renderTodaySummary();

    const list = $('#today-list');
    if (!state.exercises.length) {
      list.replaceChildren(el('div', { class: 'empty-state' }, 'No exercises yet. Tap Edit to add one.'));
      return;
    }
    const yesterday = addDays(today, -1);
    list.replaceChildren(...state.exercises.map((ex) => {
      const best = state.entries.filter((e) => e.exerciseId === ex.id).reduce((m, e) => Math.max(m, e.reps), 0);
      const y = repsFor(yesterday, ex.id);
      const meta = [best ? `Best ${fmt(best)}` : null, y ? `Yesterday ${fmt(y)}` : null].filter(Boolean).join(' · ') || 'Nothing logged yet';
      const s = stepper(today, ex);
      return el('div', { class: 'ex-card' },
        el('div', { class: 'ex-top' },
          el('div', { class: 'ex-info' }, el('div', { class: 'ex-name' }, ex.name), el('div', { class: 'ex-meta' }, meta)),
          s.node),
        el('div', { class: 'quick' },
          [5, 10, 25].map((n) => el('button', { class: 'chip-add', 'aria-label': `Add ${n} ${ex.name}`, onclick: () => s.bump(n) }, '+' + n))));
    }));
  }

  function renderTodaySummary() {
    const s = streaks(state.entries, state.freezes);
    const today = todayKey();

    $('#streak-current').textContent = plural(s.current, 'day');
    $('#streak-longest').textContent = plural(s.longest, 'day');
    const frac = s.longest ? Math.min(1, s.current / s.longest) : 0;
    const ring = (id, f) => {
      const c = $(id);
      c.style.strokeDasharray = RING_C;
      c.style.strokeDashoffset = RING_C * (1 - f);
      c.style.opacity = f > 0 ? 1 : 0;
    };
    ring('#ring-current', frac);
    ring('#ring-longest', s.longest ? 1 : 0);

    const used = freezeInWeek(today);
    $('#freeze-status').textContent = (used
      ? `This week's streak freeze is used (${formatDate(used.date)})`
      : '1 streak freeze available this week') + bonusText() + '.';

    const notice = $('#today-notice');
    const freezeBtn = $('#notice-freeze');
    const fz = freezeFor(today);
    notice.classList.toggle('frozen', !!fz && !s.loggedToday);
    freezeBtn.hidden = true;
    if (s.loggedToday) {
      notice.hidden = true;
    } else if (fz) {
      notice.hidden = false;
      $('#notice-icon').innerHTML = ICONS.flake;
      $('#notice-title').textContent = 'Today is frozen';
      $('#notice-body').textContent = fz.reason;
    } else if (state.settings.reminderEnabled) {
      notice.hidden = false;
      $('#notice-icon').innerHTML = ICONS.bell;
      $('#notice-title').textContent = 'You haven\'t logged today';
      $('#notice-body').textContent = s.current > 0
        ? `Log a set to keep your ${s.current}-day streak going.`
        : 'Log a set to start a streak.';
      freezeBtn.hidden = !(s.current > 0 && canFreeze(today));
    } else {
      notice.hidden = true;
    }
    return s;
  }

  /* ================= HISTORY ================= */

  function renderHistory() {
    renderCalendar();
    renderDayCard();
  }

  function shiftCalMonth(n) {
    const d = fromKey(state.calMonth);
    d.setMonth(d.getMonth() + n);
    const next = toKey(d);
    if (next > todayKey()) return; // no browsing into future months
    state.calMonth = next;
    renderCalendar();
  }

  function renderCalendar() {
    const today = todayKey();
    const first = fromKey(state.calMonth);
    $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('#cal-next').disabled = state.calMonth === today.slice(0, 8) + '01';

    const withReps = new Set(dailyTotals(state.entries).keys());
    const frozen = new Set(state.freezes.map((f) => f.date));
    const lead = first.getDay(); // Sunday-first, as in the design
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el('span'));
    for (let day = 1; day <= daysInMonth; day++) {
      const key = addDays(state.calMonth, day - 1);
      const cls = ['cal-day'];
      if (key === today) cls.push('today');
      if (key === state.date) cls.push('selected');
      let mark = null;
      if (withReps.has(key)) mark = el('span', { class: 'mark dot' });
      else if (frozen.has(key)) mark = el('span', { class: 'mark flake' }, '❄︎');
      const label = fromKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
        (withReps.has(key) ? ', reps logged' : '') + (frozen.has(key) ? ', streak freeze' : '');
      cells.push(el('button', {
        class: cls.join(' '), disabled: key > today, 'aria-label': label,
        'aria-current': key === state.date ? 'date' : false,
        onclick: () => { state.date = key; renderHistory(); },
      }, String(day), mark));
    }
    $('#cal-grid').replaceChildren(...cells);
  }

  function renderDayCard() {
    renderDayHead();
    const rows = $('#day-rows');
    if (!state.exercises.length) {
      rows.replaceChildren(el('div', { class: 'empty-state' }, 'No exercises yet. Add one in Settings.'));
    } else {
      rows.replaceChildren(...state.exercises.map((ex) =>
        el('div', { class: 'day-row' }, el('span', { class: 'ex-label' }, ex.name), stepper(state.date, ex).node)));
    }
    renderDayFreeze();
  }

  function renderDayHead() {
    const date = state.date;
    const total = dayTotal(date);
    const fz = freezeFor(date);
    $('#day-title').textContent = formatDate(date, { long: true });
    $('#day-sub').textContent = `${total ? plural(total, 'rep') : 'No reps yet'} · changes save automatically`;
    const pill = $('#day-pill');
    pill.className = 'pill' + (total ? ' logged' : fz ? ' frozen' : '');
    pill.textContent = total ? 'Logged' : fz ? 'Frozen' : 'Not logged';
  }

  /* ================= streak freezes ================= */

  function freezeFor(date) {
    return state.freezes.find((f) => f.date === date);
  }

  function freezeInWeek(date) {
    const wk = weekStart(date);
    return state.freezes.find((f) => weekStart(f.date) === wk);
  }

  /** A freeze is available for `date` if its week's is unused, or a bonus freeze is in hand. */
  const canFreeze = (date) => !freezeInWeek(date) || state.bonusFreezes > 0;
  const bonusText = () => (state.bonusFreezes ? ` + ${plural(state.bonusFreezes, 'bonus freeze')}` : '');

  function weekLabel(date) {
    const start = weekStart(date);
    const o = { month: 'short', day: 'numeric' };
    return `${fromKey(start).toLocaleDateString(undefined, o)}–${fromKey(addDays(start, 6)).toLocaleDateString(undefined, o)}`;
  }

  function renderDayFreeze() {
    const box = $('#day-freeze');
    const date = state.date;
    const f = freezeFor(date);
    if (f) {
      const added = new Date(f.createdAt);
      box.replaceChildren(el('div', { class: 'freeze-card' },
        el('div', { class: 'freeze-card-h' }, '❄︎ Streak freeze'),
        el('p', { class: 'freeze-reason' }, f.reason),
        el('div', { class: 'freeze-meta' },
          `Added ${added.toLocaleDateString()} ${added.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · permanent`)));
      return;
    }
    if (dayTotal(date) > 0 || !state.exercises.length) { box.replaceChildren(); return; }
    const used = freezeInWeek(date);
    if (!canFreeze(date)) {
      box.replaceChildren(el('p', { class: 'freeze-note' },
        `The streak freeze for ${weekLabel(date)} was used on ${formatDate(used.date)}. Earn gems in Learn to buy a bonus freeze.`));
      return;
    }
    box.replaceChildren(el('button', { class: 'freeze-action', onclick: () => useFreeze(date) },
      used ? '❄︎ Use a bonus freeze for this day' : '❄︎ Use a streak freeze for this day'));
  }

  async function useFreeze(date) {
    const res = await ask({
      title: `Freeze ${formatDate(date)}?`,
      body: `This keeps your streak alive across this day and uses ${freezeInWeek(date) ? `one of your bonus freezes (you have ${state.bonusFreezes})` : `your one freeze for ${weekLabel(date)}`}. ` +
        'Write down why. The freeze and its reason are permanent and can\'t be edited or removed.',
      input: { placeholder: 'Reason (e.g. sick, travelling, sore shoulder)', minLength: 3, maxLength: 280 },
      actions: [{ label: 'Use freeze permanently', value: 'freeze' }],
    });
    if (!res) return;
    try {
      await flushSaves();
      const f = await DB.addFreeze(date, res.text);
      state.freezes.push(f);
      if (f.bonus) state.bonusFreezes--;
      renderView();
      toast('Streak freeze saved');
    } catch (err) {
      await ask({ title: 'Couldn\'t add freeze', body: err.message, actions: [] });
    }
  }

  function renderFreezeList() {
    const list = $('#freeze-list');
    if (!state.freezes.length) {
      list.replaceChildren(el('div', { class: 'freeze-row empty' }, 'No freezes used yet.'));
      return;
    }
    list.replaceChildren(...[...state.freezes].reverse().map((f) => el('div', { class: 'freeze-row' },
      el('span', { class: 'fr-date' }, formatDate(f.date, { long: true })),
      el('span', { class: 'fr-reason' }, f.reason))));
  }

  /* ================= PROGRESS ================= */

  function lineStyleFor(exId) {
    const i = Math.max(0, state.exercises.findIndex((e) => e.id === exId));
    const n = SERIES_DASH.length;
    return {
      color: `--series-${(i % n) + 1}`,
      dash: DASHES[(SERIES_DASH[i % n] + Math.floor(i / n)) % DASHES.length],
      width: 2.5,
    };
  }

  function swatch(style, on) {
    const color = on ? `var(${style.color})` : 'var(--text-3)';
    return el('span', {
      'aria-hidden': 'true',
      html: `<svg viewBox="0 0 26 8"><line x1="2" y1="4" x2="24" y2="4" stroke="${color}" stroke-width="3" stroke-linecap="${style.dash.length ? 'butt' : 'round'}" stroke-dasharray="${style.dash.join(' ')}"/></svg>`,
    });
  }

  function rangeKeys() {
    const today = todayKey();
    const start = addDays(today, -(Number(state.chartRange) - 1));
    const keys = [];
    for (let d = start; d <= today; d = addDays(d, 1)) keys.push(d);
    return keys;
  }

  function renderProgress() {
    $('#chart-exercises').replaceChildren(...state.exercises.map((ex) => {
      const on = state.chartSelected.has(ex.id);
      return el('button', {
        class: 'legend-chip' + (on ? ' on' : ''), 'aria-pressed': on,
        onclick: () => {
          if (state.chartSelected.has(ex.id)) state.chartSelected.delete(ex.id);
          else state.chartSelected.add(ex.id);
          renderProgress();
        },
      }, swatch(lineStyleFor(ex.id), on), ex.name);
    }));
    document.querySelectorAll('#chart-range button').forEach((b) =>
      b.classList.toggle('active', b.dataset.range === state.chartRange));
    renderChart();
    renderStats();
  }

  function renderChart() {
    const keys = rangeKeys();
    const selected = state.exercises.filter((e) => state.chartSelected.has(e.id));
    const byKey = new Map(state.entries.map((e) => [e.date + '|' + e.exerciseId, e.reps]));
    const labels = keys.map((k) => fromKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

    let anyData = false;
    const datasets = selected.map((ex) => {
      const st = lineStyleFor(ex.id);
      const color = cssVar(st.color);
      const data = keys.map((k) => byKey.get(k + '|' + ex.id) ?? null);
      let last = -1;
      data.forEach((v, i) => { if (v != null) last = i; });
      if (last >= 0) anyData = true;
      return {
        label: ex.name, data, borderColor: color, pointBackgroundColor: color, pointBorderColor: color,
        borderWidth: st.width, borderDash: st.dash, tension: 0, spanGaps: true,
        pointRadius: data.map((_, i) => (i === last ? 4 : 0)), pointHoverRadius: 5, pointHitRadius: 10,
      };
    });

    const empty = $('#chart-empty');
    empty.hidden = anyData;
    empty.textContent = selected.length ? 'No reps logged in this range yet.' : 'Tap an exercise above to show its line.';

    if (typeof window.Chart === 'undefined') {
      empty.hidden = false;
      empty.textContent = 'Chart library failed to load.';
      return;
    }

    const muted = cssVar('--text-2');
    const grid = cssVar('--separator');
    const options = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 6 } },
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
        x: { display: false },
        y: {
          beginAtZero: true, border: { display: false },
          grid: { color: grid, drawTicks: false },
          ticks: { color: muted, precision: 0, maxTicksLimit: 4, padding: 8, font: { size: 13 } },
        },
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
    const primary = state.exercises.find((e) => state.chartSelected.has(e.id));
    $('#stats-block').hidden = !primary;
    if (!primary) return;
    const keys = rangeKeys();
    const rangeLabel = state.chartRange === '365' ? 'last year' : `last ${state.chartRange} days`;
    $('#stats-title').textContent = `${primary.name} · ${rangeLabel}`;

    const values = keys.map((k) => repsFor(k, primary.id));
    const logged = values.filter((v) => v > 0);
    const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const mid = Math.floor(values.length / 2);
    const firstHalf = mean(values.slice(0, mid).filter((v) => v > 0));
    const secondHalf = mean(values.slice(mid).filter((v) => v > 0));

    $('#stat-best').textContent = logged.length ? fmt(Math.max(...logged)) : '–';
    $('#stat-avg').textContent = logged.length ? fmt(mean(logged)) : '–';
    const change = $('#stat-change');
    if (firstHalf > 0 && secondHalf > 0) {
      const pct = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
      change.textContent = (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct) + '%';
      change.classList.toggle('accent', pct >= 0);
    } else {
      change.textContent = '–';
      change.classList.remove('accent');
    }
  }

  /* ================= LEARN (lessons) ================= */

  const areaLabels = (areas) => areas.map((a) => L.AREA_LABEL[a]);

  function areasSummary() {
    const n = state.lessonAreas.length;
    return n === L.AREAS.length ? 'All' : n === 1 ? L.AREA_LABEL[state.lessonAreas[0]] : n + ' areas';
  }

  /** What lesson picking adapts to: the last 4 weeks of logged reps. */
  function lessonContext() {
    const since = addDays(todayKey(), -27);
    return {
      level: L.userLevel(state.entries, since, state.lessonAdjust),
      trained: L.areasTrained(state.allExercises, state.entries, since),
    };
  }

  const unitWord = (ex, n) => (ex.unit === 'sec' ? n + ' sec' : plural(n, 'rep')) + (ex.note ? ' ' + ex.note : '');
  const chips = (areas) => el('div', { class: 'area-chips static' }, areaLabels(areas).map((a) => el('span', { class: 'area-chip on' }, a)));

  /* Finishing a lesson starts a gem boost: a lesson started in the next 20 minutes earns 1.5×. */
  const boostLeft = () => Math.max(0, state.gemBoostUntil - Date.now());
  const gemsFor = (boosted) => (boosted ? Math.ceil(GEM_REWARD * BOOST) : GEM_REWARD); // 7.5 rounds up to 8
  let boostTimer = null;

  function renderBoost() {
    clearTimeout(boostTimer);
    const left = boostLeft();
    $('#learn-boost').hidden = !left;
    if (!left) return;
    $('#learn-boost-title').textContent = `${BOOST}× gem boost`;
    $('#learn-boost-body').textContent =
      `Start a lesson within ${plural(Math.ceil(left / 60000), 'minute')} to earn ${gemsFor(true)} gems instead of ${GEM_REWARD}.`;
    // Redraw when the minute count drops, and hide once the boost runs out.
    boostTimer = setTimeout(() => { if (state.view === 'learn') renderBoost(); }, (left % 60000 || 60000) + 50);
  }

  function renderLearn() {
    const ctx = lessonContext();
    const ex = L.pickLesson({
      areas: state.lessonAreas, level: ctx.level, done: state.lessonsDone, skip: state.lessonSkip,
      owned: state.exercises.map((e) => e.name), trained: ctx.trained,
    });
    const box = $('#learn-next');
    if (!ex) {
      const skipped = state.lessonSkip.size > 0;
      box.replaceChildren(el('div', { class: 'lesson-card' },
        el('div', { class: 'lc-name' }, skipped ? 'That’s all of them' : 'Nothing new here yet'),
        el('p', { class: 'lc-why' }, skipped
          ? 'You’ve skipped every lesson for these areas.'
          : 'No lessons left for these areas at your level. Pick more areas, or keep logging reps to unlock harder ones.'),
        skipped
          ? el('button', { class: 'btn-primary block', onclick: () => { state.lessonSkip.clear(); renderLearn(); } }, 'Start over')
          : el('button', { class: 'btn-primary block', onclick: () => openAreas('learn') }, 'Pick areas')));
    } else {
      box.replaceChildren(el('div', { class: 'lesson-card' },
        el('div', { class: 'lc-eyebrow' }, 'Next lesson · ' + L.LEVELS[ex.level - 1]),
        el('div', { class: 'lc-name' }, ex.name),
        chips(ex.areas),
        el('p', { class: 'lc-why' }, L.why(ex, ctx.trained, ctx.level)),
        el('div', { class: 'lc-meta' }, `About 5 min · 3 sets of ${unitWord(ex, L.target(ex, ctx.level))}`),
        el('button', { class: 'btn-primary block', onclick: () => startLesson(ex, ctx) }, 'Start lesson'),
        el('button', { class: 'text-btn lc-skip', onclick: () => { state.lessonSkip.add(ex.id); renderLearn(); } }, 'Show me a different one')));
    }

    $('#learn-gems').replaceChildren(el('span', { html: ICONS.gem }), String(state.gems));
    $('#learn-gems').setAttribute('aria-label', plural(state.gems, 'gem'));
    renderBoost();
    const short = FREEZE_COST - state.gems;
    $('#learn-shop').replaceChildren(el('div', { class: 'shop-card' },
      el('span', { class: 'shop-icon', 'aria-hidden': 'true', html: ICONS.flake }),
      el('span', { class: 'row-main' },
        el('span', { class: 'row-title' }, 'Bonus streak freeze'),
        el('span', { class: 'row-sub' }, short > 0
          ? `${FREEZE_COST} gems · ${short} to go (${plural(Math.ceil(short / GEM_REWARD), 'more lesson')})`
          : `${FREEZE_COST} gems · covers an extra day in any week`),
        state.bonusFreezes ? el('span', { class: 'row-sub' }, `You have ${plural(state.bonusFreezes, 'bonus freeze')}`) : null),
      el('button', { class: 'btn-primary shop-buy', disabled: short > 0, onclick: buyFreeze }, 'Buy')));

    $('#learn-area-list').replaceChildren(...chips(state.lessonAreas).children);
    const done = state.lessonsDone.slice().reverse();
    $('#learn-done-count').textContent = done.length ? plural(done.length, 'lesson') : '';
    $('#learn-done').replaceChildren(...(done.length
      ? done.slice(0, 20).map((d) => el('div', { class: 'row' },
        el('span', { class: 'row-main' },
          el('span', { class: 'row-title' }, d.name),
          el('span', { class: 'row-sub' }, `${formatDate(d.date)} · ${fmt(d.total)} ${d.unit === 'sec' ? 'sec' : 'reps'}`))))
      : [el('div', { class: 'row' }, el('span', { class: 'row-sub' }, 'Finish a lesson and it shows up here.'))]));
  }

  async function buyFreeze() {
    const c = await ask({
      title: 'Buy a bonus streak freeze?',
      body: `Costs ${FREEZE_COST} gems. Use it from History on any missed day — even in a week where you already used your freeze.`,
      actions: [{ label: `Buy for ${FREEZE_COST} gems`, value: 'buy' }],
    });
    if (c !== 'buy') return;
    try {
      Object.assign(state, await DB.buyFreeze(FREEZE_COST));
      renderLearn();
      toast('Bonus streak freeze added');
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------- Focus areas (body map) ---------- */

  function openAreas(from) {
    const back = $('#areas-back');
    back.dataset.back = from;
    back.querySelector('span').textContent = from === 'learn' ? 'Learn' : 'Settings';
    showView('areas');
  }

  function renderAreas() {
    const on = new Set(state.lessonAreas);
    document.querySelectorAll('#body-map [data-area]').forEach((z) => z.classList.toggle('on', on.has(z.dataset.area)));
    $('#area-chips').replaceChildren(...L.AREAS.map(([a, label]) => el('button', {
      class: 'area-chip' + (on.has(a) ? ' on' : ''), 'aria-pressed': String(on.has(a)), onclick: () => toggleArea(a),
    }, label)));
  }

  async function toggleArea(area) {
    const on = state.lessonAreas.includes(area);
    if (on && state.lessonAreas.length === 1) { toast('Keep at least one area'); return; }
    state.lessonAreas = on ? state.lessonAreas.filter((a) => a !== area) : [...state.lessonAreas, area];
    state.lessonSkip.clear();
    renderAreas();
    try { await DB.setMeta('lessonAreas', state.lessonAreas); } catch (err) { toast('Could not save — ' + err.message); }
  }

  /* ---------- Lesson runner ---------- */

  let lessonTimer = null;
  const clock = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(200); } catch (_) { /* unsupported */ } };
  const logName = (ex) => ex.name + (ex.unit === 'sec' ? ' (sec)' : '');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * Count down `sec` seconds by the wall clock, so a hold or rest keeps the right time even when
   * iOS pauses the page (screen lock, app switch). Calls onTick(secondsLeft) as it changes, then onDone().
   */
  function countdown(sec, onTick, onDone) {
    const end = Date.now() + sec * 1000;
    let shown = sec;
    clearInterval(lessonTimer);
    lessonTimer = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (left !== shown) { shown = left; onTick(left); }
      if (!left) { clearInterval(lessonTimer); onDone(); }
    }, 250);
  }

  /* Keep the screen on during a lesson so auto-lock doesn't hide a timer. The browser drops the
     lock whenever the app is hidden; keepAwake() takes it again when the app is back. */
  let wakeLock = null;
  async function keepAwake() {
    if (!state.lesson || wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!state.lesson || wakeLock) { lock.release().catch(() => {}); return; } // lesson closed while waiting
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch (_) { /* unsupported (e.g. Home Screen apps before iOS 18.4): the timers still keep time */ }
  }

  function letSleep() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  /** The looping form animation for an exercise (paused if the user prefers reduced motion). */
  function figure(ex, caption) {
    const box = el('figure', { class: 'ls-figure', html: FIG.svg(ex.id, `${ex.name}: correct form`) });
    const svg = box.querySelector('svg');
    if (svg && reduceMotion.matches) svg.pauseAnimations();
    if (caption) box.append(el('figcaption', {}, caption));
    return box;
  }

  const videoLink = (ex) => el('a', {
    class: 'ls-video', target: '_blank', rel: 'noopener',
    href: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`how to do ${ex.name} proper form`),
    html: ICONS.play,
  }, 'Watch how on YouTube');

  function startLesson(ex, ctx) {
    state.lesson = {
      ex, level: ctx.level, why: L.why(ex, ctx.trained, ctx.level), steps: L.buildLesson(ex, ctx.level),
      i: 0, done: [], right: 0, asked: 0, feel: null, log: true,
      boosted: boostLeft() > 0, // started during a boost: keeps it even if the boost ends mid-lesson
    };
    $('#lesson').hidden = false;
    document.documentElement.classList.add('lesson-open');
    renderLessonStep();
    keepAwake();
  }

  function closeLesson() {
    clearInterval(lessonTimer);
    letSleep();
    state.lesson = null;
    $('#lesson').hidden = true;
    document.documentElement.classList.remove('lesson-open');
  }

  async function quitLesson() {
    const l = state.lesson;
    if (!l) return;
    if (l.i > 0) {
      const c = await ask({ title: 'Quit this lesson?', body: 'You’ll lose your progress in it.', actions: [{ label: 'Quit', value: 'quit', cls: 'danger' }] });
      if (c !== 'quit') return;
    }
    closeLesson();
  }

  function nextStep() {
    state.lesson.i++;
    renderLessonStep();
  }

  function lessonButton(label, onclick, { disabled = false, cls = '' } = {}) {
    const b = el('button', { class: ('btn-primary block ' + cls).trim(), onclick }, label);
    b.disabled = disabled;
    $('#lesson-foot').replaceChildren(b);
    return b;
  }

  function renderLessonStep() {
    clearInterval(lessonTimer);
    const l = state.lesson;
    const { ex } = l;
    const step = l.steps[l.i];
    const body = $('#lesson-body');
    const head = (eyebrow, title, cls = '') => [el('div', { class: 'ls-eyebrow' }, eyebrow), el('h2', { class: ('ls-title ' + cls).trim() }, title)];
    const text = (t, cls = '') => el('p', { class: ('ls-text ' + cls).trim() }, t);
    $('#lesson').className = 'lesson';
    $('#lesson-bar').style.width = (l.i / (l.steps.length - 1)) * 100 + '%';
    body.scrollTop = 0;

    if (step.type === 'intro') {
      body.replaceChildren(...head('New exercise', ex.name), figure(ex), videoLink(ex), chips(ex.areas), text(l.why),
        text(`You’ll learn the form, answer two quick questions, and do 3 sets of ${unitWord(ex, L.target(ex, l.level))}.`, 'muted'));
      lessonButton('Let’s go', nextStep);
    } else if (step.type === 'learn') {
      body.replaceChildren(...head('How to do it', ex.name),
        el('ol', { class: 'ls-steps' }, ex.steps.map((s) => el('li', {}, s))),
        el('div', { class: 'ls-tip' }, el('strong', {}, 'Watch out: '), ex.tip),
        videoLink(ex));
      lessonButton('Got it', nextStep);
    } else if (step.type === 'quiz') {
      let picked = null;
      const opts = step.options.map((o, i) => el('button', {
        class: 'ls-option', onclick: () => {
          picked = i;
          opts.forEach((b, j) => b.classList.toggle('picked', j === i));
          check.disabled = false;
        },
      }, o));
      body.replaceChildren(...head('Quick check', step.q, 'small'), el('div', { class: 'ls-options' }, opts));
      const check = lessonButton('Check', () => {
        const right = picked === step.answer;
        l.asked++;
        if (right) l.right++;
        else l.steps.splice(l.steps.length - 1, 0, step); // Duolingo-style: a missed question comes back before the end
        opts.forEach((b, j) => {
          b.disabled = true;
          b.classList.toggle('right', j === step.answer);
          b.classList.toggle('wrong', j === picked && !right);
        });
        $('#lesson').className = 'lesson ' + (right ? 'is-right' : 'is-wrong');
        if (!right) body.append(figure(ex, 'This is how it should look'));
        $('#lesson-foot').replaceChildren(
          el('div', { class: 'ls-verdict', role: 'status' }, right ? 'Nice!' : `Not quite — it’s “${step.options[step.answer]}”. You’ll get this one again.`),
          el('button', { class: 'btn-primary block', onclick: nextStep }, 'Continue'));
      }, { disabled: true });
    } else if (step.type === 'set' && ex.unit === 'sec') {
      let left = step.target;
      const big = el('div', { class: 'ls-big', role: 'timer' }, clock(left));
      body.replaceChildren(...head(`Set ${step.n} of ${step.of}`, ex.name), big,
        text(`Hold for ${unitWord(ex, step.target)}. ${ex.tip}`, 'muted center'));
      const finish = () => {
        clearInterval(lessonTimer);
        l.done.push(step.target - left);
        buzz();
        big.textContent = 'Done!';
        lessonButton('Continue', nextStep);
      };
      lessonButton('Start timer', () => {
        lessonButton('Stop early', finish, { cls: 'secondary' });
        countdown(step.target, (s) => { left = s; big.textContent = clock(s); }, finish);
      });
    } else if (step.type === 'set') {
      let n = step.target;
      const count = el('div', { class: 'ls-big' }, String(n));
      const adj = (d) => { n = Math.max(0, n + d); count.textContent = n; };
      body.replaceChildren(...head(`Set ${step.n} of ${step.of}`, ex.name),
        text(`Do ${unitWord(ex, step.target)}, then tap Done. Did more or fewer? Adjust the number.`, 'muted center'),
        el('div', { class: 'ls-counter' },
          el('button', { class: 'step-btn minus', 'aria-label': 'Fewer', html: ICONS.minus, onclick: () => adj(-1) }),
          count,
          el('button', { class: 'step-btn plus', 'aria-label': 'More', html: ICONS.plus, onclick: () => adj(1) })));
      lessonButton('Done', () => { l.done.push(n); nextStep(); });
    } else if (step.type === 'rest') {
      const big = el('div', { class: 'ls-big', role: 'timer' }, clock(step.sec));
      body.replaceChildren(...head('Rest', 'Catch your breath'), big, text(`Up next: set ${step.next} of 3`, 'muted center'));
      countdown(step.sec, (s) => { big.textContent = clock(s); }, () => { buzz(); nextStep(); });
      lessonButton('Skip rest', nextStep, { cls: 'secondary' });
    } else if (step.type === 'finish') {
      const total = l.done.reduce((a, b) => a + b, 0);
      const stat = (label, value) => el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value));
      const seg = el('div', { class: 'segmented ls-feel', role: 'group', 'aria-label': 'How did it feel?' },
        [['hard', 'Too hard'], ['right', 'Just right'], ['easy', 'Too easy']].map(([v, label]) => el('button', {
          onclick: (e) => {
            l.feel = v;
            seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
            btn.disabled = false;
          },
        }, label)));
      body.replaceChildren(...head('Lesson complete', ex.name + ' ✓'),
        el('div', { class: 'gem-reward', role: 'status' }, el('span', { html: ICONS.gem }), `+${gemsFor(l.boosted)} gems`,
          l.boosted ? el('span', { class: 'boost-tag' }, `${BOOST}× boost`) : null),
        el('div', { class: 'stat-row' },
          stat(ex.unit === 'sec' ? 'Seconds' : 'Reps', fmt(total)), stat('Sets', String(l.done.length)), stat('Quiz', `${l.right}/${l.asked}`)),
        el('h3', { class: 'ls-sub' }, 'How did that feel?'), seg,
        text('Your next lessons get harder or easier based on this.', 'muted'),
        el('label', { class: 'row ls-log' },
          el('span', { class: 'row-main' },
            el('span', { class: 'row-title' }, `Log ${fmt(total)} ${ex.unit === 'sec' ? 'seconds' : 'reps'} for today`),
            el('span', { class: 'row-sub' }, `Adds “${logName(ex)}” to your Today list`)),
          el('input', { type: 'checkbox', class: 'switch', checked: true, onchange: (e) => { l.log = e.target.checked; } })));
      const btn = lessonButton('Finish', () => finishLesson(total).catch((err) => toast('Could not save — ' + err.message)), { disabled: true });
    }
  }

  async function finishLesson(total) {
    const l = state.lesson;
    const { ex } = l;
    const today = todayKey();
    const logged = l.log && total > 0;
    const reward = gemsFor(l.boosted);
    state.lessonsDone.push({ id: ex.id, name: ex.name, date: today, total, unit: ex.unit, feel: l.feel });
    state.lessonAdjust = Math.max(-2, Math.min(2, state.lessonAdjust + ({ easy: 1, hard: -1 }[l.feel] || 0)));
    state.gems += reward;
    state.gemBoostUntil = Date.now() + BOOST_MS; // every finished lesson (re)starts the boost
    await DB.setMeta('gems', state.gems);
    await DB.setMeta('gemBoostUntil', state.gemBoostUntil);
    await DB.setMeta('lessonsDone', state.lessonsDone);
    await DB.setMeta('lessonAdjust', state.lessonAdjust);
    if (logged) {
      const name = logName(ex).toLowerCase();
      let target = state.allExercises.find((e) => e.name.toLowerCase() === name);
      if (!target) target = await DB.addExercise(logName(ex));
      else if (target.archived) await DB.putExercise({ ...target, archived: false });
      await flushSaves();
      await DB.setReps(today, target.id, repsFor(today, target.id) + total);
    }
    closeLesson();
    await refreshAll();
    toast(`+${reward} gems` + (logged ? ` — ${ex.name} logged on Today` : ''));
  }


  /* ================= SETTINGS ================= */

  function renderSettings() {
    $('#exercise-count').textContent = state.exercises.length;
    $('#areas-count').textContent = areasSummary();
    $('#reminder-enabled').checked = state.settings.reminderEnabled;
    $('#reminder-time').value = state.settings.reminderTime;
    renderFreezeList();
    renderThemeSeg();
    renderPushStatus();
    renderBackupStatus();
    $('#app-version').textContent = 'RepTracker v' + (CONFIG.version || 'dev') + ' · all data stays on this device';
  }

  /* ---------- Exercises sub-screen ---------- */

  function renderExerciseEditor() {
    const list = $('#ex-edit-list');
    const rows = state.exercises.map((ex) => {
      const input = el('input', { type: 'text', value: ex.name, maxlength: '60', 'aria-label': 'Rename ' + ex.name });
      input.addEventListener('change', async () => {
        const name = input.value.trim();
        if (!name) { input.value = ex.name; return; }
        ex.name = name;
        await DB.putExercise(ex);
        toast('Renamed to ' + name);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      return el('div', { class: 'ex-edit-row' }, input,
        el('button', { class: 'remove-btn', 'aria-label': 'Remove ' + ex.name, onclick: () => removeExercise(ex) }, el('span')));
    });
    if (!rows.length) rows.push(el('div', { class: 'ex-edit-row' }, el('span', { class: 'hidden-name' }, 'No exercises. Add one below.')));
    list.replaceChildren(...rows);

    const hidden = state.allExercises.filter((e) => e.archived);
    $('#hidden-exercises').replaceChildren(...(hidden.length ? [
      el('h2', { class: 'group-label' }, 'Hidden'),
      el('div', { class: 'group' }, hidden.map((ex) => el('div', { class: 'ex-edit-row' },
        el('span', { class: 'hidden-name' }, ex.name),
        el('button', { class: 'restore-btn', onclick: async () => {
          ex.archived = false;
          await DB.putExercise(ex);
          await refreshAll();
          toast(ex.name + ' restored');
        } }, 'Restore')))),
    ] : []));
  }

  async function removeExercise(ex) {
    const count = state.entries.filter((e) => e.exerciseId === ex.id).length;
    const choice = await ask({
      title: `Remove ${ex.name}?`,
      body: count
        ? `It has ${plural(count, 'logged day')}. Hiding keeps that history (and your streak), and you can restore it later.`
        : 'It has no logged history.',
      actions: count
        ? [{ label: 'Hide, keep history', value: 'hide' }, { label: 'Delete with history', value: 'delete', cls: 'danger' }]
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
    renderView();
  }

  /* ---------- Appearance ---------- */

  function currentThemeChoice() {
    try { return localStorage.getItem('rt-theme') || 'system'; } catch (_) { return 'system'; }
  }

  function applyTheme(choice) {
    const root = document.documentElement;
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
    const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const forDark = (m.getAttribute('media') || '').includes('dark');
      m.content = choice === 'system' ? (forDark ? '#000000' : '#ffffff') : (dark ? '#000000' : '#ffffff');
    });
    // iOS reads this when the app launches, so a change shows fully after reopening.
    const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) bar.content = dark ? 'black' : 'default';
    // Chart colors come from CSS variables; redraw with the new ones.
    if (chart) { chart.destroy(); chart = null; }
    if (state.view === 'progress') renderChart();
  }

  function setTheme(choice) {
    try {
      if (choice === 'system') localStorage.removeItem('rt-theme');
      else localStorage.setItem('rt-theme', choice);
    } catch (_) { /* private mode: still applies for this session */ }
    applyTheme(choice);
    renderThemeSeg(choice);
  }

  function renderThemeSeg(choice = currentThemeChoice()) {
    document.querySelectorAll('#theme-seg button').forEach((b) =>
      b.classList.toggle('active', b.dataset.themeChoice === choice));
  }

  /* ---------- Backup ---------- */

  async function renderBackupStatus() {
    const last = await DB.getMeta('lastBackup', null);
    const when = last
      ? 'Last exported ' + new Date(last).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + '.'
      : 'Not exported yet.';
    $('#backup-status').textContent = when + ' Safari can clear site data after long inactivity, so export now and then.';
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
      body: `This file has ${plural(data.exercises.length, 'exercise')} and ${plural(days, 'logged day')}` +
        (data.exportedAt ? `, exported ${new Date(data.exportedAt).toLocaleDateString()}` : '') +
        '. Merge adds it to what\'s here (the file wins on conflicts). Replace wipes this device\'s reps first.' +
        ' Streak freezes are permanent either way.',
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
    if (!ready) return;
    if (state.view === 'today') renderTodaySummary();
    const s = streaks(state.entries, state.freezes);
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
        ? `You haven't logged any reps today. Keep your ${s.current}-day streak going!`
        : 'You haven\'t logged any reps today.';
      const opts = { body, icon: 'icons/icon-192-v3.png', badge: 'icons/icon-192-v3.png', tag: 'daily-reminder' };
      if (reg && reg.showNotification) await reg.showNotification('RepTracker', opts);
      else new Notification('RepTracker', opts);
      await DB.setMeta('lastNotified', today);
    } catch (err) {
      console.warn('Notification failed', err);
    }
  }

  /* ================= Web Push (optional; sent by the GitHub Actions job) ================= */

  function urlB64ToUint8Array(b64str) {
    const padding = '='.repeat((4 - (b64str.length % 4)) % 4);
    const raw = atob((b64str + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch (_) { return 'America/New_York'; } };
  const setupStamp = () => `${state.settings.reminderTime}|${timeZone()}`;

  async function currentSubscription() {
    if (!pushSupported() || !CONFIG.vapidPublicKey) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function renderPushStatus() {
    const toggle = $('#push-enabled');
    const foot = $('#reminder-foot');
    const setup = $('#push-setup');
    if (CONFIG.repoUrl) $('#push-secrets-link').href = CONFIG.repoUrl + '/settings/secrets/actions';
    const base = 'Daily reminders need iOS 16.4 or later, RepTracker on your Home Screen, and notifications allowed.';

    if (!CONFIG.vapidPublicKey || !pushSupported()) {
      toggle.checked = false;
      toggle.disabled = true;
      setup.hidden = true;
      foot.textContent = base;
      return;
    }
    toggle.disabled = false;
    if (Notification.permission === 'denied') {
      foot.textContent = 'Notifications are blocked. Turn them on in iOS Settings › Notifications › RepTracker.';
    }
    const sub = await currentSubscription();
    toggle.checked = !!sub;
    setup.hidden = !sub;
    if (!sub) {
      if (Notification.permission !== 'denied') foot.textContent = base;
      return;
    }
    const copied = await DB.getMeta('pushCopied', null);
    const sub2 = $('#push-copy-sub');
    if (copied === setupStamp()) {
      sub2.textContent = 'Copied. It\'s in the PUSH_SUBSCRIPTIONS repo secret';
      sub2.classList.remove('accent');
    } else {
      sub2.textContent = copied ? 'Time changed: copy again and update the secret' : 'Paste it into the PUSH_SUBSCRIPTIONS repo secret';
      sub2.classList.toggle('accent', !!copied);
    }
    foot.textContent = 'Sent daily at the time above by the GitHub Actions job (it can arrive up to about 15 minutes late).';
  }

  async function subscribePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications weren\'t allowed. You can turn them on in iOS Settings › Notifications › RepTracker.');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(CONFIG.vapidPublicKey),
    });
    await DB.setMeta('pushSubscription', sub.toJSON());
  }

  async function onPushToggle(e) {
    const toggle = e.target;
    toggle.disabled = true;
    try {
      if (toggle.checked) {
        await subscribePush();
        toast('Now copy the setup code into GitHub');
      } else {
        const sub = await currentSubscription();
        if (sub) await sub.unsubscribe();
        await DB.setMeta('pushSubscription', null);
        await DB.setMeta('pushCopied', null);
        toast('Daily reminder turned off');
      }
    } catch (err) {
      await ask({ title: 'Couldn\'t turn on the daily reminder', body: err.message, actions: [] });
    } finally {
      toggle.disabled = false;
      renderPushStatus();
    }
  }

  async function copyPushSetup() {
    const sub = await currentSubscription();
    if (!sub) return;
    // The subscription plus when/where to send it. The GitHub job reads time + tz.
    const code = JSON.stringify({ ...sub.toJSON(), time: state.settings.reminderTime, tz: timeZone() });
    try {
      await navigator.clipboard.writeText(code);
    } catch (_) {
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = code;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    await DB.setMeta('pushCopied', setupStamp());
    toast('Setup code copied');
    renderPushStatus();
  }

  /* ================= service worker ================= */

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const promptUpdate = (worker) => {
        toast('A new version is ready', { label: 'Update', fn: () => worker.postMessage({ type: 'SKIP_WAITING' }) });
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
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  }

  /* ================= wiring ================= */

  function bindEvents() {
    // Navigation
    document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.back)));
    $('#today-cal').addEventListener('click', () => {
      state.date = todayKey();
      state.calMonth = state.date.slice(0, 8) + '01';
      showView('history');
    });
    $('#today-edit').addEventListener('click', () => showView('exercises'));
    $('#notice-freeze').addEventListener('click', () => useFreeze(todayKey()));
    $('#open-exercises').addEventListener('click', () => showView('exercises'));
    $('#open-areas').addEventListener('click', () => openAreas('settings'));
    $('#learn-areas').addEventListener('click', () => openAreas('learn'));
    $('#body-map').addEventListener('click', (e) => {
      const zone = e.target.closest('[data-area]');
      if (zone) toggleArea(zone.dataset.area);
    });
    $('#lesson-close').addEventListener('click', quitLesson);

    // History calendar (arrows + swipe)
    $('#cal-prev').addEventListener('click', () => shiftCalMonth(-1));
    $('#cal-next').addEventListener('click', () => shiftCalMonth(1));
    let cx = null;
    $('#cal-grid').addEventListener('touchstart', (e) => { cx = e.touches[0].clientX; }, { passive: true });
    $('#cal-grid').addEventListener('touchend', (e) => {
      if (cx == null) return;
      const dx = e.changedTouches[0].clientX - cx;
      cx = null;
      if (Math.abs(dx) > 60) shiftCalMonth(dx > 0 ? -1 : 1);
    }, { passive: true });

    // Progress
    document.querySelectorAll('#chart-range button').forEach((b) => b.addEventListener('click', () => {
      state.chartRange = b.dataset.range;
      renderProgress();
    }));

    // Exercises sub-screen
    const newEx = $('#new-exercise');
    newEx.addEventListener('input', () => { $('#add-exercise-btn').disabled = !newEx.value.trim(); });
    $('#add-exercise-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = newEx.value.trim();
      if (!name) return;
      await DB.addExercise(name);
      newEx.value = '';
      $('#add-exercise-btn').disabled = true;
      newEx.blur();
      await refreshAll();
      toast(name + ' added');
    });

    // Reminders
    $('#reminder-enabled').addEventListener('change', async (e) => {
      state.settings.reminderEnabled = e.target.checked;
      await DB.setMeta('reminderEnabled', e.target.checked);
      if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      checkReminder();
    });
    $('#reminder-time').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      state.settings.reminderTime = e.target.value;
      await DB.setMeta('reminderTime', e.target.value);
      await DB.setMeta('lastNotified', null);
      checkReminder();
      renderPushStatus();
    });
    $('#push-enabled').addEventListener('change', onPushToggle);
    $('#push-copy').addEventListener('click', copyPushSetup);

    // Appearance
    document.querySelectorAll('#theme-seg button').forEach((b) =>
      b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (currentThemeChoice() === 'system') applyTheme('system');
    });

    // Backup
    $('#export-btn').addEventListener('click', () => exportData().catch((err) => toast('Export failed: ' + err.message)));
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await importData(file);
    });

    // Save on background; handle a day rollover when coming back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushSaves().catch(console.error);
        return;
      }
      syncToday();
      checkReminder();
      keepAwake();
    });
    window.addEventListener('pagehide', () => { flushSaves().catch(() => {}); });
  }

  async function init() {
    applyTheme(currentThemeChoice());
    bindEvents();
    registerSW();
    try {
      await DB.ensureDefaults();
      await loadAll();
      // Earlier versions had a password lock; clear its stored data.
      DB.deleteMeta('auth').catch(() => {});
      DB.deleteMeta('authFails').catch(() => {});
    } catch (err) {
      console.error(err);
      $('#today-list').replaceChildren(el('div', { class: 'empty-state' },
        'Could not open storage: ' + err.message + '. Private Browsing can block it.'));
      return;
    }
    // Deep link from a notification: ?view=log (old) or ?view=today
    const param = new URLSearchParams(location.search).get('view');
    showView(param === 'log' ? 'today' : (param || 'today'));
    ready = true;
    syncToday();
    checkReminder();
    // Ask the browser not to evict our data (best effort; helps on some platforms).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  init();
})();
