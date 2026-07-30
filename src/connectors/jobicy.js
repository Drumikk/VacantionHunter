import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

function salaryPeriod(value) {
  const normalized = String(value || "year").toLowerCase();
  if (/hour/.test(normalized)) return "hour";
  if (/day/.test(normalized)) return "day";
  if (/week/.test(normalized)) return "week";
  if (/month/.test(normalized)) return "month";
  return "year";
}

export function jobicyConnector(config) {
  const source = {
    id: "jobicy",
    name: "Jobicy",
    officialApi: true,
    attributionUrl: "https://jobicy.com/jobs/",
    setupUrl: "https://github.com/Jobicy/remote-jobs-api",
    authType: "none",
    credentialFields: [],
    adapter: "remote-api",
    regions: ["global-remote"],
    note: "Публичный API с шестичасовой задержкой; опрашивать не чаще раза в час, сохранять атрибуцию и оригинальный URL.",
  };
  let cachedFeed = null;
  let feedExpiresAt = 0;

  async function loadFeed() {
    if (cachedFeed && feedExpiresAt > Date.now()) return cachedFeed;
    const pending = fetchJson(`https://jobicy.com/api/v2/remote-jobs?${new URLSearchParams({ count: "100" })}`, {
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    cachedFeed = pending;
    feedExpiresAt = Date.now() + 60 * 60 * 1_000;
    try {
      const data = await pending;
      cachedFeed = Promise.resolve(data);
      return data;
    } catch (error) {
      cachedFeed = null;
      feedExpiresAt = 0;
      throw error;
    }
  }

  return {
    ...source,
    async search(query) {
      const data = await loadFeed();
      return (data.jobs || []).map((item) => {
        const description = stripHtml(item.jobDescription || item.jobExcerpt || "");
        return {
          id: `jobicy:${item.id}`,
          externalId: String(item.id || ""),
          title: item.jobTitle,
          company: item.companyName || "Не указан",
          companyVerified: false,
          description,
          url: item.url,
          applyUrl: item.url,
          location: item.jobGeo || "Worldwide",
          remote: true,
          relocation: inferRelocation(description),
          employmentType: Array.isArray(item.jobType) ? item.jobType.join(", ") : item.jobType || null,
          experience: item.jobLevel || null,
          skills: Array.isArray(item.jobIndustry) ? item.jobIndustry : [],
          salary: item.salaryMin != null || item.salaryMax != null ? {
            min: item.salaryMin == null ? null : Number(item.salaryMin),
            max: item.salaryMax == null ? null : Number(item.salaryMax),
            currency: item.salaryCurrency ? String(item.salaryCurrency).toUpperCase() : null,
            period: salaryPeriod(item.salaryPeriod),
          } : null,
          postedAt: item.pubDate || null,
          source,
          sourceQuality: 0.82,
        };
      }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
