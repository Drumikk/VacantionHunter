import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApplicationStore, APPLICATION_STATUSES } from "../src/services/application-store.js";
import { JobService } from "../src/services/job-service.js";

function job(id = "job:one") {
  return {
    id,
    externalId: id,
    title: "Backend Developer",
    company: "Example Co",
    description: "Build APIs",
    url: `https://example.test/jobs/${encodeURIComponent(id)}`,
    applyUrl: `https://example.test/jobs/${encodeURIComponent(id)}/apply`,
    location: "Remote",
    remote: true,
    skills: ["node.js"],
    salary: { min: 4_000, max: 6_000, currency: "USD", period: "month" },
    postedAt: new Date().toISOString(),
    source: { id: "test", name: "Test source" },
    verification: { status: "verified", score: 95, risks: [] },
  };
}

async function temporaryStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-applications-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new ApplicationStore(path.join(directory, "applications.json"));
}

test("persists job snapshots, notes, next action and status history", async (t) => {
  const store = await temporaryStore(t);
  await store.load();
  const saved = await store.add(job(), { notes: "Strong match" });
  const nextActionAt = new Date(Date.now() + 86_400_000).toISOString();
  const applied = await store.update(saved.jobId, { status: "applied", notes: "Applied on company site", nextActionAt });
  const interview = await store.update(saved.jobId, { status: "interview" });

  assert.equal(interview.status, "interview");
  assert.deepEqual(interview.history.map((event) => event.status), ["saved", "applied", "interview"]);
  assert.equal(interview.notes, "Applied on company site");
  assert.equal(interview.nextActionAt, nextActionAt);
  assert.equal(interview.job.title, "Backend Developer");

  const reloaded = new ApplicationStore(store.filePath);
  await reloaded.load();
  assert.deepEqual(reloaded.get(saved.jobId), interview);
  assert.equal(reloaded.summary().counts.interview, 1);
  assert.equal(reloaded.summary().active, 1);
  assert.deepEqual(Object.keys(reloaded.summary().counts), APPLICATION_STATUSES);
});

test("validates statuses and does not reset an existing stage when refreshing its snapshot", async (t) => {
  const store = await temporaryStore(t);
  await store.load();
  await store.add(job(), { status: "applied", notes: "Keep this" });
  const refreshed = await store.add({ ...job(), company: "Renamed Company" });
  assert.equal(refreshed.status, "applied");
  assert.equal(refreshed.notes, "Keep this");
  assert.equal(refreshed.job.company, "Renamed Company");
  await assert.rejects(store.update(job().id, { status: "unknown" }), (error) => error.statusCode === 400);
  await assert.rejects(store.update(job().id, { nextActionAt: "not-a-date" }), (error) => error.statusCode === 400);
  await assert.rejects(store.update(job().id, { notes: "x".repeat(4_001) }), (error) => error.statusCode === 400);
});

test("serializes concurrent application writes without losing entries", async (t) => {
  const store = await temporaryStore(t);
  await store.load();
  await Promise.all(Array.from({ length: 15 }, (_, index) => store.add(job(`job:${index}`))));
  const reloaded = new ApplicationStore(store.filePath);
  await reloaded.load();
  assert.equal(reloaded.items.length, 15);
  assert.equal(new Set(reloaded.items.map((item) => item.jobId)).size, 15);
});

test("job service keeps a tracked snapshot after the source job disappears", async (t) => {
  const applicationStore = await temporaryStore(t);
  const jobs = [job("job:persistent")];
  const service = new JobService({
    connectors: [],
    store: { jobs, async load() {}, async merge() {} },
    applicationStore,
    config: {},
  });
  await service.initialize();
  const tracked = await service.addApplication("job:persistent", { status: "saved" });
  jobs.splice(0, 1);

  const updated = await service.updateApplication(tracked.jobId, { status: "offer", notes: "Offer received", job: { id: "forged", title: "Forged", url: "https://evil.test" } });
  assert.equal(updated.job.title, "Backend Developer");
  assert.equal(service.getApplications().summary.counts.offer, 1);
  assert.equal(service.getApplications().items[0].notes, "Offer received");
  assert.equal(await service.removeApplication(tracked.jobId), true);
  assert.equal(await service.removeApplication(tracked.jobId), false);
});
