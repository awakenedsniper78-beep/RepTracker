/* RepTracker data layer — IndexedDB wrapper.
 * Plain script (no modules) so it can be loaded by both the page and the
 * service worker (via importScripts). Exposes `self.RepDB`.
 *
 * Stores:
 *   exercises: { id, name, order, archived, createdAt }
 *   entries:   { id: "YYYY-MM-DD|exerciseId", date, exerciseId, reps }
 *   meta:      { key, value }
 */
(function (global) {
  'use strict';

  const DB_NAME = 'reptracker';
  const DB_VERSION = 1;
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
      const [exercises, entries, meta] = await Promise.all([
        getAll('exercises'), getAll('entries'), getAll('meta'),
      ]);
      const settings = {};
      meta.forEach((m) => {
        // Device-specific state doesn't belong in a backup.
        if (!['seeded', 'lastNotified', 'lastBackup', 'pushSubscription'].includes(m.key)) {
          settings[m.key] = m.value;
        }
      });
      return {
        app: 'RepTracker',
        format: 1,
        exportedAt: new Date().toISOString(),
        exercises,
        entries: entries.map(({ date, exerciseId, reps }) => ({ date, exerciseId, reps })),
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
      return data;
    },

    /**
     * Import a backup. mode "replace" wipes existing data first; mode "merge"
     * keeps existing data and lets the backup's values win on conflicts.
     */
    async importAll(data, mode) {
      RepDB.validateBackup(data);
      await tx(['exercises', 'entries', 'meta'], 'readwrite', (t) => {
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
          Object.entries(data.settings).forEach(([key, value]) => me.put({ key, value }));
        }
        me.put({ key: 'seeded', value: true });
      });
    },
  };

  global.RepDB = RepDB;
})(typeof self !== 'undefined' ? self : window);
