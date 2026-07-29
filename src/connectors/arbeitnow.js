import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";

export function arbeitnowConnector(config) {
  const source = { id: "arbeitnow", name: "Arbeitnow", officialApi: true, attributionUrl: "https://www.arbeitnow.com/" };
  return {
    ...source,
    async search(query) {
      const url = new URL("https://www.arbeitnow.com/api/job-board-api");
      if (query.relocation) url.searchParams.set("visa_sponsorship", "true");
      const data = await fetchJson(url, { timeoutMs: config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1, fetchImpl: config.fetchImpl || fetch });
      return (data.data || []).slice(0, config.maxJobsPerSource).map((item) => ({
        id: `arbeitnow:${item.slug}`, externalId: item.slug, title: item.title, company: item.company_name || "Не указан", companyVerified: true,
        description: stripHtml(item.description), url: item.url, applyUrl: item.url, location: item.location || "", remote: Boolean(item.remote),
        relocation: Boolean(item.visa_sponsorship), visaSponsorship: Boolean(item.visa_sponsorship), skills: item.tags || [],
        postedAt: item.created_at ? new Date(item.created_at * 1000).toISOString() : null, source, sourceQuality: 0.88,
      }));
    },
  };
}
