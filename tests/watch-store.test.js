import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WatchStore } from "../src/services/watch-store.js";
import { refreshWatchedQueries } from "../src/services/scheduler.js";
import { JobService } from "../src/services/job-service.js";

test("persists watched searches, normalizes duplicates, and removes them", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-watches-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "watches.json");
  const store = new WatchStore(filePath);

  const first = await store.add(".NET developer remote");
  const duplicate = await store.add("  .net   DEVELOPER remote  ");

  assert.equal(duplicate.id, first.id);
  assert.equal(store.watches.length, 1);

  const reloaded = new WatchStore(filePath);
  await reloaded.load();
  assert.deepEqual(reloaded.watches, [first]);
  assert.equal(await reloaded.remove(first.id), true);
  assert.equal(await reloaded.remove(first.id), false);

  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.deepEqual(persisted, []);
});

test("scheduler refreshes durable watches and recent searches once each", async () => {
  const refreshed = [];
  const service = {
    lastQueries: ["recent query", "same query"],
    getWatches: () => [{ id: "one", query: "same query" }, { id: "two", query: "durable query" }],
    async refreshWatch(id) { refreshed.push(`watch:${id}`); },
    async refresh(query) { refreshed.push(`recent:${query}`); },
  };

  await refreshWatchedQueries(service);

  assert.deepEqual(refreshed, ["watch:one", "watch:two", "recent:recent query"]);
});

test("tracks only newly matched jobs as unread and persists acknowledgement", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-unread-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "watches.json");
  const store = new WatchStore(filePath);
  const watch = await store.add("Python developer remote", { knownJobIds: ["job:known"] });

  const firstCheck = await store.recordResults(watch.id, ["job:known", "job:new", "job:new"]);
  assert.deepEqual(firstCheck.newJobIds, ["job:new"]);
  assert.deepEqual(firstCheck.watch.unreadJobIds, ["job:new"]);

  const secondCheck = await store.recordResults(watch.id, ["job:known", "job:new", "job:newer"]);
  assert.deepEqual(secondCheck.newJobIds, ["job:newer"]);
  assert.deepEqual(secondCheck.watch.unreadJobIds, ["job:newer", "job:new"]);

  const acknowledged = await store.acknowledge(watch.id);
  assert.deepEqual(acknowledged.unreadJobIds, []);
  const reloaded = new WatchStore(filePath);
  await reloaded.load();
  assert.deepEqual(reloaded.get(watch.id).unreadJobIds, []);
  assert.ok(reloaded.get(watch.id).knownJobIds.includes("job:newer"));
});

test("job service baselines an observation and emits only later matching jobs", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-service-watch-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const jobs = [{
    id: "job:known", externalId: "known", title: "Python Developer", company: "Known Co",
    description: "Python backend development in a remote team", skills: ["python"], remote: true,
    location: "Remote", postedAt: new Date().toISOString(), url: "https://example.test/known",
    source: { id: "test", name: "Test" }, verification: { status: "verified", score: 90, risks: [] },
  }];
  const store = { jobs, async load() {}, async merge() {} };
  const watchStore = new WatchStore(path.join(directory, "watches.json"));
  const notificationCalls = [];
  const notificationService = {
    async initialize() {},
    async enqueueWatchJobs(savedWatch, newJobs) { notificationCalls.push({ watch: savedWatch, jobs: newJobs }); },
    async flush() { return [{ status: "sent" }]; },
    status() { return { enabled: true, status: "ready" }; },
  };
  const service = new JobService({ connectors: [], store, watchStore, notificationService, config: {} });
  await service.initialize();

  const watch = await service.addWatch("Python developer remote");
  assert.equal(watch.newCount, 0);
  jobs.push({ ...jobs[0], id: "job:new", externalId: "new", company: "New Co", url: "https://example.test/new" });

  let notification = null;
  service.once("watch-jobs", (payload) => { notification = payload; });
  const refreshed = await service.refreshWatch(watch.id);

  assert.deepEqual(refreshed.newJobIds, ["job:new"]);
  assert.equal(refreshed.watch.newCount, 1);
  assert.equal(notification.watch.id, watch.id);
  assert.deepEqual(notification.newJobIds, ["job:new"]);
  assert.equal(notificationCalls.length, 1);
  assert.equal(notificationCalls[0].watch.id, watch.id);
  assert.deepEqual(notificationCalls[0].jobs.map((job) => job.id), ["job:new"]);
  assert.deepEqual(refreshed.notificationReport, [{ status: "sent" }]);
  assert.equal((await service.acknowledgeWatch(watch.id)).newCount, 0);
});

test("does not mark a new job as known when durable notification enqueue fails", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-outbox-order-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const jobs = [{
    id: "job:known", externalId: "known", title: "Python Developer", company: "Known Co",
    description: "Python backend remote", skills: ["python"], remote: true, location: "Remote",
    postedAt: new Date().toISOString(), url: "https://example.test/known",
    source: { id: "test", name: "Test" }, verification: { status: "verified", score: 90, risks: [] },
  }];
  const watchStore = new WatchStore(path.join(directory, "watches.json"));
  const notificationService = {
    async initialize() {},
    async enqueueWatchJobs() { throw new Error("outbox disk unavailable"); },
    async flush() { return []; },
    status() { return { enabled: true }; },
  };
  const service = new JobService({
    connectors: [],
    store: { jobs, async load() {}, async merge() {} },
    watchStore,
    notificationService,
    config: {},
  });
  await service.initialize();
  const watch = await service.addWatch("Python developer remote");
  jobs.push({ ...jobs[0], id: "job:new", externalId: "new", company: "New Co", url: "https://example.test/new" });

  await assert.rejects(service.refreshWatch(watch.id), /outbox disk unavailable/);
  assert.equal(watchStore.get(watch.id).knownJobIds.includes("job:new"), false);
});
