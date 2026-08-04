import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchText } from "./http.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";
import { parseSalaryText } from "../core/salary.js";
import { retrievalMatches } from "../core/source-query.js";
import { stripHtml } from "../core/text.js";

const DEFAULT_API_URL = "https://api.ahtp.fi/kipa/p67/v2/jobpostings";
const PUBLIC_JOBS_URL = "https://tyomarkkinatori.fi/en/personal-customers/vacancies";

function freshState() {
  return { version: 1, initialized: false, cursor: null, jobs: {}, pending: null, updatedAt: null };
}

function localized(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  for (const language of ["en", "fi", "sv"]) {
    if (typeof value[language] === "string" && value[language].trim()) return value[language].trim();
  }
  return Object.values(value).find((item) => typeof item === "string" && item.trim())?.trim() || "";
}

function parseNdjson(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`Job Market Finland response exceeds ${maxBytes} bytes`);
  const records = [];
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch (error) { throw new Error(`Invalid Job Market Finland NDJSON line ${index + 1}: ${error.message}`); }
  }
  return records;
}

function postingId(posting) {
  return String(posting?.metadata?.externalId || "");
}

function postingUrl(posting) {
  const id = postingId(posting);
  const language = posting.languages?.includes("en") ? "en" : posting.languages?.includes("fi") ? "fi" : posting.languages?.includes("sv") ? "sv" : null;
  return `${PUBLIC_JOBS_URL}/${encodeURIComponent(id)}${language ? `/${language}` : ""}`;
}

function mappedJob(posting, source) {
  const externalId = postingId(posting);
  const position = posting.position || {};
  const locationData = posting.location || {};
  const description = stripHtml(localized(position.jobDescription));
  const title = localized(position.title) || position.mainOccupation;
  const company = localized(posting.owner?.company) || posting.client?.company || posting.owner?.officeName || posting.client?.officeName || "Не указано";
  const countries = (locationData.countries || []).map((country) => String(country).toLocaleUpperCase("en-US") === "FI" ? "Finland" : country);
  const locationParts = [localized(locationData.workplaceName), locationData.workplacePostOffice, ...countries].filter(Boolean);
  const location = [...new Set(locationParts)].join(", ") || "Finland";
  const url = postingUrl(posting);
  const applyUrl = localized(posting.application?.url) || posting.externalLinks?.find((item) => item?.url)?.url || url;
  const wageText = [localized(position.wagePrincipalInfo), position.wageRange, position.wagePrincipal, description].filter(Boolean).join(" ");
  return {
    id: `job-market-finland:${externalId}`,
    externalId,
    title,
    company,
    companyVerified: Boolean(posting.owner?.businessId || posting.client?.businessId),
    description,
    url,
    applyUrl,
    location,
    locations: location ? [location] : [],
    remote: inferRemote(title, location, description),
    relocation: inferRelocation(description),
    visaSponsorship: inferRelocation(description),
    employmentType: [position.employmentRelationship, ...(position.continuityOfWork || []), position.workTime].filter(Boolean).join(", ") || null,
    skills: [...new Set([position.mainOccupation, ...(position.occupations || []), ...(position.skills || [])].filter(Boolean))],
    salary: parseSalaryText(wageText, { fallbackPeriod: "month", fallbackCurrency: "EUR" }),
    postedAt: posting.application?.published || posting.metadata?.created || null,
    updatedAt: posting.metadata?.lastModified || null,
    validThrough: posting.application?.expires || null,
    providerSource: "Job Market Finland customer information system",
    source,
    sourceQuality: 0.98,
  };
}

function pendingBatch(state) {
  return {
    jobs: (state.pending?.upsertIds || []).map((id) => state.jobs[id]).filter(Boolean),
    changedExternalIds: [...(state.pending?.changedExternalIds || [])],
    replaceSourceSnapshot: Boolean(state.pending?.replaceSourceSnapshot),
    syncToken: state.pending?.token || null,
  };
}

export function jobMarketFinlandConnector(config) {
  const source = {
    id: "job-market-finland",
    name: "Job Market Finland",
    officialApi: true,
    attributionUrl: PUBLIC_JOBS_URL,
    setupUrl: "https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings",
    authType: "subscription_key",
    credentialFields: ["JOBMARKET_FINLAND_API_KEY"],
    adapter: "government-feed",
    regions: ["europe"],
    note: "Официальный retrieval API Финляндии. Требует активации организации, Business ID, allowlist IP и KIPA subscription key; вакансии должны обновляться и удаляться без задержки.",
  };
  const enabled = Boolean(config.jobMarketFinlandApiKey);
  const apiUrl = config.jobMarketFinlandApiUrl || DEFAULT_API_URL;
  const statePath = config.jobMarketFinlandStatePath || path.join(config.rootDir || process.cwd(), "data", "job-market-finland-state.json");
  const maxResponseBytes = Math.max(1_000_000, Number(config.jobMarketFinlandMaxResponseBytes) || 64_000_000);
  let stateCache = null;
  let queue = Promise.resolve();
  let diagnostics = { initialized: false, published: 0, archived: 0, active: 0, matched: 0, replayed: false };

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
        ...freshState(), ...loaded,
        jobs: loaded.jobs && typeof loaded.jobs === "object" ? loaded.jobs : {},
        pending: loaded.pending || null,
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Invalid Job Market Finland state ${statePath}: ${error.message}`);
      stateCache = freshState();
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

  async function request(filters) {
    const text = await fetchText(apiUrl, {
      timeoutMs: Math.max(config.atsRequestTimeoutMs || config.requestTimeoutMs || 0, 60_000),
      userAgent: config.httpUserAgent,
      retries: 1,
      fetchImpl: config.fetchImpl || fetch,
      method: "POST",
      body: JSON.stringify(filters),
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
        "KIPA-Subscription-Key": config.jobMarketFinlandApiKey,
      },
    });
    return parseNdjson(text, maxResponseBytes);
  }

  async function execute(query) {
    const current = await loadState();
    if (current.pending) {
      const replay = pendingBatch(current);
      diagnostics = { initialized: current.initialized, published: 0, archived: 0, active: Object.keys(current.jobs).length, matched: replay.jobs.length, replayed: true };
      return replay;
    }

    const nextState = structuredClone(current);
    const changedExternalIds = new Set();
    const windowEnd = new Date().toISOString();
    const initialSnapshot = !current.initialized;
    const published = await request(initialSnapshot ? { onlyStatus: "PUBLISHED" } : {
      onlyStatus: "PUBLISHED",
      modified: { from: current.cursor, to: windowEnd },
    });
    const archived = initialSnapshot ? [] : await request({
      onlyStatus: "ARCHIVED",
      archived: { from: current.cursor, to: windowEnd },
    });

    if (initialSnapshot) nextState.jobs = {};
    for (const posting of published) {
      const externalId = postingId(posting);
      if (!externalId) continue;
      changedExternalIds.add(externalId);
      if (posting.metadata?.archived) {
        delete nextState.jobs[externalId];
        continue;
      }
      const job = mappedJob(posting, source);
      if (job.title && job.url) nextState.jobs[externalId] = job;
    }
    for (const posting of archived) {
      const externalId = postingId(posting);
      if (!externalId) continue;
      changedExternalIds.add(externalId);
      delete nextState.jobs[externalId];
    }

    nextState.initialized = true;
    nextState.cursor = windowEnd;
    const jobs = Object.values(nextState.jobs)
      .filter((job) => retrievalMatches(job, query))
      .sort((left, right) => String(right.updatedAt || right.postedAt || "").localeCompare(String(left.updatedAt || left.postedAt || "")))
      .slice(0, config.maxJobsPerSource || 100);
    const batch = {
      jobs,
      changedExternalIds: [...changedExternalIds],
      replaceSourceSnapshot: initialSnapshot,
      syncToken: null,
    };
    if (batch.jobs.length || batch.changedExternalIds.length || initialSnapshot) {
      batch.syncToken = crypto.randomUUID();
      nextState.pending = {
        token: batch.syncToken,
        changedExternalIds: batch.changedExternalIds,
        upsertIds: batch.jobs.map((job) => job.externalId),
        replaceSourceSnapshot: initialSnapshot,
        createdAt: new Date().toISOString(),
      };
    }
    nextState.updatedAt = new Date().toISOString();
    await saveState(nextState);
    diagnostics = {
      initialized: true, published: published.length, archived: archived.length,
      active: Object.keys(nextState.jobs).length, matched: jobs.length, replayed: false,
    };
    return batch;
  }

  async function acknowledge(syncToken) {
    if (!syncToken) return true;
    const current = await loadState();
    if (!current.pending) return true;
    if (current.pending.token !== syncToken) throw new Error("Job Market Finland synchronization token mismatch");
    const nextState = structuredClone(current);
    nextState.pending = null;
    nextState.updatedAt = new Date().toISOString();
    await saveState(nextState);
    return true;
  }

  return {
    ...source,
    enabled,
    disabledReason: enabled ? null : "Требуется JOBMARKET_FINLAND_API_KEY после активации организации и настройки allowlist IP в KEHA Centre.",
    getDiagnostics() { return structuredClone(diagnostics); },
    search: enabled ? (query) => enqueue(() => execute(query)) : async () => { throw new Error("Job Market Finland API key is required"); },
    acknowledge: (syncToken) => enqueue(() => acknowledge(syncToken)),
  };
}
