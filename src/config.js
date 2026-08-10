import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env.js";
import { expandRussianCompanyCatalog } from "./source-catalog.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(rootDir, ".env"));

function csv(name) {
  return (process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function readRegistry() {
  const filePath = process.env.SOURCE_REGISTRY_PATH || path.join(rootDir, "config", "sources.json");
  try { return { filePath, data: JSON.parse(fs.readFileSync(filePath, "utf8")) }; }
  catch (error) {
    if (error.code === "ENOENT") return { filePath, data: {} };
    throw new Error(`Invalid source registry ${filePath}: ${error.message}`);
  }
}

function registryEntries(registry, key, envName) {
  return [...(Array.isArray(registry[key]) ? registry[key] : []), ...csv(envName)];
}

function readRussianCompanyCatalog() {
  const filePath = process.env.RUSSIAN_COMPANY_CATALOG_PATH || path.join(rootDir, "config", "russian-company-sources.json");
  if (process.env.ENABLE_RUSSIAN_COMPANY_SOURCES === "false") return { filePath, data: { rows: [] } };
  try { return { filePath, data: JSON.parse(fs.readFileSync(filePath, "utf8")) }; }
  catch (error) {
    if (error.code === "ENOENT") return { filePath, data: { rows: [] } };
    throw new Error(`Invalid Russian company source catalog ${filePath}: ${error.message}`);
  }
}

const registry = readRegistry();
const russianCompanyCatalog = readRussianCompanyCatalog();
const russianCompanySources = expandRussianCompanyCatalog({ registry: registry.data, catalog: russianCompanyCatalog.data });
const adzunaCountries = csv("ADZUNA_COUNTRIES");

export const config = {
  rootDir,
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || "127.0.0.1",
  refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS || 15 * 60 * 1000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 8_000),
  atsRequestTimeoutMs: Number(process.env.ATS_REQUEST_TIMEOUT_MS || 30_000),
  atsIndexPageSize: Number(process.env.ATS_INDEX_PAGE_SIZE || 20),
  atsDetailConcurrency: Number(process.env.ATS_DETAIL_CONCURRENCY || 4),
  sourceConcurrency: Number(process.env.SOURCE_CONCURRENCY || 16),
  maxJobsPerSource: Number(process.env.MAX_JOBS_PER_SOURCE || 100),
  maxJobsScannedPerSource: Number(process.env.MAX_JOBS_SCANNED_PER_SOURCE || 500),
  maxGenericDetailPages: Number(process.env.MAX_GENERIC_DETAIL_PAGES || 4),
  careerPageTimeoutMs: Number(process.env.CAREER_PAGE_TIMEOUT_MS || 8_000),
  careerPageCacheMs: Number(process.env.CAREER_PAGE_CACHE_MS || 15 * 60 * 1000),
  careerPageMaxBytes: Number(process.env.CAREER_PAGE_MAX_BYTES || 2_000_000),
  enableLiveSources: process.env.ENABLE_LIVE_SOURCES !== "false",
  enableDemoSource: process.env.ENABLE_DEMO_SOURCE === "true" || process.env.ENABLE_LIVE_SOURCES === "false",
  httpUserAgent: process.env.HTTP_USER_AGENT || "VacationHunter/0.1",
  hhUserAgent: process.env.HH_USER_AGENT || "",
  hhAccessToken: process.env.HH_ACCESS_TOKEN || "",
  hhClientId: process.env.HH_CLIENT_ID || "",
  hhClientSecret: process.env.HH_CLIENT_SECRET || "",
  hhEmailImapHost: process.env.HH_EMAIL_IMAP_HOST || "imap.gmail.com",
  hhEmailImapPort: Number(process.env.HH_EMAIL_IMAP_PORT || 993),
  hhEmailImapSecure: process.env.HH_EMAIL_IMAP_SECURE !== "false",
  hhEmailImapUser: process.env.HH_EMAIL_IMAP_USER || "",
  hhEmailImapPassword: process.env.HH_EMAIL_IMAP_PASSWORD || "",
  hhEmailImapFolder: process.env.HH_EMAIL_IMAP_FOLDER || "INBOX",
  hhEmailSenderDomains: csv("HH_EMAIL_SENDER_DOMAINS"),
  hhEmailLookbackDays: Number(process.env.HH_EMAIL_LOOKBACK_DAYS || 30),
  hhEmailMaxMessages: Number(process.env.HH_EMAIL_MAX_MESSAGES || 100),
  hhEmailMaxBytes: Number(process.env.HH_EMAIL_MAX_BYTES || 2_000_000),
  joobleApiKey: process.env.JOOBLE_API_KEY || "",
  usajobsApiKey: process.env.USAJOBS_API_KEY || "",
  usajobsEmail: process.env.USAJOBS_EMAIL || "",
  careerOneStopUserId: process.env.CAREERONESTOP_USER_ID || "",
  careerOneStopApiToken: process.env.CAREERONESTOP_API_TOKEN || "",
  navApiToken: process.env.NAV_API_TOKEN || "",
  navUsePublicToken: process.env.NAV_USE_PUBLIC_TOKEN === "true",
  navLookbackDays: Number(process.env.NAV_LOOKBACK_DAYS || 180),
  navMaxFeedPagesPerSync: Number(process.env.NAV_MAX_FEED_PAGES_PER_SYNC || 5),
  jobMarketFinlandApiKey: process.env.JOBMARKET_FINLAND_API_KEY || "",
  jobMarketFinlandMaxResponseBytes: Number(process.env.JOBMARKET_FINLAND_MAX_RESPONSE_BYTES || 64_000_000),
  reliefwebAppName: process.env.RELIEFWEB_APPNAME || "",
  adzunaAppId: process.env.ADZUNA_APP_ID || "",
  adzunaApiKey: process.env.ADZUNA_API_KEY || "",
  adzunaCountries: adzunaCountries.length ? adzunaCountries : ["gb", "us", "at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "it", "mx", "nl", "nz", "pl"],
  reedApiKey: process.env.REED_API_KEY || "",
  superjobSecretKey: process.env.SUPERJOB_SECRET_KEY || "",
  franceTravailClientId: process.env.FRANCE_TRAVAIL_CLIENT_ID || "",
  franceTravailClientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET || "",
  franceTravailScope: process.env.FRANCE_TRAVAIL_SCOPE || "api_offresdemploiv2 o2dsoffre",
  franceTravailTokenUrl: process.env.FRANCE_TRAVAIL_TOKEN_URL || "",
  franceTravailSearchUrl: process.env.FRANCE_TRAVAIL_SEARCH_URL || "",
  theMuseApiKey: process.env.THE_MUSE_API_KEY || "",
  theMusePages: Number(process.env.THE_MUSE_PAGES || 2),
  smartRecruitersApiKey: process.env.SMARTRECRUITERS_API_KEY || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  telegramSilent: process.env.TELEGRAM_SILENT === "true",
  notificationBatchSize: Number(process.env.NOTIFICATION_BATCH_SIZE || 10),
  notificationMaxAttempts: Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 8),
  notificationMaxJobs: Number(process.env.NOTIFICATION_MAX_JOBS || 5),
  notificationRetryBaseMs: Number(process.env.NOTIFICATION_RETRY_BASE_MS || 60_000),
  aggregatorCacheMs: Number(process.env.AGGREGATOR_CACHE_MS || 15 * 60 * 1000),
  sourceAuthCooldownMs: Number(process.env.SOURCE_AUTH_COOLDOWN_MS || 6 * 60 * 60 * 1000),
  sourceRateLimitCooldownMs: Number(process.env.SOURCE_RATE_LIMIT_COOLDOWN_MS || 15 * 60 * 1000),
  sourceErrorCooldownMs: Number(process.env.SOURCE_ERROR_COOLDOWN_MS || 60 * 1000),
  sourceRegistryPath: registry.filePath,
  russianCompanyCatalogPath: russianCompanyCatalog.filePath,
  russianCompanySourceAudit: russianCompanySources.audit,
  sourceScope: registry.data.scope || {},
  greenhouseBoards: [...registryEntries(registry.data, "greenhouseBoards", "GREENHOUSE_BOARDS"), ...russianCompanySources.greenhouseBoards],
  ashbyBoards: [...registryEntries(registry.data, "ashbyBoards", "ASHBY_BOARDS"), ...russianCompanySources.ashbyBoards],
  leverSites: [...registryEntries(registry.data, "leverSites", "LEVER_SITES"), ...russianCompanySources.leverSites],
  recruiteeBoards: registryEntries(registry.data, "recruiteeBoards", "RECRUITEE_BOARDS"),
  workableBoards: [...registryEntries(registry.data, "workableBoards", "WORKABLE_BOARDS"), ...russianCompanySources.workableBoards],
  personioBoards: [...registryEntries(registry.data, "personioBoards", "PERSONIO_BOARDS"), ...russianCompanySources.personioBoards],
  smartRecruitersCompanies: registryEntries(registry.data, "smartRecruitersCompanies", "SMARTRECRUITERS_COMPANIES"),
  careerPages: russianCompanySources.careerPages,
  storePath: path.join(rootDir, "data", "job-store.json"),
  watchStorePath: path.join(rootDir, "data", "watch-store.json"),
  notificationOutboxPath: path.join(rootDir, "data", "notification-outbox.json"),
  applicationStorePath: path.join(rootDir, "data", "application-store.json"),
  hhEmailStatePath: path.join(rootDir, "data", "hh-email-state.json"),
  navStatePath: path.join(rootDir, "data", "nav-feed-state.json"),
  jobMarketFinlandStatePath: path.join(rootDir, "data", "job-market-finland-state.json"),
  demoPath: path.join(rootDir, "data", "demo-jobs.json"),
};
