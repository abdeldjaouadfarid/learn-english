import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { checkAndRecord, clientIp } from '../middleware/rateLimit.js';
import { sendPasswordReset, sendVerificationEmail } from '../services/mailer.js';

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LOCKOUT_MAX_FAILURES = 5;
const LOCKOUT_WINDOW_SEC = 15 * 60;

const APP_URL = () => process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

async function recordLoginAttempt(email, ip, success) {
  await query('INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)', [email, ip, success]);
}

async function isLockedOut(email) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM login_attempts
     WHERE email = $1 AND success = FALSE AND attempted_at > NOW() - ($2 || ' seconds')::interval`,
    [email, String(LOCKOUT_WINDOW_SEC)]
  );
  return rows[0].c >= LOCKOUT_MAX_FAILURES;
}

// ---------- Signup ----------
router.post('/signup', async (req, res) => {
  try {
    const ip = clientIp(req);
    const rl = await checkAndRecord(`signup:ip:${ip}`, { max: 5, windowSec: 3600 });
    if (!rl.ok) return res.status(429).json({ error: 'too_many_requests', retry_after: rl.retryAfter });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
    if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) return res.status(409).json({ error: 'email_taken' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'INSERT INTO users (email, password_hash, verified) VALUES ($1, $2, FALSE) RETURNING id, email',
      [email, hash]
    );
    const user = rows[0];

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO email_verifications (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, user.id, expires]
    );
    const verifyUrl = `${APP_URL()}/verify.html?token=${token}`;
    try {
      await sendVerificationEmail({ to: email, verifyUrl });
    } catch (mailErr) {
      console.error('verification send error:', mailErr);
    }

    res.json({ ok: true, verification_sent: true, email });
  } catch (err) {
    console.error('signup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Verify email ----------
router.post('/verify-email', async (req, res) => {
  try {
    const ip = clientIp(req);
    const rl = await checkAndRecord(`verify:ip:${ip}`, { max: 20, windowSec: 3600 });
    if (!rl.ok) return res.status(429).json({ error: 'too_many_requests', retry_after: rl.retryAfter });

    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'missing_token' });

    const { rows } = await query(
      `SELECT user_id FROM email_verifications
       WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );
    const v = rows[0];
    if (!v) return res.status(400).json({ error: 'invalid_or_expired_token' });

    await query('UPDATE users SET verified = TRUE WHERE id = $1', [v.user_id]);
    await query('UPDATE email_verifications SET used = TRUE WHERE token = $1', [token]);

    res.json({ ok: true });
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const ip = clientIp(req);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });

    const rlIp = await checkAndRecord(`resend:ip:${ip}`, { max: 5, windowSec: 3600 });
    const rlEmail = await checkAndRecord(`resend:email:${email}`, { max: 3, windowSec: 3600 });
    if (!rlIp.ok || !rlEmail.ok) {
      return res.status(429).json({ error: 'too_many_requests', retry_after: Math.max(rlIp.retryAfter || 0, rlEmail.retryAfter || 0) });
    }

    const { rows } = await query('SELECT id, verified FROM users WHERE email = $1', [email]);
    const user = rows[0];
    // Respond identically whether or not the user exists / is verified.
    if (user && !user.verified) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await query(
        'INSERT INTO email_verifications (token, user_id, expires_at) VALUES ($1, $2, $3)',
        [token, user.id, expires]
      );
      const verifyUrl = `${APP_URL()}/verify.html?token=${token}`;
      try {
        await sendVerificationEmail({ to: email, verifyUrl });
      } catch (mailErr) {
        console.error('mail send error:', mailErr);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('resend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Login ----------
router.post('/login', async (req, res) => {
  const ip = clientIp(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  try {
    const rlIp = await checkAndRecord(`login:ip:${ip}`, { max: 20, windowSec: 15 * 60 });
    if (!rlIp.ok) return res.status(429).json({ error: 'too_many_requests', retry_after: rlIp.retryAfter });

    if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

    if (await isLockedOut(email)) {
      return res.status(429).json({
        error: 'account_locked',
        message: `Too many failed attempts. Try again in 15 minutes.`,
      });
    }

    const { rows } = await query(
      'SELECT id, email, password_hash, verified FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    if (!user) {
      await recordLoginAttempt(email, ip, false);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await recordLoginAttempt(email, ip, false);
      const failuresLeft = LOCKOUT_MAX_FAILURES - (await recentFailures(email));
      return res.status(401).json({ error: 'invalid_credentials', attempts_left: Math.max(0, failuresLeft) });
    }

    if (!user.verified) {
      await recordLoginAttempt(email, ip, false);
      return res.status(403).json({ error: 'email_not_verified' });
    }

    await recordLoginAttempt(email, ip, true);
    res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function recentFailures(email) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM login_attempts
     WHERE email = $1 AND success = FALSE AND attempted_at > NOW() - ($2 || ' seconds')::interval`,
    [email, String(LOCKOUT_WINDOW_SEC)]
  );
  return rows[0].c;
}

// ---------- Me ----------
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT id, email, verified FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'user_gone' });
  res.json({ user: rows[0] });
});

// ---------- Password reset ----------
router.post('/forgot-password', async (req, res) => {
  try {
    const ip = clientIp(req);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });

    const rlIp = await checkAndRecord(`forgot:ip:${ip}`, { max: 5, windowSec: 3600 });
    const rlEmail = await checkAndRecord(`forgot:email:${email}`, { max: 3, windowSec: 3600 });
    if (!rlIp.ok || !rlEmail.ok) {
      return res.status(429).json({ error: 'too_many_requests', retry_after: Math.max(rlIp.retryAfter || 0, rlEmail.retryAfter || 0) });
    }

    const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await query(
        'INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)',
        [token, user.id, expires]
      );
      const resetUrl = `${APP_URL()}/reset.html?token=${token}`;
      try {
        await sendPasswordReset({ to: email, resetUrl });
      } catch (mailErr) {
        console.error('mail send error:', mailErr);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('forgot error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const ip = clientIp(req);
    const rl = await checkAndRecord(`reset:ip:${ip}`, { max: 20, windowSec: 3600 });
    if (!rl.ok) return res.status(429).json({ error: 'too_many_requests', retry_after: rl.retryAfter });

    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (!token) return res.status(400).json({ error: 'missing_token' });
    if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

    const { rows } = await query(
      `SELECT user_id FROM password_resets
       WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );
    const reset = rows[0];
    if (!reset) return res.status(400).json({ error: 'invalid_or_expired_token' });

    const hash = await bcrypt.hash(password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, reset.user_id]);
    await query('UPDATE password_resets SET used = TRUE WHERE token = $1', [token]);
    // Any accumulated failed-login count is now irrelevant — clear it.
    await query('DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = $1)', [reset.user_id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
