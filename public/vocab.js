const state = {
  words: [],
  known: new Set(),
};

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

function setLoading(text) {
  if (text) {
    $('loadingText').textContent = text;
    show('loading');
  } else {
    hide('loading');
  }
}

async function loadStats() {
  try {
    const res = await Auth.authFetch('/api/vocab/stats');
    const s = await res.json();
    $('statTotal').textContent = s.total;
    $('statKnown').textContent = s.known;
    $('statUnknown').textContent = s.unknown;
  } catch {}
}

async function loadWords() {
  $('loadBtn').disabled = true;
  $('loadStatus').textContent = 'Generating fresh words with AI…';
  setLoading('Generating 100 new words… (~15-25s)');

  try {
    const res = await Auth.authFetch('/api/vocab/generate', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    state.words = body.words;
    state.known = new Set();

    hide('intro');
    show('words');
    renderGrid();
  } catch (err) {
    console.error(err);
    $('loadStatus').textContent = 'Error: ' + err.message;
    $('loadBtn').disabled = false;
  } finally {
    setLoading(null);
  }
}

function renderGrid() {
  const grid = $('wordGrid');
  grid.innerHTML = '';
  $('totalCount').textContent = state.words.length;
  updateCounter();

  state.words.forEach((w, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'word-tile' + (state.known.has(i) ? ' known' : '');
    btn.innerHTML = `<span class="word">${escapeHtml(w.word)}</span><span class="word-pos">${escapeHtml(w.pos)}</span>`;
    btn.onclick = () => {
      if (state.known.has(i)) state.known.delete(i);
      else state.known.add(i);
      btn.classList.toggle('known');
      updateCounter();
    };
    grid.appendChild(btn);
  });
}

function updateCounter() {
  $('knownCount').textContent = state.known.size;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function submit() {
  const known = [];
  const unknown = [];
  state.words.forEach((w, i) => {
    (state.known.has(i) ? known : unknown).push(w);
  });

  setLoading('AI is evaluating your vocabulary…');
  try {
    const res = await Auth.authFetch('/api/vocab/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ known, unknown }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    hide('words');
    show('results');
    renderResults(body.evaluation);
    window.scrollTo(0, 0);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    setLoading(null);
  }
}

function renderResults(e) {
  $('cefrLevel').textContent = e.cefr_level;
  $('vocabSize').textContent = e.estimated_vocab_size?.toLocaleString?.() ?? e.estimated_vocab_size;
  $('summary').textContent = e.summary;

  const byLevelEl = $('byLevel');
  byLevelEl.innerHTML = '';
  ['A1','A2','B1','B2','C1','C2'].forEach(lvl => {
    const b = e.by_level?.[lvl];
    if (!b || !b.total) return;
    const pct = Math.round((b.known / b.total) * 100);
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <div class="skill-name">${lvl}</div>
      <div class="skill-bar-wrap"><div class="skill-bar" style="width:${pct}%"></div></div>
      <div class="skill-score">${b.known}/${b.total}</div>
    `;
    byLevelEl.appendChild(row);
  });

  fillList('strengths', e.strengths);
  fillList('weaknesses', e.weaknesses);
  fillList('nextSteps', e.next_steps);
}

function fillList(id, items) {
  const el = $(id);
  el.innerHTML = '';
  (items || []).forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    el.appendChild(li);
  });
}

$('loadBtn').onclick = loadWords;
$('cancelBtn').onclick = () => { hide('words'); show('intro'); loadStats(); };
$('submitBtn').onclick = submit;
$('selectAllBtn').onclick = () => {
  state.words.forEach((_, i) => state.known.add(i));
  renderGrid();
};
$('clearBtn').onclick = () => {
  state.known.clear();
  renderGrid();
};
$('againBtn').onclick = () => location.reload();

loadStats();
