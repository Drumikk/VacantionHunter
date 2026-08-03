import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore } from "../src/services/store.js";

test("serializes concurrent merges without losing jobs or racing the atomic rename", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "jobs.json");
  const store = new JobStore(filePath);
  const source = { id: "test", name: "Test" };

  await Promise.all(Array.from({ length: 12 }, (_, index) => store.merge([{
    id: `test:${index}`,
    externalId: String(index),
    title: `Role ${index}`,
    company: `Company ${index}`,
    location: "Remote",
    url: `https://example.test/jobs/${index}`,
    source,
  }])));

  assert.equal(store.jobs.length, 12);
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(persisted.length, 12);
  assert.deepEqual(new Set(persisted.map((job) => job.id)), new Set(store.jobs.map((job) => job.id)));
});

test("applies lifecycle updates without retaining stale content and removes inactive source records", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-lifecycle-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new JobStore(path.join(directory, "jobs.json"));
  const navSource = { id: "nav-norway", name: "Arbeidsplassen NAV" };
  const otherSource = { id: "other", name: "Other source" };

  await store.merge([
    {
      id: "nav-norway:active-1", externalId: "active-1", title: "Software Engineer", company: "Nordic AS",
      location: "Oslo", url: "https://example.test/nav/active-1", description: "An obsolete and much longer description", source: navSource,
    },
    {
      id: "other:keep-1", externalId: "keep-1", title: "Data Engineer", company: "Other AS",
      location: "Bergen", url: "https://example.test/other/keep-1", description: "Keep this job", source: otherSource,
    },
  ]);

  await store.applySourceChanges("nav-norway", [{
    id: "nav-norway:active-1", externalId: "active-1", title: "Software Engineer", company: "Nordic AS",
    location: "Oslo", url: "https://example.test/nav/active-1", description: "Updated", source: navSource,
  }], { changedExternalIds: ["active-1"] });

  assert.equal(store.jobs.length, 2);
  assert.equal(store.jobs.find((job) => job.externalId === "active-1").description, "Updated");

  await store.applySourceChanges("nav-norway", [], { changedExternalIds: ["active-1"] });
  assert.deepEqual(store.jobs.map((job) => job.id), ["other:keep-1"]);
});
