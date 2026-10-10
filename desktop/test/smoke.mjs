// Smoke test for an installed RepTracker, run by windows-app.yml on a real Windows machine.
// The app must already be running with --remote-debugging-port=<port>. Checks that the page
// loads from app://reptracker with the desktop bridge, then either logs one rep (`log`) or checks
// that rep is still there after a restart (`check`). Saves a screenshot.
//
//   node test/smoke.mjs <port> <log|check> <screenshot.png>
import { writeFileSync } from 'node:fs';

const [port = '9222', mode = 'log', shot = 'smoke.png'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  for (let i = 0; i < 90; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith('app://reptracker/'));
      if (page) return page;
    } catch (_) { /* not listening yet */ }
    await sleep(1000);
  }
  throw new Error('RepTracker window never appeared');
}

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (fn) => {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
    expression: `(${fn})()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
};

/** Like run(), but retried while the page is still loading (its first document gets replaced). */
async function runWhenLoaded(fn) {
  for (let i = 0; ; i++) {
    try {
      return await run(fn);
    } catch (err) {
      if (i >= 30 || !/context|Inspected target navigated/i.test(err.message)) throw err;
      await sleep(1000);
    }
  }
}

const info = await runWhenLoaded(async () => {
  for (let i = 0; i < 200 && !document.querySelector('#today-list .ex-card'); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url: location.href,
    title: document.title,
    desktop: document.documentElement.classList.contains('desktop'),
    bridge: Object.keys(window.RepTrackerDesktop || {}).sort(),
    exercises: [...document.querySelectorAll('#today-list .ex-name')].map((e) => e.textContent),
    version: window.REPTRACKER_CONFIG && window.REPTRACKER_CONFIG.version,
    userAgent: navigator.userAgent,
  };
});
console.log(JSON.stringify(info, null, 2));

const failures = [];
if (info.title !== 'RepTracker') failures.push('title is ' + info.title);
if (!info.desktop || !info.bridge.includes('saveBackup')) failures.push('desktop bridge missing');
if (!info.exercises.includes('Push-ups')) failures.push('Today list did not render');
if (!/Windows NT/.test(info.userAgent)) failures.push('not running on Windows?');

if (mode === 'log') {
  await run(async () => {
    document.querySelector('#today-list .ex-card .step-btn.plus').click();
    await new Promise((r) => setTimeout(r, 1000)); // past the 350 ms save delay
  });
}
const reps = await run(async () => (await window.RepDB.getAllEntries()).reduce((sum, e) => sum + e.reps, 0));
console.log('reps saved:', reps);
if (reps !== 1) failures.push(`expected 1 rep saved, found ${reps}`);

const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync(shot, Buffer.from(data, 'base64'));
ws.close();

if (failures.length) {
  console.error('FAILED:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log(`smoke test (${mode}) passed`);
process.exit(0);
