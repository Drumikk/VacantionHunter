const $ = (selector) => document.querySelector(selector);
const state = { parsed: null, response: null, searching: false };
const formatter = new Intl.NumberFormat("ru-RU");

function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function salaryText(job) {
  const salary = job.salary;
  if (!salary || (salary.min == null && salary.max == null)) return "Зарплата не указана";
  const range = salary.max != null ? `${formatter.format(salary.min || 0)}–${formatter.format(salary.max)}` : `от ${formatter.format(salary.min)}`;
  const period = { hour: "/час", day: "/день", week: "/нед.", month: "/мес.", year: "/год" }[salary.period] || "";
  return `${range} ${salary.currency || ""}${period}`;
}
function ageText(date) {
  const days = Math.floor((Date.now() - Date.parse(date || "")) / 86400000);
  if (!Number.isFinite(days)) return "дата не указана";
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} дн. назад`;
}
function sortSpec() {
  return [$("#primarySort").value, $("#secondarySort").value].map((value) => { const [field, direction] = value.split(":"); return { field, direction }; });
}

async function api(path, payload) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function renderQuery(parsed) {
  state.parsed = parsed;
  const labels = { role: "Роль", skill: "Навык", location: "Локация", remote: "Формат", relocation: "Переезд", experience: "Уровень", employment: "Занятость", salary: "Зарплата", exclude: "Исключить" };
  $("#queryTags").innerHTML = parsed.tags.map((tag) => `<span class="query-tag">${labels[tag.type] || tag.type}<strong>${escapeHtml(tag.type === "salary" ? `от ${tag.value.min} ${tag.value.currency || ""}` : String(tag.value === true ? "да" : tag.value))}</strong></span>`).join("");
  const box = $("#clarifications");
  const important = parsed.clarifications.filter((item) => !item.optional);
  if (!parsed.clarifications.length) { box.classList.add("hidden"); return; }
  box.innerHTML = `<p>${important.length ? "Нужно уточнение" : "Можно сделать поиск точнее"}</p>${parsed.clarifications.map((item) => `<div class="clarification-row"><span>${escapeHtml(item.question)}</span>${item.field === "location" || item.field === "role" ? `<input data-field="${item.field}" placeholder="Введите значение"><button type="button" data-apply="${item.field}">Добавить</button>` : ""}</div>`).join("")}`;
  box.classList.remove("hidden");
  box.querySelectorAll("[data-apply]").forEach((button) => button.addEventListener("click", () => {
    const input = box.querySelector(`[data-field="${button.dataset.apply}"]`);
    if (input?.value.trim()) { $("#query").value += ` ${input.value.trim()}`; parseCurrent(); }
  }));
}

let parseTimer;
async function parseCurrent() {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(async () => {
    try { renderQuery(await api("/api/parse-query", { query: $("#query").value })); } catch { /* search shows actionable error */ }
  }, 180);
}

function renderJob(job) {
  const node = $("#jobTemplate").content.firstElementChild.cloneNode(true);
  const hue = Math.max(28, Math.min(128, 28 + job.matchPercent));
  node.style.setProperty("--match-hue", hue);
  node.querySelector("h3").textContent = job.title;
  node.querySelector(".match-badge").textContent = `${job.matchPercent}% совпадения`;
  node.querySelector(".bucket-badge").textContent = job.andMatch ? "полное И" : "частичное ИЛИ";
  node.querySelector(".freshness").textContent = ageText(job.postedAt);
  node.querySelector(".company").textContent = job.company;
  node.querySelector(".company-status").innerHTML = job.companyVerified ? '<span class="icon verified">✓</span> подтверждена' : "компания не подтверждена";
  node.querySelector(".description").textContent = job.description || "Описание отсутствует";
  node.querySelector(".job-tags").innerHTML = [...(job.skills || []).slice(0, 5), job.remote ? "Удалённо" : null, job.relocation ? "Релокация" : null].filter(Boolean).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  node.querySelector(".salary").textContent = salaryText(job);
  node.querySelector(".location").textContent = job.location || (job.remote ? "Remote" : "Не указана");
  const source = job.source || {};
  node.querySelector(".source").innerHTML = source.attributionUrl ? `<a href="${escapeHtml(source.attributionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name || source.id)}</a>${job.sources?.length > 1 ? ` · ${job.sources.length} источника` : ""}` : escapeHtml(source.name || source.id || "Не указан");
  const verification = job.verification || { status: "unverified", score: 0, risks: [] };
  const statusMap = { verified: "Проверена", probable: "Вероятно подлинная", unverified: "Не проверена", suspicious: "Подозрительная", stale: "Неактуальная" };
  const verificationNode = node.querySelector(".verification");
  verificationNode.textContent = `${statusMap[verification.status] || verification.status} · ${verification.score}/100`;
  verificationNode.classList.add(["suspicious", "stale"].includes(verification.status) ? "risk" : "ok");
  const link = node.querySelector(".open-job"); link.href = job.url; link.setAttribute("aria-label", `Открыть вакансию ${job.title} на ${source.name || "источнике"}`);
  const parts = Object.entries(job.scoreBreakdown || {});
  node.querySelector(".score-bars").innerHTML = parts.map(([key, value]) => `<span title="${escapeHtml(key)}: ${value}" style="--width:${Math.min(100, value * 1.4)}%"></span>`).join("");
  node.querySelector(".missing").textContent = job.missingTags?.length ? `Не совпало: ${job.missingTags.join(", ")}` : "Все обязательные теги совпали.";
  return node;
}

function renderResults(response) {
  state.response = response;
  $("#resultCount").textContent = response.total;
  const exact = response.results.filter((job) => job.andMatch).length;
  $("#resultSummary").textContent = `${exact} полностью соответствуют всем обязательным тегам · остальные отсортированы по числу и весу совпадений`;
  const container = $("#results"); container.replaceChildren(...response.results.map(renderJob));
  $("#resultsSection").classList.remove("hidden");
  $("#resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
  updateSourceHealth(response.sources);
  renderSourceReport(response.refreshReport || [], response.sources || []);
}

function updateSourceHealth(sources = []) {
  const ok = sources.filter((source) => source.status === "ok").length;
  const unavailable = sources.filter((source) => ["error", "cooldown"].includes(source.status)).length;
  const disabled = sources.filter((source) => source.status === "disabled").length;
  $("#sourceHealth").innerHTML = `<span class="pulse"></span><span>${ok ? `Обновлено: ${ok}` : "Локальная база готова"}${unavailable ? ` · на паузе: ${unavailable}` : ""}${disabled ? ` · настройка: ${disabled}` : ""}</span>`;
}

function renderSourceReport(refreshReport, sources) {
  const box = $("#sourceReport");
  if (!refreshReport.length) { box.classList.add("hidden"); return; }
  const names = new Map(sources.map((source) => [source.id, source.name]));
  const label = { fulfilled: "обновлён", rejected: "ошибка", skipped: "пауза", disabled: "не настроен" };
  const errorText = (value) => {
    if (value === "fetch failed") return "Нет сетевого доступа из текущего окружения";
    if (value?.includes("cloudflare_challenge")) return "Антибот-защита источника; повтор после паузы";
    return value;
  };
  box.innerHTML = `<strong>Состояние источников</strong><ul>${refreshReport.map((item) => `<li><span>${escapeHtml(names.get(item.source) || item.source)}</span><b data-status="${escapeHtml(item.status)}">${label[item.status] || escapeHtml(item.status)}</b>${item.error ? `<small>${escapeHtml(errorText(item.error))}</small>` : ""}</li>`).join("")}</ul>`;
  box.classList.remove("hidden");
}

async function runSearch({ refresh = $("#refreshSources").checked } = {}) {
  if (state.searching) return;
  state.searching = true;
  $("#processing").classList.remove("hidden");
  $("#processingText").textContent = refresh ? "Запрашиваем live API, нормализуем поля, проверяем риски и удаляем дубли…" : "Разбираем теги, оцениваем совпадения и сортируем результаты…";
  try {
    const response = await api("/api/search", { query: $("#query").value, sort: sortSpec(), refresh, limit: 100 });
    renderQuery(response.query); renderResults(response);
  } catch (error) {
    $("#processingText").textContent = `Не удалось выполнить поиск: ${error.message}`;
  } finally {
    state.searching = false;
    setTimeout(() => $("#processing").classList.add("hidden"), 500);
  }
}

$("#query").addEventListener("input", parseCurrent);
$("#searchForm").addEventListener("submit", (event) => { event.preventDefault(); runSearch(); });
$("#primarySort").addEventListener("change", () => runSearch({ refresh: false }));
$("#secondarySort").addEventListener("change", () => runSearch({ refresh: false }));

const events = new EventSource("/api/events");
events.addEventListener("jobs", () => { if ($("#watchSearch").checked && state.response) runSearch({ refresh: false }); });
events.addEventListener("source", (event) => { try { updateSourceHealth([JSON.parse(event.data)]); } catch {} });

parseCurrent();
