import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

export function jobtechConnector(config) {
  const source = {
    id: "jobtech-sweden",
    name: "Arbetsförmedlingen Platsbanken",
    officialApi: true,
    attributionUrl: "https://arbetsformedlingen.se/platsbanken/",
    setupUrl: "https://jobsearch.api.jobtechdev.se/",
    authType: "none",
    credentialFields: [],
    adapter: "government-api",
    regions: ["europe"],
    note: "Открытый JobSearch API шведской государственной службы занятости.",
  };
  return {
    ...source,
    async search(query) {
      const params = new URLSearchParams({
        q: String(query.skills?.[0] || query.role || query.raw || "").trim(),
        limit: String(Math.min(config.maxJobsPerSource || 100, 100)),
        offset: "0",
      });
      const data = await fetchJson(`https://jobsearch.api.jobtechdev.se/search?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (data.hits || []).filter((item) => item?.id && item?.headline && item?.webpage_url && !item.removed).map((item) => {
        const description = stripHtml(item.description?.text || item.description?.text_formatted || "");
        const address = item.workplace_address || {};
        const location = [address.city, address.region, address.country].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(", ");
        return {
          id: `jobtech-sweden:${item.id}`,
          externalId: String(item.id),
          title: item.headline,
          company: item.employer?.workplace || item.employer?.name || "Не указан",
          companyVerified: true,
          description,
          url: item.webpage_url,
          applyUrl: item.application_details?.url || item.webpage_url,
          location,
          remote: inferRemote(location, description, item.working_hours_type?.label),
          relocation: inferRelocation(description),
          employmentType: item.employment_type?.label || item.working_hours_type?.label || null,
          salary: parseSalaryText(item.salary_description || "", { fallbackCurrency: "SEK", fallbackPeriod: "month" }),
          postedAt: item.publication_date || null,
          updatedAt: item.timestamp ? new Date(item.timestamp).toISOString() : null,
          validThrough: item.application_deadline || null,
          source,
          sourceQuality: 0.98,
        };
      }).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
