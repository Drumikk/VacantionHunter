import { config } from "../src/config.js";
import { createConnectors } from "../src/connectors/index.js";
import { assessJob } from "../src/core/authenticity.js";
import { parseQuery } from "../src/core/query-parser.js";
import { rankJobs } from "../src/core/ranker.js";

const strict = process.argv.includes("--strict");
const sourceFilter = process.argv.find((argument) => argument.startsWith("--source="))?.slice("--source=".length) || null;
const rawQuery = process.argv.slice(2).filter((argument) => !argument.startsWith("--")).join(" ") || ".NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией";
const query = parseQuery(rawQuery);
const connectors = createConnectors({ ...config, enableLiveSources: true, maxJobsPerSource: Math.min(config.maxJobsPerSource, 20) })
  .filter((connector) => connector.id !== "demo")
  .filter((connector) => !sourceFilter || connector.id === sourceFilter || connector.id.startsWith(`${sourceFilter}:`) || connector.adapter === sourceFilter);
const startedAt = new Date().toISOString();
const started = Date.now();

const results = await Promise.all(connectors.map(async (connector) => {
  const sourceStarted = Date.now();
  if (connector.enabled === false) {
    return {
      source: connector.id, name: connector.name, adapter: connector.adapter || connector.id, status: "disabled", durationMs: 0,
      count: 0, fullMatches: 0, partialMatches: 0, error: connector.disabledReason, setupUrl: connector.setupUrl || null,
      credentialFields: connector.credentialFields || [], sample: null,
    };
  }
  try {
    const jobs = (await connector.search(query)).map((job) => ({ ...job, verification: assessJob(job) }));
    const ranked = rankJobs(jobs, query);
    const full = ranked.filter((job) => job.andMatch && !job.unsafe);
    const partial = ranked.filter((job) => job.matchPercent > 0 && !job.andMatch && !job.unsafe);
    const best = full[0] || partial[0] || ranked[0];
    return {
      source: connector.id, name: connector.name, adapter: connector.adapter || connector.id, status: "ok", durationMs: Date.now() - sourceStarted,
      count: jobs.length, fullMatches: full.length, partialMatches: partial.length, error: null, setupUrl: connector.setupUrl || null,
      credentialFields: connector.credentialFields || [], diagnostics: connector.getDiagnostics?.() || null, sample: best ? {
        title: best.title, company: best.company, url: best.url, remote: best.remote, relocation: Boolean(best.relocation || best.visaSponsorship),
        salaryMonthlyUsd: best.salaryMonthlyUsd, matchPercent: best.matchPercent, andMatch: best.andMatch,
      } : null,
    };
  } catch (error) {
    return {
      source: connector.id, name: connector.name, adapter: connector.adapter || connector.id, status: "error", durationMs: Date.now() - sourceStarted,
      count: 0, fullMatches: 0, partialMatches: 0, error: error.message, errorCode: typeof error.code === "string" ? error.code : error.name || "source_error",
      setupUrl: connector.setupUrl || null, credentialFields: connector.credentialFields || [], diagnostics: connector.getDiagnostics?.() || null, sample: null,
    };
  }
}));

const summary = {
  totalSources: results.length,
  ok: results.filter((item) => item.status === "ok").length,
  disabled: results.filter((item) => item.status === "disabled").length,
  errors: results.filter((item) => item.status === "error").length,
  fullMatches: results.reduce((sum, item) => sum + item.fullMatches, 0),
  partialMatches: results.reduce((sum, item) => sum + item.partialMatches, 0),
};
console.log(JSON.stringify({ startedAt, durationMs: Date.now() - started, query, summary, report: results }, null, 2));
if (strict ? summary.disabled > 0 || summary.errors > 0 : summary.ok === 0) process.exitCode = 1;
