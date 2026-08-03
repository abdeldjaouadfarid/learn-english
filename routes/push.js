import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { publicKey, pushConfigured, tickAllSubscriptions } from '../services/push.js';

const router = express.Router();

router.get('/vapid-public-key', (_req, res) => {
  res.json({ key: publicKey(), configured: pushConfigured() });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'invalid_subscription' });
    }
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('subscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint_required' });
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT endpoint FROM push_subscriptions WHERE user_id = $1',
    [req.user.id]
  );
  res.json({ subscribed: rows.length > 0, count: rows.length, endpoints: rows.map(r => r.endpoint) });
});

// Sends the caller a push right now — handy for testing after enabling.
router.post('/test', requireAuth, async (req, res) => {
  try {
    if (!pushConfigured()) return res.status(503).json({ error: 'push_not_configured' });
    const { rows: subs } = await query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1',
      [req.user.id]
    );
    if (!subs.length) return res.status(404).json({ error: 'no_subscription' });
    const { rows: wordRows } = await query(
      `SELECT id, word, arabic FROM vocab_words
       WHERE user_id = $1 AND status = 'unknown' AND arabic IS NOT NULL
       ORDER BY RANDOM() LIMIT 1`,
      [req.user.id]
    );
    const w = wordRows[0];
    const payload = {
      title: w ? 'Practice word' : 'Reminders enabled ✓',
      body: w ? `${w.word} — ${w.arabic}` : 'Add some unknown words to start receiving them.',
      icon: '/icon.svg', badge: '/icon.svg', url: '/unknown.html', tag: 'test-push',
    };
    const webpush = (await import('web-push')).default;
    for (const sub of subs) {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    }
    res.json({ ok: true, sent_to: subs.length });
  } catch (err) {
    console.error('push test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// External-cron endpoint. Protected by NOTIFY_TICK_SECRET — set the header
// X-Tick-Secret to trigger. Also runs automatically via server-side interval.
router.post('/tick', async (req, res) => {
  const secret = process.env.NOTIFY_TICK_SECRET;
  const provided = req.headers['x-tick-secret'];
  if (!secret) return res.status(503).json({ error: 'tick_secret_not_configured' });
  if (provided !== secret) return res.status(401).json({ error: 'bad_secret' });

  try {
    const result = await tickAllSubscriptions();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('tick error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
