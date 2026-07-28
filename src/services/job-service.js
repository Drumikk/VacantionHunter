import { EventEmitter } from "node:events";
import { parseQuery } from "../core/query-parser.js";
import { rankJobs } from "../core/ranker.js";
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

export class JobService extends EventEmitter {
  constructor({ connectors, store, config }) {
    super();
    this.connectors = connectors;
    this.store = store;
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
      note: source.note,
      adapter: source.adapter || source.id,
      regions: source.regions || ["global"],
    }]));
    this.lastQueries = [];
  }

  parse(raw) { return parseQuery(raw); }

  async initialize() {
    await this.store.load();
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
      Object.assign(status, { status: "ok", lastSuccessAt: new Date().toISOString(), count: jobs.length, failureCount: 0, cooldownUntil: null });
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
    return Promise.all(selected.map(async (connector) => {
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
    }));
  }

  async search({ rawQuery, sort = [], refresh = false, limit = 100 }) {
    const query = this.parse(rawQuery);
    let refreshReport = [];
    if (refresh) refreshReport = await this.refresh(query);
    const results = rankJobs(this.store.jobs, query, { sort }).filter((job) => job.matchPercent > 0).slice(0, Math.min(limit, 250));
    return { query, total: results.length, results, refreshReport, sources: this.getSources() };
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
