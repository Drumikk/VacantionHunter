import fs from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { parseSalaryText } from "../core/salary.js";
import { inferRelocation, inferRemote } from "../core/mobility.js";
import { stripHtml } from "../core/text.js";

const DEFAULT_SENDER_DOMAINS = ["hh.ru", "headhunter.ru"];
const GENERIC_LINK_TEXT = /^(?:подробнее|смотреть|посмотреть|откликнуться|перейти|вакансия|открыть)$/iu;

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function decodedVariants(value, depth = 0, seen = new Set()) {
  const marker = String(value);
  if (depth > 2 || seen.has(marker)) return [];
  seen.add(marker);
  const variants = new Set([decodeEntities(value)]);
  let current = decodeEntities(value);
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      variants.add(decoded);
      current = decoded;
    } catch { break; }
  }
  try {
    const parsed = new URL(decodeEntities(value));
    for (const nested of parsed.searchParams.values()) {
      for (const variant of decodedVariants(nested, depth + 1, seen)) variants.add(variant);
    }
  } catch { /* malformed and relative links are ignored */ }
  return [...variants];
}

function messageDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function vacancyIdFromLink(value) {
  for (const variant of decodedVariants(value)) {
    const direct = variant.match(/(?:[a-z0-9-]+\.)?hh\.ru\/vacancy\/(\d+)/iu);
    if (direct) return direct[1];
    const parameter = variant.match(/(?:vacancyId|vacancy_id|vacancy)[=/](\d+)/iu);
    if (parameter) return parameter[1];
  }
  return null;
}

function cleanTitle(value, id) {
  const text = stripHtml(decodeEntities(value)).trim();
  return text && !GENERIC_LINK_TEXT.test(text) && text.length <= 180 ? text : `Вакансия HH ${id}`;
}

function contextAround(html, index, length) {
  return stripHtml(decodeEntities(html.slice(Math.max(0, index - 900), Math.min(html.length, index + length + 1_200)))).slice(0, 2_500);
}

function optionalField(context, labels) {
  const match = context.match(new RegExp(`(?:${labels})\\s*[:—–-]\\s*([^|•]{2,80}?)(?=\\s{2,}|(?:зарплата|опыт|график|формат)\\s*[:—–-]|$)`, "iu"));
  return match?.[1]?.trim() || "";
}

export function isAllowedHhSender(mail, domains = DEFAULT_SENDER_DOMAINS) {
  const allowed = domains.map((domain) => String(domain).toLowerCase().replace(/^@/, "")).filter(Boolean);
  const addresses = mail?.from?.value?.flatMap((entry) => entry.group || [entry]).map((entry) => String(entry.address || "").toLowerCase()) || [];
  return addresses.some((address) => {
    const domain = address.split("@").at(-1);
    return allowed.some((allowedDomain) => domain === allowedDomain || domain.endsWith(`.${allowedDomain}`));
  });
}

export function extractHhVacanciesFromEmail(mail, { senderDomains = DEFAULT_SENDER_DOMAINS } = {}) {
  if (!isAllowedHhSender(mail, senderDomains)) return [];
  const html = typeof mail.html === "string" ? mail.html : mail.textAsHtml || "";
  const text = String(mail.text || "");
  const candidates = [];
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const id = vacancyIdFromLink(match[1]);
    if (!id) continue;
    candidates.push({ id, title: cleanTitle(match[2], id), context: contextAround(html, match.index || 0, match[0].length) });
  }
  const urlPattern = /https?:\/\/[^\s<>"']+/giu;
  for (const match of text.matchAll(urlPattern)) {
    const id = vacancyIdFromLink(match[0]);
    if (!id) continue;
    const start = Math.max(0, (match.index || 0) - 900);
    candidates.push({ id, title: `Вакансия HH ${id}`, context: text.slice(start, (match.index || 0) + match[0].length + 1_200).replace(/\s+/g, " ").trim() });
  }

  const unique = new Map();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.id);
    if (!existing || existing.title.startsWith("Вакансия HH ")) unique.set(candidate.id, candidate);
  }
  return [...unique.values()].map(({ id, title, context }) => {
    const salary = parseSalaryText(context, { fallbackCurrency: "RUB", fallbackPeriod: "month" });
    return {
      id: `hh-email:${id}`,
      externalId: id,
      title,
      company: optionalField(context, "компания|работодатель") || "Не указан",
      companyVerified: false,
      description: context,
      url: `https://hh.ru/vacancy/${id}`,
      applyUrl: `https://hh.ru/applicant/vacancy_response?vacancyId=${id}`,
      location: optionalField(context, "локация|город|место работы"),
      remote: inferRemote(title, context),
      relocation: inferRelocation(title, context),
      employmentType: null,
      salary,
      salaryText: salary ? null : optionalField(context, "зарплата|доход"),
      postedAt: messageDate(mail.date),
      updatedAt: messageDate(mail.date),
      providerSource: "hh.ru email alert",
      sourceQuality: 0.9,
    };
  });
}

async function readState(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

async function writeState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, filePath);
}

export function hhEmailConnector(config) {
  const senderDomains = config.hhEmailSenderDomains?.length ? config.hhEmailSenderDomains : DEFAULT_SENDER_DOMAINS;
  const configured = Boolean(config.hhEmailImapUser && config.hhEmailImapPassword);
  const statePath = config.hhEmailStatePath || path.join(config.rootDir || process.cwd(), "data", "hh-email-state.json");
  const diagnostics = { configured, senderDomains, lastCheckedAt: null, messagesScanned: 0, vacanciesFound: 0, parseFailures: 0 };
  const source = {
    id: "hh-email",
    name: "HeadHunter email alerts",
    officialApi: false,
    attributionUrl: "https://hh.ru/",
    setupUrl: "https://feedback.hh.ru/knowledge-base/article/3711",
    authType: "imap_app_password",
    credentialFields: ["HH_EMAIL_IMAP_USER", "HH_EMAIL_IMAP_PASSWORD"],
    adapter: "email-alerts",
    regions: ["russia-cis"],
    note: "Читает только уведомления от разрешённых доменов HH, не меняет письма и не обходит ограничения сайта. Для безопасности рекомендуется отдельный почтовый ящик.",
  };
  let pending = null;

  async function execute() {
    const client = config.hhEmailImapClientFactory
      ? config.hhEmailImapClientFactory()
      : new ImapFlow({
          host: config.hhEmailImapHost || "imap.gmail.com",
          port: config.hhEmailImapPort || 993,
          secure: config.hhEmailImapSecure !== false,
          auth: { user: config.hhEmailImapUser, pass: config.hhEmailImapPassword },
          logger: false,
        });
    client.on?.("error", () => {});
    let lock = null;
    try {
      await client.connect();
      lock = await client.getMailboxLock(config.hhEmailImapFolder || "INBOX", { readOnly: true, acquireTimeout: 30_000 });
      const state = await readState(statePath);
      const uidValidity = String(client.mailbox?.uidValidity || "");
      const lastUid = state.uidValidity === uidValidity ? Number(state.lastUid || 0) : 0;
      const since = new Date(Date.now() - (config.hhEmailLookbackDays || 30) * 86_400_000);
      const criteria = { since };
      if (senderDomains.length === 1) criteria.from = senderDomains[0];
      else criteria.or = senderDomains.map((domain) => ({ from: domain }));
      const found = await client.search(criteria, { uid: true });
      const uids = (Array.isArray(found) ? found : []).filter((uid) => uid > lastUid).slice(-(config.hhEmailMaxMessages || 100));
      const jobs = [];
      let maxUid = lastUid;
      let failures = 0;
      if (uids.length) {
        for await (const message of client.fetch(uids, { uid: true, source: { maxLength: config.hhEmailMaxBytes || 2_000_000 } }, { uid: true })) {
          maxUid = Math.max(maxUid, Number(message.uid || 0));
          try {
            const mail = await simpleParser(message.source, { skipImageLinks: true, maxHtmlLengthToParse: config.hhEmailMaxBytes || 2_000_000 });
            jobs.push(...extractHhVacanciesFromEmail(mail, { senderDomains }));
          } catch { failures += 1; }
        }
        await writeState(statePath, { uidValidity, lastUid: maxUid, updatedAt: new Date().toISOString() });
      }
      Object.assign(diagnostics, { lastCheckedAt: new Date().toISOString(), messagesScanned: uids.length, vacanciesFound: jobs.length, parseFailures: failures });
      return jobs.map((job) => ({ ...job, source }));
    } finally {
      lock?.release();
      await client.logout?.().catch(() => {});
    }
  }

  return {
    ...source,
    enabled: configured,
    disabledReason: configured ? null : "Настройте отдельный IMAP-ящик: HH_EMAIL_IMAP_USER и HH_EMAIL_IMAP_PASSWORD",
    getDiagnostics() { return { ...diagnostics }; },
    async search() {
      if (!configured) throw new Error("HH email IMAP credentials are required");
      if (!pending) pending = execute().finally(() => { pending = null; });
      return pending;
    },
  };
}
