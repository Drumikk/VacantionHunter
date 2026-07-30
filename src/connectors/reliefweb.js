import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function names(value) {
  return (Array.isArray(value) ? value : [value]).map((item) => item?.name || item).filter(Boolean);
}

export function reliefWebConnector(config) {
  const source = {
    id: "reliefweb",
    name: "ReliefWeb Jobs",
    officialApi: true,
    attributionUrl: "https://reliefweb.int/jobs",
    setupUrl: "https://apidoc.reliefweb.int/parameters#appname",
    authType: "approved_appname",
    credentialFields: ["RELIEFWEB_APPNAME"],
    adapter: "international-organization-api",
    regions: ["global"],
    note: "Официальный read-only API OCHA; с ноября 2025 года appname должен быть предварительно одобрен.",
  };
  const enabled = Boolean(config.reliefwebAppName);
  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Запросите одобренный appname ReliefWeb и задайте RELIEFWEB_APPNAME",
    async search(query) {
      if (!enabled) throw new Error("RELIEFWEB_APPNAME is required");
      const params = new URLSearchParams({
        appname: config.reliefwebAppName,
        limit: String(Math.min(config.maxJobsPerSource || 100, 100)),
        profile: "full",
        "query[value]": sourceSearchTerms(query),
      });
      const data = await fetchJson(`https://api.reliefweb.int/v2/jobs?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (data.data || []).filter((item) => item?.id && item?.fields?.title).slice(0, config.maxJobsPerSource || 100).map((item) => {
        const fields = item.fields;
        const description = stripHtml([fields.body, fields["how-to-apply"] || fields.how_to_apply].filter(Boolean).join(" "));
        const countries = names(fields.country);
        const sources = names(fields.source);
        const url = fields.url || `https://reliefweb.int/job/${item.id}`;
        return {
          id: `reliefweb:${item.id}`,
          externalId: String(item.id),
          title: fields.title,
          company: sources[0] || "ReliefWeb partner",
          companyVerified: true,
          description,
          url,
          applyUrl: fields.url || url,
          location: countries.join(", "),
          remote: inferRemote(countries, description),
          relocation: inferRelocation(description),
          employmentType: names(fields["job-type"] || fields.job_type).join(", ") || null,
          postedAt: fields.date?.created || fields.date?.original || null,
          updatedAt: fields.date?.changed || null,
          validThrough: fields["closing-date"] || fields.closing_date || null,
          source,
          sourceQuality: 0.94,
        };
      });
    },
  };
}
