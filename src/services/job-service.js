import { EventEmitter } from "node:events";
import { parseQuery } from "../core/query-parser.js";
import { isRelevantMatch, rankJobs } from "../core/ranker.js";
import { assessJob, liveVerify } from "../core/authenticity.js";

function nextCooldown(error, failureCount, config) {
  if (error.status === 401 || error.status === 403 || error.code === "cloudflare_challenge") {
    return { reason: error.code || `http_${error.status}`, delayMs: config.sourceAuthCooldownMs };
  }
  if (error.status === 429) {
    return { reason: "rate_limited", delayMs: error.retryAfterMs || config.sourceRateLimitCooldownMs };
  }
  const exponential = config.sourceErrorCooldownMs * 2 ** Math.min(failureCount - 1, 6);
  return { reason: error.code || error.name || "source_error", delayMs: exponential };
}

function publicWatch(watch) {
  const { knownJobIds, unreadJobIds, ...details } = watch;
  return { ...details, newCount: unreadJobIds.length, newJobIds: unreadJobIds.slice(0, 100) };
}

function applicationDetails(details = {}) {
  const allowed = {};
  for (const key of ["status", "notes", "nextActionAt"]) {
    if (Object.hasOwn(details, key)) allowed[key] = details[key];
  }
  return allowed;
}

export async function mapConcurrent(items, concurrency, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Number(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

export class JobService extends EventEmitter {
  constructor({ connectors, store, watchStore = null, notificationService = null, applicationStore = null, config }) {
    super();
    this.connectors = connectors;
    this.store = store;
    this.watchStore = watchStore;
    this.notificationService = notificationService;
    this.applicationStore = applicationStore;
    this.config = config;
    this.sourceStatus = new Map(connectors.map((source) => [source.id, {
      id: source.id,
      name: source.name,
      status: source.enabled === false ? "disabled" : "idle",
      enabled: source.enabled !== false,
      disabledReason: source.disabledReason || null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      failureCount: 0,
      cooldownUntil: null,
      attributionUrl: source.attributionUrl,
      setupUrl: source.setupUrl || null,
      authType: source.authType || "none",
      credentialFields: source.credentialFields || [],
      officialApi: Boolean(source.officialApi),
      refreshable: source.id !== "demo",
      note: source.note,
      adapter: source.adapter || source.id,
      regions: source.regions || ["global"],
    }]));
    this.lastQueries = [];
  }

  parse(raw) { return parseQuery(raw); }

  searchableJobs() {
    return this.connectors.some((connector) => connector.id === "demo")
      ? this.store.jobs
      : this.store.jobs.filter((job) => !String(job.source?.id || "").startsWith("demo"));
  }

  async initialize() {
    await Promise.all([this.store.load(), this.watchStore?.load(), this.notificationService?.initialize(), this.applicationStore?.load()]);
    const demo = this.connectors.find((connector) => connector.id === "demo");
    if (demo) await this.ingestConnector(demo, parseQuery("работа"));
  }

  async ingestConnector(connector, query) {
    const status = this.sourceStatus.get(connector.id);
    if (connector.enabled === false) throw new Error(connector.disabledReason || `${connector.name} is disabled`);
    Object.assign(status, { status: "loading", lastError: null, lastAttemptAt: new Date().toISOString() });
    this.emit("source", status);
    try {
      const rawJobs = await connector.search(query);
      const jobs = rawJobs.map((job) => ({ ...job, verification: assessJob(job), ingestedAt: new Date().toISOString() }));
      await this.store.merge(jobs);
      Object.assign(status, { status: "ok", lastSuccessAt: new Date().toISOString(), count: jobs.length, failureCount: 0, cooldownUntil: null, diagnostics: connector.getDiagnostics?.() || null });
      this.emit("jobs", { source: connector.id, count: jobs.length, query: query.raw });
      return jobs;
    } catch (error) {
      const failureCount = status.failureCount + 1;
      const cooldown = nextCooldown(error, failureCount, this.config);
      Object.assign(status, {
        status: "cooldown",
        lastError: error.message,
        failureCount,
        cooldownReason: cooldown.reason,
        cooldownUntil: new Date(Date.now() + cooldown.delayMs).toISOString(),
        diagnostics: connector.getDiagnostics?.() || null,
      });
      this.emit("source", status);
      throw error;
    } finally {
      if (status.status === "loading") status.status = "idle";
    }
  }

  async refresh(rawQuery, { sourceIds = null } = {}) {
    const query = typeof rawQuery === "string" ? this.parse(rawQuery) : rawQuery;
    if (query.raw && !this.lastQueries.includes(query.raw)) this.lastQueries = [query.raw, ...this.lastQueries].slice(0, 10);
    const selected = this.connectors.filter((connector) => connector.id !== "demo" && (!sourceIds || sourceIds.includes(connector.id)));
    return mapConcurrent(selected, this.config.sourceConcurrency || 16, async (connector) => {
      const status = this.sourceStatus.get(connector.id);
      if (connector.enabled === false) {
        return { source: connector.id, status: "disabled", count: 0, error: connector.disabledReason };
      }
      if (status.cooldownUntil && Date.parse(status.cooldownUntil) > Date.now()) {
        return { source: connector.id, status: "skipped", count: 0, error: status.lastError, cooldownUntil: status.cooldownUntil };
      }
      try {
        const jobs = await this.ingestConnector(connector, query);
        return { source: connector.id, status: "fulfilled", count: jobs.length, error: null };
      } catch (error) {
        return { source: connector.id, status: "rejected", count: 0, error: error.message, cooldownUntil: status.cooldownUntil };
      }
    });
  }

  async checkSource(id, rawQuery) {
    const source = this.sourceStatus.get(id);
    if (!source) {
      const error = new Error("Источник не найден");
      error.statusCode = 404;
      throw error;
    }
    if (!source.refreshable) {
      const error = new Error("Этот источник не поддерживает ручное обновление");
      error.statusCode = 400;
      throw error;
    }
    const [result] = await this.refresh(rawQuery || this.lastQueries[0] || "работа", { sourceIds: [id] });
    return { result, source: this.sourceStatus.get(id) };
  }

  async search({ rawQuery, sort = [], refresh = false, limit = 100 }) {
    const query = this.parse(rawQuery);
    let refreshReport = [];
    if (refresh) refreshReport = await this.refresh(query);
    const results = rankJobs(this.searchableJobs(), query, { sort }).filter((job) => isRelevantMatch(job, query)).slice(0, Math.min(limit, 250));
    return { query, total: results.length, results, refreshReport, sources: this.getSources() };
  }

  async addWatch(rawQuery) {
    if (!this.watchStore) throw new Error("Хранилище наблюдений не настроено");
    const query = this.parse(rawQuery);
    const knownJobIds = this.matchingJobIds(query);
    const watch = await this.watchStore.add(query.raw, { knownJobIds });
    if (!this.lastQueries.includes(watch.query)) this.lastQueries = [watch.query, ...this.lastQueries].slice(0, 10);
    const exposed = publicWatch(watch);
    this.emit("watch", { action: "added", watch: exposed });
    return exposed;
  }

  async removeWatch(id) {
    if (!this.watchStore) return false;
    const removed = await this.watchStore.remove(id);
    if (removed) this.emit("watch", { action: "removed", id });
    return removed;
  }

  matchingJobIds(rawQuery) {
    const query = typeof rawQuery === "string" ? this.parse(rawQuery) : rawQuery;
    return rankJobs(this.searchableJobs(), query).filter((job) => isRelevantMatch(job, query)).slice(0, 250).map((job) => job.id);
  }

  async refreshWatch(id) {
    if (!this.watchStore) throw new Error("Хранилище наблюдений не настроено");
    const existing = this.watchStore.get(id);
    if (!existing) {
      const error = new Error("Наблюдение не найдено");
      error.statusCode = 404;
      throw error;
    }
    const report = await this.refresh(existing.query);
    const matchingIds = this.matchingJobIds(existing.query);
    const knownIds = new Set(existing.knownJobIds || []);
    const anticipatedNewIds = matchingIds.filter((jobId) => !knownIds.has(jobId));
    if (anticipatedNewIds.length) {
      const wanted = new Set(anticipatedNewIds);
      const jobs = this.store.jobs.filter((job) => wanted.has(job.id));
      await this.notificationService?.enqueueWatchJobs(publicWatch(existing), jobs);
    }
    const { watch, newJobIds } = await this.watchStore.recordResults(id, matchingIds);
    const exposed = publicWatch(watch);
    let notificationReport = [];
    if (newJobIds.length) {
      notificationReport = await this.notificationService?.flush() || [];
      this.emit("watch-jobs", { watch: exposed, newJobIds });
    }
    this.emit("watch", { action: "updated", watch: exposed });
    return { watch: exposed, newJobIds, report, notificationReport };
  }

  async acknowledgeWatch(id) {
    if (!this.watchStore) throw new Error("Хранилище наблюдений не настроено");
    const watch = publicWatch(await this.watchStore.acknowledge(id));
    this.emit("watch", { action: "acknowledged", watch });
    return watch;
  }

  getWatches() { return (this.watchStore?.watches || []).map(publicWatch); }
  getWatchQueries() { return (this.watchStore?.watches || []).map((watch) => watch.query); }
  getNotificationStatus() { return this.notificationService?.status() || { id: "telegram", enabled: false, status: "disabled" }; }
  async flushNotifications() { return this.notificationService?.flush() || []; }
  async retryNotifications() { return this.notificationService?.retryFailed() || []; }
  async sendTestNotification() { return this.notificationService?.sendTest(); }
  async discoverNotificationChats() { return this.notificationService?.discoverChats(); }

  getApplications({ status = null } = {}) {
    return {
      items: this.applicationStore?.list({ status }) || [],
      summary: this.applicationStore?.summary() || { total: 0, active: 0, counts: {} },
    };
  }

  async addApplication(jobId, details = {}) {
    const job = this.store.jobs.find((item) => item.id === jobId);
    if (!job) {
      const error = new Error("Вакансия не найдена");
      error.statusCode = 404;
      throw error;
    }
    const application = await this.applicationStore.add(job, applicationDetails(details));
    this.emit("application", { action: "updated", application });
    return application;
  }

  async updateApplication(jobId, details = {}) {
    const application = await this.applicationStore.update(jobId, applicationDetails(details));
    this.emit("application", { action: "updated", application });
    return application;
  }

  async removeApplication(jobId) {
    const removed = await this.applicationStore.remove(jobId);
    if (removed) this.emit("application", { action: "removed", jobId });
    return removed;
  }

  async verify(ids) {
    const wanted = new Set(ids);
    const jobs = this.store.jobs.filter((job) => wanted.has(job.id)).slice(0, 20);
    const verified = await Promise.all(jobs.map(async (job) => ({ ...job, verification: await liveVerify(job, { timeoutMs: this.config.requestTimeoutMs }) })));
    await this.store.merge(verified);
    return verified.map((job) => ({ id: job.id, verification: job.verification }));
  }

  getSources() { return [...this.sourceStatus.values()]; }
}
