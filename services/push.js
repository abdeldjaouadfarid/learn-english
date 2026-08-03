import webpush from 'web-push';
import { query } from '../db.js';

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

let configured = false;
if (PUBLIC && PRIVATE) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
} else {
  console.warn('[warn] VAPID keys not set — push notifications disabled.');
}

export function pushConfigured() {
  return configured;
}

export function publicKey() {
  return PUBLIC || null;
}

async function sendToOne(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    // 404/410 => subscription expired, drop it.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      return { ok: false, gone: true };
    }
    console.error('push send error:', err.statusCode, err.body || err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Send one random unknown word to every subscription. Called by the tick.
 */
export async function tickAllSubscriptions() {
  if (!configured) return { sent: 0, skipped: 0, reason: 'push_not_configured' };

  const { rows: subs } = await query('SELECT * FROM push_subscriptions');
  let sent = 0, skipped = 0, gone = 0;

  for (const sub of subs) {
    // Pick a random unknown word for this subscription's user, excluding the last one sent.
    const { rows: wordRows } = await query(
      `SELECT id, word, arabic
       FROM vocab_words
       WHERE user_id = $1 AND status = 'unknown' AND arabic IS NOT NULL
         AND ($2::int IS NULL OR id <> $2)
       ORDER BY RANDOM() LIMIT 1`,
      [sub.user_id, sub.last_word_id]
    );
    const w = wordRows[0];
    if (!w) { skipped++; continue; }

    const payload = {
      title: 'Practice word',
      body: `${w.word} — ${w.arabic}`,
      icon: '/icon.svg',
      badge: '/icon.svg',
      url: '/unknown.html',
      tag: 'practice-word',
    };
    const result = await sendToOne(sub, payload);
    if (result.gone) { gone++; continue; }
    if (!result.ok) { continue; }
    sent++;
    await query(
      'UPDATE push_subscriptions SET last_sent_at = NOW(), last_word_id = $1 WHERE id = $2',
      [w.id, sub.id]
    );
  }

  return { sent, skipped, gone, total: subs.length };
}
