# RepTracker

A tiny app for logging daily bodyweight reps (push-ups, pull-ups, and anything
else you add). It installs on Windows like any other program, and on iPhone
from the Home Screen. Pure HTML/CSS/vanilla JS, no backend. All data stays on
your device in IndexedDB.

- **Windows:** [download RepTracker-Setup.exe](https://github.com/awakenedsniper78-beep/RepTracker/releases/latest/download/RepTracker-Setup.exe) and run it ([details](#install-on-windows))
- **iPhone / web:** https://awakenedsniper78-beep.github.io/RepTracker/

## Features

- **Today**: a card per exercise with − / + and +5 / +10 / +25, your best and
  yesterday's count, a reminder card, and current / longest streak rings
- **History**: a month calendar (dots on logged days); pick any day to add or fix its reps
- **Progress**: reps-per-day chart (30D / 90D / 1Y); tap an exercise to show or hide
  its line (each exercise has its own color), plus Best, Average and Change for the range
- **Learn**: 5-minute, Duolingo-style lessons that teach a new exercise (how-to, quick quiz,
  3 guided sets with rest timers). Picks adapt to your logged reps and "too easy / too hard"
  feedback; choose focus areas by tapping a body map in Settings › Lessons. Each lesson shows an
  animated form figure (also shown when you miss a question) and a YouTube link, and earns
  5 gems. Finishing a lesson starts a 20-minute 1.5× gem boost: a lesson you start in that time
  earns 8. 20 gems buys a bonus streak freeze that covers an extra day in any week
- **Streak freezes**: cover a missed day so the streak survives. One per week
  (Monday–Sunday, by the frozen day), a written reason is required, and freezes
  are permanent: no edit or delete, and imports can only add new ones. A frozen
  day bridges the streak but doesn't add to the count.
- **Dark mode**: Settings › Appearance › System / Light / Dark
- **Custom exercises**: add, rename, hide (keeps history) or delete
- **Backup**: export / import a JSON file (merge or replace)
- **Offline**: a service worker caches the whole app; Chart.js is bundled in `vendor/`
- **Reminders**: an in-app reminder when nothing's logged, plus an optional daily push at your chosen time
  (on Windows, a notification from the system tray)

## Install on Windows

1. Download **[RepTracker-Setup.exe](https://github.com/awakenedsniper78-beep/RepTracker/releases/latest/download/RepTracker-Setup.exe)**
   (it's also on the [Releases](https://github.com/awakenedsniper78-beep/RepTracker/releases) page).
2. Double-click it. It installs RepTracker for your Windows user (no admin needed), adds it to
   the Start menu and the desktop, and opens it.
3. The installer isn't code-signed, so Windows may say **"Windows protected your PC"**: click
   **More info**, then **Run anyway**. (Your browser may also ask you to confirm keeping the download.)

- **Updates** download in the background. When one is ready RepTracker shows **Update**;
  otherwise it installs the next time you quit.
- **Your data** is stored on the PC (`%APPDATA%\RepTracker`), separate from the iPhone app. To
  bring your history over, use **Settings → Backup → Export data** on the phone and
  **Import data** on the PC.
- **Daily reminder** (Settings → Reminders) makes RepTracker start with Windows and stay in the
  system tray when you close its window, so it can show a notification at your time if nothing's
  logged. Quit it from the tray icon. No GitHub setup needed.
- **Uninstall** from Windows Settings → Apps → Installed apps → RepTracker. Your reps stay in
  `%APPDATA%\RepTracker` unless you delete that folder.

## Install on iPhone

If you added an earlier version and got a plain letter tile instead of the
icon, delete that Home Screen icon first, then add it again.

1. Open the live URL in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch RepTracker from the new icon (it runs full-screen, offline).

## Backups

Safari may clear a site's storage after weeks of not being opened. In
**Settings → Backup**, tap **Export JSON** and save it to Files / iCloud Drive
every so often. **Import JSON** restores it (Merge keeps what's on the phone;
Replace wipes it first).

## Optional: iPhone daily push reminder (even when the app is closed)

A static site can't schedule notifications by itself, so a GitHub Actions job
(`.github/workflows/daily-reminder.yml`) checks every 15 minutes and sends a Web
Push once a day when your chosen time arrives in your time zone. The app's
service worker then shows "time to log your reps", "nice, today is logged" or
"today is frozen" depending on your data.

Requirements: iOS 16.4+, and the app opened from the Home Screen icon.

One-time setup:

1. The repo already has the `VAPID_PRIVATE_KEY` secret and the `VAPID_PUBLIC_KEY`
   / `VAPID_SUBJECT` variables configured.
2. On your iPhone, open RepTracker from the Home Screen → **Settings** → set the
   **Time** → turn on **Daily reminder** → allow notifications.
3. Tap **Copy setup code**, then **Open GitHub repo secrets** (sign in) →
   **New repository secret** (or edit the existing one) → name `PUSH_SUBSCRIPTIONS`,
   paste, save. For several devices, paste a JSON array of setup codes.
4. Test it: repo → **Actions** → **Daily push reminder** → **Run workflow** → tick
   **Send to every subscription right now**.

The setup code carries the time and time zone, so **after changing the time,
copy the code again and update the secret** (the app reminds you). GitHub can
start scheduled runs late, so a reminder may arrive up to ~15 minutes after the
time (a skipped run is caught up within 3 hours). The workflow re-enables itself
each run so GitHub doesn't pause it after 60 days of repo inactivity.

### Using your own keys (forks)

```bash
npx web-push generate-vapid-keys
```

Put the public key in `js/config.js` and in the `VAPID_PUBLIC_KEY` repo variable,
the private key in the `VAPID_PRIVATE_KEY` secret, and a `mailto:` address in the
`VAPID_SUBJECT` variable.

## Development

Any static server works, e.g. `python -m http.server` in this folder. When you
change any cached file, bump `VERSION` in `sw.js` so installed copies update
(the app shows an **Update** prompt). Icons (including the Windows `desktop/assets/icon.ico`)
are generated by `python tools/make_icons.py`. Lesson logic tests: `node tools/test_lessons.mjs`.

Chart.js 4.5.1 is vendored under `vendor/` (MIT, see `vendor/chart.LICENSE.md`).

### Windows app

`desktop/` wraps the same files in [Electron](https://www.electronjs.org/). Run `npm install` in
`desktop/`, then `npm start` runs the app from your checkout and `npm run dist` builds
`desktop/dist/RepTracker-Setup.exe` (on Linux or macOS that needs Wine). Its version is the web
app's, read from `js/config.js`.

GitHub Actions (`.github/workflows/windows-app.yml`) builds the installer on Windows for every push
that touches the app, installs it, opens it to check it works, and uninstalls it. On `main` it then
publishes a GitHub Release `v<version>`, which the download link and installed copies' auto-update
use. So keep bumping the version in `js/config.js` and `sw.js` with each change: a version that
already has a release isn't published again.
