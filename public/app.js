const $ = (selector) => document.querySelector(selector);
const state = { parsed: null, response: null, searching: false, watches: [], watchBusy: false, sources: [], sourceBusy: new Set(), notification: null, notificationBusy: false, discoveredChats: [] };
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

function renderResults(response, { scroll = true } = {}) {
  state.response = response;
  $("#resultCount").textContent = response.total;
  const exact = response.results.filter((job) => job.andMatch).length;
  $("#resultSummary").textContent = `${exact} полностью соответствуют всем обязательным тегам · остальные отсортированы по числу и весу совпадений`;
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
    api_key_headers: "API-ключ + email",
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

loadWatches();
loadSources();
loadNotification();
parseCurrent();
