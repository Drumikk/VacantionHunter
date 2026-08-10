import assert from "node:assert/strict";
import test from "node:test";
import { careerPageConnectors, extractJobLinks, extractTeamtailorWidgetKeys, parseJsonLdJobs } from "../src/connectors/career-page.js";

const query = { raw: ".NET developer remote", role: ".NET developer", skills: [".net"], remote: true, relocation: false, locations: [] };
const entry = { id: "example", name: "Example", url: "https://example.test/careers", regions: ["global-remote"] };
const source = { id: "career-page:example", name: "Example", adapter: "career-page" };

test("normalizes schema.org JobPosting JSON-LD from a career page", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: { value: "job-42" },
    title: "Senior .NET Developer",
    description: "<p>ASP.NET Core. Remote with relocation support.</p>",
    hiringOrganization: { "@type": "Organization", name: "Example Inc" },
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "Europe" },
    employmentType: "FULL_TIME",
    datePosted: "2026-08-01",
    validThrough: "2026-09-01",
    baseSalary: { currency: "EUR", value: { minValue: 90000, maxValue: 110000, unitText: "YEAR" } },
    url: "/jobs/job-42",
  })}</script>`;

  const [job] = parseJsonLdJobs(html, { entry, pageUrl: entry.url, source });
  assert.equal(job.externalId, "job-42");
  assert.equal(job.company, "Example Inc");
  assert.equal(job.url, "https://example.test/jobs/job-42");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 90000, max: 110000, currency: "EUR", period: "year", explicit: true });
});

test("extracts job-looking links without treating social and navigation links as vacancies", () => {
  const links = extractJobLinks(`
    <a href="/careers">Careers</a>
    <a href="/jobs/42">Senior .NET Developer</a>
    <a href="https://linkedin.com/company/example">Software Engineer</a>
    <a href="/about">About us</a>
  `, entry.url);
  assert.deepEqual(links, [{ title: "Senior .NET Developer", url: "https://example.test/jobs/42" }]);
});

test("discovers a public Teamtailor widget and reads its public jobs feed", async () => {
  const teamtailorEntry = { id: "anna", name: "ANNA Money", url: "https://anna.test/careers" };
  const apiKey = "public-widget-key";
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url) === teamtailorEntry.url) {
      return new Response(`<div class="teamtailor-jobs-widget" data-teamtailor-api-key="${apiKey}"></div>`, { headers: { "content-type": "text/html" } });
    }
    return new Response(JSON.stringify({
      data: [{
        type: "jobs",
        id: "job-7",
        attributes: {
          title: "Senior .NET Developer",
          body: "ASP.NET Core and relocation support",
          "company-name": "ANNA Money",
          "remote-status": "fully",
          "employment-type": "Full time",
          "created-at": "2026-08-09T10:00:00Z",
        },
        relationships: { locations: { data: [{ type: "locations", id: "location-1" }] } },
        links: { "careersite-job-url": "https://jobs.anna.test/senior-dotnet-developer" },
      }],
      included: [{ type: "locations", id: "location-1", attributes: { name: "London" } }],
      links: {},
    }), { headers: { "content-type": "application/vnd.api+json" } });
  };

  assert.deepEqual(extractTeamtailorWidgetKeys(`<div data-teamtailor-api-key='${apiKey}'></div>`), [apiKey]);
  const [connector] = careerPageConnectors({
    careerPages: [teamtailorEntry],
    fetchImpl,
    requestTimeoutMs: 1_000,
    careerPageTimeoutMs: 1_000,
    maxJobsPerSource: 20,
    maxGenericDetailPages: 1,
    httpUserAgent: "VacationHunter/test",
  });
  const [job] = await connector.search(query);
  assert.equal(job.title, "Senior .NET Developer");
  assert.equal(job.company, "ANNA Money");
  assert.equal(job.location, "London");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.ok(requests.some((url) => url.startsWith("https://api.teamtailor.com/v1/jobs?") && url.includes("api_key=public-widget-key")));
  assert.equal(connector.getDiagnostics().teamtailorJobs, 1);
});

test("career-page connector follows only candidate job details and caches the index page", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url) === entry.url) {
      return new Response(`
        <html><head><title>Example Careers</title></head><body>
          <a href="/jobs/dotnet">Senior .NET Developer</a>
          <a href="/jobs/java">Java Developer</a>
        </body></html>
      `, { headers: { "content-type": "text/html" } });
    }
    if (String(url).endsWith("/jobs/dotnet")) {
      return new Response(`<html><body><h1>Senior .NET Developer</h1><p>ASP.NET Core, remote worldwide, relocation assistance.</p></body></html>`, { headers: { "content-type": "text/html" } });
    }
    return new Response(`<html><body><h1>Java Developer</h1><p>Spring and JVM.</p></body></html>`, { headers: { "content-type": "text/html" } });
  };

  const [connector] = careerPageConnectors({
    careerPages: [entry],
    fetchImpl,
    requestTimeoutMs: 1_000,
    careerPageTimeoutMs: 1_000,
    careerPageCacheMs: 60_000,
    careerPageMaxBytes: 100_000,
    maxGenericDetailPages: 2,
    atsDetailConcurrency: 2,
    maxJobsPerSource: 20,
    httpUserAgent: "VacationHunter/test",
  });

  const [job] = await connector.search(query);
  assert.equal(job.title, "Senior .NET Developer");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.equal(job.url, "https://example.test/jobs/dotnet");
  assert.equal(requests.filter((url) => url === entry.url).length, 1);
  assert.deepEqual(connector.getDiagnostics(), {
    resolvedUrl: entry.url,
    contentType: "text/html",
    jsonLdJobs: 0,
    teamtailorJobs: 0,
    jobLinks: 2,
    detailCandidates: 2,
    matched: 1,
    warnings: [],
  });

  await connector.search(query);
  assert.equal(requests.filter((url) => url === entry.url).length, 1, "the careers index should be cached between searches");
});
