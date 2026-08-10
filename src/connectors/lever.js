import { fetchJson, fetchText } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function leverSalary(item, description) {
  const range = item.salaryRange;
  if (range && (range.min != null || range.max != null)) {
    const interval = String(range.interval || "");
    const period = /year/i.test(interval) ? "year" : /hour/i.test(interval) ? "hour" : /week/i.test(interval) ? "week" : /day/i.test(interval) ? "day" : "month";
    return { min: range.min ?? null, max: range.max ?? null, currency: range.currency || null, period };
  }
  return parseSalaryText(`${item.salaryDescriptionPlain || ""} ${description}`, { fallbackPeriod: "year", fallbackCurrency: "USD" });
}

function siteEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

function postingIndex(html) {
  const postings = [];
  const pattern = /<a\s+href="(https:\/\/jobs(?:\.eu)?\.lever\.co\/[^"/]+\/([a-f\d-]+))"[^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of String(html || "").matchAll(pattern)) postings.push({ url: match[1], id: match[2], title: stripHtml(match[3]) });
  return postings;
}

function potentialTitle({ title }, query) {
  if (retrievalMatches({ title, description: "" }, query)) return true;
  return /(?:developer|engineer|architect|devops|qa|quality assurance|software|backend|back-end|platform|разработчик|инженер|архитектор)/iu.test(title || "");
}

export function leverConnectors(config) {
  return config.leverSites.map(siteEntry).filter((site) => site?.slug && site.enabled !== false).map((site) => {
    let lastRun = null;
    const source = {
      id: `lever:${site.slug}`,
      name: site.name || site.slug,
      officialApi: true,
      attributionUrl: site.homepage || `https://jobs.lever.co/${encodeURIComponent(site.slug)}`,
      adapter: "lever",
      regions: site.regions || ["global"],
    };
    return {
      ...source,
      getDiagnostics() { return lastRun ? structuredClone(lastRun) : null; },
      async search(query) {
        const pageSize = Math.max(1, Math.min(config.atsIndexPageSize || 20, 100));
        const maxScanned = Math.max(config.maxJobsPerSource, config.maxJobsScannedPerSource || 500);
        const baseUrl = site.apiBase || "https://api.lever.co";
        const index = [];
        const indexWarnings = [];
        let indexCompleted = false;
        for (let skip = 0; skip < maxScanned; skip += pageSize) {
          const params = new URLSearchParams({ mode: "html", skip: String(skip), limit: String(pageSize) });
          try {
            const page = postingIndex(await fetchText(`${baseUrl}/v0/postings/${encodeURIComponent(site.slug)}?${params}`, { timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1, fetchImpl: config.fetchImpl || fetch }));
            index.push(...page);
            if (page.length < pageSize) { indexCompleted = true; break; }
          } catch (error) {
            indexWarnings.push({ offset: skip, limit: pageSize, error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" });
            lastRun = { scanned: index.length, completed: false, warnings: indexWarnings };
            throw error;
          }
        }
        const candidates = index.filter((posting) => potentialTitle(posting, query));
        const rawJobs = [];
        const warnings = [...indexWarnings];
        let nextCandidate = 0;
        const workerCount = Math.min(candidates.length, Math.max(1, config.atsDetailConcurrency || 4));
        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (nextCandidate < candidates.length) {
            const candidate = candidates[nextCandidate];
            nextCandidate += 1;
            try {
              rawJobs.push(await fetchJson(`${baseUrl}/v0/postings/${encodeURIComponent(site.slug)}/${encodeURIComponent(candidate.id)}`, { timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1, fetchImpl: config.fetchImpl || fetch }));
            } catch (error) {
              warnings.push({ postingId: candidate.id, title: candidate.title, error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" });
            }
          }
        }));
        const jobs = rawJobs.map((item) => {
          const description = stripHtml([item.description, item.descriptionPlain, ...(item.lists || []).map((list) => `${list.text} ${list.content}`), item.additional].filter(Boolean).join(" "));
          const location = item.categories?.location || "";
          return {
            id: `lever:${site.slug}:${item.id}`, externalId: String(item.id), title: item.text, company: site.name || site.slug, companyVerified: true, description,
            url: item.hostedUrl, applyUrl: item.applyUrl || item.hostedUrl, location,
            remote: item.workplaceType === "remote" || inferRemote(location, description), relocation: inferRelocation(description), visaSponsorship: inferRelocation(description),
            employmentType: item.categories?.commitment, category: item.categories?.team || item.categories?.department, salary: leverSalary(item, description),
            postedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null, source, sourceQuality: 0.96,
          };
        }).filter((job) => retrievalMatches(job, query)).slice(0, config.maxJobsPerSource);
        lastRun = { scanned: index.length, detailCandidates: candidates.length, detailsLoaded: rawJobs.length, matched: jobs.length, completed: indexCompleted, warnings };
        return jobs;
      },
    };
  });
}
