/* electron-builder settings for the Windows installer (npm run dist / npm run release).
 * The version comes from ../js/config.js, so the web app and the Windows app always match. */
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const version = (read('js/config.js').match(/version:\s*'([^']+)'/) || [])[1];
const swVersion = (read('sw.js').match(/const VERSION = 'v([^']+)'/) || [])[1];
if (!version || version !== swVersion) {
  throw new Error(`js/config.js version (${version}) and sw.js VERSION (v${swVersion}) must match. Bump both.`);
}

module.exports = {
  appId: 'com.reptracker.desktop', // also in main.js and build/installer.nsh; never change it (installs and updates key off it)
  productName: 'RepTracker',
  copyright: 'RepTracker',
  extraMetadata: { version },
  directories: { output: 'dist', buildResources: 'build' },
  files: [
    'main.js',
    'preload.js',
    { from: '..', to: 'web', filter: ['index.html', 'manifest.json', 'css/**/*', 'js/**/*', 'vendor/**/*', 'icons/**/*'] },
  ],
  extraResources: [{ from: 'assets/icon.ico', to: 'icon.ico' }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    executableName: 'RepTracker',
  },
  // One click: installs for the current user (no admin), adds Start menu + desktop shortcuts, opens the app.
  nsis: {
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'RepTracker',
    uninstallDisplayName: 'RepTracker',
    deleteAppDataOnUninstall: false, // keep the user's reps if they uninstall
    artifactName: 'RepTracker-Setup.${ext}', // stable name for the releases/latest/download link
    include: 'build/installer.nsh',
  },
  // Where installed copies look for updates; windows-app.yml publishes the releases there.
  publish: [{ provider: 'github', owner: 'awakenedsniper78-beep', repo: 'RepTracker', releaseType: 'release' }],
};
