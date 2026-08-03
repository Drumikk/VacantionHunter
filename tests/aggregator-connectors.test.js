import test from "node:test";
import assert from "node:assert/strict";
import { joobleConnector } from "../src/connectors/jooble.js";
import { usajobsConnector } from "../src/connectors/usajobs.js";
import { careerOneStopConnector } from "../src/connectors/careeronestop.js";
import { parseQuery } from "../src/core/query-parser.js";
import { monthlyUsd } from "../src/core/salary.js";

function config(overrides = {}) {
  return {
    requestTimeoutMs: 1_000,
    maxJobsPerSource: 20,
    httpUserAgent: "VacationHunter/test",
    aggregatorCacheMs: 60_000,
    joobleApiKey: "",
    usajobsApiKey: "",
    usajobsEmail: "",
    careerOneStopUserId: "",
    careerOneStopApiToken: "",
    atsRequestTimeoutMs: 1_000,
    atsDetailConcurrency: 2,
    maxJobsScannedPerSource: 100,
    ...overrides,
  };
}

test("Jooble is disabled without a key and maps its authenticated aggregator response", async () => {
  const disabled = joobleConnector(config());
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.regions.includes("russia-cis"), false);
  assert.match(disabled.note, /прекратил работу в РФ/);
  let calls = 0;
  let request = null;
  const connector = joobleConnector(config({
    joobleApiKey: "secret-key",
    fetchImpl: async (url, options) => {
      calls += 1;
      request = { url, options };
      return new Response(JSON.stringify({ jobs: [{
        id: 42,
        title: "Python Backend Developer",
        location: "Berlin / Remote",
        snippet: "<b>Python</b> APIs and PostgreSQL",
        salary: "60000 - 80000 EUR",
        source: "Partner board",
        type: "Full-time",
        link: "https://example.test/jobs/42",
        company: "Example GmbH",
        updated: "2026-07-29T10:00:00Z",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  }));

  const query = parseQuery("Python developer remote Berlin");
  const [job] = await connector.search(query);
  await connector.search(query);

  assert.equal(calls, 1, "same query should use the credential-aware connector cache");
  assert.match(request.url, /^https:\/\/jooble\.org\/api\/secret-key$/);
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    keywords: "python developer remote",
    location: "berlin",
    page: "1",
    ResultOnPage: "20",
    companysearch: "false",
  });
  assert.equal(job.id, "jooble:42");
  assert.equal(job.description, "Python APIs and PostgreSQL");
  assert.equal(job.providerSource, "Partner board");
  assert.equal(job.remote, true);
  assert.equal(job.salary.period, null);
  assert.equal(monthlyUsd(job.salary).known, false, "unknown salary period must not distort ranking");
});

test("USAJOBS uses required API headers and maps official job fields", async () => {
  assert.equal(usajobsConnector(config()).enabled, false);
  let request = null;
  const connector = usajobsConnector(config({
    usajobsApiKey: "api-key",
    usajobsEmail: "owner@example.test",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ SearchResult: { SearchResultItems: [{
        MatchedObjectId: "100",
        MatchedObjectDescriptor: {
          PositionID: "ABC-100",
          PositionTitle: "IT Specialist",
          PositionURI: "https://www.usajobs.gov/job/100",
          ApplyURI: ["https://www.usajobs.gov/job/100/apply"],
          PositionLocationDisplay: "Anywhere in the U.S. (remote job)",
          OrganizationName: "Federal Example Agency",
          PositionSchedule: [{ Name: "Full Time" }],
          QualificationSummary: "Build secure information systems.",
          PositionRemuneration: [{ MinimumRange: "90000", MaximumRange: "120000", RateIntervalCode: "PA" }],
          PublicationStartDate: "2026-07-28T00:00:00Z",
          ApplicationCloseDate: "2026-08-15T00:00:00Z",
          UserArea: { Details: { JobSummary: "Remote federal technology role." } },
        },
      }] } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  }));

  const [job] = await connector.search(parseQuery("IT специалист remote USA"));

  assert.match(request.url, /RemoteIndicator=True/);
  assert.equal(request.options.headers["Authorization-Key"], "api-key");
  assert.equal(request.options.headers["User-Agent"], "owner@example.test");
  assert.equal(job.id, "usajobs:ABC-100");
  assert.equal(job.companyVerified, true);
  assert.deepEqual(job.salary, { min: 90000, max: 120000, currency: "USD", period: "year" });
  assert.equal(job.remote, true);
  assert.equal(job.validThrough, "2026-08-15T00:00:00Z");
});

test("USAJOBS does not issue a US-only request for an explicit non-US location", async () => {
  let calls = 0;
  const connector = usajobsConnector(config({
    usajobsApiKey: "api-key",
    usajobsEmail: "owner@example.test",
    fetchImpl: async () => { calls += 1; return new Response("{}"); },
  }));

  assert.deepEqual(await connector.search(parseQuery("Python developer Германия")), []);
  assert.equal(calls, 0);
});

test("CareerOneStop authenticates with a bearer token, loads relevant details, and caches the query", async () => {
  assert.equal(careerOneStopConnector(config()).enabled, false);
  const requests = [];
  const token = "career-secret-token";
  const connector = careerOneStopConnector(config({
    careerOneStopUserId: "api-owner@example.test",
    careerOneStopApiToken: token,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requests.push(parsed);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      if (parsed.pathname.split("/").length > 10) {
        assert.match(decodeURIComponent(parsed.pathname), /\/v2\/jobsearch\/api-owner@example\.test\/python developer\/0\/100\/acquisitiondate\/DESC\/0\/100\/60$/);
        assert.equal(parsed.searchParams.get("enableJobDescriptionSnippet"), "true");
        return Response.json({ Jobs: [
          { JvId: "JV-42", JobTitle: "Senior Python Developer", Company: "Example Corp", DescriptionSnippet: "Python APIs and remote work", AcquisitionDate: "2026-07-30", URL: "https://example.test/jobs/42", Location: "Denver, CO", OnetCodes: ["15-1252.00"] },
          { JvId: "JV-43", JobTitle: "Registered Nurse", Company: "Clinic", DescriptionSnippet: "Patient care", AcquisitionDate: "2026-07-30", URL: "https://example.test/jobs/43", Location: "Denver, CO" },
        ] });
      }
      assert.equal(decodeURIComponent(parsed.pathname), "/v2/jobsearch/api-owner@example.test/JV-42");
      assert.equal(parsed.searchParams.get("isHtml"), "false");
      return Response.json({
        JobTitle: "Senior Python Developer",
        Company: "Example Corp",
        Description: "Build Python APIs. Remote role. Salary $120,000 - $150,000 annually.",
        AcquisitionDate: "2026-07-30",
        URL: "https://example.test/jobs/42",
        Location: "United States / Remote",
        OnetCodes: ["15-1252.00"],
      });
    },
  }));

  const query = parseQuery("Python developer remote USA");
  const [job] = await connector.search(query);
  await connector.search(query);

  assert.equal(requests.length, 2, "the same query should reuse the aggregator cache");
  assert.equal(job.id, "careeronestop:JV-42");
  assert.equal(job.remote, true);
  assert.deepEqual(job.salary, { min: 120_000, max: 150_000, currency: "USD", period: "year", explicit: true });
  assert.deepEqual(connector.getDiagnostics(), { scanned: 2, detailCandidates: 1, detailsLoaded: 1, matched: 1, warnings: [] });
  assert.equal(JSON.stringify(connector).includes(token), false);
});

test("CareerOneStop does not issue a US-only request for an explicit non-US location", async () => {
  let calls = 0;
  const connector = careerOneStopConnector(config({
    careerOneStopUserId: "owner",
    careerOneStopApiToken: "token",
    fetchImpl: async () => { calls += 1; return Response.json({ Jobs: [] }); },
  }));

  assert.deepEqual(await connector.search(parseQuery("Python developer Germany")), []);
  assert.equal(calls, 0);
});
