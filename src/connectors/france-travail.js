import { fetchJson } from "./http.js";
import { cachedSearch } from "./cache.js";
import { parseSalaryText } from "../core/salary.js";
import { stripHtml } from "../core/text.js";
import { retrievalMatches, sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";

export function franceTravailConnector(config) {
  const source = {
    id: "france-travail",
    name: "France Travail",
    officialApi: true,
    attributionUrl: "https://candidat.francetravail.fr/offres/recherche",
    setupUrl: "https://www.data.gouv.fr/dataservices/api-offres-demploi",
    authType: "oauth_client_credentials",
    credentialFields: ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"],
    adapter: "government-api",
    regions: ["europe"],
    note: "Официальный API активных вакансий Франции и партнёров; требуется приложение France Travail и OAuth client credentials.",
  };
  const enabled = Boolean(config.franceTravailClientId && config.franceTravailClientSecret);
  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function accessToken() {
    if (cachedToken && tokenExpiresAt > Date.now() + 60_000) return cachedToken;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.franceTravailClientId,
      client_secret: config.franceTravailClientSecret,
      scope: config.franceTravailScope || "api_offresdemploiv2 o2dsoffre",
    });
    const data = await fetchJson(config.franceTravailTokenUrl || "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 1_500) * 1_000;
    if (!cachedToken) throw new Error("France Travail OAuth response has no access_token");
    return cachedToken;
  }

  async function execute(query) {
    const take = Math.max(1, Math.min(config.maxJobsPerSource || 100, 150));
    const params = new URLSearchParams({ motsCles: sourceSearchTerms(query), range: `0-${take - 1}`, sort: "1" });
    const data = await fetchJson(`${config.franceTravailSearchUrl || "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search"}?${params}`, {
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.httpUserAgent,
      headers: { Authorization: `Bearer ${await accessToken()}` },
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    return (data.resultats || []).map((item) => {
      const description = stripHtml([item.description, item.competences?.map((skill) => skill.libelle).join(" "), item.salaire?.commentaire].filter(Boolean).join(" "));
      const location = item.lieuTravail?.libelle || "France";
      const url = item.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(item.id)}`;
      const salaryText = [item.salaire?.libelle, item.salaire?.commentaire, item.salaire?.complement1].filter(Boolean).join(" ");
      return {
        id: `france-travail:${item.id}`,
        externalId: String(item.id || ""),
        title: item.intitule,
        company: item.entreprise?.nom || "Non communiqué",
        companyVerified: true,
        description,
        url,
        applyUrl: url,
        location,
        remote: inferRemote(item.intitule, location, description),
        relocation: inferRelocation(description),
        visaSponsorship: inferRelocation(description),
        employmentType: item.typeContratLibelle || item.natureContrat || null,
        experience: item.experienceLibelle || null,
        skills: (item.competences || []).map((skill) => skill.libelle).filter(Boolean),
        salary: parseSalaryText(salaryText, { fallbackPeriod: "year", fallbackCurrency: "EUR" }),
        postedAt: item.dateCreation || item.dateActualisation || null,
        updatedAt: item.dateActualisation || null,
        source,
        sourceQuality: 0.98,
      };
    }).filter((job) => job.externalId && job.title && job.url && retrievalMatches(job, query)).slice(0, take);
  }

  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Создайте приложение France Travail и задайте FRANCE_TRAVAIL_CLIENT_ID и FRANCE_TRAVAIL_CLIENT_SECRET",
    search: enabled ? cachedSearch(execute, { ttlMs: config.aggregatorCacheMs }) : async () => { throw new Error("France Travail credentials are required"); },
  };
}
