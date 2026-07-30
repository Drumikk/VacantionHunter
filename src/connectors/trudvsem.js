import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function searchTerms(query) {
  return String(query.skills?.[0] || query.role || query.raw || "").trim();
}

function currency(value) {
  const normalized = String(value || "").toLowerCase();
  if (/руб|rub|rur|₽/.test(normalized)) return "RUB";
  if (/usd|доллар|\$/.test(normalized)) return "USD";
  if (/eur|евро|€/.test(normalized)) return "EUR";
  return null;
}

export function trudvsemConnector(config) {
  const source = {
    id: "trudvsem",
    name: "Работа России",
    officialApi: true,
    attributionUrl: "https://trudvsem.ru/",
    setupUrl: "https://trudvsem.ru/opendata/api",
    authType: "none",
    credentialFields: [],
    adapter: "government-api",
    regions: ["russia-cis"],
    note: "Официальные открытые данные Роструда; API поддерживает текстовый поиск и инкрементальные обновления.",
  };
  return {
    ...source,
    async search(query) {
      const params = new URLSearchParams({
        text: searchTerms(query),
        limit: String(Math.min(config.maxJobsPerSource || 100, 100)),
        offset: "0",
      });
      const data = await fetchJson(`https://opendata.trudvsem.ru/api/v1/vacancies?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (data.results?.vacancies || []).map((entry) => entry?.vacancy).filter(Boolean).map((item) => {
        const description = stripHtml([item.requirements, item.duty, item.qualification, item.benefit].filter(Boolean).join(" "));
        const location = item.addresses?.address?.[0]?.location || item.region?.name || "Россия";
        const salary = item.salary_min != null || item.salary_max != null ? {
          min: Number(item.salary_min) || null,
          max: Number(item.salary_max) || null,
          currency: currency(item.currency || item.salary) || "RUB",
          period: "month",
        } : null;
        return {
          id: `trudvsem:${item.id}`,
          externalId: String(item.id),
          title: item["job-name"],
          company: item.company?.name || "Не указан",
          companyVerified: true,
          description,
          url: item.vac_url,
          applyUrl: item.vac_url,
          location,
          remote: inferRemote(item.schedule, location, description),
          relocation: inferRelocation(description, item.benefit),
          employmentType: item.schedule || null,
          salary,
          postedAt: item["creation-date"] || null,
          updatedAt: item.date_modify || null,
          source,
          sourceQuality: 0.98,
        };
      }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
