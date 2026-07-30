import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

export function reedConnector(config) {
  const source = {
    id: "reed",
    name: "Reed.co.uk",
    officialApi: true,
    attributionUrl: "https://www.reed.co.uk/jobs",
    setupUrl: "https://www.reed.co.uk/developers/jobseeker",
    authType: "api_key_basic",
    credentialFields: ["REED_API_KEY"],
    adapter: "regional-api",
    regions: ["europe"],
    note: "Официальный Jobseeker API Великобритании; API key передаётся как Basic username с пустым паролем.",
  };
  const enabled = Boolean(config.reedApiKey);
  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Получите ключ Reed Jobseeker API и задайте REED_API_KEY",
    async search(query) {
      if (!enabled) throw new Error("REED_API_KEY is required");
      const params = new URLSearchParams({
        keywords: sourceSearchTerms(query),
        resultsToTake: String(Math.min(config.maxJobsPerSource || 100, 100)),
        resultsToSkip: "0",
      });
      if (query.locations?.[0]) params.set("locationName", query.locations[0]);
      const data = await fetchJson(`https://www.reed.co.uk/api/1.0/search?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        headers: { Authorization: `Basic ${Buffer.from(`${config.reedApiKey}:`).toString("base64")}` },
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (data.results || []).map((item) => {
        const description = stripHtml(item.jobDescription || item.description || "");
        const url = item.jobUrl || item.externalUrl;
        const location = item.locationName || "United Kingdom";
        return {
          id: `reed:${item.jobId}`,
          externalId: String(item.jobId || ""),
          title: item.jobTitle,
          company: item.employerName || "Не указан",
          companyVerified: false,
          description,
          url,
          applyUrl: item.externalUrl || url,
          location,
          remote: inferRemote(item.jobTitle, location, description),
          relocation: inferRelocation(description),
          employmentType: [item.jobType, item.contractType].filter(Boolean).join(" ") || null,
          salary: item.minimumSalary != null || item.maximumSalary != null ? {
            min: item.minimumSalary == null ? null : Number(item.minimumSalary),
            max: item.maximumSalary == null ? null : Number(item.maximumSalary),
            currency: String(item.currency || "GBP").toUpperCase(),
            period: "year",
          } : null,
          postedAt: item.date || item.datePosted || null,
          validThrough: item.expirationDate || null,
          source,
          sourceQuality: 0.9,
        };
      }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
