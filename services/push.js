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

/**
 * Pick the next word for a subscription.
 *
 * Progressive-level algorithm:
 *   1. Look at every CEFR level where this user still has unknown, translated words.
 *   2. Take the TWO LOWEST such levels (A1/A2 first; once A1 is empty, A2/B1; …).
 *   3. Pick a random word from that pool, excluding the last one sent.
 *
 * This means someone with A1+A2+B1+B2 unknowns will only receive A1 and A2
 * notifications until they clear enough of those to promote themselves up.
 */
async function pickNextWord(userId, lastWordId) {
  const { rows: levelRows } = await query(
    `SELECT cefr_level
     FROM vocab_words
     WHERE user_id = $1 AND status = 'unknown' AND arabic IS NOT NULL
       AND cefr_level IS NOT NULL
     GROUP BY cefr_level
     ORDER BY
       CASE cefr_level
         WHEN 'A1' THEN 1 WHEN 'A2' THEN 2
         WHEN 'B1' THEN 3 WHEN 'B2' THEN 4
         WHEN 'C1' THEN 5 WHEN 'C2' THEN 6
         ELSE 7
       END
     LIMIT 2`,
    [userId]
  );
  const activeLevels = levelRows.map(r => r.cefr_level);

  // Fallback: user has unknown words but none with a CEFR level tagged — send anything.
  if (!activeLevels.length) {
    const { rows } = await query(
      `SELECT id, word, arabic, cefr_level FROM vocab_words
       WHERE user_id = $1 AND status = 'unknown' AND arabic IS NOT NULL
         AND ($2::int IS NULL OR id <> $2)
       ORDER BY RANDOM() LIMIT 1`,
      [userId, lastWordId]
    );
    return rows[0] || null;
  }

  const { rows } = await query(
    `SELECT id, word, arabic, cefr_level FROM vocab_words
     WHERE user_id = $1 AND status = 'unknown' AND arabic IS NOT NULL
       AND cefr_level = ANY($2::text[])
       AND ($3::int IS NULL OR id <> $3)
     ORDER BY RANDOM() LIMIT 1`,
    [userId, activeLevels, lastWordId]
  );
  // If the exclude-last-word filter made the set empty (only 1 word available),
  // fall back without the exclusion.
  if (!rows[0]) {
    const { rows: fallback } = await query(
      `SELECT id, word, arabic, cefr_level FROM vocab_words
       WHERE user_id = $1 AND status = 'unknown' AND arabic IS NOT NULL
         AND cefr_level = ANY($2::text[])
       ORDER BY RANDOM() LIMIT 1`,
      [userId, activeLevels]
    );
    return fallback[0] || null;
  }
  return rows[0];
}

export { pickNextWord };

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
    const w = await pickNextWord(sub.user_id, sub.last_word_id);
    if (!w) { skipped++; continue; }

    const payload = {
      title: `Practice word${w.cefr_level ? ' · ' + w.cefr_level : ''}`,
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
