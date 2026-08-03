const $ = (selector) => document.querySelector(selector);
const state = { parsed: null, response: null, searching: false, watches: [], watchBusy: false, sources: [], sourceBusy: new Set(), notification: null, notificationBusy: false, discoveredChats: [], applications: [], applicationSummary: { total: 0, active: 0, counts: {} }, applicationBusy: new Set(), applicationDrafts: new Map(), pipelineOpen: false };
const formatter = new Intl.NumberFormat("ru-RU");
const applicationLabels = { saved: "Сохранено", applied: "Отклик отправлен", screening: "Скрининг", interview: "Интервью", offer: "Оффер", rejected: "Отказ", withdrawn: "Не актуально" };
const pipelineColumns = [
  { id: "saved", title: "Сохранено", statuses: ["saved"] },
  { id: "applied", title: "Отклик", statuses: ["applied", "screening"] },
  { id: "interview", title: "Интервью", statuses: ["interview"] },
  { id: "offer", title: "Оффер", statuses: ["offer"] },
  { id: "closed", title: "Завершено", statuses: ["rejected", "withdrawn"] },
];

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

async function api(path, payload, method = "POST") {
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (payload !== undefined) options.body = JSON.stringify(payload);
  const response = await fetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function queryKey(query) { return String(query || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU"); }
function currentWatch(query) { return state.watches.find((watch) => queryKey(watch.query) === queryKey(query)); }
function applicationFor(jobId) { return state.applications.find((application) => application.jobId === jobId); }
function renderWatches() {
  const box = $("#savedSearches");
  if (!state.watches.length) { box.classList.add("hidden"); return; }
  $("#savedSearchCount").textContent = `${state.watches.length} из 25`;
  $("#savedSearchList").innerHTML = state.watches.map((watch) => `
    <div class="saved-search-item">
      <button type="button" class="saved-search-open" data-open-watch="${escapeHtml(watch.id)}" title="Открыть сохранённый поиск">
        <span>${escapeHtml(watch.query)}</span>${watch.newCount ? `<b>+${watch.newCount} новых</b>` : ""}
      </button>
      <button type="button" class="saved-search-remove" data-remove-watch="${escapeHtml(watch.id)}" aria-label="Удалить наблюдение: ${escapeHtml(watch.query)}">×</button>
    </div>`).join("");
  box.classList.remove("hidden");
}
function syncWatchState(query, message = null, tone = "") {
  const watch = currentWatch(query);
  $("#watchSearch").checked = Boolean(watch);
  const status = $("#watchStatus");
  status.textContent = message || (watch?.newCount ? `${watch.newCount} новых вакансий` : watch ? "Сохранено · обновляется в фоне" : "Наблюдение выключено");
  status.className = tone || (watch?.newCount ? "new" : watch ? "ok" : "");
}

async function loadWatches() {
  try {
    state.watches = (await api("/api/watches", undefined, "GET")).watches || [];
    renderWatches();
    syncWatchState(state.response?.query?.raw || $("#query").value);
  } catch (error) {
    syncWatchState(state.response?.query?.raw || $("#query").value, `Не удалось загрузить: ${error.message}`, "error");
  }
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

function statusOptions(current) {
  return Object.entries(applicationLabels).map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`).join("");
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function pipelineGroupItems(column) {
  return state.applications.filter((item) => column.statuses.includes(item.status)).sort((a, b) => {
    const aNext = a.nextActionAt ? Date.parse(a.nextActionAt) : Number.POSITIVE_INFINITY;
    const bNext = b.nextActionAt ? Date.parse(b.nextActionAt) : Number.POSITIVE_INFINITY;
    return aNext - bNext || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function renderPipeline() {
  const summary = state.applicationSummary;
  $("#pipelineCount").textContent = summary.total || 0;
  $("#pipelineSummary").innerHTML = `<span><strong>${summary.total || 0}</strong> всего</span><span><strong>${summary.active || 0}</strong> активных</span><span><strong>${summary.counts?.interview || 0}</strong> интервью</span><span><strong>${summary.counts?.offer || 0}</strong> офферов</span>`;
  if (!state.applications.length) {
    $("#pipelineBoard").innerHTML = '<div class="pipeline-empty"><strong>Воронка пока пуста</strong><p>Сохраните подходящую вакансию из выдачи — её карточка, ссылка и заметки останутся здесь.</p><button type="button" data-empty-back>Перейти к поиску</button></div>';
    return;
  }
  $("#pipelineBoard").innerHTML = pipelineColumns.map((column) => {
    const items = pipelineGroupItems(column);
    return `<section class="pipeline-column" data-pipeline-column="${column.id}">
      <header><h2>${column.title}</h2><b>${items.length}</b></header>
      <div class="pipeline-column-list">${items.map((item) => {
        const job = item.job;
        const due = item.nextActionAt && Date.parse(item.nextActionAt) < Date.now();
        return `<article class="pipeline-card" data-pipeline-job="${escapeHtml(item.jobId)}">
          <div class="pipeline-card-stage"><span data-stage="${escapeHtml(item.status)}">${escapeHtml(applicationLabels[item.status] || item.status)}</span><small>${escapeHtml(dateTimeText(item.statusChangedAt))}</small></div>
          <h3>${escapeHtml(job.title)}</h3><p class="pipeline-company">${escapeHtml(job.company)}${job.location ? ` · ${escapeHtml(job.location)}` : ""}</p>
          <p class="pipeline-salary">${escapeHtml(salaryText(job))}</p>
          <label>Этап<select data-pipeline-status>${statusOptions(item.status)}</select></label>
          <label>Следующее действие<input type="datetime-local" data-next-action value="${escapeHtml(localDateTimeValue(item.nextActionAt))}" class="${due ? "overdue" : ""}"></label>
          <label>Заметка<textarea rows="3" maxlength="4000" data-application-notes placeholder="Контакт, детали интервью, следующий шаг…">${escapeHtml(state.applicationDrafts.has(item.jobId) ? state.applicationDrafts.get(item.jobId) : item.notes || "")}</textarea></label>
          <div class="pipeline-card-actions"><button type="button" data-save-notes>Сохранить заметку</button><a href="${escapeHtml(job.applyUrl || job.url)}" target="_blank" rel="noopener noreferrer">Открыть ↗</a><button type="button" class="remove-application" data-remove-application aria-label="Удалить ${escapeHtml(job.title)} из воронки">Удалить</button></div>
        </article>`;
      }).join("") || '<p class="pipeline-column-empty">Пока пусто</p>'}</div>
    </section>`;
  }).join("");
}

function refreshJobCards() {
  if (!state.response) return;
  $("#results").replaceChildren(...state.response.results.map(renderJob));
}

async function loadApplications() {
  try {
    const response = await api("/api/applications", undefined, "GET");
    state.applications = response.items || [];
    state.applicationSummary = response.summary || { total: 0, active: 0, counts: {} };
    renderPipeline();
    refreshJobCards();
  } catch (error) {
    $("#pipelineSummary").textContent = `Не удалось загрузить воронку: ${error.message}`;
  }
}

async function saveApplication(jobId, patch = {}) {
  if (!jobId || state.applicationBusy.has(jobId)) return null;
  state.applicationBusy.add(jobId);
  refreshJobCards();
  try {
    const existing = applicationFor(jobId);
    const result = existing
      ? await api(`/api/applications/${encodeURIComponent(jobId)}`, patch, "PATCH")
      : await api("/api/applications", { jobId, ...patch });
    if (Object.hasOwn(patch, "notes")) state.applicationDrafts.delete(jobId);
    state.applications = [result.application, ...state.applications.filter((item) => item.jobId !== jobId)];
    await loadApplications();
    return result.application;
  } catch (error) {
    window.alert(`Не удалось обновить воронку: ${error.message}`);
    return null;
  } finally {
    state.applicationBusy.delete(jobId);
    refreshJobCards();
  }
}

async function removeApplication(jobId) {
  if (!jobId || state.applicationBusy.has(jobId)) return;
  state.applicationBusy.add(jobId);
  try {
    await api(`/api/applications/${encodeURIComponent(jobId)}`, undefined, "DELETE");
    state.applicationDrafts.delete(jobId);
    state.applications = state.applications.filter((item) => item.jobId !== jobId);
    await loadApplications();
  } catch (error) {
    window.alert(`Не удалось удалить вакансию: ${error.message}`);
  } finally {
    state.applicationBusy.delete(jobId);
  }
}

function openPipeline(jobId = null) {
  state.pipelineOpen = true;
  $("#hero").classList.add("hidden");
  $("#resultsSection").classList.add("hidden");
  $("#processing").classList.add("hidden");
  $("#pipelineSection").classList.remove("hidden");
  $("#pipelineButton").setAttribute("aria-current", "page");
  renderPipeline();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (jobId) requestAnimationFrame(() => document.querySelector(`[data-pipeline-job="${CSS.escape(jobId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function closePipeline() {
  state.pipelineOpen = false;
  $("#pipelineSection").classList.add("hidden");
  $("#hero").classList.remove("hidden");
  if (state.response) $("#resultsSection").classList.remove("hidden");
  $("#pipelineButton").removeAttribute("aria-current");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderJob(job) {
  const node = $("#jobTemplate").content.firstElementChild.cloneNode(true);
  node.dataset.jobId = job.id;
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
  const application = applicationFor(job.id);
  const busy = state.applicationBusy.has(job.id);
  const saveButton = node.querySelector(".save-job");
  saveButton.dataset.saveJob = job.id;
  saveButton.disabled = busy;
  saveButton.textContent = busy ? "Сохраняем…" : application ? `✓ ${applicationLabels[application.status]}` : "☆ Сохранить";
  saveButton.classList.toggle("tracked", Boolean(application));
  const statusSelect = node.querySelector(".job-status-select");
  statusSelect.dataset.jobStatus = job.id;
  statusSelect.value = application?.status || "";
  statusSelect.disabled = busy;
  const parts = Object.entries(job.scoreBreakdown || {});
  node.querySelector(".score-bars").innerHTML = parts.map(([key, value]) => `<span title="${escapeHtml(key)}: ${value}" style="--width:${Math.min(100, value * 1.4)}%"></span>`).join("");
  node.querySelector(".missing").textContent = job.missingTags?.length ? `Не совпало: ${job.missingTags.join(", ")}` : "Все обязательные теги совпали.";
  return node;
}

function renderResults(response, { scroll = true } = {}) {
  state.response = response;
  $("#resultCount").textContent = response.total;
  const exact = response.results.filter((job) => job.andMatch).length;
  const exactVerb = exact === 1 ? "соответствует" : "соответствуют";
  $("#resultSummary").textContent = `${exact} полностью ${exactVerb} всем обязательным тегам · остальные отсортированы по числу и весу совпадений`;
  const container = $("#results"); container.replaceChildren(...response.results.map(renderJob));
  $("#resultsSection").classList.remove("hidden");
  if (scroll) $("#resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
  updateSourceHealth(response.sources);
  renderSourceReport(response.refreshReport || [], response.sources || []);
  syncWatchState(response.query.raw);
}

function updateSourceHealth(sources = []) {
  state.sources = sources;
  const ok = sources.filter((source) => source.status === "ok").length;
  const unavailable = sources.filter((source) => ["error", "cooldown"].includes(source.status)).length;
  const disabled = sources.filter((source) => source.status === "disabled").length;
  $("#sourceHealth").innerHTML = `<span class="pulse"></span><span>${ok ? `Обновлено: ${ok}` : "Локальная база готова"}${unavailable ? ` · на паузе: ${unavailable}` : ""}${disabled ? ` · настройка: ${disabled}` : ""}</span>`;
}

function sourceStatusText(source) {
  if (source.status === "disabled") return "Нужна настройка";
  if (source.status === "loading") return "Проверяем";
  if (source.status === "ok") return "Работает";
  if (source.status === "cooldown") return "Пауза после ошибки";
  return source.enabled ? "Готов к проверке" : "Отключён";
}

function sourceAuthText(source) {
  return {
    none: "Без токена",
    api_key: "API-ключ",
    optional_api_key: "API-ключ необязателен",
    api_key_headers: "API-ключ + email",
    bearer_token_user_id: "Bearer-токен + User ID",
    identified_user_agent: "Контактный User-Agent",
  }[source.authType] || source.authType;
}

function dateTimeText(value) {
  if (!value) return "ещё не запускался";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function renderSources(sources = state.sources) {
  state.sources = sources;
  updateSourceHealth(sources);
  const ready = sources.filter((source) => source.enabled).length;
  const needsSetup = sources.length - ready;
  $("#sourcesSummary").innerHTML = `<strong>${ready} готово</strong><span>${needsSetup ? `${needsSetup} требуют настройки` : "Все источники подключены"}</span>`;
  $("#sourceList").innerHTML = sources.map((source) => {
    const busy = state.sourceBusy.has(source.id) || source.status === "loading";
    const cooldown = source.cooldownUntil && Date.parse(source.cooldownUntil) > Date.now();
    const canRefresh = source.enabled && source.refreshable && !busy && !cooldown;
    const credentials = source.credentialFields?.length ? `<div class="source-credentials"><span>В <code>.env</code></span>${source.credentialFields.map((field) => `<code>${escapeHtml(field)}</code>`).join("")}</div>` : "";
    const problem = source.disabledReason || source.lastError;
    return `<article class="source-card" data-source-id="${escapeHtml(source.id)}">
      <div class="source-card-head"><div><h3>${escapeHtml(source.name)}</h3><span>${escapeHtml(source.adapter)} · ${source.officialApi ? "официальный API" : "публичный источник"}</span></div><b data-source-status="${escapeHtml(source.status)}">${escapeHtml(sourceStatusText(source))}</b></div>
      <div class="source-meta"><span>${escapeHtml(sourceAuthText(source))}</span><span>${escapeHtml((source.regions || ["global"]).join(", "))}</span><span>Последний успех: ${escapeHtml(dateTimeText(source.lastSuccessAt))}</span>${source.count != null ? `<span>Получено: ${escapeHtml(source.count)}</span>` : ""}</div>
      ${source.note ? `<p>${escapeHtml(source.note)}</p>` : ""}
      ${problem ? `<p class="source-problem">${escapeHtml(problem)}</p>` : ""}
      ${cooldown ? `<p class="source-problem">Повтор после ${escapeHtml(dateTimeText(source.cooldownUntil))}</p>` : ""}
      ${credentials}
      <div class="source-actions">
        ${source.refreshable ? `<button type="button" data-refresh-source="${escapeHtml(source.id)}" ${canRefresh ? "" : "disabled"}>${busy ? "Проверяем…" : source.enabled ? cooldown ? "На паузе" : "Проверить сейчас" : "Сначала настроить"}</button>` : `<span class="source-static">Встроенные тестовые данные</span>`}
        ${source.setupUrl ? `<a href="${escapeHtml(source.setupUrl)}" target="_blank" rel="noopener noreferrer">${source.enabled ? "Документация" : "Получить доступ"} ↗</a>` : source.attributionUrl ? `<a href="${escapeHtml(source.attributionUrl)}" target="_blank" rel="noopener noreferrer">Открыть источник ↗</a>` : ""}
      </div>
    </article>`;
  }).join("");
}

async function loadSources() {
  try { renderSources(await api("/api/sources", undefined, "GET")); }
  catch (error) { $("#sourcesSummary").textContent = `Не удалось загрузить источники: ${error.message}`; }
}

function renderNotification(notification = state.notification, message = null, tone = "") {
  state.notification = notification;
  const box = $("#notificationCenter");
  if (!notification) { box.innerHTML = '<div class="notification-loading">Проверяем канал уведомлений…</div>'; return; }
  const ready = notification.enabled;
  const statusText = ready ? notification.status === "degraded" ? "Требует внимания" : "Подключён" : "Не настроен";
  const lastSent = notification.lastSentAt ? dateTimeText(notification.lastSentAt) : "ещё не отправлялись";
  const missing = [!notification.botConfigured ? "TELEGRAM_BOT_TOKEN" : null, !notification.chatConfigured ? "TELEGRAM_CHAT_ID" : null].filter(Boolean);
  box.innerHTML = `<div class="notification-head">
      <div><p class="eyebrow">Доставка новых вакансий</p><h3 id="notificationTitle">Telegram</h3></div>
      <b data-notification-status="${escapeHtml(notification.status)}">${escapeHtml(statusText)}</b>
    </div>
    <p>${ready ? "Новые совпадения из сохранённых поисков автоматически отправляются в настроенный чат." : "Создайте бота через @BotFather, напишите ему /start и добавьте реквизиты в .env."}</p>
    <div class="notification-stats"><span>В очереди: <strong>${notification.pending || 0}</strong></span><span>Отправлено: <strong>${notification.sent || 0}</strong></span><span>Ошибок: <strong>${notification.failed || 0}</strong></span><span>Последняя доставка: <strong>${escapeHtml(lastSent)}</strong></span></div>
    ${missing.length ? `<div class="source-credentials"><span>Добавьте в <code>.env</code></span>${missing.map((field) => `<code>${field}</code>`).join("")}</div>` : ""}
    ${state.discoveredChats.length ? `<div class="discovered-chats"><strong>Найденные чаты</strong>${state.discoveredChats.map((chat) => `<div><span>${escapeHtml(chat.title)} · ${escapeHtml(chat.type)}</span><code>${escapeHtml(chat.id)}</code></div>`).join("")}<small>Скопируйте нужный ID в <code>TELEGRAM_CHAT_ID</code> и перезапустите приложение.</small></div>` : ""}
    ${notification.lastError ? `<p class="source-problem">${escapeHtml(notification.lastError)}</p>` : ""}
    ${message ? `<p class="notification-message ${escapeHtml(tone)}" role="status">${escapeHtml(message)}</p>` : ""}
    <div class="source-actions notification-actions">
      <button type="button" data-test-notification ${ready && !state.notificationBusy ? "" : "disabled"}>${state.notificationBusy ? "Отправляем…" : "Отправить тест"}</button>
      ${notification.canDiscover && !notification.chatConfigured ? `<button type="button" class="secondary-action" data-discover-chats ${state.notificationBusy ? "disabled" : ""}>Найти chat ID</button>` : ""}
      ${notification.pending || notification.failed ? `<button type="button" class="secondary-action" data-flush-notifications ${state.notificationBusy ? "disabled" : ""}>Повторить очередь</button>` : ""}
      <a href="${escapeHtml(notification.setupUrl || "https://core.telegram.org/bots/features#botfather")}" target="_blank" rel="noopener noreferrer">Настройка бота ↗</a>
    </div>`;
}

async function loadNotification() {
  try { renderNotification(await api("/api/notifications/status", undefined, "GET")); }
  catch (error) { $("#notificationCenter").innerHTML = `<p class="source-problem">Не удалось загрузить уведомления: ${escapeHtml(error.message)}</p>`; }
}

async function notificationAction(action) {
  if (state.notificationBusy) return;
  state.notificationBusy = true;
  renderNotification();
  try {
    const result = await api(`/api/notifications/${action}`, {});
    if (action === "discover") state.discoveredChats = result.chats || [];
    const status = result.status || await api("/api/notifications/status", undefined, "GET");
    state.notificationBusy = false;
    const successText = action === "test" ? "Тестовое сообщение отправлено." : action === "discover" ? state.discoveredChats.length ? `Найдено чатов: ${state.discoveredChats.length}.` : "Чаты не найдены. Напишите боту /start и повторите." : "Очередь обработана.";
    renderNotification(status, successText, "ok");
  } catch (error) {
    const status = await api("/api/notifications/status", undefined, "GET").catch(() => state.notification);
    state.notificationBusy = false;
    renderNotification(status, `Не удалось отправить: ${error.message}`, "error");
  }
}

async function refreshSource(sourceId) {
  if (state.sourceBusy.has(sourceId)) return;
  state.sourceBusy.add(sourceId);
  renderSources();
  try {
    const result = await api(`/api/sources/${encodeURIComponent(sourceId)}/check`, { query: state.response?.query?.raw || $("#query").value || "работа" });
    await loadSources();
    renderSourceReport(result.result ? [result.result] : [], state.sources);
    if (state.response) {
      const response = await api("/api/search", { query: state.response.query.raw, sort: sortSpec(), refresh: false, limit: 100 });
      renderQuery(response.query);
      renderResults(response, { scroll: false });
    }
  } catch (error) {
    const source = state.sources.find((item) => item.id === sourceId);
    renderSourceReport([{ source: sourceId, status: "rejected", error: error.message }], state.sources);
    if (source) source.lastError = error.message;
  } finally {
    state.sourceBusy.delete(sourceId);
    await loadSources();
  }
}

function openSources() {
  loadNotification();
  $("#sourcesPanel").classList.remove("hidden");
  $("#sourcesBackdrop").classList.remove("hidden");
  $("#sourceHealth").setAttribute("aria-expanded", "true");
  document.body.classList.add("panel-open");
  $("#sourcesClose").focus();
}

function closeSources() {
  $("#sourcesPanel").classList.add("hidden");
  $("#sourcesBackdrop").classList.add("hidden");
  $("#sourceHealth").setAttribute("aria-expanded", "false");
  document.body.classList.remove("panel-open");
  $("#sourceHealth").focus();
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
    return response;
  } catch (error) {
    $("#processingText").textContent = `Не удалось выполнить поиск: ${error.message}`;
    return null;
  } finally {
    state.searching = false;
    setTimeout(() => $("#processing").classList.add("hidden"), 500);
  }
}

$("#query").addEventListener("input", parseCurrent);
$("#searchForm").addEventListener("submit", (event) => { event.preventDefault(); runSearch(); });
$("#primarySort").addEventListener("change", () => runSearch({ refresh: false }));
$("#secondarySort").addEventListener("change", () => runSearch({ refresh: false }));
$("#sourceHealth").addEventListener("click", openSources);
$("#pipelineButton").addEventListener("click", () => openPipeline());
$("#pipelineBack").addEventListener("click", closePipeline);
$("#sourcesClose").addEventListener("click", closeSources);
$("#sourcesBackdrop").addEventListener("click", closeSources);
$("#sourceList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-refresh-source]");
  if (button) refreshSource(button.dataset.refreshSource);
});
$("#notificationCenter").addEventListener("click", (event) => {
  if (event.target.closest("[data-test-notification]")) notificationAction("test");
  if (event.target.closest("[data-flush-notifications]")) notificationAction("flush");
  if (event.target.closest("[data-discover-chats]")) notificationAction("discover");
});
$("#results").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-job]");
  if (!button) return;
  const existing = applicationFor(button.dataset.saveJob);
  if (existing) return openPipeline(existing.jobId);
  await saveApplication(button.dataset.saveJob, { status: "saved" });
});
$("#results").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-job-status]");
  if (!select?.value) return;
  await saveApplication(select.dataset.jobStatus, { status: select.value });
});
$("#pipelineBoard").addEventListener("click", async (event) => {
  if (event.target.closest("[data-empty-back]")) return closePipeline();
  const card = event.target.closest("[data-pipeline-job]");
  if (!card) return;
  const jobId = card.dataset.pipelineJob;
  if (event.target.closest("[data-remove-application]")) return removeApplication(jobId);
  if (event.target.closest("[data-save-notes]")) {
    const notes = card.querySelector("[data-application-notes]").value;
    await saveApplication(jobId, { notes });
  }
});
$("#pipelineBoard").addEventListener("change", async (event) => {
  const card = event.target.closest("[data-pipeline-job]");
  if (!card) return;
  if (event.target.matches("[data-pipeline-status]")) await saveApplication(card.dataset.pipelineJob, { status: event.target.value });
  if (event.target.matches("[data-next-action]")) {
    const value = event.target.value ? new Date(event.target.value).toISOString() : null;
    await saveApplication(card.dataset.pipelineJob, { nextActionAt: value });
  }
});
$("#pipelineBoard").addEventListener("input", (event) => {
  if (!event.target.matches("[data-application-notes]")) return;
  const card = event.target.closest("[data-pipeline-job]");
  if (card) state.applicationDrafts.set(card.dataset.pipelineJob, event.target.value);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#sourcesPanel").classList.contains("hidden")) closeSources(); });
$("#watchSearch").addEventListener("change", async (event) => {
  if (state.watchBusy) return;
  const query = state.response?.query?.raw || $("#query").value.trim();
  if (!query) { event.target.checked = false; return syncWatchState(query, "Сначала выполните поиск", "error"); }
  state.watchBusy = true;
  event.target.disabled = true;
  try {
    if (event.target.checked) {
      const { watch } = await api("/api/watches", { query });
      state.watches = [watch, ...state.watches.filter((item) => item.id !== watch.id)];
      renderWatches();
      syncWatchState(query, "Сохранено · обновляется в фоне", "ok");
    } else {
      const watch = currentWatch(query);
      if (watch) await api(`/api/watches/${encodeURIComponent(watch.id)}`, undefined, "DELETE");
      state.watches = state.watches.filter((item) => item.id !== watch?.id);
      renderWatches();
      syncWatchState(query, "Наблюдение выключено");
    }
  } catch (error) {
    await loadWatches();
    syncWatchState(query, `Не удалось изменить: ${error.message}`, "error");
  } finally {
    state.watchBusy = false;
    event.target.disabled = false;
  }
});
$("#savedSearchList").addEventListener("click", async (event) => {
  const openId = event.target.dataset.openWatch;
  const removeId = event.target.dataset.removeWatch;
  if (openId) {
    const watch = state.watches.find((item) => item.id === openId);
    if (!watch) return;
    $("#query").value = watch.query;
    parseCurrent();
    const response = await runSearch({ refresh: false });
    if (!response) return;
    try {
      const { watch: acknowledged } = await api(`/api/watches/${encodeURIComponent(openId)}/acknowledge`, {});
      state.watches = state.watches.map((item) => item.id === openId ? acknowledged : item);
      renderWatches();
      syncWatchState(watch.query);
    } catch (error) {
      syncWatchState(watch.query, `Выдача открыта, но отметка просмотра не сохранена: ${error.message}`, "error");
    }
    return;
  }
  if (removeId) {
    const watch = state.watches.find((item) => item.id === removeId);
    if (!watch) return;
    event.target.disabled = true;
    try {
      await api(`/api/watches/${encodeURIComponent(removeId)}`, undefined, "DELETE");
      state.watches = state.watches.filter((item) => item.id !== removeId);
      renderWatches();
      syncWatchState(state.response?.query?.raw || $("#query").value, "Наблюдение удалено");
    } catch (error) {
      event.target.disabled = false;
      syncWatchState(state.response?.query?.raw || $("#query").value, `Не удалось удалить: ${error.message}`, "error");
    }
  }
});

const events = new EventSource("/api/events");
events.addEventListener("jobs", () => { if ($("#watchSearch").checked && state.response) runSearch({ refresh: false }); });
events.addEventListener("source", (event) => {
  try {
    const changed = JSON.parse(event.data);
    renderSources(state.sources.map((source) => source.id === changed.id ? { ...source, ...changed } : source));
  } catch { /* the next source snapshot will resynchronize state */ }
});
events.addEventListener("watch", () => loadWatches());
events.addEventListener("watch-jobs", (event) => {
  try {
    const { watch } = JSON.parse(event.data);
    state.watches = [watch, ...state.watches.filter((item) => item.id !== watch.id)];
    renderWatches();
    syncWatchState(state.response?.query?.raw || $("#query").value);
    loadNotification();
  } catch { /* a later watch snapshot will resynchronize state */ }
});
events.addEventListener("application", () => loadApplications());

loadWatches();
loadSources();
loadNotification();
loadApplications();
parseCurrent();
