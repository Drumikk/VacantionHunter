import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env.js";

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

const registry = readRegistry();

export const config = {
  rootDir,
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || "127.0.0.1",
  refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS || 15 * 60 * 1000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 8_000),
  maxJobsPerSource: Number(process.env.MAX_JOBS_PER_SOURCE || 100),
  enableLiveSources: process.env.ENABLE_LIVE_SOURCES !== "false",
  httpUserAgent: process.env.HTTP_USER_AGENT || "VacationHunter/0.1",
  hhUserAgent: process.env.HH_USER_AGENT || "",
  joobleApiKey: process.env.JOOBLE_API_KEY || "",
  usajobsApiKey: process.env.USAJOBS_API_KEY || "",
  usajobsEmail: process.env.USAJOBS_EMAIL || "",
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
  sourceScope: registry.data.scope || {},
  greenhouseBoards: registryEntries(registry.data, "greenhouseBoards", "GREENHOUSE_BOARDS"),
  ashbyBoards: registryEntries(registry.data, "ashbyBoards", "ASHBY_BOARDS"),
  leverSites: registryEntries(registry.data, "leverSites", "LEVER_SITES"),
  storePath: path.join(rootDir, "data", "job-store.json"),
  watchStorePath: path.join(rootDir, "data", "watch-store.json"),
  notificationOutboxPath: path.join(rootDir, "data", "notification-outbox.json"),
  demoPath: path.join(rootDir, "data", "demo-jobs.json"),
};
