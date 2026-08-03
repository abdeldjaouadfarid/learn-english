# English Level Test & IELTS Roadmap

A full-stack web app that gives learners an adaptive English placement test, estimates their CEFR level and IELTS band, generates a personalized IELTS study roadmap, and includes a vocabulary self-check tool with an Arabic-translated review sheet you can export to PDF.

---

## Features

### Placement test
- ~14 AI-generated questions per session (grammar, vocabulary, reading comprehension, short answer, essay), mixed A1–C2 difficulty.
- AI grading returns CEFR level, estimated IELTS band, per-skill scores (grammar / vocabulary / reading / writing), and a short summary.
- If you set a target band, the AI generates a study roadmap: total weeks, weekly hours, phases with milestones, a Mon–Sun schedule, recommended resources, and test-day tips.

### Vocabulary check
- Loads 100 fresh words per batch, mixed across parts of speech and CEFR levels.
- You click the words you know; the rest are stored as "unknown".
- No word is ever repeated — the generator is given every word already in your list to avoid.
- After submit, AI estimates your vocabulary size and CEFR level with a per-level breakdown.

### Words to Learn (review table)
- All unknown words in a sortable/filterable table.
- AI enrichment adds:
  - **Arabic translation** (Modern Standard Arabic, RTL rendered)
  - **Frequency rank** (1–10 000, lower = more common)
  - **Importance** (1–10 for IELTS)
  - **Example sentence** (10–18 words, target word highlighted in green, composed from words you already know when possible)
- Per-row actions: mark as known, remove.
- **Download PDF**: opens print-optimized view; use "Save as PDF" in the browser dialog (native Arabic rendering, no bundled fonts needed).

### Authentication & security
- Email + password signup with **email verification** (required before login).
- JWT sessions (7-day expiry), server-side revalidation on every page load via `/api/auth/me`.
- **Rate limiting** (DB-backed) on all auth endpoints:
  - Per-IP: signup 5/hr, login 20/15min, forgot 5/hr, resend 5/hr, verify 20/hr, reset 20/hr
  - Per-email: forgot 3/hr, resend 3/hr (stops mailbox spam)
- **Account lockout**: 5 failed logins in 15 minutes locks the email; cleared on successful password reset.
- Password reset via signed one-hour token, emailed via Nodemailer.
- `Cache-Control: no-store` on protected HTML and all API responses — back button after logout can't show protected pages.
- Every navigation uses `location.replace()` so the browser history can't ping-pong between login and app pages.

### Mobile
- Two responsive breakpoints (640px and 380px). Full-width buttons, stacked toolbars, table hides low-value columns, word grid shrinks tile size, all on phone.

---

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Runtime   | Node.js (ES modules) |
| Web       | Express 4 |
| Database  | PostgreSQL (via `pg`) |
| Auth      | `bcrypt` + `jsonwebtoken` |
| Mail      | Nodemailer (Gmail SMTP by default) |
| LLM       | Google Gemini (default, free tier) or Anthropic Claude |
| Frontend  | Vanilla HTML/CSS/JS (no framework, no build step) |

---

## Prerequisites

- Node.js 18+
- PostgreSQL 13+ (local install, Docker, or cloud — Neon/Supabase/Railway all work)
- (Optional) A Gmail account with an App Password for real reset/verification emails

---

## Setup

### 1. Install dependencies

```bash
npm install
```

Native modules (`bcrypt`) may prompt to approve install scripts:

```bash
npm approve-scripts bcrypt
npm rebuild bcrypt
```

### 2. Create the database

Local Postgres:
```bash
psql -U postgres -c "CREATE DATABASE learn_english;"
```

Cloud Postgres (Neon, Supabase, etc.): create a database from the provider's dashboard and copy the connection string.

The app auto-creates all tables on first boot — no migrations to run.

### 3. Configure environment

Copy `.env.example` to `.env` and fill in the values (see the [Environment variables](#environment-variables) section below).

Minimum required to boot:
- `DATABASE_URL`
- `JWT_SECRET`
- `GEMINI_API_KEY` (free at https://aistudio.google.com/apikey) **or** `ANTHROPIC_API_KEY`

If you don't set SMTP, verification and reset links print to the server console — useful for local testing.

### 4. Run

```bash
npm start
```

Open http://localhost:3000. You'll be redirected to `/login.html`. Hit **Sign up** to create your first account.

For development with auto-restart on file changes:
```bash
npm run dev
```

---

## Environment variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `PORT` | HTTP port | `3000` |
| `APP_URL` | Base URL used in outbound email links | `http://localhost:3000` |
| `JWT_SECRET` | HMAC secret for signing JWTs (make it long and random) | `openssl rand -hex 32` |
| `DATABASE_URL` | Postgres connection string | `postgres://user:pass@host:5432/db` |
| `LLM_PROVIDER` | `gemini` or `anthropic` | `gemini` |
| `GEMINI_API_KEY` | Google AI Studio key (free) | `AI...` |
| `GEMINI_MODEL` | Model alias | `gemini-flash-latest` |
| `ANTHROPIC_API_KEY` | Anthropic console key | `sk-ant-...` |
| `ANTHROPIC_MODEL` | Model id | `claude-haiku-4-5-20251001` |
| `ANTHROPIC_BASE_URL` | Override endpoint (usually leave as-is) | `https://api.anthropic.com` |
| `SMTP_HOST` | SMTP server | `smtp.gmail.com` |
| `SMTP_PORT` | Port | `465` |
| `SMTP_SECURE` | TLS on connect | `true` |
| `SMTP_USER` | Sender address (leave blank for dev — prints to console) | `you@gmail.com` |
| `SMTP_PASS` | App password (**not** your Google password) | `xxxx xxxx xxxx xxxx` |
| `SMTP_FROM` | From header | `"English Level Test <you@gmail.com>"` |

### Gmail App Password

Real Gmail passwords won't work for SMTP. Steps:
1. Enable 2-Step Verification on your Google account.
2. Go to https://myaccount.google.com/apppasswords.
3. Generate a new app password ("Mail" / "Other: nodemailer").
4. Paste the 16-character password (spaces optional) into `SMTP_PASS`.

---

## Project structure

```
├── server.js               Express app + API routes
├── db.js                   pg Pool + schema initialization
├── env.js                  Loads .env with override (ES-modules hoisting fix)
├── middleware/
│   ├── auth.js             JWT sign/verify, requireAuth middleware
│   └── rateLimit.js        DB-backed rate limiter, clientIp helper
├── routes/
│   └── auth.js             Signup / login / verify / resend / forgot / reset / me
├── services/
│   ├── llm.js              Provider-agnostic LLM layer (Gemini + Anthropic)
│   └── mailer.js           Nodemailer transport + email templates
├── public/
│   ├── index.html          Placement test (protected)
│   ├── vocab.html          Vocabulary check (protected)
│   ├── unknown.html        Words-to-learn review table (protected)
│   ├── login.html          Public auth pages
│   ├── signup.html
│   ├── forgot.html
│   ├── reset.html
│   ├── verify.html
│   ├── auth-client.js      Shared auth helpers (authFetch, ensureSession, redirectIfAuthed)
│   ├── app.js              Placement test frontend
│   ├── vocab.js            Vocabulary check frontend
│   ├── unknown.js          Review table frontend
│   └── style.css           Dark theme, responsive
├── .env.example
└── package.json
```

---

## API reference

All non-auth endpoints require `Authorization: Bearer <jwt>`.

### Auth (`/api/auth`)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/signup` | `{ email, password }` | Sends verification email; does NOT log in |
| POST | `/verify-email` | `{ token }` | Marks user verified |
| POST | `/resend-verification` | `{ email }` | Rate-limited per email |
| POST | `/login` | `{ email, password }` | Returns `{ token, user }` |
| GET  | `/me` | — | Returns current user; used by frontend guards |
| POST | `/forgot-password` | `{ email }` | Emails 1-hour reset link |
| POST | `/reset-password` | `{ token, password }` | Consumes token, clears login attempts |

### Placement test (`/api/test`)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/start` | — | `{ session_id, questions }` |
| POST | `/submit` | `{ session_id, answers, goal_band, target_date }` | `{ result, roadmap }` |
| GET  | `/session/:id` | — | Full session with result + roadmap |

### Vocabulary (`/api/vocab`)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/generate` | — | 100 fresh words, dedup against your DB |
| POST | `/submit` | `{ known, unknown }` | Saves both, returns AI evaluation |
| GET  | `/unknown` | — | All unknown words, sorted importance→frequency |
| POST | `/enrich` | — | Adds Arabic + freq + importance + example (batch of 30) |
| POST | `/mark-known` | `{ id }` | Flip a word to known |
| DELETE | `/word/:id` | — | Remove a word |
| GET  | `/stats` | — | Counts by status |

---

## Data model

```
users(id, email, password_hash, verified, created_at)
email_verifications(token, user_id, expires_at, used, created_at)
password_resets(token, user_id, expires_at, used, created_at)
login_attempts(id, email, ip, success, attempted_at)
rate_limits(id, key, created_at)

sessions(id, user_id, created_at, goal_band, target_date, status)
questions(id, session_id, idx, section, type, prompt, options_json, correct_answer)
answers(id, session_id, question_id, answer)
results(session_id, cefr_level, estimated_ielts, skills_json, summary, created_at)
roadmaps(session_id, content_json, created_at)

vocab_words(id, user_id, word, pos, cefr_level, status,
            arabic, frequency_rank, importance, example_sentence, created_at)
UNIQUE INDEX (user_id, LOWER(word))
```

All user data is deleted with `ON DELETE CASCADE` from `users`.

---

## Switching LLM provider

Free path (default): Google Gemini.
```
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-flash-latest
```

Paid path: Anthropic.
```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Both providers implement the same three internal functions: `generateTest`, `gradeTest`, `generateRoadmap`, `generateVocabBatch`, `evaluateVocab`, `enrichWords`. Adding another provider means adding one function in `services/llm.js`.

---

## Development notes

- **ES modules everywhere** (`"type": "module"` in package.json).
- **Env loading order matters**: `env.js` is imported first so `dotenv.config({ override: true })` runs before any other module (like `services/llm.js`) reads `process.env`. The `override: true` beats a system-level `ANTHROPIC_BASE_URL` if one is set.
- **Schema is idempotent**: `initDb()` runs `CREATE TABLE IF NOT EXISTS` for everything and uses a `DO $$` block to add `users.verified` if it's missing (grandfathering existing users to `TRUE`).
- **`rate_limits` and `login_attempts` are pruned hourly** to keep the tables small.
- **No build step** on the frontend — everything is plain HTML/CSS/JS served from `/public`.

---

## Troubleshooting

**`EADDRINUSE :::3000`** — another server is already on port 3000. Kill it:
```powershell
Get-NetTCPConnection -LocalPort 3000 | Select -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

**`SECURITY WARNING: The SSL modes 'prefer', 'require'...`** — harmless. `pg` is warning that in a future major version `sslmode=require` semantics will change. To silence, use `sslmode=verify-full` in your `DATABASE_URL`.

**`401 UNAUTHENTICATED` from the LLM** — your key is being redirected to a third-party proxy. Check for a system-level `ANTHROPIC_BASE_URL` env var (`echo $env:ANTHROPIC_BASE_URL`); either unset it or set `ANTHROPIC_BASE_URL=https://api.anthropic.com` in `.env`.

**`Your credit balance is too low`** — your Anthropic account is out of credits. Add credit at https://console.anthropic.com/settings/billing, or switch to Gemini free tier by setting `LLM_PROVIDER=gemini`.

**Signup succeeds but no email arrives** — you haven't set `SMTP_USER`. The verification link is printed in the server console instead. For real emails, add a Gmail App Password (see [Gmail App Password](#gmail-app-password) above).

**Login says "Please verify your email first"** — click the link from the verification email (or the console-printed link) before logging in. Use the **Resend verification link** button if it's expired.

---

## License

MIT — do whatever you want with it.
