import { config } from "../src/config.js";
import { extractJobLinks, extractTeamtailorWidgetKeys, parseJsonLdJobs } from "../src/connectors/career-page.js";
import { catalogCoverageSummary, isLinkedInUrl } from "../src/source-catalog.js";

const concurrency = Math.max(1, Number(process.env.RUSSIAN_SOURCE_AUDIT_CONCURRENCY || 16));
const timeoutMs = Math.max(1_000, Number(process.env.RUSSIAN_SOURCE_AUDIT_TIMEOUT_MS || 12_000));
const maxBytes = Math.max(100_000, Number(process.env.RUSSIAN_SOURCE_AUDIT_MAX_BYTES || 2_000_000));

function sourceEntries() {
  const entries = new Map();
  const add = (adapter, values) => {
    for (const value of values || []) entries.set(`${adapter}:${value.slug || value.id}`, { ...value, adapter });
  };
  add("greenhouse", config.greenhouseBoards);
  add("ashby", config.ashbyBoards);
  add("lever", config.leverSites);
  add("workable", config.workableBoards);
  add("personio", config.personioBoards);
  add("career-page", config.careerPages);
  return entries;
}

function targetRows() {
  const result = new Map();
  for (const row of config.russianCompanySourceAudit || []) {
    for (const id of row.connectorIds || []) {
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(row.row);
    }
  }
  return result;
}

function endpoint(id, entry) {
  const slug = entry.slug || entry.id;
  if (entry.adapter === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`;
  if (entry.adapter === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`;
  if (entry.adapter === "lever") return `${entry.apiBase || "https://api.lever.co"}/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=1`;
  if (entry.adapter === "workable") return `https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=false`;
  if (entry.adapter === "personio") return `https://${encodeURIComponent(slug)}.jobs.personio.de/xml?language=${encodeURIComponent(entry.language || "en")}`;
  if (entry.adapter === "career-page") return entry.url;
  throw new Error(`Unsupported audit adapter for ${id}`);
}

function postingCount(adapter, text) {
  if (adapter === "personio") return (text.match(/<position(?:\s|>)/giu) || []).length;
  try {
    const data = JSON.parse(text);
    if (adapter === "greenhouse" || adapter === "ashby" || adapter === "workable") return Array.isArray(data.jobs) ? data.jobs.length : 0;
    if (adapter === "lever") return Array.isArray(data) ? data.length : Array.isArray(data.postings) ? data.postings.length : 0;
  } catch { /* reported as zero with the response metadata below */ }
  return 0;
}

async function probe(id, entry, rows) {
  const url = endpoint(id, entry);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/json,application/xml,text/xml;q=0.9,*/*;q=0.5", "User-Agent": config.httpUserAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const finalUrl = response.url || url;
    const text = (await response.text()).slice(0, maxBytes);
    const contentType = response.headers.get("content-type") || "";
    const redirectedToLinkedIn = isLinkedInUrl(finalUrl);
    let metrics;
    if (entry.adapter === "career-page") {
      const source = { id, name: entry.name, adapter: entry.adapter };
      const context = { entry, pageUrl: finalUrl, source };
      metrics = {
        jsonLdJobs: parseJsonLdJobs(text, context).length,
        jobLinks: extractJobLinks(text, finalUrl).length,
        teamtailorWidgets: extractTeamtailorWidgetKeys(text).length,
      };
    } else {
      metrics = { postings: postingCount(entry.adapter, text) };
    }
    return {
      id,
      name: entry.name,
      adapter: entry.adapter,
      catalogRows: rows,
      configuredUrl: entry.homepage || entry.url || url,
      probeUrl: url,
      finalUrl,
      status: redirectedToLinkedIn ? "redirected-linkedin" : response.ok ? "reachable" : "http-error",
      httpStatus: response.status,
      contentType,
      bytesRead: Buffer.byteLength(text),
      durationMs: Date.now() - startedAt,
      ...metrics,
    };
  } catch (error) {
    return {
      id,
      name: entry.name,
      adapter: entry.adapter,
      catalogRows: rows,
      configuredUrl: entry.homepage || entry.url || url,
      probeUrl: url,
      status: "request-error",
      error: error.message,
      code: typeof error.code === "string" ? error.code : error.name || "source_error",
      durationMs: Date.now() - startedAt,
    };
  }
}

async function mapConcurrent(items, workerCount, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const entries = sourceEntries();
const rowsById = targetRows();
const missing = [...rowsById.keys()].filter((id) => !entries.has(id));
if (missing.length) throw new Error(`Catalog connector IDs missing from runtime config: ${missing.join(", ")}`);

const targets = [...rowsById.entries()].map(([id, rows]) => ({ id, rows, entry: entries.get(id) }));
const results = await mapConcurrent(targets, concurrency, ({ id, entry, rows }) => probe(id, entry, rows));
const statuses = {};
const adapters = {};
for (const result of results) {
  statuses[result.status] = (statuses[result.status] || 0) + 1;
  adapters[result.adapter] = (adapters[result.adapter] || 0) + 1;
}

const report = {
  auditedAt: new Date().toISOString(),
  catalog: catalogCoverageSummary(config.russianCompanySourceAudit),
  targets: results.length,
  statuses,
  adapters,
  results,
};

if (process.argv.includes("--summary")) {
  console.log(JSON.stringify({
    ...report,
    results: undefined,
    genericWithMachineReadableJobs: results.filter((result) => result.adapter === "career-page" && ((result.jsonLdJobs || 0) > 0 || (result.jobLinks || 0) > 0)).length,
    genericWithSupportedPublicFeed: results.filter((result) => result.adapter === "career-page" && (result.teamtailorWidgets || 0) > 0).length,
    atsWithOpenPostings: results.filter((result) => result.adapter !== "career-page" && (result.postings || 0) > 0).length,
    exceptions: results.filter((result) => result.status !== "reachable"),
  }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
