const SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "₽": "RUB" };
const CURRENCY_ALIASES = {
  usd: "USD", dollar: "USD", dollars: "USD", доллар: "USD", долларов: "USD",
  eur: "EUR", euro: "EUR", евро: "EUR",
  gbp: "GBP", pound: "GBP", pounds: "GBP", фунт: "GBP", фунтов: "GBP",
  rub: "RUB", rur: "RUB", руб: "RUB", рублей: "RUB",
  cad: "CAD", aud: "AUD", chf: "CHF", pln: "PLN", sek: "SEK", nok: "NOK",
};

export const DEFAULT_USD_RATES = {
  USD: 1, EUR: 1.09, GBP: 1.29, RUB: 0.0108, CAD: 0.73, AUD: 0.66,
  CHF: 1.12, PLN: 0.255, SEK: 0.094, NOK: 0.092,
};

function parseNumber(value) {
  const cleaned = String(value).toLowerCase().replace(/\s/g, "");
  const multiplier = /k|тыс/.test(cleaned) ? 1_000 : 1;
  let numeric = cleaned.replace(/[^\d.,]/g, "");
  const separators = [...numeric.matchAll(/[.,]/g)].map((match) => match.index);
  if (separators.length) {
    const last = separators.at(-1);
    const digitsAfter = numeric.length - last - 1;
    const thousands = digitsAfter === 3 && multiplier === 1 && separators.every((index, position) =>
      position === separators.length - 1 || separators[position + 1] - index === 4,
    );
    if (thousands) numeric = numeric.replace(/[.,]/g, "");
    else {
      const decimalSeparator = numeric[last];
      numeric = numeric.slice(0, last).replace(/[.,]/g, "") + "." + numeric.slice(last + 1);
      if (decimalSeparator !== ".") numeric = numeric.replace(/,/g, "");
    }
  }
  const number = Number.parseFloat(numeric);
  return Number.isFinite(number) ? number * multiplier : null;
}

function detectCurrency(text) {
  for (const [symbol, code] of Object.entries(SYMBOLS)) if (text.includes(symbol)) return code;
  const normalized = text.toLowerCase();
  for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) {
    if (new RegExp(`(^|[^a-zа-я])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zа-я]|$)`, "i").test(normalized)) return code;
  }
  return null;
}

function detectPeriod(text, fallback = "month") {
  if (/\b(hour|hourly|час|часа|часов|\/h|per hour)\b/i.test(text)) return "hour";
  if (/\b(year|annual|annually|год|годовых|per annum|\/yr)\b/i.test(text)) return "year";
  if (/\b(day|daily|день|дня|\/day)\b/i.test(text)) return "day";
  if (/\b(week|weekly|недел|\/week)\b/i.test(text)) return "week";
  if (/\b(month|monthly|месяц|мес|\/mo)\b/i.test(text)) return "month";
  return fallback;
}

export function parseSalaryText(text, { fallbackPeriod = "month", fallbackCurrency = null } = {}) {
  const value = String(text || "");
  const currency = detectCurrency(value) || fallbackCurrency;
  const period = detectPeriod(value, fallbackPeriod);
  const targetPattern = /(?:от|from|min(?:imum)?|не\s+менее)\s*([$€£₽]?)\s*([\d\s.,]+\s*(?:k|тыс)?)(?:\s*([a-zа-я]{2,10}))?/iu;
  const rangePattern = /([$€£₽]?)\s*([\d\s.,]+\s*(?:k|тыс)?)\s*(?:-|–|—|to|до)\s*([$€£₽]?)\s*([\d\s.,]+\s*(?:k|тыс)?)/iu;
  const simplePattern = /([$€£₽])\s*([\d\s.,]+\s*(?:k|тыс)?)|([\d\s.,]+\s*(?:k|тыс)?)\s*(usd|eur|gbp|rub|rur|cad|aud|chf|pln|sek|nok|доллар(?:ов)?|евро|руб(?:лей)?)/iu;

  const range = value.match(rangePattern);
  if (range) {
    return { min: parseNumber(range[2]), max: parseNumber(range[4]), currency: SYMBOLS[range[1]] || SYMBOLS[range[3]] || currency, period, explicit: true };
  }
  const target = value.match(targetPattern);
  if (target && (target[1] || target[3] || currency)) {
    return { min: parseNumber(target[2]), max: null, currency: SYMBOLS[target[1]] || CURRENCY_ALIASES[String(target[3] || "").toLowerCase()] || currency, period, explicit: true };
  }
  const simple = value.match(simplePattern);
  if (simple) {
    return { min: parseNumber(simple[2] || simple[3]), max: null, currency: SYMBOLS[simple[1]] || CURRENCY_ALIASES[String(simple[4] || "").toLowerCase()] || currency, period, explicit: true };
  }
  return null;
}

export function monthlyUsd(salary, rates = DEFAULT_USD_RATES) {
  if (!salary || !salary.currency) return { min: null, max: null, known: false, approximate: true };
  const rate = rates[salary.currency.toUpperCase()];
  const factor = { hour: 173.33, day: 21.67, week: 52 / 12, month: 1, year: 1 / 12 }[salary.period];
  if (!rate || !factor) return { min: null, max: null, known: false, approximate: true };
  const convert = (amount) => amount == null ? null : Math.round(amount * factor * rate);
  return { min: convert(salary.min), max: convert(salary.max), known: salary.min != null || salary.max != null, approximate: salary.currency !== "USD" || salary.period !== "month" };
}

export function formatSalary(salary) {
  if (!salary || (salary.min == null && salary.max == null)) return "Не указана";
  const amount = salary.max != null ? `${salary.min?.toLocaleString("ru-RU") || "?"}–${salary.max.toLocaleString("ru-RU")}` : `от ${salary.min.toLocaleString("ru-RU")}`;
  const period = { hour: "/час", day: "/день", week: "/нед.", month: "/мес.", year: "/год" }[salary.period] || "";
  return `${amount} ${salary.currency || ""}${period}`.trim();
}
