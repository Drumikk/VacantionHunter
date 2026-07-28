import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";

function boardEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

export function greenhouseConnectors(config) {
  return config.greenhouseBoards.map(boardEntry).filter((board) => board?.slug && board.enabled !== false).map((board) => {
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
      async search() {
        const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`, { timeoutMs: config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1 });
        return (data.jobs || []).slice(0, config.maxJobsPerSource).map((item) => ({
          id: `greenhouse:${board.slug}:${item.id}`, externalId: String(item.id), title: item.title, company: board.name || board.slug, companyVerified: true,
          description: stripHtml(item.content), url: item.absolute_url, applyUrl: item.absolute_url, location: item.location?.name || "", remote: /remote|worldwide/i.test(item.location?.name || ""),
          salary: parseSalaryText(stripHtml(item.content), { fallbackPeriod: "year", fallbackCurrency: "USD" }), postedAt: item.updated_at, updatedAt: item.updated_at,
          source, sourceQuality: 0.96,
        }));
      },
    };
  });
}
