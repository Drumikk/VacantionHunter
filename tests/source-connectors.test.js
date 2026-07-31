import test from "node:test";
import assert from "node:assert/strict";
import { ashbyConnectors } from "../src/connectors/ashby.js";
import { greenhouseConnectors } from "../src/connectors/greenhouse.js";
import { leverConnectors } from "../src/connectors/lever.js";
import { inferRelocation, inferRemote } from "../src/core/mobility.js";
import { parseQuery } from "../src/core/query-parser.js";
import { scoreJob } from "../src/core/ranker.js";
import { retrievalMatches, sourceSearchTerms } from "../src/core/source-query.js";

const targetQuery = parseQuery(".NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией");

function baseConfig(overrides = {}) {
  return {
    requestTimeoutMs: 1_000,
    atsRequestTimeoutMs: 1_000,
    httpUserAgent: "VacationHunter/test",
    maxJobsPerSource: 100,
    maxJobsScannedPerSource: 20,
    atsIndexPageSize: 20,
    ...overrides,
  };
}

test("translates Russian role terms for international source searches", () => {
  assert.equal(sourceSearchTerms(targetQuery), ".net developer");
  assert.equal(sourceSearchTerms(targetQuery, { includeRemote: true }), ".net developer remote");
  assert.equal(retrievalMatches({ title: "Senior C# Engineer", description: "ASP.NET Core" }, targetQuery), true);
  assert.equal(retrievalMatches({ title: "Senior Java Engineer", description: "Spring" }, targetQuery), false);
});

test("infers mobility promises but respects explicit negative statements", () => {
  assert.equal(inferRemote("Remote-first team"), true);
  assert.equal(inferRemote("This is not a remote position"), false);
  assert.equal(inferRelocation("We cover relocation and provide visa sponsorship"), true);
  assert.equal(inferRelocation("We do not provide relocation or visa sponsorship"), false);
  assert.equal(inferRemote("Télétravail possible en France"), true);
  assert.equal(inferRelocation("Aide à la mobilité et au déménagement"), true);
});

test("Ashby mapping produces a complete match for remote paid .NET relocation", async () => {
  const [connector] = ashbyConnectors(baseConfig({
    ashbyBoards: [{ slug: "target", name: "Target" }],
    fetchImpl: async () => new Response(JSON.stringify({ jobs: [{
      isListed: true,
      title: "Software Engineer, Windows AI Automation",
      descriptionPlain: "Build Windows and .NET systems. We will cover relocation and visa sponsorship.",
      jobUrl: "https://jobs.example.test/one",
      applyUrl: "https://jobs.example.test/one/apply",
      location: "Remote",
      isRemote: true,
      employmentType: "FullTime",
      compensation: { summaryComponents: [{ compensationType: "Salary", interval: "YEAR", minValue: 160_000, maxValue: 300_000, currencyCode: "USD" }] },
      publishedAt: "2026-07-29T00:00:00Z",
    }] }), { headers: { "content-type": "application/json" } }),
  }));

  const [job] = await connector.search(targetQuery);
  const scored = scoreJob(job, targetQuery);
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 160_000, max: 300_000, currency: "USD", period: "year" });
  assert.equal(scored.andMatch, true);
  assert.equal(scored.salaryMonthlyUsd, 13_333);
});

test("Greenhouse fetches details only for title/metadata candidates", async () => {
  const requested = [];
  const [connector] = greenhouseConnectors(baseConfig({
    greenhouseBoards: [{ slug: "target", name: "Target" }],
    fetchImpl: async (url) => {
      requested.push(String(url));
      if (String(url).endsWith("/jobs?content=false")) {
        return new Response(JSON.stringify({ jobs: [
          { id: 1, title: "Java Engineer", absolute_url: "https://jobs.example.test/1", location: { name: "Remote" } },
          { id: 2, title: "Senior .NET Developer", absolute_url: "https://jobs.example.test/2", location: { name: "Remote" } },
        ] }), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: 2, title: "Senior .NET Developer", absolute_url: "https://jobs.example.test/2", location: { name: "Remote" }, content: "ASP.NET Core. $80000 - $100000 per year. Relocation support provided.", updated_at: "2026-07-29T00:00:00Z" }), { headers: { "content-type": "application/json" } });
    },
  }));

  const [job] = await connector.search(targetQuery);
  assert.equal(requested.length, 2);
  assert.match(requested[1], /\/jobs\/2$/);
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 80_000, max: 100_000, currency: "USD", period: "year", explicit: true });
  assert.deepEqual(connector.getDiagnostics(), { stage: "details", scanned: 2, detailCandidates: 1, detailsLoaded: 1, warnings: [] });
});

test("Greenhouse reports a failed detail without losing the index candidate", async () => {
  const [connector] = greenhouseConnectors(baseConfig({
    greenhouseBoards: [{ slug: "target", name: "Target" }],
    fetchImpl: async (url) => {
      if (String(url).endsWith("/jobs?content=false")) {
        return new Response(JSON.stringify({ jobs: [{ id: 7, title: ".NET Developer", absolute_url: "https://jobs.example.test/7", location: { name: "Remote" } }] }), { headers: { "content-type": "application/json" } });
      }
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  }));

  const [job] = await connector.search(targetQuery);
  assert.equal(job.id, "greenhouse:target:7");
  assert.equal(connector.getDiagnostics().detailsLoaded, 0);
  assert.equal(connector.getDiagnostics().warnings[0].postingId, 7);
});

test("Lever paginates, uses structured salary and filters after scanning", async () => {
  const requested = [];
  const rows = [
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", text: "Java Engineer", descriptionPlain: "Spring", hostedUrl: "https://jobs.example.test/java", categories: { location: "Remote" } },
    { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", text: ".NET Developer", descriptionPlain: "C# and ASP.NET. Relocation assistance provided.", hostedUrl: "https://jobs.example.test/dotnet", workplaceType: "remote", categories: { location: "Worldwide", commitment: "Full-time" }, salaryRange: { min: 90_000, max: 120_000, currency: "USD", interval: "per-year-salary" } },
  ];
  const [connector] = leverConnectors(baseConfig({
    leverSites: [{ slug: "target", name: "Target" }],
    fetchImpl: async (url) => {
      requested.push(String(url));
      const parsed = new URL(url);
      if (parsed.searchParams.get("mode") === "html") {
        return new Response(`<ul><li><a href="https://jobs.lever.co/target/${rows[0].id}">Java Engineer</a></li><li><a href="https://jobs.lever.co/target/${rows[1].id}">.NET Developer</a></li></ul>`, { headers: { "content-type": "text/html" } });
      }
      return new Response(JSON.stringify(String(url).includes(rows[0].id) ? rows[0] : rows[1]), { headers: { "content-type": "application/json" } });
    },
  }));

  const [job] = await connector.search(targetQuery);
  assert.equal(requested.length, 3);
  assert.equal(job.id, `lever:target:${rows[1].id}`);
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 90_000, max: 120_000, currency: "USD", period: "year" });
});

test("Lever records and skips one failed posting page without losing later matches", async () => {
  const failedId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const matchId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const [connector] = leverConnectors(baseConfig({
    leverSites: [{ slug: "target", name: "Target" }],
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get("mode") === "html") return new Response(`<a href="https://jobs.lever.co/target/${failedId}">Software Engineer</a><a href="https://jobs.lever.co/target/${matchId}">.NET Developer</a>`);
      if (String(url).includes(failedId)) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return new Response(JSON.stringify({
        id: matchId, text: ".NET Developer", descriptionPlain: "ASP.NET. Relocation support provided.", hostedUrl: "https://jobs.example.test/dotnet",
        workplaceType: "remote", categories: { location: "Remote" }, salaryRange: { min: 60_000, max: 90_000, currency: "USD", interval: "per-year-salary" },
      }), { headers: { "content-type": "application/json" } });
    },
  }));

  const [job] = await connector.search(targetQuery);
  assert.equal(job.id, `lever:target:${matchId}`);
  assert.equal(connector.getDiagnostics().completed, true);
  assert.equal(connector.getDiagnostics().warnings.length, 1);
  assert.equal(connector.getDiagnostics().warnings[0].postingId, failedId);
});
