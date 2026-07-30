import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function commentJob(item, source) {
  const description = stripHtml(item.comment_text || item.story_text || "");
  const parts = description.split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
  const company = parts[0]?.slice(0, 160) || item.author || "Не указан";
  const title = parts[1]?.slice(0, 180) || description.split(/[.!?\n]/)[0]?.slice(0, 180) || "Вакансия из Who Is Hiring";
  const location = parts[2]?.slice(0, 180) || "";
  const url = `https://news.ycombinator.com/item?id=${item.objectID}`;
  return {
    id: `hn-whoishiring:${item.objectID}`,
    externalId: String(item.objectID),
    title,
    company,
    companyVerified: false,
    description,
    url,
    applyUrl: url,
    location,
    remote: inferRemote(location, description),
    relocation: inferRelocation(description),
    salary: parseSalaryText(description, { fallbackCurrency: "USD", fallbackPeriod: "year" }),
    postedAt: item.created_at || null,
    source,
    sourceQuality: 0.7,
  };
}

export function hnWhoIsHiringConnector(config) {
  const source = {
    id: "hn-who-is-hiring",
    name: "Hacker News — Who Is Hiring",
    officialApi: false,
    attributionUrl: "https://news.ycombinator.com/submitted?id=whoishiring",
    setupUrl: "https://hn.algolia.com/api",
    authType: "none",
    credentialFields: [],
    adapter: "community-api",
    regions: ["north-america", "europe", "global-remote"],
    note: "Объявления публикуются работодателями в ежемесячной теме; источник не подтверждает работодателя, поэтому требуется проверка на карьерном сайте.",
  };
  return {
    ...source,
    async search(query) {
      const threads = await fetchJson("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Who%20is%20hiring&hitsPerPage=5", {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      const thread = (threads.hits || []).find((item) => /^Ask HN: Who is hiring\?/iu.test(item.title || "")) || threads.hits?.[0];
      if (!thread?.objectID) return [];
      const params = new URLSearchParams({
        tags: `comment,story_${thread.objectID}`,
        query: sourceSearchTerms(query),
        hitsPerPage: String(Math.min(config.maxJobsScannedPerSource || 100, 100)),
      });
      const data = await fetchJson(`https://hn.algolia.com/api/v1/search?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (data.hits || []).filter((item) => item?.objectID && item?.comment_text).map((item) => commentJob(item, source)).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
