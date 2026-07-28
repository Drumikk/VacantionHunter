import { fetchJson } from "./http.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";

function siteEntry(value) {
  return typeof value === "string" ? { slug: value, name: value } : value;
}

export function leverConnectors(config) {
  return config.leverSites.map(siteEntry).filter((site) => site?.slug && site.enabled !== false).map((site) => {
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
      async search() {
        const jobs = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site.slug)}?mode=json`, { timeoutMs: config.requestTimeoutMs, userAgent: config.httpUserAgent, retries: 1 });
        return (Array.isArray(jobs) ? jobs : []).slice(0, config.maxJobsPerSource).map((item) => {
        const description = stripHtml([item.description, item.descriptionPlain, ...(item.lists || []).map((list) => `${list.text} ${list.content}`), item.additional].filter(Boolean).join(" "));
        return {
          id: `lever:${site.slug}:${item.id}`, externalId: String(item.id), title: item.text, company: site.name || site.slug, companyVerified: true, description,
          url: item.hostedUrl, applyUrl: item.applyUrl || item.hostedUrl, location: item.categories?.location || "", remote: /remote|worldwide/i.test(item.workplaceType || item.categories?.location || ""),
          employmentType: item.categories?.commitment, category: item.categories?.team || item.categories?.department, salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "USD" }),
          postedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null, source, sourceQuality: 0.96,
        };
        });
      },
    };
  });
}
