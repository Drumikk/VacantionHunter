import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

const COUNTRIES = {
  gb: { name: "United Kingdom", currency: "GBP", regions: ["europe"] },
  us: { name: "United States", currency: "USD", regions: ["north-america"] },
  at: { name: "Austria", currency: "EUR", regions: ["europe"] },
  au: { name: "Australia", currency: "AUD", regions: ["oceania"] },
  be: { name: "Belgium", currency: "EUR", regions: ["europe"] },
  br: { name: "Brazil", currency: "BRL", regions: ["latin-america"] },
  ca: { name: "Canada", currency: "CAD", regions: ["north-america"] },
  ch: { name: "Switzerland", currency: "CHF", regions: ["europe"] },
  de: { name: "Germany", currency: "EUR", regions: ["europe"] },
  es: { name: "Spain", currency: "EUR", regions: ["europe"] },
  fr: { name: "France", currency: "EUR", regions: ["europe"] },
  it: { name: "Italy", currency: "EUR", regions: ["europe"] },
  mx: { name: "Mexico", currency: "MXN", regions: ["latin-america"] },
  nl: { name: "Netherlands", currency: "EUR", regions: ["europe"] },
  nz: { name: "New Zealand", currency: "NZD", regions: ["oceania"] },
  pl: { name: "Poland", currency: "PLN", regions: ["europe"] },
};

export function adzunaConnectors(config) {
  const enabled = Boolean(config.adzunaAppId && config.adzunaApiKey);
  return (config.adzunaCountries || []).map((value) => String(value).toLowerCase()).filter((code) => COUNTRIES[code]).map((code) => {
    const country = COUNTRIES[code];
    const source = {
      id: `adzuna:${code}`,
      name: `Adzuna — ${country.name}`,
      officialApi: true,
      attributionUrl: "https://www.adzuna.com/",
      setupUrl: "https://developer.adzuna.com/",
      authType: "api_key",
      credentialFields: ["ADZUNA_APP_ID", "ADZUNA_API_KEY"],
      adapter: "adzuna",
      regions: country.regions,
      note: "Adzuna требует переход по redirect_url, атрибуцию и соблюдение квот API.",
    };
    return {
      ...source,
      enabled,
      disabledReason: enabled ? null : "Задайте ADZUNA_APP_ID и ADZUNA_API_KEY",
      async search(query) {
        if (!enabled) throw new Error("Adzuna credentials are required");
        const params = new URLSearchParams({
          app_id: config.adzunaAppId,
          app_key: config.adzunaApiKey,
          results_per_page: String(Math.min(config.maxJobsPerSource || 50, 50)),
          what: sourceSearchTerms(query),
          sort_by: "date",
          "content-type": "application/json",
        });
        if (query.exclusions?.length) params.set("what_exclude", query.exclusions.join(" "));
        const data = await fetchJson(`https://api.adzuna.com/v1/api/jobs/${code}/search/1?${params}`, {
          timeoutMs: config.requestTimeoutMs,
          userAgent: config.httpUserAgent,
          retries: 1,
          fetchImpl: config.fetchImpl || fetch,
        });
        return (data.results || []).map((item) => {
          const description = stripHtml(item.description || "");
          const location = item.location?.display_name || item.location?.area?.join(", ") || country.name;
          const url = item.redirect_url;
          return {
            id: `adzuna:${code}:${item.id}`,
            externalId: String(item.id),
            title: item.title,
            company: item.company?.display_name || "Не указан",
            companyVerified: false,
            description,
            url,
            applyUrl: url,
            location,
            remote: inferRemote(item.title, location, description),
            relocation: inferRelocation(description),
            salary: item.salary_min != null || item.salary_max != null ? {
              min: item.salary_min == null ? null : Number(item.salary_min),
              max: item.salary_max == null ? null : Number(item.salary_max),
              currency: country.currency,
              period: "year",
              predicted: String(item.salary_is_predicted || "0") === "1",
            } : null,
            employmentType: [item.contract_time, item.contract_type].filter(Boolean).join(" ") || null,
            postedAt: item.created || null,
            source,
            sourceQuality: 0.84,
          };
        }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
      },
    };
  });
}
