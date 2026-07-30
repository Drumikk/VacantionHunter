import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function boardEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

function salaryOf(value) {
  if (!value || value.min == null && value.max == null) return null;
  const rawPeriod = String(value.period || "month").toLowerCase();
  const period = /year|annual/.test(rawPeriod) ? "year" : /hour/.test(rawPeriod) ? "hour" : /week/.test(rawPeriod) ? "week" : /day/.test(rawPeriod) ? "day" : "month";
  return {
    min: value.min == null ? null : Number(value.min),
    max: value.max == null ? null : Number(value.max),
    currency: value.currency || null,
    period,
  };
}

export function recruiteeConnectors(config) {
  return (config.recruiteeBoards || []).map(boardEntry).filter((board) => board?.slug && board.enabled !== false).map((board) => {
    const source = {
      id: `recruitee:${board.slug}`,
      name: board.name || board.slug,
      officialApi: true,
      attributionUrl: board.homepage || `https://${board.slug}.recruitee.com/`,
      setupUrl: "https://docs.recruitee.com/reference/intro-to-careers-site-api",
      authType: "none",
      credentialFields: [],
      adapter: "recruitee",
      regions: board.regions || ["global"],
    };
    return {
      ...source,
      async search(query) {
        const data = await fetchJson(`https://${encodeURIComponent(board.slug)}.recruitee.com/api/offers/`, {
          timeoutMs: config.atsRequestTimeoutMs || config.requestTimeoutMs,
          userAgent: config.httpUserAgent,
          retries: 1,
          fetchImpl: config.fetchImpl || fetch,
        });
        return (data.offers || []).map((item) => {
          const translation = item.translations?.en || Object.values(item.translations || {})[0] || {};
          const description = stripHtml([translation.description || item.description, translation.requirements || item.requirements].filter(Boolean).join(" "));
          const locations = (item.locations || []).map((location) => [location.city, location.state, location.country].filter(Boolean).join(", ")).filter(Boolean);
          const location = item.location || locations.join("; ") || [item.city, item.state_name, item.country].filter(Boolean).join(", ");
          const externalId = String(item.id || item.guid || item.slug || item.careers_url || "");
          const url = item.careers_url || `https://${board.slug}.recruitee.com/o/${item.slug}`;
          return {
            id: `recruitee:${board.slug}:${externalId}`,
            externalId,
            title: translation.title || item.title || item.sharing_title,
            company: board.name || item.company_name || board.slug,
            companyVerified: true,
            description,
            url,
            applyUrl: item.careers_apply_url || url,
            location,
            locations,
            remote: item.on_site === false || /remote job/iu.test(item.location || "") || inferRemote(location, locations, description),
            relocation: inferRelocation(description),
            visaSponsorship: inferRelocation(description),
            employmentType: item.employment_type_code || null,
            salary: salaryOf(item.salary),
            postedAt: item.published_at || item.created_at || null,
            updatedAt: item.updated_at || null,
            validThrough: item.close_at || null,
            source,
            sourceQuality: 0.96,
          };
        }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
      },
    };
  });
}
