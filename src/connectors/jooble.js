import { fetchJson } from "./http.js";
import { cachedSearch } from "./cache.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";

function salary(value) {
  const parsed = parseSalaryText(value || "");
  if (!parsed) return null;
  const hasPeriod = /hour|час|year|annual|год|day|день|week|недел|month|месяц|мес/iu.test(value || "");
  return { ...parsed, period: hasPeriod ? parsed.period : null };
}

function searchTerms(query) {
  const role = query.role || "";
  const skills = (query.skills || []).filter((skill) => !role.toLocaleLowerCase("ru-RU").includes(skill.toLocaleLowerCase("ru-RU")));
  return [role, ...skills, query.remote ? "remote" : null].filter(Boolean).join(" ") || query.raw;
}

function searchLocation(query) {
  const locations = (query.locations || []).filter((location) => location !== "remote");
  if (locations.length) return locations.join(", ");
  return query.remote ? "Remote" : "";
}

export function joobleConnector(config) {
  const source = {
    id: "jooble",
    name: "Jooble",
    officialApi: true,
    attributionUrl: "https://jooble.org/",
    setupUrl: "https://jooble.org/api/about",
    authType: "api_key",
    credentialFields: ["JOOBLE_API_KEY"],
    adapter: "aggregator-api",
    regions: ["russia-cis", "europe", "north-america", "latin-america", "oceania", "global-remote"],
    note: "Официальный агрегаторный API; ключ выдаётся после регистрации Jooble REST API.",
  };
  const enabled = Boolean(config.joobleApiKey);
  const execute = async (query) => {
    const data = await fetchJson(`https://jooble.org/api/${encodeURIComponent(config.joobleApiKey)}`, {
      method: "POST",
      body: JSON.stringify({
        keywords: searchTerms(query),
        location: searchLocation(query),
        page: "1",
        ResultOnPage: String(Math.min(config.maxJobsPerSource, 100)),
        companysearch: "false",
      }),
      headers: { "Content-Type": "application/json" },
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    return (data.jobs || []).filter((item) => item?.id != null && item?.title && item?.link).slice(0, config.maxJobsPerSource).map((item) => ({
      id: `jooble:${item.id}`,
      externalId: String(item.id),
      title: item.title,
      company: item.company || "Не указан",
      companyVerified: false,
      description: stripHtml(item.snippet || ""),
      url: item.link,
      applyUrl: item.link,
      location: item.location || "",
      remote: /remote|worldwide|удален|удалён/iu.test(`${item.title || ""} ${item.location || ""} ${item.snippet || ""}`),
      employmentType: item.type || null,
      salary: salary(item.salary),
      salaryText: item.salary || null,
      postedAt: item.updated || null,
      providerSource: item.source || null,
      source,
      sourceQuality: 0.84,
    }));
  };
  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Требуется JOOBLE_API_KEY; регистрация: https://jooble.org/api/about",
    search: enabled ? cachedSearch(execute, { ttlMs: config.aggregatorCacheMs }) : async () => { throw new Error("JOOBLE_API_KEY is required"); },
  };
}
