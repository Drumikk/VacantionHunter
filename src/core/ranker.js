import { overlapScore, normalizeText } from "./text.js";
import { monthlyUsd } from "./salary.js";
import { locationMatches } from "./location.js";

function includes(value, wanted) { return normalizeText(value).includes(normalizeText(wanted)); }

const TITLE_TECHNOLOGIES = [".net", "java", "python", "javascript", "typescript", "go", "golang", "rust", "php", "ruby", "kotlin"];

function roleMatch(wanted, job) {
  const terms = normalizeText(wanted).split(" ");
  const title = `${job.title || ""} ${job.category || ""}`;
  const combined = `${title} ${job.description || ""}`;
  const wantedTechnologies = TITLE_TECHNOLOGIES.filter((technology) => overlapScore([technology], wanted) === 1);
  const titleTechnologies = TITLE_TECHNOLOGIES.filter((technology) => overlapScore([technology], title) === 1);
  const hasWantedTechnologyInTitle = wantedTechnologies.some((technology) => overlapScore([technology], title) === 1);
  if (wantedTechnologies.length && titleTechnologies.length && !hasWantedTechnologyInTitle) return overlapScore(terms, title);
  return overlapScore(terms, combined);
}

function tagMatch(tag, job) {
  const text = `${job.title || ""} ${job.description || ""} ${(job.skills || []).join(" ")} ${job.category || ""}`;
  switch (tag.type) {
    case "role": return roleMatch(tag.value, job);
    case "skill": return overlapScore([tag.value], text);
    case "location": return locationMatches(`${job.location || ""} ${(job.locations || []).join(" ")}`, tag.value) ? 1 : 0;
    case "remote": return job.remote ? 1 : 0;
    case "relocation": return job.relocation || job.visaSponsorship ? 1 : 0;
    case "experience": return includes(`${job.experience || ""} ${job.title || ""} ${job.description || ""}`, tag.value) ? 1 : 0;
    case "employment": return includes(job.employmentType || "", tag.value) ? 1 : 0;
    case "salary": {
      const normalized = job.salaryMonthlyUsd || monthlyUsd(job.salary).min;
      if (normalized == null) return 0;
      if (!tag.normalizedMonthlyUsd) return 1;
      return normalized >= tag.normalizedMonthlyUsd ? 1 : Math.max(0, normalized / tag.normalizedMonthlyUsd);
    }
    case "exclude": return includes(text, tag.value) ? 0 : 1;
    default: return 0;
  }
}

function freshnessScore(job, now = Date.now()) {
  const posted = Date.parse(job.postedAt || job.updatedAt || "");
  if (!Number.isFinite(posted)) return 0.25;
  const ageDays = Math.max(0, (now - posted) / 86_400_000);
  return Math.exp(-ageDays / 21);
}

function salaryScore(job, query) {
  const value = job.salaryMonthlyUsd || monthlyUsd(job.salary).min;
  if (value == null) return { score: 0, value: null };
  if (!query.salaryMonthlyUsd) return { score: 0.35, value };
  const ratio = value / query.salaryMonthlyUsd;
  return { score: ratio >= 1 ? Math.min(1, 0.75 + Math.log2(Math.max(1, ratio)) * 0.25) : Math.max(0, ratio * 0.65), value };
}

export function scoreJob(job, query, { now = Date.now() } = {}) {
  const evaluated = query.tags.map((tag) => ({ ...tag, match: tagMatch(tag, job) }));
  const totalWeight = evaluated.reduce((sum, tag) => sum + tag.weight, 0) || 1;
  const matchedWeight = evaluated.reduce((sum, tag) => sum + tag.weight * tag.match, 0);
  const required = evaluated.filter((tag) => tag.required);
  const andMatch = required.length > 0 && required.every((tag) => tag.match >= 0.999);
  const requiredMissCount = required.filter((tag) => tag.match < 0.999).length;
  const salary = salaryScore(job, query);
  const textScore = matchedWeight / totalWeight;
  const freshness = freshnessScore(job, now);
  const authenticity = Math.max(0, Math.min(1, (job.verification?.score ?? 50) / 100));
  const unsafe = ["suspicious", "stale"].includes(job.verification?.status);
  const sourceQuality = Math.max(0, Math.min(1, job.sourceQuality ?? 0.6));
  const safetyPenalty = unsafe ? 35 : 0;
  const score = Math.max(0, Math.round((textScore * 70 + salary.score * 15 + freshness * 8 + authenticity * 5 + sourceQuality * 2 - safetyPenalty) * 10) / 10);
  const matchedTags = evaluated.filter((tag) => tag.match >= 0.75).map((tag) => tag.id);
  const partialTags = evaluated.filter((tag) => tag.match > 0 && tag.match < 0.75).map((tag) => tag.id);
  const missingTags = evaluated.filter((tag) => tag.match === 0).map((tag) => tag.id);
  return { ...job, score, matchPercent: Math.round(textScore * 100), andMatch, unsafe, requiredMissCount, salaryMonthlyUsd: salary.value, matchedTags, partialTags, missingTags, scoreBreakdown: { tagMatch: Math.round(textScore * 700) / 10, salary: Math.round(salary.score * 150) / 10, freshness: Math.round(freshness * 80) / 10, authenticity: Math.round(authenticity * 50) / 10, sourceQuality: Math.round(sourceQuality * 20) / 10, safetyPenalty: -safetyPenalty } };
}

function compareValues(a, b, field, direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const av = a[field] ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  const bv = b[field] ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv), "ru") * multiplier;
  return (av - bv) * multiplier;
}

export function rankJobs(jobs, query, { sort = [] } = {}) {
  const scored = jobs.map((job) => scoreJob(job, query));
  return scored.sort((a, b) => {
    if (a.unsafe !== b.unsafe) return a.unsafe ? 1 : -1;
    if (a.andMatch !== b.andMatch) return a.andMatch ? -1 : 1;
    if (a.requiredMissCount !== b.requiredMissCount) return a.requiredMissCount - b.requiredMissCount;
    const userSort = sort.filter((item) => item?.field);
    if (userSort.length) {
      for (const item of userSort) {
        const result = compareValues(a, b, item.field, item.direction);
        if (result !== 0) return result;
      }
    } else {
      const relevance = compareValues(a, b, "score", "desc");
      if (relevance !== 0) return relevance;
      const salary = compareValues(a, b, "salaryMonthlyUsd", "desc");
      if (salary !== 0) return salary;
    }
    return String(b.postedAt || "").localeCompare(String(a.postedAt || ""));
  });
}

export function isRelevantMatch(job, query) {
  if (!job || job.matchPercent <= 0) return false;
  const matched = new Set(job.matchedTags || []);
  if (query.role && !matched.has("role")) return false;
  if (query.skills?.length && !query.skills.some((skill) => matched.has(`skill:${skill}`))) return false;
  return true;
}
