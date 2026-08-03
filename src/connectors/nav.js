import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchResponse, fetchText } from "./http.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";
import { parseSalaryText } from "../core/salary.js";
import { retrievalMatches } from "../core/source-query.js";
import { stripHtml } from "../core/text.js";

const DEFAULT_BASE_URL = "https://pam-stilling-feed.nav.no";
const PUBLIC_TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

function freshState(config) {
  const lookbackDays = Math.max(1, Math.min(Number(config.navLookbackDays) || 180, 180));
  return {
    version: 1,
    cursor: {
      url: "/api/v1/feed",
      lastModified: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1_000).toUTCString(),
      etag: null,
    },
    headers: {},
    details: {},
    pending: null,
    updatedAt: null,
  };
}

function safeUrl(value, baseUrl) {
  const base = new URL(baseUrl);
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin) throw new Error(`NAV feed returned an unexpected origin: ${resolved.origin}`);
  return resolved;
}

function relativeUrl(value, baseUrl) {
  const resolved = safeUrl(value, baseUrl);
  return `${resolved.pathname}${resolved.search}`;
}

function compactHeader(item) {
  const entry = item?._feed_entry || {};
  const externalId = String(entry.uuid || item?.id || "");
  return {
    externalId,
    url: item?.url || `/api/v1/feedentry/${encodeURIComponent(externalId)}`,
    title: entry.title || item?.title || "",
    description: item?.content_text || "",
    company: entry.businessName || "",
    location: entry.municipal || "Norway",
    modified: entry.sistEndret || item?.date_modified || null,
  };
}

function locationOf(content) {
  const places = (content.workLocations || []).map((place) => {
    const country = String(place.country || "").toLocaleUpperCase("en-US") === "NORGE" ? "Norway" : place.country;
    return [...new Set([place.city, place.municipal, place.county, country].filter(Boolean))].join(", ");
  }).filter(Boolean);
  return { location: places.join("; ") || "Norway", locations: places };
}

function navJob(content, source) {
  const externalId = String(content.uuid || "");
  const description = stripHtml(content.description || "");
  const { location, locations } = locationOf(content);
  const url = content.link || content.sourceurl || `https://arbeidsplassen.nav.no/stillinger/stilling/${encodeURIComponent(externalId)}`;
  const applyUrl = content.applicationUrl || content.sourceurl || url;
  const skills = [...new Set([
    ...(content.occupationCategories || []).flatMap((item) => [item.level1, item.level2]),
    ...(content.categoryList || []).map((item) => item.name),
  ].filter(Boolean))];
  return {
    id: `nav-norway:${externalId}`,
    externalId,
    title: content.title || content.jobtitle,
    company: content.employer?.name || "Не указано",
    companyVerified: Boolean(content.employer?.orgnr),
    description,
    url,
    applyUrl,
    location,
    locations,
    remote: inferRemote(content.title, location, description),
    relocation: inferRelocation(description),
    visaSponsorship: inferRelocation(description),
    employmentType: [content.engagementtype, content.extent].filter(Boolean).join(", ") || null,
    skills,
    salary: parseSalaryText(description, { fallbackPeriod: "year", fallbackCurrency: "NOK" }),
    postedAt: content.published || null,
    updatedAt: content.updated || null,
    validThrough: content.expires || content.applicationDue || null,
    providerSource: content.source || "NAV",
    source,
    sourceQuality: 0.97,
  };
}

function pendingBatch(state) {
  const pending = state.pending;
  return {
    jobs: (pending?.upsertIds || []).map((id) => state.details[id]?.job).filter(Boolean),
    changedExternalIds: [...(pending?.changedExternalIds || [])],
    syncToken: pending?.token || null,
  };
}

export function navConnector(config) {
  const source = {
    id: "nav-norway",
    name: "Arbeidsplassen NAV",
    officialApi: true,
    attributionUrl: "https://arbeidsplassen.nav.no/stillinger",
    setupUrl: "https://navikt.github.io/pam-stilling-feed/",
    authType: "bearer_token",
    credentialFields: ["NAV_API_TOKEN"],
    adapter: "government-feed",
    regions: ["europe"],
    note: "Официальный непрерывный feed вакансий Норвегии. Production-токен выдаёт NAV после принятия условий; публичный вращающийся токен допустим только для экспериментов.",
  };
  const enabled = Boolean(config.navApiToken || config.navUsePublicToken);
  const baseUrl = config.navFeedBaseUrl || DEFAULT_BASE_URL;
  const statePath = config.navStatePath || path.join(config.rootDir || process.cwd(), "data", "nav-feed-state.json");
  let stateCache = null;
  let diagnostics = { pages: 0, items: 0, activeHeaders: 0, detailCandidates: 0, detailsLoaded: 0, matched: 0, caughtUp: false, replayed: false, warnings: [] };
  let queue = Promise.resolve();

  function enqueue(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }

  async function loadState() {
    if (stateCache) return stateCache;
    try {
      const loaded = JSON.parse(await fs.readFile(statePath, "utf8"));
      stateCache = {
        ...freshState(config),
        ...loaded,
        cursor: { ...freshState(config).cursor, ...(loaded.cursor || {}) },
        headers: loaded.headers && typeof loaded.headers === "object" ? loaded.headers : {},
        details: loaded.details && typeof loaded.details === "object" ? loaded.details : {},
        pending: loaded.pending || null,
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Invalid NAV feed state ${statePath}: ${error.message}`);
      stateCache = freshState(config);
    }
    return stateCache;
  }

  async function saveState(state) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(state), "utf8");
    await fs.rename(temporaryPath, statePath);
    stateCache = state;
  }

  async function token() {
    if (config.navApiToken) return config.navApiToken;
    const text = await fetchText(safeUrl("/api/publicToken", baseUrl), {
      timeoutMs: config.requestTimeoutMs,
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
    });
    const found = text.match(PUBLIC_TOKEN_PATTERN)?.[0];
    if (!found) throw new Error("NAV public experiment token was not found");
    return found;
  }

  async function execute(query) {
    const current = await loadState();
    if (current.pending) {
      const replay = pendingBatch(current);
      diagnostics = {
        pages: 0, items: 0, activeHeaders: Object.keys(current.headers).length, detailCandidates: replay.jobs.length,
        detailsLoaded: 0, matched: replay.jobs.length, caughtUp: false, replayed: true, warnings: [],
      };
      return replay;
    }

    const nextState = structuredClone(current);
    const changedExternalIds = new Set();
    const warnings = [];
    const bearer = await token();
    const requestOptions = {
      timeoutMs: Math.max(config.atsRequestTimeoutMs || config.requestTimeoutMs || 0, 30_000),
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
      acceptedStatuses: [304],
    };
    const maxPages = Math.max(1, Math.min(Number(config.navMaxFeedPagesPerSync) || 5, 100));
    let pages = 0;
    let items = 0;
    let caughtUp = false;

    for (; pages < maxPages; pages += 1) {
      const requestedUrl = safeUrl(nextState.cursor.url || "/api/v1/feed", baseUrl);
      const headers = { Authorization: `Bearer ${bearer}`, Accept: "application/json" };
      if (nextState.cursor.lastModified) headers["If-Modified-Since"] = nextState.cursor.lastModified;
      if (nextState.cursor.etag) headers["If-None-Match"] = nextState.cursor.etag;
      const response = await fetchResponse(requestedUrl, { ...requestOptions, headers });
      if (response.status === 304) { caughtUp = true; break; }
      const pageData = await response.json();
      const pageItems = Array.isArray(pageData.items) ? pageData.items : [];
      items += pageItems.length;
      for (const item of pageItems) {
        const header = compactHeader(item);
        if (!header.externalId) continue;
        changedExternalIds.add(header.externalId);
        if (String(item?._feed_entry?.status || "").toLocaleUpperCase("en-US") !== "ACTIVE") {
          delete nextState.headers[header.externalId];
          delete nextState.details[header.externalId];
          continue;
        }
        if (nextState.headers[header.externalId]?.modified !== header.modified) delete nextState.details[header.externalId];
        nextState.headers[header.externalId] = header;
      }

      const lastModified = response.headers.get("last-modified") || nextState.cursor.lastModified;
      if (pageData.next_url) {
        nextState.cursor = { url: relativeUrl(pageData.next_url, baseUrl), lastModified, etag: null };
      } else {
        nextState.cursor = {
          url: relativeUrl(pageData.feed_url || `${requestedUrl.pathname}${requestedUrl.search}`, baseUrl),
          lastModified,
          etag: response.headers.get("etag") || null,
        };
        caughtUp = true;
        pages += 1;
        break;
      }
    }

    const headerCandidates = Object.values(nextState.headers).filter((header) => {
      const cachedJob = nextState.details[header.externalId]?.job;
      return retrievalMatches(header, query) || cachedJob && retrievalMatches(cachedJob, query);
    }).sort((left, right) => String(right.modified || "").localeCompare(String(left.modified || "")))
      .slice(0, config.maxJobsPerSource || 100);
    const toLoad = headerCandidates.filter((header) => nextState.details[header.externalId]?.modified !== header.modified);
    let nextDetail = 0;
    const workers = Math.min(toLoad.length, Math.max(1, config.atsDetailConcurrency || 4));
    await Promise.all(Array.from({ length: workers }, async () => {
      while (nextDetail < toLoad.length) {
        const header = toLoad[nextDetail];
        nextDetail += 1;
        try {
          const response = await fetchResponse(safeUrl(header.url, baseUrl), {
            ...requestOptions,
            acceptedStatuses: [],
            headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
          });
          const detail = await response.json();
          const content = detail.ad_content || detail.json;
          if (String(detail.status || "").toLocaleUpperCase("en-US") !== "ACTIVE" || !content) {
            changedExternalIds.add(header.externalId);
            delete nextState.headers[header.externalId];
            delete nextState.details[header.externalId];
            continue;
          }
          const job = navJob(content, source);
          if (job.externalId && job.title && job.url) nextState.details[header.externalId] = { modified: header.modified, job };
        } catch (error) {
          warnings.push({ postingId: header.externalId, title: header.title, error: error.message, code: typeof error.code === "string" ? error.code : error.name || "source_error" });
        }
      }
    }));

    const jobs = headerCandidates.map((header) => nextState.details[header.externalId]?.job)
      .filter((job) => job && nextState.headers[job.externalId] && retrievalMatches(job, query))
      .slice(0, config.maxJobsPerSource || 100);
    const batch = {
      jobs,
      changedExternalIds: [...changedExternalIds],
      syncToken: null,
    };
    if (batch.jobs.length || batch.changedExternalIds.length) {
      batch.syncToken = crypto.randomUUID();
      nextState.pending = {
        token: batch.syncToken,
        changedExternalIds: batch.changedExternalIds,
        upsertIds: batch.jobs.map((job) => job.externalId),
        createdAt: new Date().toISOString(),
      };
    }
    nextState.updatedAt = new Date().toISOString();
    await saveState(nextState);
    diagnostics = {
      pages, items, activeHeaders: Object.keys(nextState.headers).length, detailCandidates: headerCandidates.length,
      detailsLoaded: toLoad.length - warnings.length, matched: jobs.length, caughtUp, replayed: false, warnings,
    };
    return batch;
  }

  async function acknowledge(syncToken) {
    if (!syncToken) return true;
    const current = await loadState();
    if (!current.pending) return true;
    if (current.pending.token !== syncToken) throw new Error("NAV feed synchronization token mismatch");
    const nextState = structuredClone(current);
    nextState.pending = null;
    nextState.updatedAt = new Date().toISOString();
    await saveState(nextState);
    return true;
  }

  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Требуется NAV_API_TOKEN; production-доступ: nav.team.arbeidsplassen@nav.no. Для локального эксперимента можно явно задать NAV_USE_PUBLIC_TOKEN=true.",
    getDiagnostics() { return structuredClone(diagnostics); },
    search: enabled ? (query) => enqueue(() => execute(query)) : async () => { throw new Error("NAV API token is required"); },
    acknowledge: (syncToken) => enqueue(() => acknowledge(syncToken)),
  };
}
