import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/core/query-parser.js";
import { isRelevantMatch, rankJobs } from "../src/core/ranker.js";

const source = { id: "demo", name: "Demo", officialApi: true };
function job(id, title, salary, extra = {}) {
  return { id, externalId: id, title, company: "Example", description: ".NET C# ASP.NET developer role with a complete description and benefits.", remote: true, location: "Remote", salary, postedAt: "2026-07-28T00:00:00Z", source, sourceQuality: 0.9, verification: { score: 85 }, ...extra };
}

test("AND matches rank before OR matches and higher salaries lead", () => {
  const query = parseQuery(".Net разработчик удаленно от 4000$ в месяц");
  const ranked = rankJobs([
    job("missing", ".NET Developer", null),
    job("low", ".NET Developer", { min: 3000, currency: "USD", period: "month" }),
    job("high", ".NET Developer", { min: 8000, currency: "USD", period: "month" }),
    job("mid", ".NET Developer", { min: 6000, currency: "USD", period: "month" }),
    job("other", "Java Developer", { min: 10000, currency: "USD", period: "month" }, { description: "Java Spring developer role with detailed responsibilities and benefits." }),
  ], query);
  assert.deepEqual(ranked.slice(0, 2).map((item) => item.id), ["high", "mid"]);
  assert.equal(ranked[0].andMatch, true);
  assert.equal(ranked.at(-1).id, "other");
  assert.ok(ranked.findIndex((item) => item.id === "missing") > ranked.findIndex((item) => item.id === "mid"));
});

test("supports explicit multi-field sorting inside AND/OR buckets", () => {
  const query = parseQuery(".NET developer");
  const ranked = rankJobs([job("b", ".NET Developer", { min: 5000, currency: "USD", period: "month" }, { company: "Zulu" }), job("a", ".NET Developer", { min: 5000, currency: "USD", period: "month" }, { company: "Alpha" })], query, { sort: [{ field: "company", direction: "asc" }, { field: "salaryMonthlyUsd", direction: "desc" }] });
  assert.deepEqual(ranked.map((item) => item.company), ["Alpha", "Zulu"]);
});

test("suspicious vacancies are demoted regardless of salary and AND match", () => {
  const query = parseQuery(".NET developer remote от 4000$ в месяц");
  const ranked = rankJobs([
    job("safe", ".NET Developer", { min: 5000, currency: "USD", period: "month" }),
    job("scam", ".NET Developer", { min: 20000, currency: "USD", period: "month" }, { verification: { score: 5, status: "suspicious" } }),
    job("partial", "Java Developer", { min: 7000, currency: "USD", period: "month" }),
  ], query, { sort: [{ field: "salaryMonthlyUsd", direction: "desc" }] });
  assert.equal(ranked[0].id, "safe");
  assert.equal(ranked.at(-1).id, "scam");
});

test("relevance gate rejects a different technology that only shares a generic role", () => {
  const query = parseQuery(".NET разработчик удалённо от 4000$ в месяц");
  const ranked = rankJobs([
    job("dotnet", "Software Engineer", { min: 80_000, currency: "USD", period: "year" }, { description: "Build ASP.NET and C# services." }),
    job("java", "Java Developer", { min: 120_000, currency: "USD", period: "year" }, { description: "Build Spring services and collaborate with .NET teams." }),
  ], query);
  assert.equal(isRelevantMatch(ranked.find((item) => item.id === "dotnet"), query), true);
  assert.equal(isRelevantMatch(ranked.find((item) => item.id === "java"), query), false);
});
