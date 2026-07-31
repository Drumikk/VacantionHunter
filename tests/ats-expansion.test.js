import assert from "node:assert/strict";
import test from "node:test";
import { personioConnectors } from "../src/connectors/personio.js";
import { smartRecruitersConnectors } from "../src/connectors/smartrecruiters.js";

const query = { raw: ".NET developer remote", role: ".NET developer", skills: [".net"], remote: true, relocation: false, locations: [] };

function config(overrides = {}) {
  return {
    requestTimeoutMs: 1_000,
    atsRequestTimeoutMs: 1_000,
    atsDetailConcurrency: 2,
    httpUserAgent: "VacationHunter/test",
    maxJobsPerSource: 20,
    maxJobsScannedPerSource: 100,
    personioBoards: [],
    smartRecruitersCompanies: [],
    ...overrides,
  };
}

test("Personio expands public XML feeds and maps current positions", async () => {
  const [connector] = personioConnectors(config({
    personioBoards: [{ slug: "example", name: "Example GmbH", regions: ["europe"] }],
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.hostname, "example.jobs.personio.de");
      assert.equal(parsed.pathname, "/xml");
      assert.equal(parsed.searchParams.get("language"), "en");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><workzag-jobs>
        <position><id>42</id><office>Remote Germany</office><department>Engineering</department><name>Senior .NET Developer</name>
        <jobDescriptions><jobDescription><name>Your mission</name><value><![CDATA[Build ASP.NET services. Relocation assistance. EUR 90,000 - 110,000 annually.]]></value></jobDescription></jobDescriptions>
        <employmentType>permanent</employmentType><schedule>full-time</schedule><seniority>experienced</seniority><createdAt>2026-07-30T10:00:00Z</createdAt></position>
        <position><id>43</id><office>Berlin</office><name>Java Developer</name><jobDescriptions><jobDescription><value>Spring</value></jobDescription></jobDescriptions></position>
      </workzag-jobs>`, { headers: { "content-type": "text/xml" } });
    },
  }));

  const [job] = await connector.search(query);
  assert.equal(job.id, "personio:example:42");
  assert.equal(job.company, "Example GmbH");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.equal(job.url, "https://example.jobs.personio.de/job/42?language=en");
  assert.deepEqual(job.salary, { min: 90_000, max: 110_000, currency: "EUR", period: "year", explicit: true });
});

test("SmartRecruiters searches index, loads only relevant details, and maps compensation", async () => {
  const requested = [];
  const apiKey = "smart-test-key";
  const [connector] = smartRecruitersConnectors(config({
    smartRecruitersApiKey: apiKey,
    smartRecruitersCompanies: [{ slug: "Example", name: "Example Inc", regions: ["north-america"] }],
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requested.push(parsed);
      assert.equal(options.headers["X-SmartToken"], apiKey);
      if (parsed.pathname.endsWith("/postings")) {
        assert.match(parsed.searchParams.get("q"), /\.net developer/i);
        return Response.json({ content: [
          { id: "java", name: "Java Developer", function: { label: "Engineering" } },
          { id: "dotnet", name: "Senior .NET Developer", location: { city: "Toronto", country: "ca", remote: true }, function: { label: "Engineering" } },
        ] });
      }
      assert.match(parsed.pathname, /\/postings\/dotnet$/);
      return Response.json({ id: "dotnet", name: "Senior .NET Developer", active: true, releasedDate: "2026-07-30T10:00:00Z",
        company: { name: "Example Inc" }, location: { city: "Toronto", country: "ca", remote: true }, function: { label: "Engineering" },
        typeOfEmployment: { label: "Full-time" }, experienceLevel: { label: "Senior" },
        postingUrl: "https://jobs.smartrecruiters.com/Example/dotnet", applyUrl: "https://jobs.smartrecruiters.com/Example/dotnet?apply=true",
        compensation: { min: 120_000, max: 150_000, currency: "CAD", period: "YEARLY" },
        jobAd: { sections: { jobDescription: { text: "ASP.NET remote services." }, qualifications: { text: "C# and .NET" } } },
      });
    },
  }));

  const [job] = await connector.search(query);
  assert.equal(requested.length, 2);
  assert.equal(job.id, "smartrecruiters:Example:dotnet");
  assert.equal(job.remote, true);
  assert.equal(job.applyUrl, "https://jobs.smartrecruiters.com/Example/dotnet?apply=true");
  assert.deepEqual(job.salary, { min: 120_000, max: 150_000, currency: "CAD", period: "year" });
  assert.equal(JSON.stringify(connector).includes(apiKey), false);
  assert.deepEqual(connector.getDiagnostics(), { scanned: 2, detailCandidates: 1, detailsLoaded: 1, matched: 1, warnings: [] });
});
