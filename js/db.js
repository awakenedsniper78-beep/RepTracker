/* RepTracker data layer — IndexedDB wrapper.
 * Plain script (no modules) so it can be loaded by both the page and the
 * service worker (via importScripts). Exposes `self.RepDB`.
 *
 * Stores:
 *   exercises: { id, name, order, archived, createdAt }
 *   entries:   { id: "YYYY-MM-DD|exerciseId", date, exerciseId, reps }
 *   meta:      { key, value }
 *   freezes:   { date, reason, createdAt }  — permanent: add-only, never edited or deleted
 */
(function (global) {
  'use strict';

  const DB_NAME = 'reptracker';
  const DB_VERSION = 2;
  const MAX_REASON = 280;
  // Meta keys that belong to this device only: never exported, never imported.
  // (Importing `auth` would let a crafted backup replace the app-lock password.)
  const DEVICE_KEYS = ['seeded', 'lastNotified', 'lastBackup', 'pushSubscription', 'auth', 'authFails'];
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('exercises')) {
          db.createObjectStore('exercises', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('exerciseId', 'exerciseId');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('freezes')) {
          db.createObjectStore('freezes', { keyPath: 'date' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // If another tab upgrades the DB, close so it isn't blocked.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab'));
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(storeNames, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeNames, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; }, (err) => {
        try { t.abort(); } catch (_) { /* already finished */ }
        reject(err);
      });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }

  const getAll = (store) => tx([store], 'readonly', (t) => reqToPromise(t.objectStore(store).getAll()));

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const RepDB = {
    open,
    uid,

    /** Close and permanently delete the whole database (used by "forgot password"). */
    async eraseEverything() {
      if (dbPromise) {
        try { (await dbPromise).close(); } catch (_) { /* ignore */ }
        dbPromise = null;
      }
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // other connections close via onversionchange
      });
    },

    /* ---------- exercises ---------- */
    async getExercises({ includeArchived = false } = {}) {
      const all = await getAll('exercises');
      return all
        .filter((e) => includeArchived || !e.archived)
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    },

    async putExercise(ex) {
      await tx(['exercises'], 'readwrite', (t) => { t.objectStore('exercises').put(ex); });
      return ex;
    },

    async addExercise(name) {
      const all = await getAll('exercises');
      const order = all.reduce((m, e) => Math.max(m, e.order), -1) + 1;
      return RepDB.putExercise({ id: uid(), name, order, archived: false, createdAt: Date.now() });
    },

    /** Permanently delete an exercise and all its entries. */
    async deleteExercise(id) {
      await tx(['exercises', 'entries'], 'readwrite', async (t) => {
        t.objectStore('exercises').delete(id);
        const idx = t.objectStore('entries').index('exerciseId');
        const keys = await reqToPromise(idx.getAllKeys(id));
        keys.forEach((k) => t.objectStore('entries').delete(k));
      });
    },

    async ensureDefaults() {
      const seeded = await RepDB.getMeta('seeded');
      if (seeded) return;
      const existing = await getAll('exercises');
      if (existing.length === 0) {
        const now = Date.now();
        await tx(['exercises'], 'readwrite', (t) => {
          const s = t.objectStore('exercises');
          s.put({ id: 'pushups', name: 'Push-ups', order: 0, archived: false, createdAt: now });
          s.put({ id: 'pullups', name: 'Pull-ups', order: 1, archived: false, createdAt: now + 1 });
        });
      }
      await RepDB.setMeta('seeded', true);
    },

    /* ---------- entries ---------- */
    async getEntriesForDate(date) {
      return tx(['entries'], 'readonly', (t) =>
        reqToPromise(t.objectStore('entries').index('date').getAll(date)));
    },

    async getAllEntries() {
      return getAll('entries');
    },

    /** Set the total reps for a date+exercise. reps <= 0 removes the entry. */
    async setReps(date, exerciseId, reps) {
      const id = date + '|' + exerciseId;
      reps = Math.max(0, Math.floor(Number(reps) || 0));
      await tx(['entries'], 'readwrite', (t) => {
        const s = t.objectStore('entries');
        if (reps > 0) s.put({ id, date, exerciseId, reps });
        else s.delete(id);
      });
      return reps;
    },

    /* ---------- streak freezes (permanent) ---------- */
    async getFreezes() {
      const all = await getAll('freezes');
      return all.sort((a, b) => (a.date < b.date ? -1 : 1));
    },

    /**
     * Add a streak freeze. Rules, enforced here so no UI path can skip them:
     *  - a written reason is required
     *  - at most one freeze per Monday–Sunday week (by the frozen date)
     *  - the day must not be in the future and must have no reps logged
     *  - freezes are permanent: there is deliberately no update/delete API
     */
    async addFreeze(date, reason) {
      const { weekStart, todayKey } = global.RepStats;
      reason = String(reason || '').trim().slice(0, MAX_REASON);
      if (reason.length < 3) throw new Error('Write a reason for the freeze (at least a few characters).');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayKey()) throw new Error('You can only freeze today or a past day.');
      const freeze = { date, reason, createdAt: Date.now() };
      await tx(['freezes', 'entries'], 'readwrite', async (t) => {
        const fs = t.objectStore('freezes');
        const [existing, entries] = await Promise.all([
          reqToPromise(fs.getAll()),
          reqToPromise(t.objectStore('entries').index('date').getAll(date)),
        ]);
        if (existing.some((f) => f.date === date)) throw new Error('That day is already frozen.');
        const wk = weekStart(date);
        const clash = existing.find((f) => weekStart(f.date) === wk);
        if (clash) throw new Error(`You already used this week's freeze (on ${clash.date}). Only one per week.`);
        if (entries.some((e) => e.reps > 0)) throw new Error('That day already has reps logged — no freeze needed.');
        fs.add(freeze); // add, never put: can't overwrite an existing freeze
      });
      return freeze;
    },

    /* ---------- meta / settings ---------- */
    async getMeta(key, fallback) {
      const row = await tx(['meta'], 'readonly', (t) => reqToPromise(t.objectStore('meta').get(key)));
      return row === undefined ? fallback : row.value;
    },

    async setMeta(key, value) {
      await tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ key, value }); });
    },

    /* ---------- backup ---------- */
    async exportAll() {
      const [exercises, entries, meta, freezes] = await Promise.all([
        getAll('exercises'), getAll('entries'), getAll('meta'), getAll('freezes'),
      ]);
      const settings = {};
      meta.forEach((m) => {
        // Device-specific state doesn't belong in a backup.
        if (!DEVICE_KEYS.includes(m.key)) {
          settings[m.key] = m.value;
        }
      });
      return {
        app: 'RepTracker',
        format: 1,
        exportedAt: new Date().toISOString(),
        exercises,
        entries: entries.map(({ date, exerciseId, reps }) => ({ date, exerciseId, reps })),
        freezes,
        settings,
      };
    },

    validateBackup(data) {
      if (!data || typeof data !== 'object') throw new Error('Not a JSON object');
      if (data.app !== 'RepTracker') throw new Error('This file is not a RepTracker backup');
      if (!Array.isArray(data.exercises) || !Array.isArray(data.entries)) {
        throw new Error('Backup is missing exercises or entries');
      }
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      data.exercises.forEach((e) => {
        if (!e || typeof e.id !== 'string' || typeof e.name !== 'string') {
          throw new Error('Backup contains an invalid exercise');
        }
      });
      data.entries.forEach((e) => {
        if (!e || !dateRe.test(e.date) || typeof e.exerciseId !== 'string' || !(Number(e.reps) >= 0)) {
          throw new Error('Backup contains an invalid entry');
        }
      });
      if (data.freezes !== undefined) {
        if (!Array.isArray(data.freezes)) throw new Error('Backup has invalid freezes');
        data.freezes.forEach((f) => {
          if (!f || !dateRe.test(f.date) || typeof f.reason !== 'string') {
            throw new Error('Backup contains an invalid streak freeze');
          }
        });
      }
      return data;
    },

    /**
     * Import a backup. mode "replace" wipes existing data first; mode "merge"
     * keeps existing data and lets the backup's values win on conflicts.
     * Streak freezes are permanent in both modes: existing ones are never
     * removed or overwritten; the backup can only add freezes for new days.
     */
    async importAll(data, mode) {
      RepDB.validateBackup(data);
      await tx(['exercises', 'entries', 'meta', 'freezes'], 'readwrite', async (t) => {
        const ex = t.objectStore('exercises');
        const en = t.objectStore('entries');
        const me = t.objectStore('meta');
        if (mode === 'replace') { ex.clear(); en.clear(); }
        data.exercises.forEach((e, i) => ex.put({
          id: e.id,
          name: String(e.name).slice(0, 60),
          order: Number.isFinite(e.order) ? e.order : i,
          archived: !!e.archived,
          createdAt: Number(e.createdAt) || Date.now(),
        }));
        data.entries.forEach((e) => {
          const reps = Math.floor(Number(e.reps));
          if (reps > 0) en.put({ id: e.date + '|' + e.exerciseId, date: e.date, exerciseId: e.exerciseId, reps });
        });
        if (data.settings && typeof data.settings === 'object') {
          Object.entries(data.settings)
            .filter(([key]) => !DEVICE_KEYS.includes(key))
            .forEach(([key, value]) => me.put({ key, value }));
        }
        me.put({ key: 'seeded', value: true });

        const fs = t.objectStore('freezes');
        const { weekStart } = global.RepStats;
        const weeks = new Set((await reqToPromise(fs.getAllKeys())).map((d) => weekStart(String(d))));
        (data.freezes || []).forEach((f) => {
          // Same one-per-week rule as addFreeze (also covers an existing freeze for that day).
          if (weeks.has(weekStart(f.date))) return;
          weeks.add(weekStart(f.date));
          fs.add({
            date: f.date,
            reason: String(f.reason).slice(0, MAX_REASON),
            createdAt: Number(f.createdAt) || Date.now(),
          });
        });
      });
    },
  };

  global.RepDB = RepDB;
})(typeof self !== 'undefined' ? self : window);
