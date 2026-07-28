import { normalizeText, tokens } from "./text.js";
import { parseSalaryText, monthlyUsd } from "./salary.js";

const SKILLS = [
  ".net", "dotnet", "c#", "asp.net", "java", "kotlin", "python", "django", "flask", "fastapi",
  "javascript", "typescript", "react", "vue", "angular", "node.js", "node", "go", "golang", "rust",
  "php", "ruby", "rails", "sql", "postgresql", "mysql", "mongodb", "redis", "docker", "kubernetes",
  "aws", "azure", "gcp", "terraform", "spark", "kafka", "airflow", "machine learning", "ml", "ai",
];

const ROLE_PATTERNS = [
  /((?:senior|middle|mid|junior|lead|principal|старший|младший|ведущий)?\s*(?:\.net|dotnet|c#|java|python|javascript|typescript|react|node(?:\.js)?|go|golang|data|backend|frontend|full\s*stack|qa|devops|product)?\s*(?:developer|engineer|разработчик|программист|аналитик|designer|дизайнер|manager|менеджер|tester|тестировщик|architect|архитектор))/iu,
  /((?:data scientist|data engineer|product manager|project manager|business analyst|system analyst|системный аналитик|бизнес аналитик|продакт менеджер))/iu,
];

const LOCATIONS = ["москва", "санкт-петербург", "петербург", "россия", "германия", "берлин", "европа", "польша", "сербия", "испания", "португалия", "нидерланды", "канада", "сша", "uk", "великобритания", "remote", "удаленно", "удалённо"];

function unique(values) { return [...new Set(values.filter(Boolean))]; }

export function parseQuery(rawQuery) {
  const raw = String(rawQuery || "").trim();
  const normalized = normalizeText(raw);
  const salary = parseSalaryText(raw, { fallbackPeriod: /год|annual|year/i.test(raw) ? "year" : "month" });
  const salaryUsd = monthlyUsd(salary);

  let role = null;
  for (const pattern of ROLE_PATTERNS) {
    const match = raw.match(pattern);
    if (match?.[1]) { role = normalizeText(match[1]).replace(/^(ищу|нужен|нужна)\s+/, ""); break; }
  }

  const skills = unique(SKILLS.filter((skill) => {
    const normalizedSkill = normalizeText(skill);
    return normalized.includes(normalizedSkill) || (normalizedSkill === "dotnet" && normalized.includes(".net"));
  }).map((skill) => skill === "dotnet" ? ".net" : skill));

  const locations = unique(LOCATIONS.filter((location) => normalized.includes(normalizeText(location))).map((location) => {
    if (["remote", "удаленно", "удалённо"].includes(location)) return "remote";
    if (location === "петербург") return "санкт-петербург";
    return location;
  }));
  const remote = /(remote|удален|удалён|из дома|worldwide)/iu.test(raw);
  const relocation = /relocat|visa sponsorship|рабоч(?:ая|ей) виз|переезд|релокац/iu.test(raw);
  const experienceMatch = raw.match(/\b(intern|стаж[её]р|junior|middle|mid|senior|lead|principal|architect|младший|старший|ведущий)\b/iu);
  const experience = experienceMatch ? normalizeText(experienceMatch[1]) : null;
  const employment = /частичн|part[- ]?time/i.test(raw) ? "part-time" : /контракт|contract|freelance|фриланс/i.test(raw) ? "contract" : /стажиров|internship/i.test(raw) ? "internship" : null;
  const exclusions = [...raw.matchAll(/(?:не|без|exclude|-)(?:\s+)([\p{L}\p{N}+#.\-]+)/giu)].map((m) => normalizeText(m[1]));

  const fallbackTerms = tokens(raw).filter((term) => !/\d/.test(term) && ![...skills, ...locations].some((known) => normalizeText(known) === term));
  if (!role && fallbackTerms.length) role = fallbackTerms.slice(0, 3).join(" ");

  const tags = [];
  if (role) tags.push({ id: "role", type: "role", value: role, weight: 5, required: true });
  for (const skill of skills) tags.push({ id: `skill:${skill}`, type: "skill", value: skill, weight: 4, required: true });
  for (const location of locations.filter((item) => item !== "remote")) tags.push({ id: `location:${location}`, type: "location", value: location, weight: 3, required: true });
  if (remote) tags.push({ id: "remote", type: "remote", value: true, weight: 3, required: true });
  if (relocation) tags.push({ id: "relocation", type: "relocation", value: true, weight: 3, required: false });
  if (experience) tags.push({ id: "experience", type: "experience", value: experience, weight: 2, required: false });
  if (employment) tags.push({ id: "employment", type: "employment", value: employment, weight: 2, required: false });
  if (salary?.min != null) tags.push({ id: "salary", type: "salary", value: salary, normalizedMonthlyUsd: salaryUsd.min, weight: 5, required: true });
  for (const exclusion of exclusions) tags.push({ id: `exclude:${exclusion}`, type: "exclude", value: exclusion, weight: 5, required: true });

  const clarifications = [];
  if (!role) clarifications.push({ field: "role", question: "Какую должность или специализацию искать?" });
  if (salary && !salary.currency) clarifications.push({ field: "salaryCurrency", question: "В какой валюте указана зарплата?" });
  if (salary && !/(час|hour|год|year|annual|месяц|month|мес|week|недел|day|день)/iu.test(raw)) clarifications.push({ field: "salaryPeriod", question: "Зарплата указана за месяц?", suggested: "month" });
  if (!locations.length && !remote) clarifications.push({ field: "location", question: "Есть предпочтение по стране/городу или нужна удалёнка?", optional: true });

  return { raw, normalized, role, skills, locations, remote, relocation, experience, employment, salary, salaryMonthlyUsd: salaryUsd.min, exclusions, tags, clarifications };
}
