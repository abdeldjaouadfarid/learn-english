import { query } from '../db.js';

/**
 * DB-backed rate limiter. Returns { ok, retryAfter } — retryAfter is seconds.
 * key: any string identifying the bucket (e.g. `login:ip:1.2.3.4`, `reset:email:x@y.com`).
 */
export async function checkAndRecord(key, { max, windowSec }) {
  const since = new Date(Date.now() - windowSec * 1000);
  const { rows } = await query(
    'SELECT COUNT(*)::int AS c, MIN(created_at) AS oldest FROM rate_limits WHERE key = $1 AND created_at > $2',
    [key, since]
  );
  const count = rows[0].c;
  if (count >= max) {
    const oldest = new Date(rows[0].oldest).getTime();
    const retryAfter = Math.max(1, Math.ceil((oldest + windowSec * 1000 - Date.now()) / 1000));
    return { ok: false, retryAfter };
  }
  await query('INSERT INTO rate_limits (key) VALUES ($1)', [key]);
  return { ok: true };
}

export function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// Best-effort cleanup — call periodically.
export async function pruneOld() {
  await query("DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 day'");
  await query("DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '7 days'");
  await query("DELETE FROM email_verifications WHERE expires_at < NOW() - INTERVAL '30 days'");
  await query("DELETE FROM password_resets WHERE expires_at < NOW() - INTERVAL '30 days'");
}
