import { fetchJson } from "./http.js";
import { stripHtml } from "../core/text.js";
import { sourceSearchTerms } from "../core/source-query.js";
import { inferRelocation } from "../core/mobility.js";

export function hhUserAgentDiagnostics(value) {
  const configured = Boolean(value);
  const formatValid = /^[^/()\s]+\/[^()\s]+\s+\((?:contact:\s*)?[^\s@()]+@[^\s@()]+\.[^\s@()]+\)$/i.test(value || "");
  return { configured, formatValid };
}

export function hhConnector(config) {
  const userAgent = hhUserAgentDiagnostics(config.hhUserAgent);
  const hasAccessToken = Boolean(config.hhAccessToken);
  const hasClientId = Boolean(config.hhClientId);
  const hasClientSecret = Boolean(config.hhClientSecret);
  const hasClientCredentials = hasClientId && hasClientSecret;
  const authMode = hasAccessToken ? "access_token" : hasClientCredentials ? "client_credentials" : "missing";
  const diagnostics = {
    userAgentConfigured: userAgent.configured,
    userAgentFormatValid: userAgent.formatValid,
    authConfigured: hasAccessToken || hasClientCredentials,
    authMode,
    clientCredentialsComplete: hasClientCredentials,
  };
  let cachedAccessToken = config.hhAccessToken || null;

  async function getAccessToken() {
    if (cachedAccessToken) return cachedAccessToken;
    if (!hasClientCredentials) {
      const error = new Error("HeadHunter требует HH_ACCESS_TOKEN или пару HH_CLIENT_ID + HH_CLIENT_SECRET");
      error.code = "invalid_config";
      throw error;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.hhClientId,
      client_secret: config.hhClientSecret,
    });
    const data = await fetchJson("https://api.hh.ru/token", {
      timeoutMs: config.requestTimeoutMs,
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      userAgent: config.hhUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    if (!data?.access_token) {
      const error = new Error("HeadHunter не вернул access_token для приложения");
      error.code = "invalid_auth_response";
      throw error;
    }
    cachedAccessToken = data.access_token;
    return cachedAccessToken;
  }

  let disabledReason = null;
  if (!userAgent.configured) disabledReason = "Требуется HH_USER_AGENT с реальным контактным email";
  else if (!userAgent.formatValid) disabledReason = "HH_USER_AGENT должен иметь формат AppName/Version (real-email@example.com)";
  else if (!hasAccessToken && (hasClientId !== hasClientSecret)) disabledReason = "HH_CLIENT_ID и HH_CLIENT_SECRET должны быть указаны вместе";
  else if (!hasAccessToken && !hasClientCredentials) disabledReason = "Требуется HH_ACCESS_TOKEN или HH_CLIENT_ID + HH_CLIENT_SECRET";
  const source = {
    id: "hh",
    name: "HeadHunter",
    officialApi: true,
    attributionUrl: "https://hh.ru/",
    setupUrl: "https://dev.hh.ru/",
    authType: "oauth2_application",
    credentialFields: ["HH_USER_AGENT", "HH_ACCESS_TOKEN", "HH_CLIENT_ID", "HH_CLIENT_SECRET"],
  };
  return {
    ...source,
    enabled: !disabledReason,
    disabledReason,
    getDiagnostics() { return diagnostics; },
    async search(query) {
      if (!config.hhUserAgent) throw new Error("HH_USER_AGENT is required by the HeadHunter API");
      if (!userAgent.formatValid) {
        const error = new Error("HH_USER_AGENT должен иметь формат AppName/Version (real-email@example.com)");
        error.code = "invalid_config";
        throw error;
      }
      const accessToken = await getAccessToken();
      const params = new URLSearchParams({ text: sourceSearchTerms(query), per_page: String(Math.min(config.maxJobsPerSource, 100)), page: "0", order_by: "publication_time", period: "30" });
      if (query.salary?.min && query.salary.currency) { params.set("salary", String(query.salary.min)); params.set("currency", query.salary.currency); }
      const data = await fetchJson(`https://api.hh.ru/vacancies?${params}`, { timeoutMs: config.requestTimeoutMs, headers: { "HH-User-Agent": config.hhUserAgent, Authorization: `Bearer ${accessToken}` }, userAgent: config.hhUserAgent, retries: 1, fetchImpl: config.fetchImpl || fetch });
      return (data.items || []).map((item) => ({
        id: `hh:${item.id}`, externalId: String(item.id), title: item.name, company: item.employer?.name || "Не указан",
        companyVerified: Boolean(item.employer?.trusted), description: stripHtml(`${item.snippet?.requirement || ""} ${item.snippet?.responsibility || ""}`),
        url: item.alternate_url, applyUrl: item.apply_alternate_url || item.alternate_url, location: item.area?.name || "", remote: item.work_format?.some((format) => format.id === "REMOTE") || item.schedule?.id === "remote",
        relocation: inferRelocation(item.name, item.snippet?.requirement, item.snippet?.responsibility),
        employmentType: item.employment?.name || item.employment_form?.name || null, experience: item.experience?.name || null,
        salary: item.salary ? { min: item.salary.from, max: item.salary.to, currency: item.salary.currency === "RUR" ? "RUB" : item.salary.currency, period: "month", gross: item.salary.gross } : null,
        postedAt: item.published_at, updatedAt: item.created_at, archived: item.archived, closed: item.closed_for_applicants,
        source, sourceQuality: 0.95,
      }));
    },
  };
}
