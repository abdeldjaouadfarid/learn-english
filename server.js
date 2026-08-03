import './env.js';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pool, query, initDb } from './db.js';
import { requireAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import {
  generateTest, gradeTest, generateRoadmap,
  generateVocabBatch, evaluateVocab, enrichWords,
  activeProvider,
} from './services/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1); // so req.headers['x-forwarded-for'] is honored
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  },
}));

const active = activeProvider();
console.log(`[info] LLM provider: ${active.provider}, model: ${active.model}`);
if (active.provider === 'gemini' && !process.env.GEMINI_API_KEY) {
  console.warn('[warn] GEMINI_API_KEY is not set.');
}
if (!process.env.SMTP_USER) {
  console.log('[info] SMTP not configured — password-reset links will print to console.');
}

app.use('/api/auth', authRouter);

// ---------- Placement test ----------

app.post('/api/test/start', requireAuth, async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const questions = await generateTest();

    await query(
      'INSERT INTO sessions (id, user_id, status) VALUES ($1, $2, $3)',
      [sessionId, req.user.id, 'in_progress']
    );

    const inserted = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const { rows } = await query(
        `INSERT INTO questions (session_id, idx, section, type, prompt, options_json, correct_answer)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [sessionId, i, q.section, q.type, q.prompt,
         q.options ? JSON.stringify(q.options) : null,
         q.correct_answer ?? null]
      );
      inserted.push({
        id: rows[0].id,
        idx: i,
        section: q.section,
        type: q.type,
        prompt: q.prompt,
        options: q.options || null,
      });
    }

    res.json({ session_id: sessionId, questions: inserted });
  } catch (err) {
    console.error('start error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/test/submit', requireAuth, async (req, res) => {
  try {
    const { session_id, answers, goal_band, target_date } = req.body;
    if (!session_id || !answers) return res.status(400).json({ error: 'missing fields' });

    const sessionRes = await query(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (!sessionRes.rowCount) return res.status(404).json({ error: 'session not found' });

    const qRes = await query(
      'SELECT * FROM questions WHERE session_id = $1 ORDER BY idx',
      [session_id]
    );
    const questions = qRes.rows;

    for (const q of questions) {
      const a = answers[q.id];
      if (a != null) {
        await query(
          'INSERT INTO answers (session_id, question_id, answer) VALUES ($1, $2, $3)',
          [session_id, q.id, String(a)]
        );
      }
    }

    await query(
      'UPDATE sessions SET goal_band = $1, target_date = $2 WHERE id = $3',
      [goal_band ?? null, target_date ?? null, session_id]
    );

    const result = await gradeTest({ questions, answers });

    await query(
      `INSERT INTO results (session_id, cefr_level, estimated_ielts, skills_json, summary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET
         cefr_level = EXCLUDED.cefr_level,
         estimated_ielts = EXCLUDED.estimated_ielts,
         skills_json = EXCLUDED.skills_json,
         summary = EXCLUDED.summary`,
      [session_id, result.cefr_level, result.estimated_ielts,
       JSON.stringify(result.skills), result.summary]
    );

    let roadmap = null;
    if (goal_band) {
      roadmap = await generateRoadmap({ result, goalBand: goal_band, targetDate: target_date });
      await query(
        `INSERT INTO roadmaps (session_id, content_json) VALUES ($1, $2)
         ON CONFLICT (session_id) DO UPDATE SET content_json = EXCLUDED.content_json`,
        [session_id, JSON.stringify(roadmap)]
      );
    }

    await query('UPDATE sessions SET status = $1 WHERE id = $2', ['done', session_id]);

    res.json({ result, roadmap });
  } catch (err) {
    console.error('submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session/:id', requireAuth, async (req, res) => {
  const sessionRes = await query(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!sessionRes.rowCount) return res.status(404).json({ error: 'not found' });

  const resultRes = await query('SELECT * FROM results WHERE session_id = $1', [req.params.id]);
  const roadmapRes = await query('SELECT * FROM roadmaps WHERE session_id = $1', [req.params.id]);

  res.json({
    session: sessionRes.rows[0],
    result: resultRes.rows[0]
      ? { ...resultRes.rows[0], skills: JSON.parse(resultRes.rows[0].skills_json) }
      : null,
    roadmap: roadmapRes.rows[0] ? JSON.parse(roadmapRes.rows[0].content_json) : null,
  });
});

// ---------- Vocabulary ----------

app.post('/api/vocab/generate', requireAuth, async (req, res) => {
  try {
    const count = 100;
    const existingRes = await query('SELECT word FROM vocab_words WHERE user_id = $1', [req.user.id]);
    const existing = existingRes.rows.map(r => r.word.toLowerCase());
    const existingSet = new Set(existing);

    const candidates = await generateVocabBatch({ excludeWords: existing, count });

    const seen = new Set();
    const filtered = [];
    for (const w of candidates) {
      const key = (w.word || '').trim().toLowerCase();
      if (!key || seen.has(key) || existingSet.has(key)) continue;
      seen.add(key);
      filtered.push({ word: key, pos: w.pos || 'other', cefr_level: w.cefr_level || 'B1' });
      if (filtered.length >= count) break;
    }

    res.json({ words: filtered });
  } catch (err) {
    console.error('vocab generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vocab/submit', requireAuth, async (req, res) => {
  try {
    const { known = [], unknown = [] } = req.body;
    if (!Array.isArray(known) || !Array.isArray(unknown)) {
      return res.status(400).json({ error: 'known and unknown must be arrays' });
    }

    for (const w of known) {
      await query(
        `INSERT INTO vocab_words (user_id, word, pos, cefr_level, status)
         VALUES ($1, $2, $3, $4, 'known') ON CONFLICT DO NOTHING`,
        [req.user.id, w.word, w.pos || null, w.cefr_level || null]
      );
    }
    for (const w of unknown) {
      await query(
        `INSERT INTO vocab_words (user_id, word, pos, cefr_level, status)
         VALUES ($1, $2, $3, $4, 'unknown') ON CONFLICT DO NOTHING`,
        [req.user.id, w.word, w.pos || null, w.cefr_level || null]
      );
    }

    const evaluation = await evaluateVocab({ known, unknown });
    res.json({ evaluation, saved: { known: known.length, unknown: unknown.length } });
  } catch (err) {
    console.error('vocab submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vocab/unknown', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, word, pos, cefr_level, arabic, frequency_rank, importance, example_sentence, created_at
     FROM vocab_words WHERE user_id = $1 AND status = 'unknown'
     ORDER BY
       (importance IS NULL), importance DESC NULLS LAST,
       frequency_rank ASC NULLS LAST,
       cefr_level ASC, word ASC`,
    [req.user.id]
  );
  const missing = rows.filter(r => r.arabic == null || r.example_sentence == null).length;
  res.json({ words: rows, missing_enrichment: missing });
});

app.post('/api/vocab/enrich', requireAuth, async (req, res) => {
  try {
    const batchSize = 30;
    const { rows: pending } = await query(
      `SELECT id, word, pos, cefr_level FROM vocab_words
       WHERE user_id = $1 AND status = 'unknown'
         AND (arabic IS NULL OR frequency_rank IS NULL OR example_sentence IS NULL)
       LIMIT $2`,
      [req.user.id, batchSize]
    );

    if (!pending.length) return res.json({ enriched: 0, remaining: 0 });

    const knownRes = await query(
      `SELECT word FROM vocab_words WHERE user_id = $1 AND status = 'known'
       ORDER BY frequency_rank ASC NULLS LAST LIMIT 400`,
      [req.user.id]
    );
    const knownVocab = knownRes.rows.map(r => r.word);

    const enriched = await enrichWords(pending, { knownVocab });

    for (const e of enriched) {
      await query(
        `UPDATE vocab_words
         SET arabic = $1, frequency_rank = $2, importance = $3, example_sentence = $4
         WHERE id = $5 AND user_id = $6`,
        [e.arabic || null, e.frequency_rank ?? null, e.importance ?? null,
         e.example || null, e.id, req.user.id]
      );
    }

    const { rows: remRow } = await query(
      `SELECT COUNT(*)::int AS c FROM vocab_words
       WHERE user_id = $1 AND status = 'unknown'
         AND (arabic IS NULL OR frequency_rank IS NULL OR example_sentence IS NULL)`,
      [req.user.id]
    );

    res.json({ enriched: enriched.length, remaining: remRow[0].c });
  } catch (err) {
    console.error('enrich error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vocab/mark-known', requireAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const info = await query(
    "UPDATE vocab_words SET status = 'known' WHERE id = $1 AND user_id = $2",
    [id, req.user.id]
  );
  res.json({ updated: info.rowCount });
});

app.delete('/api/vocab/word/:id', requireAuth, async (req, res) => {
  const info = await query(
    'DELETE FROM vocab_words WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  res.json({ deleted: info.rowCount });
});

app.get('/api/vocab/stats', requireAuth, async (req, res) => {
  const { rows } = await query(
    "SELECT status, COUNT(*)::int AS c FROM vocab_words WHERE user_id = $1 GROUP BY status",
    [req.user.id]
  );
  const stats = { known: 0, unknown: 0, total: 0 };
  for (const r of rows) {
    if (r.status === 'known') stats.known = r.c;
    if (r.status === 'unknown') stats.unknown = r.c;
  }
  stats.total = stats.known + stats.unknown;
  res.json(stats);
});

// ---------- Boot ----------

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await initDb();
    const { pruneOld } = await import('./middleware/rateLimit.js');
    setInterval(() => { pruneOld().catch(e => console.error('prune error:', e.message)); }, 60 * 60 * 1000);
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('Failed to initialize DB:', err.message);
    process.exit(1);
  }
})();
