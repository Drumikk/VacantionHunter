import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

export function remotiveConnector(config) {
  const source = { id: "remotive", name: "Remotive", officialApi: true, attributionUrl: "https://remotive.com/remote-jobs", note: "Public API listings are delayed by 24 hours; attribution and backlink are required." };
  return {
    ...source,
    async search(query) {
      const params = new URLSearchParams();
      if (query.role || query.skills?.length) params.set("search", sourceSearchTerms(query));
      const data = await fetchJson(`https://remotive.com/api/remote-jobs?${params}`, { timeoutMs: config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1, fetchImpl: config.fetchImpl || fetch });
      return (data.jobs || []).slice(0, config.maxJobsPerSource).map((item) => ({
        id: `remotive:${item.id}`, externalId: String(item.id), title: item.title, company: item.company_name || "Не указан", companyVerified: false,
        description: stripHtml(item.description), url: item.url, applyUrl: item.url, location: item.candidate_required_location || "Remote", remote: true,
        relocation: inferRelocation(item.description), visaSponsorship: inferRelocation(item.description),
        category: item.category, employmentType: item.job_type, salary: parseSalaryText(item.salary || "", { fallbackPeriod: "year", fallbackCurrency: "USD" }),
        postedAt: item.publication_date, source, sourceQuality: 0.82,
      }));
    },
  };
}
