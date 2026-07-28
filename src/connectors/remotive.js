import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";

export function remotiveConnector(config) {
  const source = { id: "remotive", name: "Remotive", officialApi: true, attributionUrl: "https://remotive.com/remote-jobs", note: "Public API listings are delayed by 24 hours; attribution and backlink are required." };
  return {
    ...source,
    async search(query) {
      const params = new URLSearchParams();
      if (query.role) params.set("search", query.role);
      const data = await fetchJson(`https://remotive.com/api/remote-jobs?${params}`, { timeoutMs: config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1 });
      return (data.jobs || []).slice(0, config.maxJobsPerSource).map((item) => ({
        id: `remotive:${item.id}`, externalId: String(item.id), title: item.title, company: item.company_name || "Не указан", companyVerified: false,
        description: stripHtml(item.description), url: item.url, applyUrl: item.url, location: item.candidate_required_location || "Remote", remote: true,
        category: item.category, employmentType: item.job_type, salary: parseSalaryText(item.salary || "", { fallbackPeriod: "year", fallbackCurrency: "USD" }),
        postedAt: item.publication_date, source, sourceQuality: 0.82,
      }));
    },
  };
}
