import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function ashbySalary(compensation) {
  const salary = compensation?.summaryComponents?.find((item) => item.compensationType === "Salary");
  if (!salary) return null;
  const period = /YEAR/i.test(salary.interval) ? "year" : /HOUR/i.test(salary.interval) ? "hour" : "month";
  return { min: salary.minValue, max: salary.maxValue, currency: salary.currencyCode, period };
}

function boardEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

export function ashbyConnectors(config) {
  return config.ashbyBoards.map(boardEntry).filter((board) => board?.slug && board.enabled !== false).map((board) => {
    const source = {
      id: `ashby:${board.slug}`,
      name: board.name || board.slug,
      officialApi: true,
      attributionUrl: board.homepage || `https://jobs.ashbyhq.com/${encodeURIComponent(board.slug)}`,
      adapter: "ashby",
      regions: board.regions || ["global"],
    };
    return {
      ...source,
      async search(query) {
        const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`, { timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1, fetchImpl: config.fetchImpl || fetch });
        return (data.jobs || []).filter((item) => item.isListed !== false).map((item) => {
          const description = stripHtml(item.descriptionHtml || item.descriptionPlain || "");
          const locations = (item.secondaryLocations || []).map((location) => location.location);
          return {
            id: `ashby:${board.slug}:${item.jobUrl}`, externalId: item.jobUrl, title: item.title, company: board.name || board.slug, companyVerified: true,
            description, url: item.jobUrl, applyUrl: item.applyUrl || item.jobUrl, location: item.location || "", locations,
            remote: Boolean(item.isRemote) || inferRemote(item.location, locations, description), relocation: inferRelocation(description), visaSponsorship: inferRelocation(description),
            employmentType: item.employmentType, salary: ashbySalary(item.compensation), postedAt: item.publishedAt || null,
            source, sourceQuality: 0.96,
          };
        }).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource);
      },
    };
  });
}
