import { normalizeText, overlapScore, tokens } from "./text.js";

const ENGLISH_TERM = new Map([
  ["разработчик", "developer"],
  ["программист", "developer"],
  ["инженер", "engineer"],
  ["старший", "senior"],
  ["ведущий", "lead"],
  ["младший", "junior"],
  ["удаленно", "remote"],
  ["удалённо", "remote"],
]);

function preferredTerm(term) {
  const normalized = normalizeText(term);
  return ENGLISH_TERM.get(normalized) || (normalized === "dotnet" ? ".net" : normalized);
}

export function sourceSearchTerms(query, { includeRemote = false } = {}) {
  const roleTerms = tokens(query.role || "", { keepStopWords: true }).map(preferredTerm);
  const skillTerms = (query.skills || []).map(preferredTerm);
  const terms = [...roleTerms, ...skillTerms];
  if (includeRemote && query.remote) terms.push("remote");
  return [...new Set(terms.filter(Boolean))].join(" ") || query.raw;
}

export function retrievalMatches(job, query) {
  const wanted = [query.role, ...(query.skills || [])].filter(Boolean);
  if (!wanted.length) return true;
  const searchable = `${job.title || ""} ${job.description || ""} ${(job.skills || []).join(" ")} ${job.category || ""}`;
  if (query.skills?.length && !query.skills.some((skill) => overlapScore([skill], searchable) === 1)) return false;
  return !query.role || overlapScore(tokens(query.role, { keepStopWords: true }), searchable) >= 0.5;
}
