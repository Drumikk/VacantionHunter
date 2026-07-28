import dns from "node:dns/promises";
import net from "node:net";
import { normalizeText } from "./text.js";

const PAYMENT_PATTERNS = [/оплат.*трудоустрой/iu, /взнос/iu, /training fee/iu, /pay.*before.*interview/iu, /переведите.*карт/iu];
const CHAT_ONLY = /(только|only)\s*(telegram|whatsapp|телеграм|ватсап)/iu;

function isPrivateIp(address) {
  if (!net.isIP(address)) return true;
  return /^(10\.|127\.|169\.254\.|192\.168\.|0\.|::1$|fc|fd|fe80)/i.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

async function safePublicUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS vacancy URLs are verified");
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error("Private or unresolved host rejected");
  return parsed;
}

function parseJsonLd(html) {
  const values = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const list = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      values.push(...list.filter((item) => item?.["@type"] === "JobPosting" || (Array.isArray(item?.["@type"]) && item["@type"].includes("JobPosting"))));
    } catch { /* malformed third-party JSON-LD is only a missing signal */ }
  }
  return values;
}

export function assessJob(job, { http = null, checkedAt = new Date().toISOString() } = {}) {
  let score = 35;
  const signals = [];
  const risks = [];
  const text = `${job.title || ""} ${job.description || ""}`;
  if (job.source?.officialApi) { score += 25; signals.push("official_api"); }
  if (job.companyVerified) { score += 15; signals.push("verified_company"); }
  if (job.url && /^https:\/\//i.test(job.url)) { score += 5; signals.push("https_url"); }
  if (job.applyUrl || job.url) { score += 5; signals.push("apply_path_present"); }
  if (job.postedAt) { score += 5; signals.push("posted_date_present"); }
  if (job.validThrough && Date.parse(job.validThrough) < Date.now()) { score -= 50; risks.push("expired_valid_through"); }
  if (job.archived || job.closed) { score -= 50; risks.push("source_marks_closed"); }
  if (!job.company || /confidential|скрыт|неизвест/i.test(job.company)) { score -= 10; risks.push("anonymous_employer"); }
  if (PAYMENT_PATTERNS.some((pattern) => pattern.test(text))) { score -= 40; risks.push("candidate_payment_request"); }
  if (CHAT_ONLY.test(text)) { score -= 20; risks.push("chat_only_contact"); }
  if (normalizeText(text).length < 80) { score -= 8; risks.push("very_short_description"); }
  if (http?.ok) { score += 10; signals.push("live_http_2xx"); }
  if (http?.jobPosting) { score += 5; signals.push("jobposting_schema"); }
  if (http && !http.ok) { score -= 25; risks.push(`http_${http.status || "error"}`); }
  score = Math.max(0, Math.min(100, score));
  const status = risks.includes("expired_valid_through") || risks.includes("source_marks_closed") ? "stale" : score >= 80 ? "verified" : score >= 55 ? "probable" : score >= 35 ? "unverified" : "suspicious";
  return { score, status, signals, risks, checkedAt, httpStatus: http?.status || null };
}

export async function liveVerify(job, { timeoutMs = 5_000, fetchImpl = fetch } = {}) {
  if (!job.url) return assessJob(job, { http: { ok: false, status: "missing_url" } });
  try {
    await safePublicUrl(job.url);
    const response = await fetchImpl(job.url, { redirect: "follow", headers: { "User-Agent": "VacationHunterVerifier/0.1" }, signal: AbortSignal.timeout(timeoutMs) });
    const contentType = response.headers.get("content-type") || "";
    const html = contentType.includes("text/html") ? (await response.text()).slice(0, 750_000) : "";
    const postings = parseJsonLd(html);
    const posting = postings[0];
    const expired = posting?.validThrough && Date.parse(posting.validThrough) < Date.now();
    const http = { ok: response.ok && !expired, status: response.status, jobPosting: Boolean(posting), validThrough: posting?.validThrough || null };
    return assessJob({ ...job, validThrough: posting?.validThrough || job.validThrough }, { http });
  } catch (error) {
    return assessJob(job, { http: { ok: false, status: error.name === "TimeoutError" ? "timeout" : "error" } });
  }
}
