import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

const PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    })
  : null;

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

export function activeProvider() {
  return { provider: PROVIDER, model: PROVIDER === 'gemini' ? GEMINI_MODEL : ANTHROPIC_MODEL };
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(raw.slice(start, end + 1));
}

async function callAnthropic({ system, user, maxTokens }) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set');
  const resp = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return resp.content.map(b => b.text || '').join('');
}

async function callGemini({ system, user }) {
  if (!gemini) throw new Error('GEMINI_API_KEY not set');
  const resp = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  });
  return resp.text;
}

async function callModel(opts) {
  if (PROVIDER === 'gemini') return callGemini(opts);
  if (PROVIDER === 'anthropic') return callAnthropic(opts);
  throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
}

export async function generateTest() {
  const system = `You are an expert English placement examiner. You design short adaptive English tests that reliably estimate a learner's CEFR level (A1-C2) and IELTS band (0-9). Output STRICT JSON only.`;

  const user = `Generate a 14-question English placement test that covers grammar, vocabulary, reading comprehension, and a short written response. Difficulty should range from A1 to C2 so we can place any learner.

Return JSON with this exact shape:
{
  "questions": [
    {
      "section": "grammar" | "vocabulary" | "reading" | "writing",
      "type": "mcq" | "fill_blank" | "short_answer" | "essay",
      "prompt": "string (for reading, include the passage inline)",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "string"
    }
  ]
}

Rules:
- 5 grammar (mcq or fill_blank), 4 vocabulary (mcq), 3 reading (mcq with a short 3-5 sentence passage in the prompt), 1 short_answer (2-3 sentences), 1 essay (100-150 word target).
- Mix difficulties: 3 easy (A1-A2), 6 medium (B1-B2), 5 hard (C1-C2).
- For mcq, always 4 options and set correct_answer to the letter (e.g. "B").
- For fill_blank, use "____" in the prompt and put the expected word in correct_answer. Include an empty options array.
- For essay, include an empty options array and set correct_answer to "".
- Prompts must be self-contained and unambiguous.

Return ONLY the JSON object, no prose.`;

  const text = await callModel({ system, user, maxTokens: 6000 });
  const data = extractJson(text);
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error('Model returned no questions');
  }
  return data.questions;
}

export async function gradeTest({ questions, answers }) {
  const payload = questions.map((q, i) => ({
    idx: i,
    section: q.section,
    type: q.type,
    prompt: q.prompt,
    options: q.options_json ? JSON.parse(q.options_json) : undefined,
    correct_answer: q.correct_answer || undefined,
    user_answer: answers[q.id] ?? '',
  }));

  const system = `You are a certified English language assessor. You grade placement tests and estimate CEFR level and IELTS band. Output STRICT JSON only.`;

  const user = `Grade this placement test. For each answer, judge correctness (for objective items) or quality (for writing) and produce an overall assessment.

Test:
${JSON.stringify(payload, null, 2)}

Return JSON with this exact shape:
{
  "cefr_level": "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
  "estimated_ielts": number,
  "skills": {
    "grammar":    { "score": number, "notes": "string" },
    "vocabulary": { "score": number, "notes": "string" },
    "reading":    { "score": number, "notes": "string" },
    "writing":    { "score": number, "notes": "string" }
  },
  "summary": "string, 2-4 sentences describing the learner's current level, strengths, and main weaknesses"
}

Scores are 0-100. estimated_ielts is 0-9 with one decimal. Be honest and calibrated. Return ONLY the JSON.`;

  const text = await callModel({ system, user, maxTokens: 3000 });
  return extractJson(text);
}

export async function generateVocabBatch({ excludeWords = [], count = 100 }) {
  const overGenerate = Math.round(count * 1.4);
  const excludeSample = excludeWords.slice(-400);

  const system = `You are a vocabulary curator building an English vocabulary assessment. You generate diverse word lists mixed across parts of speech and CEFR levels. Output STRICT JSON only.`;

  const user = `Generate ${overGenerate} distinct English words for a vocabulary self-check.

Requirements:
- Mix across parts of speech: ~35% nouns, ~25% verbs, ~20% adjectives, ~10% adverbs, ~10% other (phrasal verbs, common idioms, prepositions of interest).
- Mix across CEFR levels: ~15% A1, ~15% A2, ~20% B1, ~25% B2, ~15% C1, ~10% C2.
- Prefer useful, real-world vocabulary. No archaic, offensive, or obscure technical terms.
- Do NOT include any of these words (already seen): ${excludeSample.length ? excludeSample.join(', ') : '(none yet)'}
- Return unique lowercase entries. Single words or short phrasal verbs only.

Return JSON:
{
  "words": [
    { "word": "string (lowercase)", "pos": "noun" | "verb" | "adjective" | "adverb" | "phrasal_verb" | "idiom" | "other", "cefr_level": "A1" | "A2" | "B1" | "B2" | "C1" | "C2" }
  ]
}

Return ONLY the JSON.`;

  const text = await callModel({ system, user, maxTokens: 8000 });
  const data = extractJson(text);
  if (!Array.isArray(data.words)) throw new Error('Model returned no words');
  return data.words;
}

export async function enrichWords(words, { knownVocab = [] } = {}) {
  if (!words.length) return [];
  const payload = words.map(w => ({ id: w.id, word: w.word, pos: w.pos, cefr_level: w.cefr_level }));
  const knownSample = knownVocab.slice(0, 400);

  const system = `You are a bilingual English-Arabic lexicographer. You provide Arabic translations, usage-frequency data, and simple example sentences for word lists. Output STRICT JSON only.`;

  const user = `For each English word below, provide:
- arabic: the most common Modern Standard Arabic translation (a single word or short phrase, no explanations, use Arabic script).
- frequency_rank: an integer 1-10000 estimating how common the word is in modern English (1 = extremely common like "the", 10000 = very rare). Lower = more common.
- importance: an integer 1-10 rating how important the word is for an IELTS learner to know (10 = essential, 1 = optional).
- example: a natural English example sentence, 10-18 words, that shows the word in context. Wrap the exact form of the target word as it appears in the sentence with double asterisks, like **word** or **inflected**. Use ONLY one pair of asterisks per sentence.

IMPORTANT for the example sentence: build the rest of the sentence with simple, common English vocabulary the learner already knows. Prefer words from this known-vocabulary sample when possible:
${knownSample.length ? knownSample.join(', ') : '(no known-vocab sample available — use basic A1-A2 English only)'}

Words to enrich:
${JSON.stringify(payload, null, 2)}

Return JSON:
{
  "words": [
    { "id": number, "arabic": "string", "frequency_rank": number, "importance": number, "example": "string with **target** marked" }
  ]
}

Return ONLY the JSON. Preserve every id from the input.`;

  const text = await callModel({ system, user, maxTokens: 12000 });
  const data = extractJson(text);
  if (!Array.isArray(data.words)) throw new Error('Model returned no enrichments');
  return data.words;
}

export async function evaluateVocab({ known, unknown }) {
  const knownSample = known.slice(0, 200);
  const unknownSample = unknown.slice(0, 200);

  const system = `You are an English vocabulary assessor. You analyze which words a learner knows vs. does not know and estimate their vocabulary size and CEFR level. Output STRICT JSON only.`;

  const user = `A learner completed a vocabulary self-check. They marked ${known.length} words as KNOWN and ${unknown.length} words as UNKNOWN out of ${known.length + unknown.length} total.

KNOWN words (sample): ${JSON.stringify(knownSample)}

UNKNOWN words (sample): ${JSON.stringify(unknownSample)}

Analyze the pattern:
- Which CEFR levels do they know well?
- Which parts of speech are weakest?
- Estimate their active vocabulary size.
- Estimate their receptive vocabulary CEFR level.

Return JSON:
{
  "estimated_vocab_size": number,
  "cefr_level": "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
  "known_ratio": number,
  "by_level": {
    "A1": { "known": number, "total": number },
    "A2": { "known": number, "total": number },
    "B1": { "known": number, "total": number },
    "B2": { "known": number, "total": number },
    "C1": { "known": number, "total": number },
    "C2": { "known": number, "total": number }
  },
  "strengths": ["string"],
  "weaknesses": ["string"],
  "summary": "string, 2-3 sentences",
  "next_steps": ["string"]
}

Return ONLY the JSON.`;

  const text = await callModel({ system, user, maxTokens: 3000 });
  return extractJson(text);
}

export async function generateRoadmap({ result, goalBand, targetDate }) {
  const system = `You are an IELTS preparation coach. You build concrete, week-by-week study plans tailored to a learner's current level. Output STRICT JSON only.`;

  const user = `Build an IELTS preparation roadmap.

Current assessment:
- CEFR level: ${result.cefr_level}
- Estimated current IELTS band: ${result.estimated_ielts}
- Skill breakdown: ${JSON.stringify(result.skills)}
- Summary: ${result.summary}

Goal:
- Target IELTS band: ${goalBand}
- Target date: ${targetDate || 'flexible'}

Return JSON:
{
  "estimated_weeks": number,
  "weekly_hours": number,
  "phases": [
    { "name": "string", "weeks": number, "focus": ["string"], "milestones": ["string"] }
  ],
  "weekly_schedule": [
    { "day": "Mon", "activities": ["string"] },
    { "day": "Tue", "activities": ["string"] },
    { "day": "Wed", "activities": ["string"] },
    { "day": "Thu", "activities": ["string"] },
    { "day": "Fri", "activities": ["string"] },
    { "day": "Sat", "activities": ["string"] },
    { "day": "Sun", "activities": ["string"] }
  ],
  "resources": [
    { "name": "string", "type": "book" | "website" | "app" | "youtube" | "practice_test", "why": "string" }
  ],
  "test_day_tips": ["string"]
}

Be realistic about the gap. If the gap is large, propose more weeks. Return ONLY the JSON.`;

  const text = await callModel({ system, user, maxTokens: 4000 });
  return extractJson(text);
}
