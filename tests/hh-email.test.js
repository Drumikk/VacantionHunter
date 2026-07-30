import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { simpleParser } from "mailparser";
import { extractHhVacanciesFromEmail, hhEmailConnector, isAllowedHhSender } from "../src/connectors/hh-email.js";

const rawAlert = [
  "From: HeadHunter <noreply@hh.ru>",
  "To: jobs@example.test",
  "Subject: New vacancies",
  "Date: Wed, 29 Jul 2026 10:00:00 +0300",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
  "",
  "<html><body>",
  "<section>Компания: Acme Labs  Локация: Москва  Зарплата: от 450 000 руб. в месяц  Формат: remote",
  '<a href="https://hh.ru/vacancy/123?from=email">Senior .NET Developer</a>',
  '<a href="https://hh.ru/vacancy/123?utm_source=alert">Подробнее</a></section>',
  "<section>Работодатель: Globex  Город: Берлин  visa sponsorship and relocation support",
  '<a href="https://click.hh.ru/redirect?url=https%253A%252F%252Fhh.ru%252Fvacancy%252F456%253Ffrom%253Demail">Backend Engineer</a></section>',
  "</body></html>",
].join("\r\n");

test("extracts, canonicalizes and deduplicates HH vacancies from an allowed alert", async () => {
  const mail = await simpleParser(Buffer.from(rawAlert));
  const jobs = extractHhVacanciesFromEmail(mail);

  assert.equal(jobs.length, 2);
  const first = jobs.find((job) => job.externalId === "123");
  const second = jobs.find((job) => job.externalId === "456");
  assert.equal(first.title, "Senior .NET Developer");
  assert.equal(first.url, "https://hh.ru/vacancy/123");
  assert.equal(first.salary.min, 450_000);
  assert.equal(first.salary.currency, "RUB");
  assert.equal(first.salary.period, "month");
  assert.equal(first.remote, true);
  assert.equal(second.title, "Backend Engineer");
  assert.equal(second.relocation, true);
  assert.equal(first.postedAt, "2026-07-29T07:00:00.000Z");
});

test("rejects lookalike sender domains", () => {
  const spoofed = { from: { value: [{ address: "alerts@hh.ru.evil.test" }] } };
  assert.equal(isAllowedHhSender(spoofed), false);
  assert.deepEqual(extractHhVacanciesFromEmail(spoofed), []);
});

test("HH email connector is disabled until both IMAP credentials exist", () => {
  const connector = hhEmailConnector({ hhEmailImapUser: "", hhEmailImapPassword: "" });
  assert.equal(connector.enabled, false);
  assert.match(connector.disabledReason, /HH_EMAIL_IMAP_USER/);
});

test("reads new UIDs once, keeps a cursor and never exposes IMAP secrets", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-hh-email-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "state.json");
  const calls = { searches: [], fetches: 0, logouts: 0 };

  class FakeImapClient {
    constructor() { this.mailbox = { uidValidity: 42n }; }
    on() {}
    async connect() {}
    async getMailboxLock(folder, options) {
      assert.equal(folder, "Alerts");
      assert.deepEqual(options, { readOnly: true, acquireTimeout: 30_000 });
      return { release() {} };
    }
    async search(criteria, options) {
      calls.searches.push({ criteria, options });
      return [7];
    }
    async *fetch(uids, query, options) {
      calls.fetches += 1;
      assert.deepEqual(uids, [7]);
      assert.equal(query.source.maxLength, 500_000);
      assert.deepEqual(options, { uid: true });
      yield { uid: 7, source: Buffer.from(rawAlert) };
    }
    async logout() { calls.logouts += 1; }
  }

  const username = "private-mailbox@example.test";
  const password = "private-app-password";
  const connector = hhEmailConnector({
    hhEmailImapUser: username,
    hhEmailImapPassword: password,
    hhEmailImapFolder: "Alerts",
    hhEmailSenderDomains: ["hh.ru"],
    hhEmailStatePath: statePath,
    hhEmailMaxBytes: 500_000,
    hhEmailImapClientFactory: () => new FakeImapClient(),
  });

  const first = await connector.search({ raw: ".NET developer" });
  const second = await connector.search({ raw: ".NET developer" });
  assert.equal(first.length, 2);
  assert.equal(first[0].source.id, "hh-email");
  assert.deepEqual(second, []);
  assert.equal(calls.fetches, 1);
  assert.equal(calls.logouts, 2);
  assert.deepEqual(calls.searches[0].options, { uid: true });
  assert.equal(JSON.stringify(connector.getDiagnostics()).includes(username), false);
  assert.equal(JSON.stringify(connector.getDiagnostics()).includes(password), false);
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, "utf8")), {
    uidValidity: "42",
    lastUid: 7,
    updatedAt: JSON.parse(await fs.readFile(statePath, "utf8")).updatedAt,
  });
});
