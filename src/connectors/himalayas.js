import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

function salaryPeriod(value) {
  const normalized = String(value || "annual").toLowerCase();
  if (/hour/.test(normalized)) return "hour";
  if (/day/.test(normalized)) return "day";
  if (/week/.test(normalized) && !/fortnight/.test(normalized)) return "week";
  if (/month|fortnight/.test(normalized)) return "month";
  return "year";
}

export function himalayasConnector(config) {
  const source = {
    id: "himalayas",
    name: "Himalayas",
    officialApi: true,
    attributionUrl: "https://himalayas.app/jobs",
    setupUrl: "https://himalayas.app/api",
    authType: "none",
    credentialFields: [],
    adapter: "remote-api",
    regions: ["global-remote"],
    note: "Публичный API требует ссылку на оригинал и упоминание Himalayas как источника.",
  };
  return {
    ...source,
    async search(query) {
      const params = new URLSearchParams({ q: String(query.skills?.[0] || query.role || query.raw || "").trim(), sort: "recent", page: "1" });
      const data = await fetchJson(`https://himalayas.app/jobs/api/search?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      const records = data.jobs || data.data || data.results || [];
      return records.map((item) => {
        const description = stripHtml(item.description || item.excerpt || "");
        const locations = Array.isArray(item.locationRestrictions) ? item.locationRestrictions : [];
        const location = locations.join(", ") || "Worldwide";
        const url = item.applicationLink || item.url;
        return {
          id: `himalayas:${item.guid}`,
          externalId: String(item.guid || ""),
          title: item.title,
          company: item.companyName || "Не указан",
          companyVerified: false,
          description,
          url,
          applyUrl: url,
          location,
          locations,
          remote: true,
          relocation: inferRelocation(description),
          employmentType: item.employmentType || null,
          experience: item.seniority || null,
          skills: [...(item.category || []), ...(item.parentCategories || [])],
          salary: item.minSalary != null || item.maxSalary != null ? {
            min: item.minSalary == null ? null : Number(item.minSalary),
            max: item.maxSalary == null ? null : Number(item.maxSalary),
            currency: item.currency ? String(item.currency).toUpperCase() : null,
            period: salaryPeriod(item.salaryPeriod),
          } : null,
          postedAt: item.pubDate || null,
          validThrough: item.expiryDate || null,
          source,
          sourceQuality: 0.86,
        };
      }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, Math.min(config.maxJobsPerSource || 20, 20));
    },
  };
}
