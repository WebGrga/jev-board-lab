const MAX_SELECTED_ROWS = 25;
const MAX_QUESTIONS = 20;
const PAGE_SIZE = 40;

const state = {
  fileName: "",
  headers: [],
  rows: [],
  visibleRows: [],
  includedFields: new Set(),
  selectedRows: new Set(),
  questions: [],
  results: [],
  visibleLimit: PAGE_SIZE,
  running: false,
};

const els = Object.fromEntries([
  "fileInput", "themeButton", "emptyView", "workbench", "dropZone", "datasetName", "datasetSummary",
  "downloadResults", "questionCount", "resultBadge", "dataPanel", "questionsPanel", "resultsPanel",
  "selectVisible", "clearSelection", "selectionCount", "searchInput", "fieldCount", "fieldOptions",
  "dataHead", "dataRows", "noMatches", "showMoreRows", "questionList", "addQuestion",
  "validationSummary", "runSummary", "runPrivacy", "runButton", "resultsEmpty", "resultsContent",
  "usageSummary", "exportResultsInline", "resultList", "toast",
].map((id) => [id, document.getElementById(id)]));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const rawHeaders = rows.shift().map((value, index) => value.trim() || `column_${index + 1}`);
  const seen = new Map();
  const headers = rawHeaders.map((header) => {
    const count = seen.get(header) || 0;
    seen.set(header, count + 1);
    return count ? `${header}_${count + 1}` : header;
  });
  const objects = rows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  return { headers, rows: objects };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatNumber(value) { return new Intl.NumberFormat("en").format(value); }
function slugify(value) {
  return String(value || "question").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "question";
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.setTimeout(() => els.toast.classList.remove("visible"), 2200);
}

function getStateForRow(rowIndex) {
  const row = state.rows[rowIndex] || {};
  return Object.fromEntries([...state.includedFields].map((field) => [field, row[field] ?? ""]));
}

function getRowLabel(rowIndex) {
  const row = state.rows[rowIndex] || {};
  const values = state.headers.map((header) => row[header]).filter(Boolean);
  return String(values[0] || `Row ${rowIndex + 1}`).slice(0, 90);
}

function setTab(name) {
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  els.dataPanel.hidden = name !== "data";
  els.questionsPanel.hidden = name !== "questions";
  els.resultsPanel.hidden = name !== "results";
  window.scrollTo({ top: Math.max(0, els.workbench.offsetTop - 20), behavior: "smooth" });
}

function renderFields() {
  els.fieldOptions.innerHTML = state.headers.map((header) => `<label><input type="checkbox" data-field="${escapeHtml(header)}" ${state.includedFields.has(header) ? "checked" : ""} />${escapeHtml(header)}</label>`).join("");
  els.fieldCount.textContent = `${state.includedFields.size} of ${state.headers.length}`;
}

function filterRows() {
  const term = els.searchInput.value.trim().toLowerCase();
  state.visibleRows = state.rows.map((row, index) => ({ row, index })).filter(({ row }) => !term || Object.values(row).join(" ").toLowerCase().includes(term));
}

function renderTable() {
  filterRows();
  const previewFields = [...state.includedFields].slice(0, 5);
  const rows = state.visibleRows.slice(0, state.visibleLimit);
  els.dataHead.innerHTML = `<tr><th class="select-cell"><span class="visually-hidden">Select</span></th><th>Row</th>${previewFields.map((field) => `<th>${escapeHtml(field)}</th>`).join("")}</tr>`;
  els.dataRows.innerHTML = rows.map(({ row, index }) => `<tr class="${state.selectedRows.has(index) ? "selected" : ""}">
    <td class="select-cell"><input type="checkbox" data-row="${index}" aria-label="Select row ${index + 1}" ${state.selectedRows.has(index) ? "checked" : ""} /></td>
    <td>${index + 1}</td>
    ${previewFields.map((field) => `<td><span class="cell-text">${escapeHtml(row[field])}</span></td>`).join("")}
  </tr>`).join("");
  els.noMatches.hidden = state.visibleRows.length > 0;
  els.showMoreRows.hidden = state.visibleLimit >= state.visibleRows.length;
  renderRunState();
}

function questionTemplate(type = "noul") {
  const firstField = state.headers[0] || "field";
  const uid = crypto.randomUUID();
  if (type === "choice") return { uid, type, id: "classification", instructions: `Which category best fits \`${firstField}\`?`, criteria: "option_a: Describe what belongs in option A\noption_b: Describe what belongs in option B\nother: None of the above" };
  if (type === "score") return { uid, type, id: "quality", instructions: `How strong is the evidence in \`${firstField}\`?`, criteria: "No relevant evidence\nSome indirect or incomplete evidence\nClear and specific evidence" };
  return { uid, type: "noul", id: "matches_condition", instructions: `Does \`${firstField}\` satisfy the condition?`, trueCriteria: "The condition is clearly satisfied", falseCriteria: "The condition is not satisfied or the evidence is missing" };
}

function criteriaMarkup(question) {
  if (question.type === "choice") return `<div class="question-field"><label>Options</label><textarea data-prop="criteria" placeholder="billing: Payment or subscription issues\ntechnical: Bugs or integration problems\nother: None of the above">${escapeHtml(question.criteria || "")}</textarea><p class="question-help">One option per line as key: description. Add other when the list may be incomplete.</p></div>`;
  if (question.type === "score") return `<div class="question-field"><label>Ordered levels</label><textarea data-prop="criteria" placeholder="No impact\nDegraded, but a workaround exists\nBlocking, with no workaround">${escapeHtml(question.criteria || "")}</textarea><p class="question-help">2-10 concrete levels, low to high. Describe situations, not vague degrees.</p></div>`;
  return `<div class="criteria-grid"><div class="question-field"><label>Yes means (optional)</label><input data-prop="trueCriteria" value="${escapeHtml(question.trueCriteria || "")}" /></div><div class="question-field"><label>No means (optional)</label><input data-prop="falseCriteria" value="${escapeHtml(question.falseCriteria || "")}" /></div></div><p class="question-help">Noul returns the probability of yes. A value near 0.5 means uncertainty, not a medium amount.</p>`;
}

function renderQuestions() {
  els.questionList.innerHTML = state.questions.map((question, index) => `<article class="question-card" data-uid="${question.uid}">
    <div class="question-card-head">
      <span class="question-index">Q${String(index + 1).padStart(2, "0")}</span>
      <select class="type-select" data-prop="type" aria-label="Question type">
        <option value="noul" ${question.type === "noul" ? "selected" : ""}>Noul</option>
        <option value="choice" ${question.type === "choice" ? "selected" : ""}>Choice</option>
        <option value="score" ${question.type === "score" ? "selected" : ""}>Score</option>
      </select>
      <input class="question-id" data-prop="id" aria-label="Question ID" value="${escapeHtml(question.id)}" placeholder="question_id" />
      <button class="remove-question" type="button" data-remove aria-label="Remove question"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="question-body">
      <div class="question-field"><label>Instructions</label><textarea data-prop="instructions" placeholder="Ask one focused judgment about the state.">${escapeHtml(question.instructions)}</textarea></div>
      ${criteriaMarkup(question)}
    </div>
  </article>`).join("");
  els.questionCount.textContent = state.questions.length;
  renderRunState();
}

function parseChoiceCriteria(text) {
  const entries = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const colon = line.indexOf(":");
    const key = slugify(colon >= 0 ? line.slice(0, colon) : line);
    const description = colon >= 0 ? line.slice(colon + 1).trim() : "";
    return [key, description || null];
  });
  return Object.fromEntries(entries);
}

function buildQuestions() {
  const errors = [];
  const output = {};
  const used = new Set();
  state.questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    const id = slugify(question.id);
    if (!question.instructions.trim()) errors.push(`${label} needs instructions.`);
    if (used.has(id)) errors.push(`${label} has a duplicate ID.`);
    used.add(id);
    const built = { type: question.type, instructions: question.instructions.trim() };
    if (question.type === "choice") {
      built.criteria = parseChoiceCriteria(question.criteria);
      if (Object.keys(built.criteria).length < 2) errors.push(`${label} needs at least two Choice options.`);
    } else if (question.type === "score") {
      built.criteria = String(question.criteria || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (built.criteria.length < 2 || built.criteria.length > 10) errors.push(`${label} needs 2-10 Score levels.`);
    } else if (question.trueCriteria.trim() || question.falseCriteria.trim()) {
      if (!question.trueCriteria.trim() || !question.falseCriteria.trim()) errors.push(`${label} needs both yes and no criteria, or neither.`);
      else built.criteria = { true: question.trueCriteria.trim(), false: question.falseCriteria.trim() };
    }
    output[id] = built;
  });
  if (!state.questions.length) errors.push("Add at least one question.");
  return { errors, questions: output };
}

function renderRunState() {
  const selected = state.selectedRows.size;
  const { errors } = buildQuestions();
  els.selectionCount.textContent = `${selected} ${selected === 1 ? "row" : "rows"} selected${selected >= MAX_SELECTED_ROWS ? ` (limit ${MAX_SELECTED_ROWS})` : ""}`;
  els.runSummary.textContent = selected ? `${selected} ${selected === 1 ? "state" : "states"} x ${state.questions.length} ${state.questions.length === 1 ? "question" : "questions"}` : "Select at least one row";
  els.runButton.disabled = !selected || errors.length > 0 || state.running;
  els.runButton.textContent = state.running ? "Running" : "Run Jev";
  els.validationSummary.hidden = errors.length === 0;
  els.validationSummary.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("");
}

function updateQuestionFromElement(element) {
  const card = element.closest("[data-uid]");
  const question = state.questions.find((item) => item.uid === card?.dataset.uid);
  if (!question || !element.dataset.prop) return;
  const previousType = question.type;
  question[element.dataset.prop] = element.value;
  if (element.dataset.prop === "id") question.id = slugify(element.value);
  if (element.dataset.prop === "type" && previousType !== element.value) {
    const replacement = questionTemplate(element.value);
    Object.assign(question, { type: replacement.type, criteria: replacement.criteria || "", trueCriteria: replacement.trueCriteria || "", falseCriteria: replacement.falseCriteria || "" });
    renderQuestions();
  } else renderRunState();
}

async function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".csv")) { toast("Choose a CSV file"); return; }
  try {
    const parsed = parseCsv(await file.text());
    if (!parsed.headers.length || !parsed.rows.length) throw new Error("No data rows found");
    state.fileName = file.name;
    state.headers = parsed.headers;
    state.rows = parsed.rows;
    state.includedFields = new Set(parsed.headers);
    state.selectedRows = new Set();
    state.questions = [questionTemplate("noul")];
    state.results = [];
    state.visibleLimit = PAGE_SIZE;
    els.searchInput.value = "";
    els.datasetName.textContent = file.name;
    els.datasetSummary.textContent = `${formatNumber(parsed.rows.length)} rows / ${formatNumber(parsed.headers.length)} fields / parsed locally`;
    els.emptyView.hidden = true;
    els.workbench.hidden = false;
    els.resultsContent.hidden = true;
    els.resultsEmpty.hidden = false;
    els.downloadResults.hidden = true;
    els.resultBadge.textContent = "0";
    renderFields();
    renderTable();
    renderQuestions();
    setTab("data");
    toast(`Loaded ${formatNumber(parsed.rows.length)} rows locally`);
  } catch (error) { toast(error.message || "This CSV could not be read"); }
  els.fileInput.value = "";
}

async function evaluateState(rowIndex, questions) {
  const apiUrl = String(window.JEV_BOARD_CONFIG?.apiUrl || "").replace(/\/$/, "");
  if (!apiUrl) throw new Error("The Jev API is not connected yet.");
  const response = await fetch(`${apiUrl}/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: getStateForRow(rowIndex), questions }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Jev request failed (${response.status})`);
  return body;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { results[index] = await worker(items[index]); }
      catch (error) { results[index] = { error: error.message || "Request failed" }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function runJev() {
  const built = buildQuestions();
  if (built.errors.length || !state.selectedRows.size) { renderRunState(); return; }
  state.running = true;
  renderRunState();
  els.runPrivacy.textContent = "Running selected rows without storing file contents.";
  const indexes = [...state.selectedRows];
  const responses = await mapWithConcurrency(indexes, 3, (rowIndex) => evaluateState(rowIndex, built.questions));
  state.results = indexes.map((rowIndex, index) => ({ rowIndex, state: getStateForRow(rowIndex), ...responses[index] }));
  state.running = false;
  els.runPrivacy.textContent = "Selected state and questions are sent only when you run Jev.";
  renderRunState();
  renderResults();
  setTab("results");
}

function answerMarkup(id, answer) {
  if (!answer) return `<article class="answer-card"><h4>${escapeHtml(id)}</h4><div class="result-error">No answer returned</div></article>`;
  const primary = answer.type === "choice" ? answer.choice : answer.type === "score" ? Number(answer.score).toFixed(2) : `${Math.round(Number(answer.noul) * 100)}% yes`;
  const meta = answer.type === "noul" ? "Probability that yes is true" : `Confidence ${Math.round(Number(answer.confidence || 0) * 100)}%`;
  const probabilities = answer.probabilities ? Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]).map(([key, value]) => `<div class="probability"><span>${escapeHtml(key)}</span><b>${Math.round(Number(value) * 100)}%</b></div>`).join("") : "";
  return `<article class="answer-card"><h4>${escapeHtml(id)}</h4><div class="answer-primary">${escapeHtml(primary)}</div><div class="answer-meta">${escapeHtml(meta)}</div>${probabilities ? `<div class="probabilities">${probabilities}</div>` : ""}</article>`;
}

function renderResults() {
  const successful = state.results.filter((result) => result.answers);
  const tokens = successful.reduce((sum, result) => sum + Number(result.usage?.input_tokens || 0) + Number(result.usage?.output_tokens || 0), 0);
  els.resultsEmpty.hidden = state.results.length > 0;
  els.resultsContent.hidden = state.results.length === 0;
  els.downloadResults.hidden = state.results.length === 0;
  els.resultBadge.textContent = state.results.length;
  els.usageSummary.textContent = `${successful.length} of ${state.results.length} states completed / ${formatNumber(tokens)} total tokens`;
  els.resultList.innerHTML = state.results.map((result) => `<article class="result-item">
    <div class="result-state"><strong>Row ${result.rowIndex + 1}: ${escapeHtml(getRowLabel(result.rowIndex))}</strong><code>${escapeHtml(JSON.stringify(result.state).slice(0, 260))}${JSON.stringify(result.state).length > 260 ? "…" : ""}</code></div>
    ${result.error ? `<div class="answer-card"><div class="result-error">${escapeHtml(result.error)}</div></div>` : `<div class="answer-list">${Object.entries(result.answers || {}).map(([id, answer]) => answerMarkup(id, answer)).join("")}</div>`}
  </article>`).join("");
}

function exportResults() {
  if (!state.results.length) return;
  const payload = { file: state.fileName, exported_at: new Date().toISOString(), questions: buildQuestions().questions, results: state.results };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.fileName.replace(/\.csv$/i, "")}-jev-results.json`;
  link.click();
  URL.revokeObjectURL(url);
}

els.fileInput.addEventListener("change", (event) => loadFile(event.target.files?.[0]));
for (const eventName of ["dragenter", "dragover"]) els.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropZone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) els.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropZone.classList.remove("dragging"); });
els.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files?.[0]));
document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
document.querySelectorAll("[data-next]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.next)));
els.searchInput.addEventListener("input", () => { state.visibleLimit = PAGE_SIZE; renderTable(); });
els.showMoreRows.addEventListener("click", () => { state.visibleLimit += PAGE_SIZE; renderTable(); });
els.selectVisible.addEventListener("click", () => {
  for (const { index } of state.visibleRows.slice(0, state.visibleLimit)) {
    if (state.selectedRows.size >= MAX_SELECTED_ROWS) break;
    state.selectedRows.add(index);
  }
  renderTable();
});
els.clearSelection.addEventListener("click", () => { state.selectedRows.clear(); renderTable(); });
els.dataRows.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-row]");
  if (!checkbox) return;
  const index = Number(checkbox.dataset.row);
  if (checkbox.checked && state.selectedRows.size >= MAX_SELECTED_ROWS) { checkbox.checked = false; toast(`Select up to ${MAX_SELECTED_ROWS} rows per run`); return; }
  if (checkbox.checked) state.selectedRows.add(index); else state.selectedRows.delete(index);
  renderTable();
});
els.fieldOptions.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-field]");
  if (!checkbox) return;
  if (checkbox.checked) state.includedFields.add(checkbox.dataset.field); else state.includedFields.delete(checkbox.dataset.field);
  if (!state.includedFields.size) { state.includedFields.add(checkbox.dataset.field); checkbox.checked = true; toast("Keep at least one field in state"); }
  renderFields();
  renderTable();
});
els.questionList.addEventListener("input", (event) => updateQuestionFromElement(event.target));
els.questionList.addEventListener("change", (event) => updateQuestionFromElement(event.target));
els.questionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const uid = button.closest("[data-uid]").dataset.uid;
  state.questions = state.questions.filter((question) => question.uid !== uid);
  renderQuestions();
});
els.addQuestion.addEventListener("click", () => {
  if (state.questions.length >= MAX_QUESTIONS) { toast(`Add up to ${MAX_QUESTIONS} questions`); return; }
  state.questions.push(questionTemplate("noul"));
  renderQuestions();
});
document.querySelectorAll("[data-template]").forEach((button) => button.addEventListener("click", () => {
  if (state.questions.length >= MAX_QUESTIONS) { toast(`Add up to ${MAX_QUESTIONS} questions`); return; }
  state.questions.push(questionTemplate(button.dataset.template));
  renderQuestions();
}));
els.runButton.addEventListener("click", runJev);
els.downloadResults.addEventListener("click", exportResults);
els.exportResultsInline.addEventListener("click", exportResults);
els.themeButton.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("jev-workbench-theme", next);
});

const savedTheme = localStorage.getItem("jev-workbench-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
else if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
