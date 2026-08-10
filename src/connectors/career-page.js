import { createHash } from "node:crypto";
import { fetchJson, fetchResponse } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

const ROLE_PATTERN = /(?:\b(?:software|data|machine learning|ml|ai|cloud|platform|security|mobile|ios|android|frontend|front-end|backend|back-end|full[- ]?stack|devops|qa|quality|product|project|marketing|sales|support|customer success|designer|design|analyst|scientist|developer|engineer|architect|manager|lead|director|specialist|consultant|recruiter|researcher)\b|разработчик|инженер|аналитик|архитектор|дизайнер|менеджер|руководитель|специалист|тестировщик)/iu;
const JOB_PATH_PATTERN = /\/(?:jobs?|careers?|vacanc(?:y|ies)|positions?|openings?|opportunities?|roles?|apply)(?:\/|$)/iu;
const NON_JOB_TITLE = /^(?:careers?|jobs?|vacancies|open positions|open roles|join us|join our team|learn more|read more|view all|apply now|details?)$/iu;
const BLOCKED_LINK_HOSTS = /(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com)$/iu;

function decodeEntities(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value = "") {
  return decodeEntities(stripHtml(value)).replace(/\s+/g, " ").trim();
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
}

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(decodeEntities(value), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function valueOf(input) {
  if (typeof input === "string" || typeof input === "number") return String(input);
  if (input && typeof input === "object") return valueOf(input.value ?? input.name ?? input["@id"] ?? "");
  return "";
}

function typeIncludes(value, expected) {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => String(item || "").toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US"));
}

function collectJobPostings(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (typeIncludes(value["@type"], "JobPosting")) output.push(value);
  if (value["@graph"]) collectJobPostings(value["@graph"], output);
  return output;
}

function locationText(item) {
  const locations = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation].filter(Boolean);
  const parts = [];
  for (const location of locations) {
    const address = location?.address || location;
    parts.push(
      [address?.streetAddress, address?.addressLocality, address?.addressRegion, valueOf(address?.addressCountry)]
        .filter(Boolean)
        .join(", "),
    );
  }
  const applicant = Array.isArray(item.applicantLocationRequirements) ? item.applicantLocationRequirements : [item.applicantLocationRequirements].filter(Boolean);
  for (const place of applicant) parts.push(valueOf(place));
  if (/telecommute/i.test(String(item.jobLocationType || ""))) parts.push("Remote");
  return [...new Set(parts.filter(Boolean))].join("; ");
}

function structuredSalary(item, description) {
  const base = item.baseSalary;
  const value = base?.value && typeof base.value === "object" ? base.value : base;
  if (value && typeof value === "object") {
    const min = Number(value.minValue ?? value.value);
    const max = Number(value.maxValue ?? value.value);
    const unit = String(value.unitText || base?.unitText || "").toLocaleLowerCase("en-US");
    const period = /year|annual/.test(unit) ? "year" : /month/.test(unit) ? "month" : /week/.test(unit) ? "week" : /day/.test(unit) ? "day" : /hour/.test(unit) ? "hour" : null;
    if (Number.isFinite(min) || Number.isFinite(max)) {
      return {
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
        currency: base?.currency || item.salaryCurrency || null,
        period,
        explicit: true,
      };
    }
  }
  return parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" });
}

function pageHeading(html, fallback = "") {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return cleanText(heading || title || fallback).replace(/\s+[|–—-]\s+(?:careers?|jobs?).*$/iu, "");
}

function pageDescription(html) {
  const meta = html.match(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["'][^>]*>/iu)?.[1]
    || html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/iu)?.[1]
    || "";
  return `${cleanText(meta)} ${cleanText(html)}`.trim().slice(0, 50_000);
}

function normalizePosting(item, { entry, pageUrl, source }) {
  const title = cleanText(item.title || item.name || "");
  const description = cleanText(item.description || item.responsibilities || item.qualifications || "");
  const location = locationText(item);
  const url = absoluteUrl(valueOf(item.url || item.mainEntityOfPage), pageUrl) || pageUrl;
  const externalId = valueOf(item.identifier) || hash(url);
  const remote = /telecommute/i.test(String(item.jobLocationType || "")) || inferRemote(location, description);
  return {
    id: `${source.id}:${hash(`${externalId}:${url}`)}`,
    externalId,
    title,
    company: valueOf(item.hiringOrganization) || entry.name,
    companyVerified: true,
    description,
    url,
    applyUrl: url,
    location,
    remote,
    relocation: inferRelocation(description),
    visaSponsorship: inferRelocation(description),
    employmentType: Array.isArray(item.employmentType) ? item.employmentType.join(", ") : item.employmentType,
    salary: structuredSalary(item, description),
    postedAt: item.datePosted || null,
    updatedAt: item.dateModified || item.datePosted || null,
    validThrough: item.validThrough || null,
    source,
    sourceQuality: 0.86,
  };
}

export function parseJsonLdJobs(html, context) {
  const postings = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json(?:;[^"']*)?["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      const payload = JSON.parse(decodeEntities(match[1]).replace(/^\s*<!--|-->\s*$/g, ""));
      postings.push(...collectJobPostings(payload));
    } catch { /* malformed analytics JSON-LD is not a source failure */ }
  }
  return postings.map((item) => normalizePosting(item, context)).filter((job) => job.title);
}

function attribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

export function extractTeamtailorWidgetKeys(html) {
  const keys = new Set();
  const pattern = /<[^>]+\bdata-teamtailor-api-key\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/giu;
  for (const match of String(html || "").matchAll(pattern)) {
    const value = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value) keys.add(value);
  }
  return [...keys];
}

function looksLikeJobLink(item) {
  if (!item.title || NON_JOB_TITLE.test(item.title)) return false;
  const parsed = new URL(item.url);
  return JOB_PATH_PATTERN.test(parsed.pathname) || ROLE_PATTERN.test(item.title);
}

export function extractJobLinks(html, pageUrl) {
  const links = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const match of String(html || "").matchAll(pattern)) {
    const href = attribute(match[1], "href");
    const url = absoluteUrl(href, pageUrl);
    if (!url || BLOCKED_LINK_HOSTS.test(new URL(url).hostname)) continue;
    const title = cleanText(match[2]) || cleanText(attribute(match[1], "aria-label")) || cleanText(attribute(match[1], "title"));
    const item = { title, url };
    if (!looksLikeJobLink(item) || seen.has(url)) continue;
    seen.add(url);
    links.push(item);
  }
  return links;
}

async function loadPage(url, config) {
  const response = await fetchResponse(url, {
    timeoutMs: config.careerPageTimeoutMs || config.requestTimeoutMs,
    retries: 1,
    headers: { Accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.5" },
    userAgent: config.httpUserAgent,
    fetchImpl: config.fetchImpl || fetch,
  });
  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url || url;
  if (BLOCKED_LINK_HOSTS.test(new URL(finalUrl).hostname)) throw new Error(`Career page redirected to excluded social host ${new URL(finalUrl).hostname}`);
  const html = (await response.text()).slice(0, config.careerPageMaxBytes || 2_000_000);
  return { html, url: finalUrl, contentType };
}

function teamtailorLocation(item, included = []) {
  const byId = new Map(included.map((value) => [`${value.type}:${value.id}`, value]));
  const relationships = item.relationships || {};
  const values = [];
  for (const type of ["locations", "regions"]) {
    const data = Array.isArray(relationships[type]?.data) ? relationships[type].data : [relationships[type]?.data].filter(Boolean);
    for (const reference of data) {
      const related = byId.get(`${reference.type}:${reference.id}`);
      const attributes = related?.attributes || {};
      const label = attributes.name || attributes.city || "";
      if (label) values.push(label);
    }
  }
  return [...new Set(values)].join("; ");
}

function normalizeTeamtailorPosting(item, { entry, source, included = [] }) {
  const attributes = item.attributes || {};
  const title = cleanText(attributes.title || item.title || "");
  const description = cleanText(attributes.body || attributes.pitch || attributes.description || "");
  const rawUrl = item.links?.["careersite-job-url"] || item.links?.["careersite-job-internal-url"] || attributes["apply-url"] || entry.url;
  const url = absoluteUrl(rawUrl, entry.url) || entry.url;
  const location = teamtailorLocation(item, included);
  const remoteStatus = String(attributes["remote-status"] || "");
  const remote = /fully|remote/i.test(remoteStatus) || inferRemote(location, description);
  return {
    id: `${source.id}:${hash(`teamtailor:${item.id || url}`)}`,
    externalId: String(item.id || hash(url)),
    title,
    company: attributes["company-name"] || entry.name,
    companyVerified: true,
    description,
    url,
    applyUrl: url,
    location,
    remote,
    relocation: inferRelocation(description),
    visaSponsorship: inferRelocation(description),
    employmentType: attributes["employment-type"] || attributes["employment-type-name"] || null,
    salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" }),
    postedAt: attributes["created-at"] || attributes["published-at"] || null,
    updatedAt: attributes["updated-at"] || attributes["created-at"] || null,
    source,
    sourceQuality: 0.93,
  };
}

function teamtailorUrl(apiKey, pageSize, nextUrl = null) {
  const url = new URL(nextUrl || "https://api.teamtailor.com/v1/jobs");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("api_version", "20161108");
  if (!nextUrl) {
    url.searchParams.set("filter[feed]", "public");
    url.searchParams.set("include", "division,department,role,regions,locations");
    url.searchParams.set("fields[divisions]", "name");
    url.searchParams.set("fields[departments]", "name");
    url.searchParams.set("fields[roles]", "name");
    url.searchParams.set("fields[locations]", "name,city");
    url.searchParams.set("fields[regions]", "name");
    url.searchParams.set("page[size]", String(pageSize));
  }
  return url;
}

async function loadTeamtailorJobs(apiKey, { entry, source, config }) {
  const limit = Math.max(1, Number(config.maxJobsPerSource || 100));
  const pageSize = Math.min(30, limit);
  const results = [];
  let nextUrl = null;
  const seenPages = new Set();
  while (results.length < limit) {
    const url = teamtailorUrl(apiKey, pageSize, nextUrl);
    const canonical = url.toString();
    if (seenPages.has(canonical)) break;
    seenPages.add(canonical);
    const payload = await fetchJson(url, {
      timeoutMs: config.careerPageTimeoutMs || config.requestTimeoutMs,
      retries: 1,
      headers: { Accept: "application/vnd.api+json,application/json" },
      userAgent: config.httpUserAgent,
      fetchImpl: config.fetchImpl || fetch,
    });
    const included = Array.isArray(payload.included) ? payload.included : [];
    for (const item of Array.isArray(payload.data) ? payload.data : []) {
      const job = normalizeTeamtailorPosting(item, { entry, source, included });
      if (job.title) results.push(job);
      if (results.length >= limit) break;
    }
    nextUrl = payload.links?.next || null;
    if (!nextUrl) break;
  }
  return results;
}

function anchorJob(item, description, { entry, source }) {
  return {
    id: `${source.id}:${hash(item.url)}`,
    externalId: hash(item.url),
    title: item.title,
    company: entry.name,
    companyVerified: true,
    description,
    url: item.url,
    applyUrl: item.url,
    location: "",
    remote: inferRemote(item.title, description),
    relocation: inferRelocation(description),
    visaSponsorship: inferRelocation(description),
    salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" }),
    postedAt: null,
    updatedAt: null,
    source,
    sourceQuality: 0.74,
  };
}

function entryValue(value) {
  return typeof value === "string" ? { id: hash(value), name: value, url: value } : value;
}

export function careerPageConnectors(config) {
  return (config.careerPages || []).map(entryValue).filter((entry) => entry?.id && entry?.url && entry.enabled !== false).map((entry) => {
    let lastRun = null;
    let cachedPage = null;
    const source = {
      id: `career-page:${entry.id}`,
      name: entry.name || entry.id,
      officialApi: false,
      attributionUrl: entry.homepage || entry.url,
      adapter: "career-page",
      regions: entry.regions || ["global"],
      catalogRow: entry.catalogRow,
    };

    return {
      ...source,
      getDiagnostics() { return lastRun ? structuredClone(lastRun) : null; },
      async search(query) {
        const warnings = [];
        const cacheMs = config.careerPageCacheMs ?? 15 * 60 * 1_000;
        if (!cachedPage || Date.now() - cachedPage.loadedAt > cacheMs) {
          const loaded = await loadPage(entry.url, config);
          cachedPage = { ...loaded, loadedAt: Date.now() };
        }

        const context = { entry, pageUrl: cachedPage.url, source };
        const structured = parseJsonLdJobs(cachedPage.html, context).filter((job) => retrievalMatches(job, query));
        const teamtailor = [];
        for (const apiKey of extractTeamtailorWidgetKeys(cachedPage.html)) {
          try {
            const jobs = await loadTeamtailorJobs(apiKey, { entry, source, config });
            teamtailor.push(...jobs.filter((job) => retrievalMatches(job, query)));
          } catch (error) {
            warnings.push({ url: "https://api.teamtailor.com/v1/jobs", error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" });
          }
        }
        const links = extractJobLinks(cachedPage.html, cachedPage.url);
        const directMatches = links.filter((item) => retrievalMatches({ title: item.title, description: "" }, query));
        const exploratory = links.filter((item) => !directMatches.includes(item) && ROLE_PATTERN.test(item.title));
        const candidates = [...directMatches, ...exploratory].slice(0, config.maxGenericDetailPages || 4);
        const detailed = [];
        let next = 0;
        const workers = Math.min(candidates.length, Math.max(1, config.atsDetailConcurrency || 4));
        await Promise.all(Array.from({ length: workers }, async () => {
          while (next < candidates.length) {
            const index = next;
            next += 1;
            const candidate = candidates[index];
            try {
              const page = await loadPage(candidate.url, config);
              const embedded = parseJsonLdJobs(page.html, { entry, pageUrl: page.url, source });
              if (embedded.length) detailed.push(...embedded.filter((job) => retrievalMatches(job, query)));
              else {
                const title = pageHeading(page.html, candidate.title) || candidate.title;
                const description = pageDescription(page.html);
                const job = anchorJob({ title, url: page.url }, description, { entry, source });
                if (retrievalMatches(job, query)) detailed.push(job);
              }
            } catch (error) {
              warnings.push({ url: candidate.url, error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" });
              if (directMatches.includes(candidate)) detailed.push(anchorJob(candidate, "", { entry, source }));
            }
          }
        }));

        if (!structured.length && !teamtailor.length && !detailed.length) {
          const title = pageHeading(cachedPage.html);
          const description = pageDescription(cachedPage.html);
          const single = anchorJob({ title, url: cachedPage.url }, description, { entry, source });
          if (ROLE_PATTERN.test(title) && retrievalMatches(single, query)) detailed.push(single);
        }

        const unique = new Map();
        for (const job of [...structured, ...teamtailor, ...detailed]) unique.set(job.url, job);
        const jobs = [...unique.values()].slice(0, config.maxJobsPerSource);
        lastRun = {
          resolvedUrl: cachedPage.url,
          contentType: cachedPage.contentType,
          jsonLdJobs: structured.length,
          teamtailorJobs: teamtailor.length,
          jobLinks: links.length,
          detailCandidates: candidates.length,
          matched: jobs.length,
          warnings,
        };
        return jobs;
      },
    };
  });
}
