import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function boardEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

export function workableConnectors(config) {
  return (config.workableBoards || []).map(boardEntry).filter((board) => board?.slug && board.enabled !== false).map((board) => {
    const source = {
      id: `workable:${board.slug}`,
      name: board.name || board.slug,
      officialApi: true,
      attributionUrl: board.homepage || `https://apply.workable.com/${encodeURIComponent(board.slug)}/`,
      setupUrl: "https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page",
      authType: "none",
      credentialFields: [],
      adapter: "workable",
      regions: board.regions || ["global"],
      note: "Официальный публичный endpoint Workable возвращает только опубликованные вакансии компании; пользовательская авторизация не требуется.",
    };
    return {
      ...source,
      async search(query) {
        const data = await fetchJson(`https://www.workable.com/api/accounts/${encodeURIComponent(board.slug)}?details=true`, {
          timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs,
          userAgent: config.httpUserAgent,
          retries: 1,
          fetchImpl: config.fetchImpl || fetch,
        });
        return (data.jobs || []).map((item) => {
          const description = stripHtml(item.description || "");
          const locations = (item.locations || []).map((place) => [place.city, place.region, place.country].filter(Boolean).join(", ")).filter(Boolean);
          const location = locations.join("; ") || [item.city, item.state, item.country].filter(Boolean).join(", ") || (item.telecommuting ? "Remote" : "");
          const externalId = String(item.shortcode || item.code || item.url || "");
          const url = item.url || item.shortlink || `https://apply.workable.com/${encodeURIComponent(board.slug)}/j/${encodeURIComponent(externalId)}`;
          return {
            id: `workable:${board.slug}:${externalId}`,
            externalId,
            title: item.title,
            company: board.name || board.slug,
            companyVerified: true,
            description,
            url,
            applyUrl: item.application_url || url,
            location,
            locations,
            remote: Boolean(item.telecommuting) || inferRemote(location, description),
            relocation: inferRelocation(description),
            visaSponsorship: inferRelocation(description),
            employmentType: item.employment_type || null,
            experience: item.experience || null,
            category: item.department || item.function || item.industry || null,
            salary: parseSalaryText(description, { fallbackPeriod: "year" }),
            postedAt: item.published_on || item.created_at || null,
            source,
            sourceQuality: 0.96,
          };
        }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
      },
    };
  });
}
