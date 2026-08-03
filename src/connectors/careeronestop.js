import { cachedSearch } from "./cache.js";
import { fetchJson } from "./http.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";
import { parseSalaryText } from "../core/salary.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { stripHtml } from "../core/text.js";

const US_LOCATIONS = new Set(["united states", "north america"]);

function pathPart(value) {
  return encodeURIComponent(String(value || "0"));
}

function candidateJob(item) {
  return {
    title: item?.JobTitle,
    description: stripHtml(item?.DescriptionSnippet || ""),
    skills: Array.isArray(item?.OnetCodes) ? item.OnetCodes : [],
  };
}

export function careerOneStopConnector(config) {
  const source = {
    id: "careeronestop",
    name: "CareerOneStop",
    officialApi: true,
    attributionUrl: "https://www.careeronestop.org/JobSearch/job-search.aspx",
    setupUrl: "https://www.careeronestop.org/Developers/WebAPI/web-api.aspx",
    authType: "bearer_token_user_id",
    credentialFields: ["CAREERONESTOP_USER_ID", "CAREERONESTOP_API_TOKEN"],
    adapter: "government-api",
    regions: ["north-america"],
    note: "Официальный API CareerOneStop Министерства труда США; требуется бесплатный User ID и API token.",
  };
  const enabled = Boolean(config.careerOneStopUserId && config.careerOneStopApiToken);
  let diagnostics = { scanned: 0, detailCandidates: 0, detailsLoaded: 0, matched: 0, warnings: [] };

  async function execute(query) {
    diagnostics = { scanned: 0, detailCandidates: 0, detailsLoaded: 0, matched: 0, warnings: [] };
    if (query.locations?.length && !query.locations.some((location) => US_LOCATIONS.has(location))) return [];

    const pageSize = Math.max(1, Math.min(config.maxJobsScannedPerSource || config.maxJobsPerSource || 100, 100));
    const keyword = sourceSearchTerms(query) || "0";
    const path = [
      "https://api.careeronestop.org/v2/jobsearch",
      pathPart(config.careerOneStopUserId),
      pathPart(keyword),
      "0",
      "100",
      "acquisitiondate",
      "DESC",
      "0",
      String(pageSize),
      "60",
    ].join("/");
    const headers = { Authorization: `Bearer ${config.careerOneStopApiToken}` };
    const params = new URLSearchParams({
      showFilters: "false",
      enableJobDescriptionSnippet: "true",
      enableMetaData: "false",
    });
    const requestOptions = {
      headers,
      timeoutMs: Math.max(config.atsRequestTimeoutMs || config.requestTimeoutMs || 0, 30_000),
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    };
    const data = await fetchJson(`${path}?${params}`, requestOptions);
    if (data?.ErrorMessage) throw new Error(`CareerOneStop: ${data.ErrorMessage}`);
    const rawJobs = Array.isArray(data?.Jobs) ? data.Jobs : [];
    const candidates = rawJobs.filter((item) => item?.JvId && item?.JobTitle && item?.URL && retrievalMatches(candidateJob(item), query))
      .slice(0, config.maxJobsPerSource || 100);

    const details = new Map();
    const warnings = [];
    let next = 0;
    const workers = Math.min(candidates.length, Math.max(1, config.atsDetailConcurrency || 4));
    await Promise.all(Array.from({ length: workers }, async () => {
      while (next < candidates.length) {
        const candidate = candidates[next];
        next += 1;
        const detailParams = new URLSearchParams({ isHtml: "false", enableMetaData: "false" });
        const detailUrl = `https://api.careeronestop.org/v2/jobsearch/${pathPart(config.careerOneStopUserId)}/${pathPart(candidate.JvId)}?${detailParams}`;
        try {
          details.set(String(candidate.JvId), await fetchJson(detailUrl, requestOptions));
        } catch (error) {
          warnings.push({
            postingId: String(candidate.JvId),
            title: candidate.JobTitle,
            error: error.message,
            code: typeof error.code === "string" ? error.code : error.name || "source_error",
          });
        }
      }
    }));

    const jobs = candidates.map((item) => {
      const detail = details.get(String(item.JvId)) || {};
      const description = stripHtml(detail.Description || item.DescriptionSnippet || "");
      const location = detail.Location || item.Location || "United States";
      const url = detail.URL || item.URL;
      const title = detail.JobTitle || item.JobTitle;
      const company = detail.Company || item.Company || "Не указано";
      const onetCodes = detail.OnetCodes || item.OnetCodes || [];
      return {
        id: `careeronestop:${item.JvId}`,
        externalId: String(item.JvId),
        title,
        company,
        companyVerified: false,
        description,
        url,
        applyUrl: url,
        location,
        remote: inferRemote(location, description),
        relocation: inferRelocation(description),
        visaSponsorship: inferRelocation(description),
        skills: Array.isArray(onetCodes) ? onetCodes : [],
        salary: parseSalaryText(description, { fallbackPeriod: "year" }),
        postedAt: detail.AcquisitionDate || item.AcquisitionDate || null,
        source,
        sourceQuality: 0.95,
      };
    }).filter((job) => job.title && job.url && retrievalMatches(job, query));

    diagnostics = {
      scanned: rawJobs.length,
      detailCandidates: candidates.length,
      detailsLoaded: details.size,
      matched: jobs.length,
      warnings,
    };
    return jobs;
  }

  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Требуются CAREERONESTOP_USER_ID и CAREERONESTOP_API_TOKEN; регистрация: https://www.careeronestop.org/Developers/WebAPI/web-api.aspx",
    getDiagnostics() { return structuredClone(diagnostics); },
    search: enabled
      ? cachedSearch(execute, { ttlMs: config.aggregatorCacheMs })
      : async () => { throw new Error("CareerOneStop credentials are required"); },
  };
}
