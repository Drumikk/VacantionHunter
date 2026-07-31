import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

function companyEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

function locationOf(item) {
  return [item.location?.city, item.location?.region, item.location?.country].filter(Boolean).join(", ");
}

function descriptionOf(item) {
  const sections = item.jobAd?.sections || item.jobAd || {};
  return stripHtml([sections.companyDescription?.text || sections.companyDescription, sections.jobDescription?.text || sections.jobDescription,
    sections.qualifications?.text || sections.qualifications, sections.additionalInformation?.text || sections.additionalInformation].filter(Boolean).join(" "));
}

function compensationOf(item, description) {
  const value = item.compensation;
  if (value && (value.min != null || value.max != null)) {
    const rawPeriod = String(value.period || "year").toLowerCase();
    const period = /hour/.test(rawPeriod) ? "hour" : /day/.test(rawPeriod) ? "day" : /week/.test(rawPeriod) ? "week" : /month/.test(rawPeriod) ? "month" : "year";
    return { min: value.min == null ? null : Number(value.min), max: value.max == null ? null : Number(value.max), currency: value.currency || null, period };
  }
  return parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" });
}

export function smartRecruitersConnectors(config) {
  return (config.smartRecruitersCompanies || []).map(companyEntry).filter((company) => company?.slug && company.enabled !== false).map((company) => {
    let diagnostics = null;
    const source = {
      id: `smartrecruiters:${company.slug}`,
      name: company.name || company.slug,
      officialApi: true,
      attributionUrl: company.homepage || `https://careers.smartrecruiters.com/${encodeURIComponent(company.slug)}`,
      setupUrl: "https://developers.smartrecruiters.com/docs/posting-api",
      authType: "optional_api_key",
      credentialFields: [],
      adapter: "smartrecruiters",
      regions: company.regions || ["global"],
      note: "Официальный Posting API отдаёт только опубликованные вакансии; SMARTRECRUITERS_API_KEY поддерживается как необязательный серверный credential.",
    };
    const headers = config.smartRecruitersApiKey ? { "X-SmartToken": config.smartRecruitersApiKey } : {};
    return {
      ...source,
      getDiagnostics() { return diagnostics ? structuredClone(diagnostics) : null; },
      async search(query) {
        const take = Math.max(1, Math.min(config.maxJobsScannedPerSource || 100, 100));
        const params = new URLSearchParams({ q: sourceSearchTerms(query), limit: String(take), offset: "0" });
        const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.slug)}/postings`;
        const data = await fetchJson(`${base}?${params}`, {
          timeoutMs: Math.max(config.atsRequestTimeoutMs || config.requestTimeoutMs || 0, 30_000),
          userAgent: config.httpUserAgent,
          headers,
          retries: 1,
          fetchImpl: config.fetchImpl || fetch,
        });
        const candidates = (data.content || []).filter((item) => retrievalMatches({
          title: item.name,
          description: [item.function?.label, item.department?.label, item.industry?.label].filter(Boolean).join(" "),
        }, query)).slice(0, config.maxJobsPerSource || 100);
        const details = [];
        const warnings = [];
        let next = 0;
        const workers = Math.min(candidates.length, Math.max(1, config.atsDetailConcurrency || 4));
        await Promise.all(Array.from({ length: workers }, async () => {
          while (next < candidates.length) {
            const candidate = candidates[next];
            next += 1;
            try {
              details.push(await fetchJson(`${base}/${encodeURIComponent(candidate.id || candidate.uuid)}`, {
                timeoutMs: Math.max(config.atsRequestTimeoutMs || config.requestTimeoutMs || 0, 30_000),
                userAgent: config.httpUserAgent,
                headers,
                retries: 1,
                fetchImpl: config.fetchImpl || fetch,
              }));
            } catch (error) {
              warnings.push({ postingId: candidate.id || candidate.uuid, title: candidate.name, error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" });
            }
          }
        }));
        const jobs = details.filter((item) => item.active !== false).map((item) => {
          const description = descriptionOf(item);
          const location = locationOf(item);
          const externalId = String(item.id || item.uuid || "");
          const url = item.postingUrl || item.applyUrl;
          return {
            id: `smartrecruiters:${company.slug}:${externalId}`,
            externalId,
            title: item.name,
            company: item.company?.name || company.name || company.slug,
            companyVerified: true,
            description,
            url,
            applyUrl: item.applyUrl || url,
            location,
            remote: Boolean(item.location?.remote) || inferRemote(location, description),
            relocation: inferRelocation(description),
            visaSponsorship: inferRelocation(description),
            employmentType: item.typeOfEmployment?.label || null,
            experience: item.experienceLevel?.label || null,
            category: item.function?.label || item.department?.label || item.industry?.label || null,
            skills: [item.function?.label, item.department?.label, item.industry?.label].filter(Boolean),
            salary: compensationOf(item, description),
            postedAt: item.releasedDate || null,
            source,
            sourceQuality: 0.96,
          };
        }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
        diagnostics = { scanned: (data.content || []).length, detailCandidates: candidates.length, detailsLoaded: details.length, matched: jobs.length, warnings };
        return jobs;
      },
    };
  });
}
