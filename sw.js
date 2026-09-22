/* RepTracker service worker: offline app shell + push reminders.
 * Bump VERSION whenever any cached file changes so clients pick up the update.
 */
const VERSION = 'v1.4.0';
const CACHE = 'reptracker-' + VERSION;

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/config.js',
  'js/stats.js',
  'js/db.js',
  'js/app.js',
  'vendor/chart.umd.min.js',
  'icons/icon-192-v2.png',
  'icons/icon-512-v2.png',
  'icons/apple-touch-icon-v2.png',
  'icons/favicon-32.png',
];

importScripts('js/stats.js', 'js/db.js');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('reptracker-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Cache-first for the app shell (fully offline); network with cache fallback otherwise.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      // Any navigation (incl. ?view=… deep links) is served by the cached shell.
      return (await cache.match('index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

/* ---------- Web Push ---------- */

async function buildReminder(payload) {
  // iOS requires every push to show a notification, so we always show one —
  // but tailor it to whether today is already logged.
  let s = { current: 0, loggedToday: false, frozenToday: false };
  try {
    const [entries, freezes] = await Promise.all([self.RepDB.getAllEntries(), self.RepDB.getFreezes()]);
    s = self.RepStats.streaks(entries, freezes);
  } catch (err) { /* DB unavailable: fall back to generic text */ }

  const enabled = await self.RepDB.getMeta('reminderEnabled', true).catch(() => true);
  if (s.frozenToday && !s.loggedToday) {
    return { title: 'RepTracker', body: 'Today is covered by a streak freeze ❄️ — rest up.', silent: true };
  }
  if (s.loggedToday) {
    return {
      title: 'RepTracker',
      body: s.current > 1 ? `Nice — today is logged. ${s.current}-day streak 🔥` : 'Nice — today is logged ✓',
      silent: true,
    };
  }
  return {
    title: payload.title || 'Time to log your reps',
    body: s.current > 0
      ? `Don't break your ${s.current}-day streak — log today's reps.`
      : (payload.body || 'Nothing logged today yet. Knock out a set!'),
    silent: !enabled,
  };
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = { body: event.data && event.data.text() }; }

  event.waitUntil((async () => {
    const n = await buildReminder(payload);
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: 'icons/icon-192-v2.png',
      badge: 'icons/icon-192-v2.png',
      tag: 'daily-reminder',
      silent: n.silent,
      data: { url: './?view=log' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});
