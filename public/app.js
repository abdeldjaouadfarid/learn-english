const state = {
  sessionId: null,
  questions: [],
  answers: {},
  idx: 0,
  goalBand: 7,
  targetDate: null,
};

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");

function setLoading(text) {
  if (text) {
    $("loadingText").textContent = text;
    show("loading");
  } else {
    hide("loading");
  }
}

async function startTest() {
  state.goalBand = parseFloat($("goalBand").value) || 7;
  state.targetDate = $("targetDate").value || null;

  $("startBtn").disabled = true;
  $("startStatus").textContent = "Generating test with AI…";
  setLoading("Building your test… (Waiting clsplease, ~10-20s)");

  try {
    const res = await Auth.authFetch("/api/test/start", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    state.sessionId = body.session_id;
    state.questions = body.questions;
    state.answers = {};
    state.idx = 0;

    hide("intro");
    show("test");
    renderQuestion();
  } catch (err) {
    console.error(err);
    $("startStatus").textContent = "Error: " + err.message;
    $("startBtn").disabled = false;
  } finally {
    setLoading(null);
  }
}

function renderQuestion() {
  const q = state.questions[state.idx];
  const total = state.questions.length;

  $("progressFill").style.width = `${((state.idx + 1) / total) * 100}%`;
  $("qIndicator").textContent = `${state.idx + 1} / ${total}`;
  $("prevBtn").disabled = state.idx === 0;
  $("nextBtn").textContent = state.idx === total - 1 ? "Submit test" : "Next";

  const container = $("questionContainer");
  container.innerHTML = "";

  const section = document.createElement("div");
  section.className = "question-section";
  section.textContent = `${q.section} · ${q.type.replace("_", " ")}`;
  container.appendChild(section);

  const prompt = document.createElement("div");
  prompt.className = "question-prompt";
  prompt.textContent = q.prompt;
  container.appendChild(prompt);

  const current = state.answers[q.id] ?? "";

  if (q.type === "mcq" && q.options) {
    q.options.forEach((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      const div = document.createElement("div");
      div.className = "option" + (current === letter ? " selected" : "");
      div.innerHTML = `<span class="option-letter">${letter}</span><span>${escapeHtml(opt)}</span>`;
      div.onclick = () => {
        state.answers[q.id] = letter;
        renderQuestion();
      };
      container.appendChild(div);
    });
  } else if (q.type === "fill_blank" || q.type === "short_answer") {
    const input = document.createElement(
      q.type === "short_answer" ? "textarea" : "input",
    );
    if (q.type !== "short_answer") input.type = "text";
    input.value = current;
    input.placeholder =
      q.type === "short_answer" ? "Write your answer…" : "Fill in the blank";
    input.oninput = (e) => {
      state.answers[q.id] = e.target.value;
    };
    container.appendChild(input);
  } else if (q.type === "essay") {
    const ta = document.createElement("textarea");
    ta.style.minHeight = "220px";
    ta.value = current;
    ta.placeholder = "Write your response here (100-150 words)…";
    ta.oninput = (e) => {
      state.answers[q.id] = e.target.value;
    };
    container.appendChild(ta);
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

async function next() {
  if (state.idx < state.questions.length - 1) {
    state.idx++;
    renderQuestion();
    window.scrollTo(0, 0);
  } else {
    await submitTest();
  }
}

function prev() {
  if (state.idx > 0) {
    state.idx--;
    renderQuestion();
    window.scrollTo(0, 0);
  }
}

async function submitTest() {
  setLoading("Grading your test and building your roadmap…");
  try {
    const res = await Auth.authFetch("/api/test/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.sessionId,
        answers: state.answers,
        goal_band: state.goalBand,
        target_date: state.targetDate,
      }),
    });
    if (!res.ok)
      throw new Error((await res.json()).error || "Failed to submit");
    const data = await res.json();

    hide("test");
    show("results");
    renderResults(data.result, data.roadmap);
    window.scrollTo(0, 0);
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    setLoading(null);
  }
}

function renderResults(result, roadmap) {
  $("cefrLevel").textContent = result.cefr_level;
  $("ieltsBand").textContent = result.estimated_ielts.toFixed(1);
  $("summary").textContent = result.summary;

  const skillsEl = $("skills");
  skillsEl.innerHTML = "";
  Object.entries(result.skills).forEach(([name, data]) => {
    const row = document.createElement("div");
    row.className = "skill-row";
    row.innerHTML = `
      <div class="skill-name">${name}</div>
      <div class="skill-bar-wrap"><div class="skill-bar" style="width:${data.score}%"></div></div>
      <div class="skill-score">${data.score}</div>
    `;
    skillsEl.appendChild(row);
    if (data.notes) {
      const notes = document.createElement("p");
      notes.className = "skill-notes";
      notes.textContent = data.notes;
      skillsEl.appendChild(notes);
    }
  });

  if (roadmap) {
    show("roadmapSection");
    $("roadmapWeeks").textContent = roadmap.estimated_weeks;
    $("roadmapHours").textContent = roadmap.weekly_hours;

    const phasesEl = $("phases");
    phasesEl.innerHTML = "";
    roadmap.phases.forEach((p) => {
      const div = document.createElement("div");
      div.className = "phase";
      div.innerHTML = `
        <div class="phase-header">${escapeHtml(p.name)}<span class="phase-weeks">${p.weeks} weeks</span></div>
        <div style="color:var(--muted);font-size:14px;">Focus: ${p.focus.map(escapeHtml).join(", ")}</div>
        <ul>${p.milestones.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
      `;
      phasesEl.appendChild(div);
    });

    const scheduleEl = $("schedule");
    scheduleEl.innerHTML = "";
    roadmap.weekly_schedule.forEach((d) => {
      const row = document.createElement("div");
      row.className = "day-row";
      row.innerHTML = `
        <div class="day-name">${escapeHtml(d.day)}</div>
        <div class="day-activities">${d.activities.map(escapeHtml).join(" · ")}</div>
      `;
      scheduleEl.appendChild(row);
    });

    const resEl = $("resources");
    resEl.innerHTML = "";
    roadmap.resources.forEach((r) => {
      const li = document.createElement("li");
      li.className = "resource-item";
      li.innerHTML = `
        <div><span class="resource-name">${escapeHtml(r.name)}</span><span class="resource-type">${escapeHtml(r.type)}</span></div>
        <div class="resource-why">${escapeHtml(r.why)}</div>
      `;
      resEl.appendChild(li);
    });

    const tipsEl = $("tips");
    tipsEl.innerHTML = "";
    roadmap.test_day_tips.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      tipsEl.appendChild(li);
    });
  }
}

$("startBtn").onclick = startTest;
$("nextBtn").onclick = next;
$("prevBtn").onclick = prev;
$("restartBtn").onclick = () => location.reload();
