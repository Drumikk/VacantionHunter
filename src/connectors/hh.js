import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";

export function hhConnector(config) {
  const source = { id: "hh", name: "HeadHunter", officialApi: true, attributionUrl: "https://hh.ru/" };
  return {
    ...source,
    enabled: Boolean(config.hhUserAgent),
    disabledReason: config.hhUserAgent ? null : "Требуется HH_USER_AGENT с реальным контактным email",
    async search(query) {
      if (!config.hhUserAgent) throw new Error("HH_USER_AGENT is required by the HeadHunter API");
      const params = new URLSearchParams({ text: [query.role, ...query.skills].filter(Boolean).join(" "), per_page: String(Math.min(config.maxJobsPerSource, 100)), page: "0", order_by: "publication_time", period: "30" });
      if (query.salary?.min && query.salary.currency) { params.set("salary", String(query.salary.min)); params.set("currency", query.salary.currency); }
      const data = await fetchJson(`https://api.hh.ru/vacancies?${params}`, { timeoutMs: config.requestTimeoutMs, headers: { "HH-User-Agent": config.hhUserAgent }, userAgent: config.hhUserAgent, retries: 1 });
      return (data.items || []).map((item) => ({
        id: `hh:${item.id}`, externalId: String(item.id), title: item.name, company: item.employer?.name || "Не указан",
        companyVerified: Boolean(item.employer?.trusted), description: stripHtml(`${item.snippet?.requirement || ""} ${item.snippet?.responsibility || ""}`),
        url: item.alternate_url, applyUrl: item.apply_alternate_url || item.alternate_url, location: item.area?.name || "", remote: item.work_format?.some((format) => format.id === "REMOTE") || item.schedule?.id === "remote",
        employmentType: item.employment?.name || item.employment_form?.name || null, experience: item.experience?.name || null,
        salary: item.salary ? { min: item.salary.from, max: item.salary.to, currency: item.salary.currency === "RUR" ? "RUB" : item.salary.currency, period: "month", gross: item.salary.gross } : null,
        postedAt: item.published_at, updatedAt: item.created_at, archived: item.archived, closed: item.closed_for_applicants,
        source, sourceQuality: 0.95,
      }));
    },
  };
}
