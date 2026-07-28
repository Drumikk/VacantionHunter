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
