import { normalizeText } from "./text.js";

const LOCATION_ALIASES = [
  ["moscow", ["moscow", "москва"]],
  ["saint petersburg", ["saint petersburg", "saint-petersburg", "st petersburg", "st. petersburg", "санкт петербург", "санкт-петербург", "петербург"]],
  ["russia", ["russia", "russian federation", "россия", "рф"]],
  ["germany", ["germany", "deutschland", "германия"]],
  ["berlin", ["berlin", "берлин"]],
  ["europe", ["europe", "европа", "emea"]],
  ["poland", ["poland", "польша"]],
  ["serbia", ["serbia", "сербия"]],
  ["spain", ["spain", "испания"]],
  ["portugal", ["portugal", "португалия"]],
  ["netherlands", ["netherlands", "the netherlands", "нидерланды", "голландия"]],
  ["canada", ["canada", "канада"]],
  ["united states", ["united states", "united states of america", "usa", "u.s.a", "сша"]],
  ["united kingdom", ["united kingdom", "great britain", "britain", "uk", "u.k", "великобритания"]],
  ["australia", ["australia", "австралия"]],
  ["new zealand", ["new zealand", "новая зеландия"]],
  ["north america", ["north america", "северная америка"]],
  ["latin america", ["latin america", "latam", "латинская америка"]],
];

function containsPhrase(text, phrase) {
  return ` ${normalizeText(text).replace(/-/g, " ")} `.includes(` ${normalizeText(phrase).replace(/-/g, " ")} `);
}

export function extractLocations(value) {
  return LOCATION_ALIASES.filter(([, aliases]) => aliases.some((alias) => containsPhrase(value, alias))).map(([canonical]) => canonical);
}

export function matchedLocationTokens(value) {
  const result = new Set();
  for (const [, aliases] of LOCATION_ALIASES) {
    for (const alias of aliases) {
      if (containsPhrase(value, alias)) normalizeText(alias).replace(/-/g, " ").split(" ").forEach((token) => result.add(token));
    }
  }
  return result;
}

export function locationMatches(value, wanted) {
  const entry = LOCATION_ALIASES.find(([canonical]) => canonical === wanted);
  const aliases = entry?.[1] || [wanted];
  return aliases.some((alias) => containsPhrase(value, alias));
}
