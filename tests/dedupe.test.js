import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, deduplicateJobs } from "../src/core/dedupe.js";

test("canonical URL removes tracking parameters", () => {
  assert.equal(canonicalUrl("https://www.example.com/job/1?utm_source=x&gh_src=abc"), "https://example.com/job/1");
});

test("deduplicates cross-source jobs and preserves provenance", () => {
  const jobs = deduplicateJobs([
    { id: "1", title: "Senior .NET Developer", company: "Acme", location: "Berlin", url: "https://acme.test/jobs/1?utm_source=board", description: "short", source: { id: "a", name: "A" } },
    { id: "2", title: "Senior Dotnet Developer", company: "Acme", location: "Berlin", url: "https://acme.test/jobs/1", description: "a much richer description", source: { id: "b", name: "B" } },
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].duplicateCount, 2);
  assert.equal(jobs[0].sources.length, 2);
  assert.match(jobs[0].description, /richer/);
});

test("repeated synchronization is idempotent", () => {
  const record = { id: "1", externalId: "42", title: "Backend Developer", company: "Acme", location: "Remote", url: "https://acme.test/jobs/42", source: { id: "ats", name: "ATS" } };
  const first = deduplicateJobs([record]);
  const second = deduplicateJobs([...first, record]);
  assert.equal(second.length, 1);
  assert.equal(second[0].duplicateCount, 1);
  assert.deepEqual(second[0].provenanceKeys, ["ats:42"]);
});
