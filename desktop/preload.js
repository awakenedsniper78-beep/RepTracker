/* The bridge between the RepTracker page and the Windows app (main.js).
 * The page sees it as window.RepTrackerDesktop; in a browser that's undefined. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let flushHandler = null;
const listeners = { 'update-ready': new Set(), 'show-view': new Set() };

// main.js asks before the window closes; always answer, even if the page has nothing to save.
ipcRenderer.on('flush', async (_event, id) => {
  try {
    if (flushHandler) await flushHandler();
  } catch (_) { /* answer anyway so the window can close */ }
  ipcRenderer.send('flush:done', id);
});

for (const channel of Object.keys(listeners)) {
  ipcRenderer.on(channel, (_event, value) => listeners[channel].forEach((fn) => fn(value)));
}

contextBridge.exposeInMainWorld('RepTrackerDesktop', {
  notify: (title, body) => ipcRenderer.send('notify', String(title), String(body)),
  getBackground: () => ipcRenderer.invoke('background:get'),
  setBackground: (on) => ipcRenderer.invoke('background:set', !!on),
  setTheme: (choice) => ipcRenderer.invoke('theme:set', String(choice)),
  saveBackup: (name, text) => ipcRenderer.invoke('backup:save', String(name), String(text)),
  installUpdate: () => ipcRenderer.send('update:install'),
  onFlush: (fn) => { flushHandler = fn; },
  on: (channel, fn) => {
    if (listeners[channel] && typeof fn === 'function') listeners[channel].add(fn);
  },
});
