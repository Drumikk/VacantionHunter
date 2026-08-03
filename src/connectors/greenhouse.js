import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function boardEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

export function greenhouseConnectors(config) {
  return config.greenhouseBoards.map(boardEntry).filter((board) => board?.slug && board.enabled !== false).map((board) => {
    let lastRun = null;
    const source = {
      id: `greenhouse:${board.slug}`,
      name: board.name || board.slug,
      officialApi: true,
      attributionUrl: board.homepage || `https://boards.greenhouse.io/${encodeURIComponent(board.slug)}`,
      adapter: "greenhouse",
      regions: board.regions || ["global"],
    };
    return {
      ...source,
      getDiagnostics() { return lastRun; },
      async search(query) {
        const baseUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}`;
        let data;
        try {
          data = await fetchJson(`${baseUrl}/jobs?content=false`, { timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 2, fetchImpl: config.fetchImpl || fetch });
        } catch (error) {
          lastRun = { stage: "index", scanned: 0, detailCandidates: 0, detailsLoaded: 0, warnings: [{ error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" }] };
          throw error;
        }
        const candidates = (data.jobs || []).map((item) => ({
          id: item.id, title: item.title, description: (item.metadata || []).map((field) => Array.isArray(field.value) ? field.value.join(" ") : field.value).filter(Boolean).join(" "),
          location: item.location?.name || "", url: item.absolute_url, updatedAt: item.updated_at,
        })).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource);
        const details = new Array(candidates.length);
        let nextCandidate = 0;
        const workerCount = Math.min(candidates.length, Math.max(1, config.atsDetailConcurrency || 4));
        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (nextCandidate < candidates.length) {
            const index = nextCandidate;
            nextCandidate += 1;
            const candidate = candidates[index];
            try {
              const item = await fetchJson(`${baseUrl}/jobs/${encodeURIComponent(candidate.id)}`, { timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 2, fetchImpl: config.fetchImpl || fetch });
              details[index] = { item, warning: null };
            } catch (error) {
              details[index] = { item: candidate, warning: { postingId: candidate.id, title: candidate.title, error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" } };
            }
          }
        }));
        const warnings = details.map((detail) => detail.warning).filter(Boolean);
        lastRun = { stage: "details", scanned: (data.jobs || []).length, detailCandidates: candidates.length, detailsLoaded: details.length - warnings.length, warnings };
        return details.map(({ item }) => {
          const description = stripHtml(item.content || item.description || "");
          const location = item.location?.name || item.location || "";
          return {
            id: `greenhouse:${board.slug}:${item.id}`, externalId: String(item.id), title: item.title, company: board.name || board.slug, companyVerified: true,
            description, url: item.absolute_url || item.url, applyUrl: item.absolute_url || item.url, location,
            remote: inferRemote(location, description), relocation: inferRelocation(description), visaSponsorship: inferRelocation(description),
            salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" }), postedAt: item.updated_at || item.updatedAt, updatedAt: item.updated_at || item.updatedAt,
            source, sourceQuality: 0.96,
          };
        });
      },
    };
  });
}
