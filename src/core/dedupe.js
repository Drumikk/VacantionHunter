import crypto from "node:crypto";
import { normalizeText, tokenSet } from "./text.js";

export function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gh_src|lever-source|source|ref|tracking)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch { return String(url || "").trim(); }
}

function fingerprint(job) {
  const location = normalizeText(job.location || (job.remote ? "remote" : ""));
  const raw = `${normalizeText(job.company)}|${normalizeText(job.title)}|${location}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function jaccard(a, b) {
  const left = tokenSet(a, { expand: false });
  const right = tokenSet(b, { expand: false });
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function mergeJobs(primary, duplicate) {
  const richer = String(duplicate.description || "").length > String(primary.description || "").length ? duplicate : primary;
  const other = richer === primary ? duplicate : primary;
  const provenanceKeys = [...new Set([
    ...(primary.provenanceKeys || [`${primary.source?.id || "unknown"}:${primary.externalId || primary.id}`]),
    ...(duplicate.provenanceKeys || [`${duplicate.source?.id || "unknown"}:${duplicate.externalId || duplicate.id}`]),
  ])];
  return {
    ...other,
    ...richer,
    id: primary.id,
    duplicateCount: provenanceKeys.length,
    provenanceKeys,
    sources: [...new Map([...(primary.sources || [primary.source]), ...(duplicate.sources || [duplicate.source])].filter(Boolean).map((source) => [source.id || source.name, source])).values()],
    sourceUrls: [...new Set([...(primary.sourceUrls || [primary.url]), ...(duplicate.sourceUrls || [duplicate.url])].filter(Boolean).map(canonicalUrl))],
    postedAt: [primary.postedAt, duplicate.postedAt].filter(Boolean).sort().at(-1),
    verification: (duplicate.verification?.score || 0) > (primary.verification?.score || 0) ? duplicate.verification : primary.verification,
  };
}

export function deduplicateJobs(jobs) {
  const byKey = new Map();
  const candidates = [];
  for (const job of jobs) {
    const keys = [job.source?.id && job.externalId ? `${job.source.id}:${job.externalId}` : null, job.url ? canonicalUrl(job.url) : null, fingerprint(job)].filter(Boolean);
    let existingKey = keys.find((key) => byKey.has(key));
    if (!existingKey && job.company) {
      const fuzzy = candidates.find((candidate) => normalizeText(candidate.company) === normalizeText(job.company) && jaccard(candidate.title, job.title) >= 0.86 && (!candidate.location || !job.location || jaccard(candidate.location, job.location) >= 0.5));
      if (fuzzy) existingKey = fingerprint(fuzzy);
    }
    if (existingKey) {
      const merged = mergeJobs(byKey.get(existingKey), job);
      for (const key of keys) byKey.set(key, merged);
      byKey.set(fingerprint(merged), merged);
      const index = candidates.findIndex((candidate) => candidate.id === merged.id);
      if (index >= 0) candidates[index] = merged;
    } else {
      const provenanceKeys = job.provenanceKeys || [`${job.source?.id || "unknown"}:${job.externalId || job.id || fingerprint(job)}`];
      const normalized = { ...job, id: job.id || fingerprint(job), duplicateCount: provenanceKeys.length, provenanceKeys, sources: job.sources || [job.source].filter(Boolean), sourceUrls: job.sourceUrls || [job.url].filter(Boolean).map(canonicalUrl) };
      for (const key of keys) byKey.set(key, normalized);
      candidates.push(normalized);
    }
  }
  return candidates;
}
