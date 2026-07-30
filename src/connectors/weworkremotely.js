import { XMLParser } from "fast-xml-parser";
import { fetchText } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

function value(input) {
  if (input == null) return "";
  if (typeof input === "object") return String(input["#text"] || input["@_href"] || "");
  return String(input);
}

export function parseWwrFeed(xml, source) {
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml);
  const raw = parsed?.rss?.channel?.item || [];
  return (Array.isArray(raw) ? raw : [raw]).map((item) => {
    const combinedTitle = value(item.title);
    const parts = combinedTitle.split(/\s*:\s*/).filter(Boolean);
    const company = value(item["dc:creator"]) || (parts.length > 1 ? parts.shift() : "Не указан");
    const title = parts.length ? parts.join(": ") : combinedTitle;
    const description = stripHtml(value(item["content:encoded"]) || value(item.description));
    const url = value(item.link);
    const externalId = value(item.guid) || url;
    const categories = (Array.isArray(item.category) ? item.category : [item.category]).map(value).filter(Boolean);
    const location = value(item.region) || categories.find((category) => /worldwide|remote|america|europe|emea|asia|africa|australia/iu.test(category)) || "Remote";
    return {
      id: `wwr:${externalId}`,
      externalId,
      title,
      company,
      companyVerified: false,
      description,
      url,
      applyUrl: url,
      location,
      remote: true,
      relocation: inferRelocation(description),
      skills: categories,
      salary: parseSalaryText(description, { fallbackCurrency: "USD", fallbackPeriod: "year" }),
      postedAt: value(item.pubDate) || null,
      source,
      sourceQuality: 0.86,
    };
  }).filter((job) => job.externalId && job.title && job.url);
}

export function weWorkRemotelyConnector(config) {
  const source = {
    id: "weworkremotely",
    name: "We Work Remotely",
    officialApi: true,
    attributionUrl: "https://weworkremotely.com/",
    setupUrl: "https://weworkremotely.com/remote-job-rss-feed",
    authType: "none",
    credentialFields: [],
    adapter: "rss",
    regions: ["global-remote"],
    note: "Официальный публичный RSS; WWR просит сохранять атрибуцию и ссылки на оригинальные вакансии.",
  };
  return {
    ...source,
    async search(query) {
      const xml = await fetchText("https://weworkremotely.com/remote-jobs.rss", {
        timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        headers: { Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return parseWwrFeed(xml, source).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
