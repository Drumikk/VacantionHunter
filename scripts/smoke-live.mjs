import { config } from "../src/config.js";
import { createConnectors } from "../src/connectors/index.js";
import { parseQuery } from "../src/core/query-parser.js";

const query = parseQuery(process.argv.slice(2).join(" ") || ".NET developer remote");
const connectors = createConnectors({ ...config, enableLiveSources: true, maxJobsPerSource: Math.min(config.maxJobsPerSource, 5) }).filter((connector) => connector.id !== "demo" && connector.enabled !== false);
const results = await Promise.allSettled(connectors.map(async (connector) => {
  const jobs = await connector.search(query);
  return { source: connector.id, count: jobs.length, sample: jobs[0] ? { title: jobs[0].title, company: jobs[0].company, url: jobs[0].url } : null };
}));

const report = results.map((result, index) => result.status === "fulfilled" ? { status: "ok", ...result.value } : { source: connectors[index].id, status: "error", error: result.reason.message });
console.log(JSON.stringify({ query: query.raw, report }, null, 2));
if (report.every((item) => item.status === "error")) process.exitCode = 1;
