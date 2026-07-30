import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

export function remoteOkConnector(config) {
  const source = {
    id: "remoteok",
    name: "Remote OK",
    officialApi: true,
    attributionUrl: "https://remoteok.com/remote-jobs",
    setupUrl: "https://remoteok.com/api",
    authType: "none",
    credentialFields: [],
    adapter: "remote-api",
    regions: ["global-remote"],
    note: "Публичный API требует ссылку на оригинальную вакансию и указание Remote OK как источника.",
  };
  return {
    ...source,
    async search(query) {
      const data = await fetchJson("https://remoteok.com/api", {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (Array.isArray(data) ? data : []).filter((item) => item?.id && item?.position && (item.url || item.apply_url)).map((item) => {
        const description = stripHtml(item.description || "");
        const min = Number(item.salary_min) || null;
        const max = Number(item.salary_max) || null;
        return {
          id: `remoteok:${item.id}`,
          externalId: String(item.id),
          title: item.position,
          company: item.company || "Не указан",
          companyVerified: false,
          description,
          url: item.url || item.apply_url,
          applyUrl: item.apply_url || item.url,
          location: item.location || "Remote",
          remote: true,
          relocation: inferRelocation(description),
          skills: Array.isArray(item.tags) ? item.tags : [],
          salary: min != null || max != null ? { min, max, currency: "USD", period: "year" } : null,
          postedAt: item.date || (item.epoch ? new Date(item.epoch * 1000).toISOString() : null),
          source,
          sourceQuality: 0.78,
        };
      }).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
