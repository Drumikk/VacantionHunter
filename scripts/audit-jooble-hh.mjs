import { config } from "../src/config.js";
import { fetchJson } from "../src/connectors/http.js";

if (!config.joobleApiKey) throw new Error("JOOBLE_API_KEY is required");

const probes = [
  { id: "global-dotnet-russia", host: "jooble.org", keywords: ".NET разработчик", location: "Россия" },
  { id: "global-programmer-russia", host: "jooble.org", keywords: "программист", location: "Россия" },
  { id: "russian-dotnet-russia", host: "ru.jooble.org", keywords: ".NET разработчик", location: "Россия" },
  { id: "russian-programmer-russia", host: "ru.jooble.org", keywords: "программист", location: "Россия" },
];

function isHeadHunterSource(value) {
  return /(^|\W)(hh(?:\.ru)?|headhunter)(\W|$)/iu.test(value || "");
}

function sourceCounts(jobs) {
  return Object.entries(jobs.reduce((counts, job) => {
    const source = job.source || "unknown";
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]).map(([source, count]) => ({ source, count }));
}

const reports = [];
for (const probe of probes) {
  try {
    const byId = new Map();
    let totalCount = null;
    for (let page = 1; page <= 3; page += 1) {
      const data = await fetchJson(`https://${probe.host}/api/${encodeURIComponent(config.joobleApiKey)}`, {
        method: "POST",
        body: JSON.stringify({
          keywords: probe.keywords,
          location: probe.location,
          page: String(page),
          ResultOnPage: "100",
          companysearch: "false",
        }),
        headers: { "Content-Type": "application/json" },
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
      });
      totalCount = data.totalCount ?? totalCount;
      for (const job of data.jobs || []) if (job?.id != null) byId.set(String(job.id), job);
    }
    const jobs = [...byId.values()];
    const hhJobs = jobs.filter((job) => isHeadHunterSource(job.source));
    reports.push({
      id: probe.id,
      endpointHost: probe.host,
      keywords: probe.keywords,
      location: probe.location,
      reportedTotal: totalCount,
      scannedUnique: jobs.length,
      sources: sourceCounts(jobs),
      hhCount: hhJobs.length,
      hhSamples: hhJobs.slice(0, 10).map((job) => ({
        title: job.title,
        company: job.company,
        location: job.location,
        providerSource: job.source,
        joobleUrl: job.link,
        updated: job.updated,
      })),
    });
  } catch (error) {
    reports.push({ id: probe.id, endpointHost: probe.host, keywords: probe.keywords, location: probe.location, error: error.message });
  }
}

const hhSamples = reports.flatMap((report) => report.hhSamples || []);
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  apiKeyExposed: false,
  hhDetected: hhSamples.length > 0,
  hhVacanciesReturned: reports.reduce((sum, report) => sum + (report.hhCount || 0), 0),
  reports,
}, null, 2));

if (!hhSamples.length) process.exitCode = 2;
