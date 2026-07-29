import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NotificationOutbox } from "../src/services/notification-outbox.js";
import { NotificationService, watchMessage } from "../src/services/notification-service.js";

async function temporaryOutbox(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-notifications-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new NotificationOutbox(path.join(directory, "outbox.json"));
}

function config(overrides = {}) {
  return {
    telegramBotToken: "secret-bot-token",
    telegramChatId: "123456",
    telegramSilent: false,
    requestTimeoutMs: 1_000,
    notificationBatchSize: 10,
    notificationMaxAttempts: 3,
    notificationMaxJobs: 5,
    notificationRetryBaseMs: 0,
    ...overrides,
  };
}

test("persists the notification outbox and deduplicates the same event", async (t) => {
  const outbox = await temporaryOutbox(t);
  await outbox.load();
  const first = await outbox.enqueue({ channel: "telegram", dedupeKey: "watch:one", payload: { text: "hello" } });
  const duplicate = await outbox.enqueue({ channel: "telegram", dedupeKey: "watch:one", payload: { text: "changed" } });
  assert.equal(duplicate.id, first.id);
  assert.equal(outbox.entries.length, 1);

  const reloaded = new NotificationOutbox(outbox.filePath);
  await reloaded.load();
  assert.equal(reloaded.pending().length, 1);
  assert.equal(reloaded.pending()[0].payload.text, "hello");
  await reloaded.markFailed(first.id, new Error("permanent"), { delayMs: 0, maxAttempts: 1 });
  assert.equal(reloaded.stats().failed, 1);
  assert.equal(await reloaded.retryFailed(), 1);
  assert.equal(reloaded.pending().length, 1);
});

test("retries Telegram delivery from the durable outbox and never exposes the token", async (t) => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0 } }), { status: 429, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  const fetchImpl = async (url, options) => { requests.push({ url, options }); return responses.shift(); };
  const outbox = await temporaryOutbox(t);
  const service = new NotificationService({ outbox, config: config(), fetchImpl });
  await service.initialize();
  await service.enqueueWatchJobs({ id: "watch-one", query: "Python remote" }, [{
    id: "job-one", title: "Python Developer", company: "Example", location: "Remote", url: "https://example.test/jobs/1",
  }]);

  const failed = await service.flush();
  assert.equal(failed[0].status, "pending");
  assert.equal(service.status().pending, 1);
  const sent = await service.flush();
  assert.equal(sent[0].status, "sent");
  assert.equal(service.status().pending, 0);
  assert.equal(service.status().sent, 1);
  assert.equal(JSON.stringify(service.status()).includes("secret-bot-token"), false);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /sendMessage$/);
  assert.equal(JSON.parse(requests[0].options.body).chat_id, "123456");
});

test("formats a bounded vacancy digest and refuses tests when Telegram is not configured", async (t) => {
  const jobs = Array.from({ length: 12 }, (_, index) => ({
    id: `job-${index}`,
    title: `Backend Developer ${"x".repeat(500)}`,
    company: "Company",
    url: `https://example.test/jobs/${index}`,
  }));
  const text = watchMessage({ query: "Backend remote" }, jobs, { maxJobs: 5 });
  assert.ok(text.length <= 4_000);
  assert.match(text, /Ещё 7 вакансий/);

  const service = new NotificationService({ outbox: await temporaryOutbox(t), config: config({ telegramBotToken: "", telegramChatId: "" }) });
  await service.initialize();
  assert.equal(service.status().enabled, false);
  await assert.rejects(service.sendTest(), (error) => error.statusCode === 409);
});

test("discovers safe chat metadata after the user contacts the bot", async (t) => {
  const fetchImpl = async (url) => {
    assert.match(url, /getUpdates$/);
    return new Response(JSON.stringify({ ok: true, result: [
      { update_id: 1, message: { chat: { id: 123, type: "private", first_name: "Ivan", username: "ivan" } } },
      { update_id: 2, channel_post: { chat: { id: -100777, type: "channel", title: "Vacancies" } } },
      { update_id: 3, message: { chat: { id: 123, type: "private", first_name: "Ivan" } } },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const service = new NotificationService({
    outbox: await temporaryOutbox(t),
    config: config({ telegramChatId: "" }),
    fetchImpl,
  });
  await service.initialize();
  const result = await service.discoverChats();
  assert.deepEqual(result.chats, [
    { id: "123", type: "private", title: "Ivan", username: null },
    { id: "-100777", type: "channel", title: "Vacancies", username: null },
  ]);
  assert.equal(service.status().enabled, false);
  assert.equal(service.status().canDiscover, true);
  assert.equal(JSON.stringify(result).includes("secret-bot-token"), false);
});
