import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

export function superJobConnector(config) {
  const source = {
    id: "superjob",
    name: "SuperJob",
    officialApi: true,
    attributionUrl: "https://www.superjob.ru/vacancy/search/",
    setupUrl: "https://api.superjob.ru/",
    authType: "app_secret",
    credentialFields: ["SUPERJOB_SECRET_KEY"],
    adapter: "regional-api",
    regions: ["russia-cis"],
    note: "Официальный API; публичный поиск вакансий не требует OAuth пользователя, но требует Secret key приложения в X-Api-App-Id.",
  };
  const enabled = Boolean(config.superjobSecretKey);
  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Зарегистрируйте приложение SuperJob и задайте SUPERJOB_SECRET_KEY",
    async search(query) {
      if (!enabled) throw new Error("SUPERJOB_SECRET_KEY is required");
      const params = new URLSearchParams({
        keyword: sourceSearchTerms(query),
        count: String(Math.min(config.maxJobsPerSource || 100, 100)),
        page: "0",
      });
      const data = await fetchJson(`https://api.superjob.ru/2.0/vacancies/?${params}`, {
        timeoutMs: config.requestTimeoutMs,
        userAgent: config.httpUserAgent,
        headers: { "X-Api-App-Id": config.superjobSecretKey },
        retries: 1,
        fetchImpl: config.fetchImpl || fetch,
      });
      return (data.objects || []).map((item) => {
        const description = stripHtml([item.vacancyRichText, item.candidat, item.work, item.compensation].filter(Boolean).join(" "));
        const location = item.town?.title || item.address || "Россия";
        const workFormat = item.place_of_work?.title || item.type_of_work?.title || "";
        const url = item.link;
        return {
          id: `superjob:${item.id}`,
          externalId: String(item.id || ""),
          title: item.profession,
          company: item.firm_name || item.client?.title || "Не указан",
          companyVerified: false,
          description,
          url,
          applyUrl: url,
          location,
          remote: inferRemote(workFormat, location, description),
          relocation: Boolean(item.moveable) || inferRelocation(description),
          employmentType: workFormat || null,
          experience: item.experience?.title || null,
          salary: item.payment_from != null || item.payment_to != null ? {
            min: Number(item.payment_from) || null,
            max: Number(item.payment_to) || null,
            currency: String(item.currency || "RUB").toUpperCase(),
            period: "month",
          } : null,
          postedAt: item.date_published ? new Date(Number(item.date_published) * 1000).toISOString() : null,
          validThrough: item.date_pub_to ? new Date(Number(item.date_pub_to) * 1000).toISOString() : null,
          source,
          sourceQuality: 0.92,
        };
      }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, config.maxJobsPerSource || 100);
    },
  };
}
