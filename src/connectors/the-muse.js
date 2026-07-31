import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { parseSalaryText } from "../core/salary.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

const CATEGORY_RULES = [
  [/\b(data|analytics?|bi|scientist)\b/i, ["Data and Analytics"]],
  [/\b(design|designer|ux|ui)\b/i, ["Design and UX"]],
  [/\bproduct\s+(manager|management)\b/i, ["Product Management"]],
  [/\bproject\s+(manager|management)\b/i, ["Project Management"]],
  [/\b(customer|support|success)\b/i, ["Customer Service"]],
  [/\b(sales|account executive|business development)\b/i, ["Sales"]],
  [/\b(marketing|seo|advertising)\b/i, ["Advertising and Marketing"]],
  [/\b(hr|human resources|recruit|talent acquisition)\b/i, ["Human Resources and Recruitment"]],
  [/\b(health|medical|nurse|doctor|clinical)\b/i, ["Healthcare"]],
  [/\b(finance|accounting|accountant|auditor)\b/i, ["Accounting and Finance"]],
  [/\b(developer|engineer|software|programmer|devops|sre|\.net|c#|java|python|javascript|typescript|cloud|security|qa|test)\b/i, ["Software Engineering", "Computer and IT"]],
];

function categoriesFor(query) {
  const text = [query?.role, ...(query?.skills || []), query?.raw].filter(Boolean).join(" ");
  for (const [pattern, categories] of CATEGORY_RULES) {
    if (pattern.test(text)) return categories;
  }
  return [null];
}

function jobLocations(item) {
  return (Array.isArray(item.locations) ? item.locations : []).map((entry) => entry?.name).filter(Boolean);
}

export function theMuseConnector(config) {
  const source = {
    id: "the-muse",
    name: "The Muse",
    officialApi: true,
    attributionUrl: "https://www.themuse.com/search",
    setupUrl: "https://www.themuse.com/developers/api/v2",
    authType: "optional_api_key",
    credentialFields: [],
    adapter: "job-board-api",
    regions: ["north-america", "europe", "global-remote"],
    note: "Public API works anonymously with a lower quota; THE_MUSE_API_KEY is optional and raises the documented request allowance.",
  };
  const pageCache = new Map();
  const pageCount = Math.max(1, Math.min(3, Number(config.theMusePages || 2)));
  const ttlMs = Math.max(60 * 60 * 1_000, Number(config.aggregatorCacheMs || 0));
  let diagnostics = { requestedPages: 0, loadedPages: 0, warnings: [] };

  async function loadPage(category, page) {
    const key = `${category || "all"}:${page}`;
    const cached = pageCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const params = new URLSearchParams({ page: String(page) });
    if (category) params.set("category", category);
    if (config.theMuseApiKey) params.set("api_key", config.theMuseApiKey);
    const pending = fetchJson(`https://www.themuse.com/api/public/jobs?${params}`, {
      timeoutMs: Math.max(60_000, config.atsRequestTimeoutMs || config.requestTimeoutMs || 0),
      userAgent: config.httpUserAgent,
      retries: 0,
      fetchImpl: config.fetchImpl || fetch,
    });
    pageCache.set(key, { expiresAt: Date.now() + ttlMs, value: pending });
    try {
      const data = await pending;
      pageCache.set(key, { expiresAt: Date.now() + ttlMs, value: Promise.resolve(data) });
      return data;
    } catch (error) {
      pageCache.delete(key);
      throw error;
    }
  }

  return {
    ...source,
    getDiagnostics() { return diagnostics; },
    async search(query) {
      const requests = categoriesFor(query).flatMap((category) =>
        Array.from({ length: pageCount }, (_, page) => loadPage(category, page)),
      );
      const settled = await Promise.allSettled(requests);
      const pages = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
      diagnostics = {
        requestedPages: requests.length,
        loadedPages: pages.length,
        warnings: settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message || String(result.reason)),
      };
      if (!pages.length) throw settled.find((result) => result.status === "rejected")?.reason || new Error("The Muse returned no pages");
      const seen = new Set();
      const jobs = pages.flatMap((data) => Array.isArray(data?.results) ? data.results : []).filter((item) => {
        const id = String(item?.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).map((item) => {
        const description = stripHtml(item.contents || "");
        const locations = jobLocations(item);
        const location = locations.join(", ") || "Не указано";
        const categories = (Array.isArray(item.categories) ? item.categories : []).map((entry) => entry?.name).filter(Boolean);
        const levels = (Array.isArray(item.levels) ? item.levels : []).map((entry) => entry?.name).filter(Boolean);
        const url = item.refs?.landing_page;
        return {
          id: `the-muse:${item.id}`,
          externalId: String(item.id),
          title: item.name,
          company: item.company?.name || "Не указано",
          companyVerified: false,
          description,
          url,
          applyUrl: url,
          location,
          locations,
          remote: inferRemote(location, description),
          relocation: inferRelocation(description),
          visaSponsorship: inferRelocation(description),
          experience: levels.join(", ") || null,
          category: categories.join(", ") || null,
          skills: [...categories, ...levels, ...(Array.isArray(item.tags) ? item.tags : [])],
          salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" }),
          postedAt: item.publication_date || null,
          source,
          sourceQuality: 0.9,
        };
      });
      return jobs.filter((job) => job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
