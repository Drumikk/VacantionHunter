import { XMLParser } from "fast-xml-parser";
import { fetchText } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function boardEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parsePersonioFeed(xml, source, board) {
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml);
  return list(parsed?.["workzag-jobs"]?.position).map((item) => {
    const blocks = list(item.jobDescriptions?.jobDescription);
    const description = stripHtml(blocks.map((block) => [block?.name, block?.value].filter(Boolean).join(" ")).join(" "));
    const externalId = String(item.id || "");
    const location = String(item.office || "");
    const url = `https://${board.slug}.jobs.personio.de/job/${encodeURIComponent(externalId)}?language=${encodeURIComponent(board.language || "en")}`;
    return {
      id: `personio:${board.slug}:${externalId}`,
      externalId,
      title: item.name,
      company: item.subcompany || board.name || board.slug,
      companyVerified: true,
      description,
      url,
      applyUrl: url,
      location,
      remote: inferRemote(item.name, location, description),
      relocation: inferRelocation(description),
      visaSponsorship: inferRelocation(description),
      employmentType: [item.employmentType, item.schedule].filter(Boolean).join(", ") || null,
      experience: [item.seniority, item.yearsOfExperience].filter(Boolean).join(", ") || null,
      category: item.occupationCategory || item.department || null,
      skills: [item.department, item.recruitingCategory, item.occupation, item.occupationCategory].filter(Boolean),
      salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "EUR" }),
      postedAt: item.createdAt || null,
      source,
      sourceQuality: 0.96,
    };
  }).filter((job) => job.externalId && job.title && job.url);
}

export function personioConnectors(config) {
  return (config.personioBoards || []).map(boardEntry).filter((board) => board?.slug && board.enabled !== false).map((board) => {
    const source = {
      id: `personio:${board.slug}`,
      name: board.name || board.slug,
      officialApi: true,
      attributionUrl: board.homepage || `https://${board.slug}.jobs.personio.de/`,
      setupUrl: "https://developer.personio.de/docs/retrieving-open-job-positions",
      authType: "none",
      credentialFields: [],
      adapter: "personio",
      regions: board.regions || ["europe"],
      note: "Официальный XML feed публичной Personio career page; содержит только текущие открытые позиции работодателя.",
    };
    return {
      ...source,
      async search(query) {
        const language = board.language || "en";
        const xml = await fetchText(`https://${encodeURIComponent(board.slug)}.jobs.personio.de/xml?language=${encodeURIComponent(language)}`, {
          timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs,
          userAgent: config.httpUserAgent,
          headers: { Accept: "application/xml, text/xml;q=0.9" },
          retries: 1,
          fetchImpl: config.fetchImpl || fetch,
        });
        return parsePersonioFeed(xml, source, board).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
      },
    };
  });
}
