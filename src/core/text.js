const STOP_WORDS = new Set([
  "и", "или", "в", "на", "с", "со", "для", "по", "от", "до", "из", "к", "а", "но",
  "the", "a", "an", "and", "or", "for", "with", "in", "at", "of", "to", "from",
  "работа", "вакансия", "вакансии", "поиск", "ищу", "нужна", "нужен", "позиция", "job", "jobs",
]);

const SYNONYMS = new Map([
  ["dotnet", [".net", "dotnet", "asp.net", "c#", "csharp"]],
  [".net", [".net", "dotnet", "asp.net", "c#", "csharp"]],
  ["c#", ["c#", "csharp", ".net", "dotnet"]],
  ["javascript", ["javascript", "js", "typescript", "ts"]],
  ["frontend", ["frontend", "front-end", "фронтенд"]],
  ["backend", ["backend", "back-end", "бэкенд"]],
  ["developer", ["developer", "engineer", "разработчик", "программист"]],
  ["разработчик", ["developer", "engineer", "разработчик", "программист"]],
  ["remote", ["remote", "удаленно", "удалённо", "удаленка", "удалёнка"]],
  ["релокация", ["relocation", "relocate", "релокация", "переезд", "visa sponsorship"]],
]);

export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/c\s*sharp/g, "c#")
    .replace(/dot\s*net/g, ".net")
    .replace(/[^\p{L}\p{N}+#.\-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(value, { keepStopWords = false } = {}) {
  return normalizeText(value).split(" ").filter((token) => token && (keepStopWords || !STOP_WORDS.has(token)));
}

export function expandToken(token) {
  return SYNONYMS.get(token) || [token];
}

export function tokenSet(value, { expand = true } = {}) {
  const set = new Set();
  for (const token of tokens(value)) {
    for (const synonym of expand ? expandToken(token) : [token]) set.add(synonym);
  }
  return set;
}

export function overlapScore(queryTerms, textValue) {
  if (!queryTerms.length) return 1;
  const haystack = tokenSet(textValue);
  let matched = 0;
  for (const term of queryTerms) {
    const variants = expandToken(normalizeText(term));
    if (variants.some((variant) => haystack.has(variant) || normalizeText(textValue).includes(variant))) matched += 1;
  }
  return matched / queryTerms.length;
}

export function stripHtml(value = "") {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
