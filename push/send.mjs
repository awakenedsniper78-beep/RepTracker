// Sends the RepTracker daily reminder push (run by GitHub Actions every 15 min).
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SUBSCRIPTIONS,
//      STATE_FILE (JSON of what was already sent today), FORCE ("true" = send now)
//
// PUSH_SUBSCRIPTIONS is one setup code or a JSON array of them, copied from
// RepTracker → Settings → Reminders → Copy setup code. A setup code is a push
// subscription plus { time: "HH:MM", tz: "Area/City" }. Older codes without
// time/tz default to 19:00 America/New_York.
//
// A subscription is due once its local time passes `time` (within a 3-hour
// window, so a late or skipped cron run still sends, but never at midnight),
// and only once per local day.
//
// `node send.mjs --check` exits early and writes due=true|false to
// $GITHUB_OUTPUT, so the workflow can skip installing web-push when idle.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const env = process.env;
const CHECK_ONLY = process.argv.includes('--check');
const FORCE = env.FORCE === 'true';
const STATE_FILE = env.STATE_FILE || 'push-state.json';
const WINDOW_MIN = 180;

function output(key, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function parseSubs() {
  if (!env.PUSH_SUBSCRIPTIONS || !env.PUSH_SUBSCRIPTIONS.trim()) return [];
  const parsed = JSON.parse(env.PUSH_SUBSCRIPTIONS);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Local date ("YYYY-MM-DD") and minutes since midnight in a time zone. */
function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

let subs;
try {
  subs = parseSubs();
} catch (err) {
  console.error('PUSH_SUBSCRIPTIONS is not valid JSON:', err.message);
  output('due', 'false');
  process.exit(1);
}
if (!subs.length) {
  console.log('No PUSH_SUBSCRIPTIONS secret yet — turn on Daily reminder in the app and paste the setup code.');
  output('due', 'false');
  process.exit(0);
}

const state = loadState();
const due = [];
for (const sub of subs) {
  const tz = sub.tz || 'America/New_York';
  const [h, m] = String(sub.time || '19:00').split(':').map(Number);
  const target = h * 60 + (m || 0);
  let now;
  try { now = localNow(tz); } catch { console.error(`Unknown time zone "${tz}", skipping.`); continue; }
  const id = createHash('sha256').update(String(sub.endpoint)).digest('hex').slice(0, 16);
  const inWindow = now.minutes >= target && now.minutes < target + WINDOW_MIN;
  const alreadySent = state[id] === now.date;
  if (FORCE || (inWindow && !alreadySent)) due.push({ sub, id, date: now.date, tz });
  else console.log(`#${id}: not due (${tz} ${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}, target ${sub.time || '19:00'}${alreadySent ? ', already sent today' : ''})`);
}

output('due', due.length ? 'true' : 'false');
if (CHECK_ONLY || !due.length) process.exit(0);

if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
  console.log('VAPID keys not configured — nothing to do.');
  process.exit(0);
}

const { default: webpush } = await import('web-push');
webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:reptracker@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

const payload = JSON.stringify({ title: 'Time to log your reps', body: 'Nothing logged today yet. Knock out a set!' });
let failed = 0;
for (const { sub, id, date } of due) {
  const { time, tz, ...subscription } = sub; // web-push only needs endpoint + keys
  try {
    const res = await webpush.sendNotification(subscription, payload, { TTL: 6 * 3600, urgency: 'high' });
    state[id] = date;
    console.log(`#${id}: sent (${res.statusCode})`);
  } catch (err) {
    failed++;
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.error(`#${id}: subscription expired (${err.statusCode}). Turn Daily reminder off and on in the app and update the secret.`);
      state[id] = date; // don't retry an expired one every 15 minutes
    } else {
      console.error(`#${id}: failed`, err.statusCode || '', err.body || err.message);
    }
  }
}
writeFileSync(STATE_FILE, JSON.stringify(state));
process.exit(failed === due.length ? 1 : 0);
