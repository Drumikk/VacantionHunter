import { config } from "../src/config.js";
import { joobleConnector } from "../src/connectors/jooble.js";
import { parseQuery } from "../src/core/query-parser.js";

if (!config.joobleApiKey) throw new Error("JOOBLE_API_KEY is required");

const connector = joobleConnector({
  ...config,
  maxJobsPerSource: Math.min(Math.max(config.maxJobsPerSource, 100), 100),
  aggregatorCacheMs: 0,
});

const searches = [
  ".NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией",
  ".NET Разработчик Россия",
  "C# разработчик Россия",
  "программист Россия",
];

function isHeadHunterSource(value) {
  return /(^|\W)(hh(?:\.ru)?|headhunter)(\W|$)/iu.test(value || "");
}

function sourceCounts(jobs) {
  return Object.entries(jobs.reduce((counts, job) => {
    const source = job.providerSource || "unknown";
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]).map(([source, count]) => ({ source, count }));
}

const reports = [];
for (const raw of searches) {
  const jobs = await connector.search(parseQuery(raw));
  const hhJobs = jobs.filter((job) => isHeadHunterSource(job.providerSource));
  reports.push({
    raw,
    returned: jobs.length,
    sources: sourceCounts(jobs),
    hhCount: hhJobs.length,
    hhSamples: hhJobs.slice(0, 10).map((job) => ({
      title: job.title,
      company: job.company,
      location: job.location,
      providerSource: job.providerSource,
      joobleUrl: job.url,
      updated: job.postedAt,
    })),
  });
}

const hhSamples = reports.flatMap((report) => report.hhSamples);
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  apiKeyExposed: false,
  hhDetected: hhSamples.length > 0,
  hhVacanciesReturned: reports.reduce((sum, report) => sum + report.hhCount, 0),
  reports,
}, null, 2));

if (!hhSamples.length) process.exitCode = 2;
