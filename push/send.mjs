// Sends the daily reminder push to every subscription in PUSH_SUBSCRIPTIONS.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SUBSCRIPTIONS
// PUSH_SUBSCRIPTIONS may be one subscription object or a JSON array of them
// (copy it from RepTracker → Settings → Daily push reminder).
import webpush from 'web-push';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SUBSCRIPTIONS } = process.env;

if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
  console.log('VAPID keys not configured — nothing to do.');
  process.exit(0);
}
if (!PUSH_SUBSCRIPTIONS || !PUSH_SUBSCRIPTIONS.trim()) {
  console.log('No PUSH_SUBSCRIPTIONS secret yet — subscribe in the app, then save it as a repo secret.');
  process.exit(0);
}

let subs;
try {
  subs = JSON.parse(PUSH_SUBSCRIPTIONS);
  if (!Array.isArray(subs)) subs = [subs];
} catch (err) {
  console.error('PUSH_SUBSCRIPTIONS is not valid JSON:', err.message);
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:reptracker@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const payload = JSON.stringify({
  title: 'Time to log your reps',
  body: 'Nothing logged today yet. Knock out a set!',
});

let failed = 0;
for (const [i, sub] of subs.entries()) {
  try {
    const res = await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high' });
    console.log(`#${i}: sent (${res.statusCode})`);
  } catch (err) {
    failed++;
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.error(`#${i}: subscription expired (${err.statusCode}). Re-subscribe in the app and update the secret.`);
    } else {
      console.error(`#${i}: failed`, err.statusCode || '', err.body || err.message);
    }
  }
}
process.exit(failed === subs.length ? 1 : 0);
