/* RepTracker for Windows: the RepTracker web app (index.html, css/, js/, … from the repo root)
 * in its own window. Data stays in IndexedDB under %APPDATA%\RepTracker.
 *
 * What the desktop app adds:
 * - "Daily reminder" (Settings › Reminders) starts RepTracker with Windows and keeps it in the
 *   system tray after its window is closed, so the reminder notification still comes. It stands
 *   in for Web Push, which Electron doesn't support.
 * - Updates download from GitHub Releases and install on restart (see windows-app.yml).
 */
'use strict';

const {
  app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, nativeTheme, protocol, screen, shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_ID = 'com.reptracker.desktop'; // must match appId in electron-builder.config.js
const HOST = 'reptracker';
const START_URL = `app://${HOST}/index.html`;
// Packaged, the web app is copied into web/ (electron-builder.config.js); `npm start` serves the checkout.
const WEB_ROOT = app.isPackaged ? path.join(__dirname, 'web') : path.join(__dirname, '..');
const WIN = process.platform === 'win32';
const ICON = WIN
  ? (app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, 'assets', 'icon.ico'))
  : path.join(WEB_ROOT, 'icons', 'icon-192-v3.png');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'desktop-settings.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

let settings = { background: false, theme: 'system', bounds: null, maximized: false, trayHintShown: false };
let win = null;
let tray = null;
let quitting = false;      // set once the app is really exiting (not just closing to the tray)
let flushing = false;      // the page is saving before a close
let closeReady = false;    // pending saves are flushed; let the window close
let updateVersion = null;  // a downloaded update, waiting for a restart
let reminder = null;       // the reminder on screen; a new one replaces it (like the web app's notification tag)
const notifications = new Set(); // keep a reference so click handlers survive garbage collection

/* ---------- settings (window position, tray mode, theme) ---------- */

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch (_) { /* first run, or unreadable: keep defaults */ }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE + '.tmp', JSON.stringify(settings, null, 2));
    fs.renameSync(SETTINGS_FILE + '.tmp', SETTINGS_FILE);
  } catch (err) {
    console.warn('Could not save settings:', err.message);
  }
}

/* ---------- serving the web app ---------- */

// A fixed private origin (app://reptracker) so IndexedDB keeps the same data on every launch.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

async function serve(request) {
  const url = new URL(request.url);
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (_) { rel = null; }
  const file = rel && path.join(WEB_ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  const inside = file && !path.relative(WEB_ROOT, file).startsWith('..') && !path.isAbsolute(path.relative(WEB_ROOT, file));
  if (url.host !== HOST || !inside) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);
    return new Response(body, {
      headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' },
    });
  } catch (_) {
    return new Response('Not found', { status: 404 });
  }
}

/* ---------- main window ---------- */

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(460, workArea.width);
  const height = Math.min(900, workArea.height - 40);
  return {
    width, height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}

/** The saved window position, if it's still on a connected screen. */
function savedBounds() {
  const b = settings.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 20 && b.y < a.y + a.height - 60);
  return onScreen ? b : null;
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  settings.maximized = win.isMaximized();
  if (!win.isMinimized() && !win.isFullScreen()) settings.bounds = win.getNormalBounds();
  saveSettings();
}

function darkBackground() {
  return settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors);
}

function createWindow(show) {
  const saved = savedBounds();
  closeReady = false;
  win = new BrowserWindow({
    ...(saved || defaultBounds()),
    minWidth: 360,
    minHeight: 560,
    show: false,
    title: 'RepTracker',
    icon: ICON,
    backgroundColor: darkBackground() ? '#000000' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // the reminder timer keeps running while the window is hidden in the tray
    },
  });
  win.removeMenu();

  if (show) {
    const reveal = () => {
      if (!win || win.isDestroyed() || win.isVisible()) return;
      if (saved && settings.maximized) win.maximize();
      win.show();
    };
    win.once('ready-to-show', reveal);
    setTimeout(reveal, 4000); // never leave a launch with no window, even if the page is slow
  }

  const contents = win.webContents;
  // Links (YouTube, GitHub) open in the default browser; the app window never leaves the app.
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`app://${HOST}/`)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  contents.on('did-finish-load', () => {
    if (updateVersion) send('update-ready', updateVersion);
  });
  let lastCrash = 0;
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || Date.now() - lastCrash < 10000) return;
    lastCrash = Date.now();
    contents.reload();
  });
  contents.on('context-menu', (_event, p) => {
    const items = [];
    for (const word of (p.misspelledWord ? p.dictionarySuggestions : []).slice(0, 5)) {
      items.push({ label: word, click: () => contents.replaceMisspelling(word) });
    }
    if (items.length) items.push({ type: 'separator' });
    if (p.isEditable) {
      items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy },
        { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
    } else if (p.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Closing: first let the page save any rep counts still waiting to be written, then either
  // hide to the tray (daily reminder on) or really close.
  win.on('close', (event) => {
    if (closeReady) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    flushPage().then(() => {
      flushing = false;
      if (!win || win.isDestroyed()) return;
      saveBounds();
      if (settings.background && !quitting) {
        win.hide();
        trayHintOnce();
        installUpdateInBackground();
      } else {
        closeReady = true;
        win.close();
      }
    });
  });
  win.on('closed', () => { win = null; });
  // Windows is shutting down or signing out: close for real instead of hiding.
  win.on('query-session-end', () => { quitting = true; });
  win.on('session-end', () => { quitting = true; });

  win.loadURL(START_URL);
}

function showWindow() {
  if (!win) {
    createWindow(true);
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) {
    if (settings.maximized) win.maximize();
    win.show();
    if (updateVersion) send('update-ready', updateVersion); // offer it again: it may have arrived while hidden
  }
  win.focus();
}

function send(channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

/** Ask the page to write pending changes to IndexedDB. Resolves when done (or after 2 s). */
let flushSeq = 0;
function flushPage() {
  if (!win || win.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve();
  const id = ++flushSeq;
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      ipcMain.removeListener('flush:done', onDone);
      resolve();
    };
    const onDone = (_event, doneId) => { if (doneId === id) finish(); };
    const timer = setTimeout(finish, 2000);
    ipcMain.on('flush:done', onDone);
    win.webContents.send('flush', id);
  });
}

/* ---------- tray + start with Windows (the "Daily reminder" setting) ---------- */

function createTray() {
  if (tray) return;
  tray = new Tray(ICON);
  tray.setToolTip('RepTracker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open RepTracker', click: showWindow },
    { type: 'separator' },
    { label: 'Quit RepTracker', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function setBackground(on) {
  settings.background = !!on;
  saveSettings();
  if (WIN && app.isPackaged) {
    // A start-up entry: launched hidden at sign-in so the reminder can fire.
    // (build/installer.nsh removes it again on uninstall.)
    app.setLoginItemSettings({ openAtLogin: settings.background, name: APP_ID, args: ['--hidden'] });
  }
  if (settings.background) {
    createTray();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
  return settings.background;
}

function trayHintOnce() {
  if (settings.trayHintShown) return;
  settings.trayHintShown = true;
  saveSettings();
  notify('RepTracker is still running',
    'It stays in the system tray so your daily reminder can come. Right-click the tray icon to quit.', false);
}

function notify(title, body, openToday = true) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: String(title).slice(0, 80),
    body: String(body).slice(0, 300),
    icon: nativeImage.createFromPath(path.join(WEB_ROOT, 'icons', 'icon-192-v3.png')),
  });
  notifications.add(n);
  if (notifications.size > 10) notifications.delete(notifications.values().next().value);
  n.on('click', () => {
    showWindow();
    if (openToday) send('show-view', 'today');
  });
  n.on('close', () => notifications.delete(n));
  if (openToday) {
    if (reminder) reminder.close();
    reminder = n;
  }
  n.show();
}

/* ---------- updates from GitHub Releases ---------- */

// A downloaded update installs when RepTracker quits, or right away from the page's Update button.
let autoUpdater = null;

function setupUpdates() {
  if (!app.isPackaged || !WIN) return;
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.on('update-downloaded', (info) => {
    updateVersion = info.version;
    send('update-ready', info.version);
    installUpdateInBackground();
  });
  autoUpdater.on('error', (err) => console.warn('Update check failed:', err && err.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline: try again later */ });
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
  ipcMain.on('update:install', (event) => {
    if (!fromApp(event) || !updateVersion) return;
    quitting = true;
    autoUpdater.quitAndInstall(true, true); // silent install, then reopen
  });
}

/** In tray mode RepTracker may not quit for weeks, so update while its window is hidden and come back hidden. */
function installUpdateInBackground() {
  if (!autoUpdater || !updateVersion || !settings.background || (win && win.isVisible())) return;
  if (settings.autoUpdateTried === updateVersion) return; // tried once already: wait for a normal restart
  settings.autoUpdateTried = updateVersion;
  settings.relaunchHiddenUntil = Date.now() + 5 * 60 * 1000;
  saveSettings();
  quitting = true;
  autoUpdater.quitAndInstall(true, true);
}

/* ---------- messages from the page (desktop/preload.js) ---------- */

function fromApp(event) {
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'app:' && url.host === HOST;
  } catch (_) {
    return false;
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    return fn(...args);
  });
}

function registerIpc() {
  handle('background:get', () => settings.background);
  handle('background:set', (on) => setBackground(on));
  handle('theme:set', (choice) => {
    settings.theme = choice === 'light' || choice === 'dark' ? choice : 'system';
    nativeTheme.themeSource = settings.theme; // title bar and native menus follow the app's theme
    saveSettings();
  });
  handle('backup:save', async (name, text) => {
    const fileName = String(name).replace(/[^\w.-]+/g, '_').slice(0, 100) || 'reptracker-backup.json';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save RepTracker backup',
      defaultPath: path.join(app.getPath('documents'), fileName),
      filters: [{ name: 'RepTracker backup', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await fs.promises.writeFile(filePath, String(text), 'utf8');
    return { saved: true, path: filePath };
  });
  ipcMain.on('notify', (event, title, body) => {
    if (fromApp(event)) notify(title, body);
  });
}

/* ---------- start ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit(); // already running: the first copy shows its window (second-instance below)
} else {
  if (WIN) app.setAppUserModelId(APP_ID); // needed for Windows notifications
  loadSettings();

  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(() => {
    nativeTheme.themeSource = settings.theme;
    protocol.handle('app', serve);
    registerIpc();
    // Start hidden in the tray when Windows starts us at sign-in, or after a background update.
    const afterUpdate = Date.now() < (settings.relaunchHiddenUntil || 0);
    if (settings.relaunchHiddenUntil) {
      delete settings.relaunchHiddenUntil;
      saveSettings();
    }
    const hidden = settings.background && (process.argv.includes('--hidden') || afterUpdate);
    createWindow(!hidden);
    if (settings.background) setBackground(true); // tray icon, and refresh the start-up entry
    try {
      setupUpdates();
    } catch (err) {
      console.warn('Updates unavailable:', err.message); // the app works fine without them
    }
  });
}
