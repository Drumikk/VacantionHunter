import { fetchJson } from "./http.js";
import { cachedSearch } from "./cache.js";
import { stripHtml } from "../core/text.js";
import { sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

const US_LOCATIONS = new Set(["united states", "north america"]);

function period(code) {
  return { PA: "year", PH: "hour", PD: "day", PW: "week", PM: "month" }[code] || null;
}

export function usajobsConnector(config) {
  const source = {
    id: "usajobs",
    name: "USAJOBS",
    officialApi: true,
    attributionUrl: "https://www.usajobs.gov/",
    setupUrl: "https://developer.usajobs.gov/APIRequest/Index",
    authType: "api_key_headers",
    credentialFields: ["USAJOBS_API_KEY", "USAJOBS_EMAIL"],
    adapter: "government-api",
    regions: ["north-america"],
    note: "Официальный API федеральных вакансий США.",
  };
  const enabled = Boolean(config.usajobsApiKey && config.usajobsEmail);
  const execute = async (query) => {
    if (query.locations?.length && !query.locations.some((location) => US_LOCATIONS.has(location))) return [];
    const params = new URLSearchParams({
      Keyword: sourceSearchTerms(query),
      ResultsPerPage: String(Math.min(config.maxJobsPerSource, 100)),
      DatePosted: "30",
      Fields: "Full",
      SortField: "opendate",
    });
    if (query.remote) params.set("RemoteIndicator", "True");
    const data = await fetchJson(`https://data.usajobs.gov/api/search?${params}`, {
      headers: { Host: "data.usajobs.gov", "Authorization-Key": config.usajobsApiKey },
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.usajobsEmail,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    return (data.SearchResult?.SearchResultItems || []).filter((item) => {
      const job = item?.MatchedObjectDescriptor;
      return (job?.PositionID || item?.MatchedObjectId) && job?.PositionTitle && job?.PositionURI;
    }).slice(0, config.maxJobsPerSource).map((item) => {
      const job = item.MatchedObjectDescriptor || {};
      const remuneration = job.PositionRemuneration?.[0];
      const details = job.UserArea?.Details || {};
      const description = stripHtml([details.JobSummary, job.QualificationSummary, details.MajorDuties].filter(Boolean).join(" "));
      return {
        id: `usajobs:${job.PositionID || item.MatchedObjectId}`,
        externalId: String(job.PositionID || item.MatchedObjectId),
        title: job.PositionTitle,
        company: job.OrganizationName || job.DepartmentName || "US Federal Government",
        companyVerified: true,
        description,
        url: job.PositionURI,
        applyUrl: job.ApplyURI?.[0] || job.PositionURI,
        location: job.PositionLocationDisplay || job.PositionLocation?.[0]?.LocationName || "United States",
        remote: /remote|anywhere in the u\.s\./iu.test(`${job.PositionLocationDisplay || ""} ${description}`),
        relocation: inferRelocation(description),
        employmentType: job.PositionSchedule?.[0]?.Name || job.PositionOfferingType?.[0]?.Name || null,
        salary: remuneration ? {
          min: Number(remuneration.MinimumRange) || null,
          max: Number(remuneration.MaximumRange) || null,
          currency: "USD",
          period: period(remuneration.RateIntervalCode),
        } : null,
        postedAt: job.PublicationStartDate || job.PositionStartDate || null,
        validThrough: job.ApplicationCloseDate || job.PositionEndDate || null,
        source,
        sourceQuality: 0.98,
      };
    });
  };
  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Требуются USAJOBS_API_KEY и USAJOBS_EMAIL; регистрация: https://developer.usajobs.gov/APIRequest/Index",
    search: enabled ? cachedSearch(execute, { ttlMs: config.aggregatorCacheMs }) : async () => { throw new Error("USAJOBS credentials are required"); },
  };
}
