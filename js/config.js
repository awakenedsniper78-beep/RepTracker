/* Deployment config. Safe to be public: the VAPID *public* key is meant to be shared.
 * The matching private key lives only in the GitHub Actions secret VAPID_PRIVATE_KEY. */
window.REPTRACKER_CONFIG = {
  version: '1.4.0',
  vapidPublicKey: 'BHHzEa9QsOCjGl8bBlZAPcdodXM9CCi0xatAKsLLvO3aUUMbdl66FOaoynyo61pAEKZS9KLxMRUJNQwxDETT7N4',
  repoUrl: 'https://github.com/awakenedsniper78-beep/RepTracker',
};
