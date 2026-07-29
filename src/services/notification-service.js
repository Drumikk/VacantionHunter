import crypto from "node:crypto";

export class TelegramError extends Error {
  constructor(message, { status = null, retryAfterMs = null, code = null } = {}) {
    super(message);
    this.name = "TelegramError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

function salaryText(job) {
  const salary = job.salary;
  if (!salary || (salary.min == null && salary.max == null)) return null;
  const range = salary.max != null ? `${salary.min || 0}–${salary.max}` : `от ${salary.min}`;
  const period = { hour: "/час", day: "/день", week: "/нед.", month: "/мес.", year: "/год" }[salary.period] || "";
  return `${range} ${salary.currency || ""}${period}`.trim();
}

function shorten(value, length) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1))}…`;
}

export function watchMessage(watch, jobs, { maxJobs = 5 } = {}) {
  const visible = jobs.slice(0, maxJobs);
  const lines = [`🔔 Новые вакансии: ${jobs.length}`, `Поиск: ${shorten(watch.query, 180)}`, ""];
  visible.forEach((job, index) => {
    const details = [job.company, job.location || (job.remote ? "Remote" : null), salaryText(job)].filter(Boolean).join(" · ");
    lines.push(`${index + 1}. ${shorten(job.title, 140)}`);
    if (details) lines.push(shorten(details, 220));
    if (job.url) lines.push(job.url);
    lines.push("");
  });
  if (jobs.length > visible.length) lines.push(`Ещё ${jobs.length - visible.length} вакансий доступны в VacationHunter.`);
  return shorten(lines.join("\n").trim(), 4_000);
}

export class TelegramClient {
  constructor({ token, chatId, timeoutMs = 8_000, fetchImpl = fetch, silent = false }) {
    this.token = token;
    this.chatId = chatId;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.silent = silent;
  }

  async sendMessage(text) {
    return this.request("sendMessage", {
      chat_id: this.chatId,
      text: shorten(text, 4_000),
      disable_notification: this.silent,
      link_preview_options: { is_disabled: true },
    });
  }

  async getUpdates() {
    return this.request("getUpdates", { limit: 100, timeout: 0, allowed_updates: ["message", "channel_post", "my_chat_member"] });
  }

  async request(method, payload) {
    const safeToken = encodeURIComponent(this.token).replace("%3A", ":");
    const response = await this.fetchImpl(`https://api.telegram.org/bot${safeToken}/${method}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    let data = null;
    try { data = await response.json(); } catch { /* handled as an invalid API response below */ }
    if (!response.ok || !data?.ok) {
      const description = shorten(data?.description || `HTTP ${response.status}`, 300);
      throw new TelegramError(`Telegram API: ${description}`, {
        status: response.status,
        code: data?.error_code || response.status,
        retryAfterMs: Number(data?.parameters?.retry_after || 0) * 1_000 || null,
      });
    }
    return data.result;
  }
}

export class NotificationService {
  #flushPromise = null;

  constructor({ outbox, config, fetchImpl = fetch }) {
    this.outbox = outbox;
    this.config = config;
    this.enabled = Boolean(config.telegramBotToken && config.telegramChatId);
    this.client = config.telegramBotToken ? new TelegramClient({
      token: config.telegramBotToken,
      chatId: config.telegramChatId,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl,
      silent: config.telegramSilent,
    }) : null;
  }

  async initialize() { await this.outbox.load(); }

  status() {
    return {
      id: "telegram",
      name: "Telegram",
      enabled: this.enabled,
      status: this.enabled ? (this.outbox.stats().failed ? "degraded" : "ready") : "disabled",
      botConfigured: Boolean(this.config.telegramBotToken),
      chatConfigured: Boolean(this.config.telegramChatId),
      canDiscover: Boolean(this.config.telegramBotToken),
      credentialFields: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
      setupUrl: "https://core.telegram.org/bots/features#botfather",
      ...this.outbox.stats(),
    };
  }

  async enqueueWatchJobs(watch, jobs) {
    if (!this.enabled || !jobs.length) return null;
    const ids = jobs.map((job) => job.id).sort().join("|");
    const dedupeKey = `telegram:${watch.id}:${crypto.createHash("sha256").update(ids).digest("hex")}`;
    return this.outbox.enqueue({
      channel: "telegram",
      dedupeKey,
      payload: { text: watchMessage(watch, jobs, { maxJobs: this.config.notificationMaxJobs }) },
    });
  }

  async flush() {
    if (!this.enabled) return [];
    if (this.#flushPromise) return this.#flushPromise;
    this.#flushPromise = this.#doFlush().finally(() => { this.#flushPromise = null; });
    return this.#flushPromise;
  }

  async #doFlush() {
    const reports = [];
    for (const entry of this.outbox.pending({ limit: this.config.notificationBatchSize })) {
      try {
        const message = await this.client.sendMessage(entry.payload.text);
        await this.outbox.markSent(entry.id, message?.message_id);
        reports.push({ id: entry.id, status: "sent" });
      } catch (error) {
        const exponential = this.config.notificationRetryBaseMs * 2 ** Math.min(entry.attempts, 6);
        const updated = await this.outbox.markFailed(entry.id, error, {
          delayMs: error.retryAfterMs ?? exponential,
          maxAttempts: this.config.notificationMaxAttempts,
        });
        reports.push({ id: entry.id, status: updated.status, error: updated.lastError, nextAttemptAt: updated.nextAttemptAt });
      }
    }
    return reports;
  }

  async sendTest() {
    if (!this.enabled) {
      const error = new Error("Telegram не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
      error.statusCode = 409;
      throw error;
    }
    const message = await this.client.sendMessage("✅ VacationHunter подключён. Новые вакансии из сохранённых поисков будут приходить в этот чат.");
    return { sent: true, messageId: message?.message_id == null ? null : String(message.message_id) };
  }

  async retryFailed() {
    if (!this.enabled) return [];
    await this.outbox.retryFailed();
    return this.flush();
  }

  async discoverChats() {
    if (!this.config.telegramBotToken) {
      const error = new Error("Сначала задайте TELEGRAM_BOT_TOKEN и перезапустите приложение");
      error.statusCode = 409;
      throw error;
    }
    const updates = await this.client.getUpdates();
    const chats = new Map();
    for (const update of Array.isArray(updates) ? updates : []) {
      const chat = update.message?.chat || update.channel_post?.chat || update.my_chat_member?.chat;
      if (!chat?.id) continue;
      chats.set(String(chat.id), {
        id: String(chat.id),
        type: chat.type || "unknown",
        title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Telegram chat",
        username: chat.username || null,
      });
    }
    return { chats: [...chats.values()] };
  }
}
