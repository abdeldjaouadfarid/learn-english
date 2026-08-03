const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

let allWords = [];

function setLoading(text) {
  if (text) {
    $('loadingText').textContent = text;
    show('loading');
  } else {
    hide('loading');
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderExample(sentence, targetWord) {
  if (!sentence) return '—';
  const parts = String(sentence).split(/\*\*(.+?)\*\*/g);
  if (parts.length > 1) {
    return parts.map((p, i) =>
      i % 2 === 1 ? `<span class="target-word">${escapeHtml(p)}</span>` : escapeHtml(p)
    ).join('');
  }
  if (targetWord) {
    const escaped = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${escaped}\\w*)\\b`, 'i');
    const html = escapeHtml(sentence);
    return html.replace(re, '<span class="target-word">$1</span>');
  }
  return escapeHtml(sentence);
}

async function loadWords({ triggerEnrich = true } = {}) {
  try {
    const res = await Auth.authFetch('/api/vocab/unknown');
    const data = await res.json();
    allWords = data.words || [];
    render();

    if (triggerEnrich && data.missing_enrichment > 0) {
      $('statusLine').textContent = `Fetching Arabic translations for ${data.missing_enrichment} words…`;
      await enrichAll();
    }
  } catch (err) {
    $('statusLine').textContent = 'Error: ' + err.message;
  }
}

async function enrichAll() {
  let safety = 20;
  while (safety-- > 0) {
    try {
      const res = await Auth.authFetch('/api/vocab/enrich', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'enrich failed');

      if (data.enriched > 0) {
        const r2 = await Auth.authFetch('/api/vocab/unknown');
        const d2 = await r2.json();
        allWords = d2.words || [];
        render();
        $('statusLine').textContent = data.remaining > 0
          ? `Fetching translations… ${data.remaining} left`
          : 'All translations loaded.';
      }
      if (data.remaining === 0 || data.enriched === 0) {
        setTimeout(() => { $('statusLine').textContent = ''; }, 2000);
        break;
      }
    } catch (err) {
      $('statusLine').textContent = 'Enrichment error: ' + err.message;
      break;
    }
  }
}

function render() {
  const level = $('filterLevel').value;
  const sort = $('sortBy').value;

  let rows = allWords.slice();
  if (level) rows = rows.filter(w => w.cefr_level === level);

  const levelOrder = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  const cmp = {
    importance: (a, b) => (b.importance ?? -1) - (a.importance ?? -1) || (a.frequency_rank ?? 99999) - (b.frequency_rank ?? 99999),
    frequency:  (a, b) => (a.frequency_rank ?? 99999) - (b.frequency_rank ?? 99999),
    level:      (a, b) => (levelOrder[a.cefr_level] || 9) - (levelOrder[b.cefr_level] || 9) || a.word.localeCompare(b.word),
    alpha:      (a, b) => a.word.localeCompare(b.word),
  }[sort];
  rows.sort(cmp);

  const body = $('tableBody');
  body.innerHTML = '';

  if (!rows.length) {
    show('emptyMsg');
    return;
  }
  hide('emptyMsg');

  rows.forEach((w, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="row-num">${i + 1}</td>
      <td class="cell-word">${escapeHtml(w.word)}</td>
      <td class="cell-arabic" dir="rtl" lang="ar">${escapeHtml(w.arabic || '—')}</td>
      <td class="cell-example">${renderExample(w.example_sentence, w.word)}</td>
      <td class="cell-pos">${escapeHtml(w.pos || '')}</td>
      <td class="cell-level"><span class="level-badge level-${w.cefr_level || ''}">${escapeHtml(w.cefr_level || '')}</span></td>
      <td class="cell-freq">${w.frequency_rank ?? '—'}</td>
      <td class="cell-imp">${renderImp(w.importance)}</td>
      <td class="no-print cell-action">
        <button data-id="${w.id}" class="mark-known" title="Mark as known">✓ Save</button>
        <button data-id="${w.id}" class="mark-delete" title="Remove">✕</button>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('.mark-known').forEach(b => b.onclick = () => markKnown(b.dataset.id));
  body.querySelectorAll('.mark-delete').forEach(b => b.onclick = () => removeWord(b.dataset.id));
}

function renderImp(v) {
  if (v == null) return '—';
  return `<span class="imp-bar" title="${v}/10"><span style="width:${v * 10}%"></span></span>`;
}

async function markKnown(id) {
  try {
    await Auth.authFetch('/api/vocab/mark-known', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(id) }),
    });
    allWords = allWords.filter(w => String(w.id) !== String(id));
    render();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function removeWord(id) {
  if (!confirm('Remove this word from your list?')) return;
  try {
    await Auth.authFetch(`/api/vocab/word/${id}`, { method: 'DELETE' });
    allWords = allWords.filter(w => String(w.id) !== String(id));
    render();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function downloadPdf() {
  const level = $('filterLevel').value;
  const sort = $('sortBy').value;
  const count = level ? allWords.filter(w => w.cefr_level === level).length : allWords.length;
  $('printMeta').textContent = `${count} words · ${level ? 'Level ' + level : 'All levels'} · sorted by ${sort} · ${new Date().toLocaleDateString()}`;
  show('printMeta');
  document.querySelector('.print-header').classList.remove('hidden');
  window.print();
  setTimeout(() => document.querySelector('.print-header').classList.add('hidden'), 500);
}

$('filterLevel').onchange = render;
$('sortBy').onchange = render;
$('reenrichBtn').onclick = async () => {
  setLoading('Fetching translations from AI…');
  await enrichAll();
  setLoading(null);
};
$('pdfBtn').onclick = downloadPdf;

loadWords();
