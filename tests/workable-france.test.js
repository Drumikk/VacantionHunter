import assert from "node:assert/strict";
import test from "node:test";
import { workableConnectors } from "../src/connectors/workable.js";
import { franceTravailConnector } from "../src/connectors/france-travail.js";
import { theMuseConnector } from "../src/connectors/the-muse.js";

const query = { raw: ".NET developer remote relocation", role: ".NET developer", skills: [".net"], remote: true, relocation: true, locations: [] };

function config(overrides = {}) {
  return {
    requestTimeoutMs: 1_000,
    atsRequestTimeoutMs: 1_000,
    httpUserAgent: "VacationHunter/test",
    maxJobsPerSource: 20,
    aggregatorCacheMs: 60_000,
    workableBoards: [],
    ...overrides,
  };
}

test("Workable expands public company boards and maps published jobs", async () => {
  const connectors = workableConnectors(config({
    workableBoards: [
      { slug: "worknomads", name: "WorkNomads", regions: ["europe"] },
      { slug: "azumo", name: "Azumo", regions: ["latin-america"] },
    ],
    fetchImpl: async (url) => {
      const requested = new URL(url);
      assert.equal(requested.hostname, "www.workable.com");
      assert.equal(requested.searchParams.get("details"), "true");
      return Response.json({ jobs: [{
        shortcode: "ABC123", title: "Senior .NET Developer", description: "ASP.NET remote role. Relocation support. USD 100000 - 120000 per year.",
        employment_type: "Full-time", telecommuting: true, department: "Engineering", experience: "Mid-Senior level",
        url: "https://apply.workable.com/j/ABC123", application_url: "https://apply.workable.com/j/ABC123/apply",
        published_on: "2026-07-30", locations: [{ city: "Sofia", country: "Bulgaria" }],
      }] });
    },
  }));

  assert.equal(connectors.length, 2);
  assert.equal(connectors[0].id, "workable:worknomads");
  const [job] = await connectors[0].search(query);
  assert.equal(job.id, "workable:worknomads:ABC123");
  assert.equal(job.company, "WorkNomads");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.equal(job.applyUrl, "https://apply.workable.com/j/ABC123/apply");
  assert.deepEqual(job.salary, { min: 100000, max: 120000, currency: "USD", period: "year", explicit: true });
});

test("France Travail obtains one OAuth token and maps official vacancy search", async () => {
  assert.equal(franceTravailConnector(config()).enabled, false);
  const clientId = "france-client";
  const clientSecret = "france-secret";
  let tokenCalls = 0;
  let searchCalls = 0;
  const connector = franceTravailConnector(config({
    franceTravailClientId: clientId,
    franceTravailClientSecret: clientSecret,
    franceTravailTokenUrl: "https://auth.example.test/token",
    franceTravailSearchUrl: "https://api.example.test/search",
    fetchImpl: async (url, options) => {
      const requested = new URL(url);
      if (requested.hostname === "auth.example.test") {
        tokenCalls += 1;
        assert.equal(options.method, "POST");
        const body = new URLSearchParams(options.body);
        assert.equal(body.get("client_id"), clientId);
        assert.equal(body.get("client_secret"), clientSecret);
        assert.match(body.get("scope"), /api_offresdemploiv2/);
        return Response.json({ access_token: "oauth-token", expires_in: 1_500 });
      }
      searchCalls += 1;
      assert.equal(options.headers.Authorization, "Bearer oauth-token");
      assert.match(requested.searchParams.get("motsCles"), /\.net/i);
      assert.equal(requested.searchParams.get("range"), "0-19");
      return Response.json({ resultats: [{
        id: "177ABCD", intitule: "Développeur .NET", description: "ASP.NET. Télétravail avec aide à la mobilité et au déménagement.",
        dateCreation: "2026-07-30T10:00:00Z", dateActualisation: "2026-07-31T10:00:00Z",
        entreprise: { nom: "Société Exemple" }, lieuTravail: { libelle: "75 - Paris" },
        typeContratLibelle: "CDI", experienceLibelle: "5 ans", competences: [{ libelle: "C#" }],
        salaire: { libelle: "Annuel de 50000 EUR à 70000 EUR" }, origineOffre: { urlOrigine: "https://example.test/jobs/177ABCD" },
      }] });
    },
  }));

  const [first] = await connector.search(query);
  await connector.search({ ...query, raw: `${query.raw} Paris` });
  assert.equal(tokenCalls, 1);
  assert.equal(searchCalls, 2);
  assert.equal(JSON.stringify(connector).includes(clientSecret), false);
  assert.equal(first.id, "france-travail:177ABCD");
  assert.equal(first.company, "Société Exemple");
  assert.equal(first.remote, true);
  assert.equal(first.relocation, true);
  assert.equal(first.url, "https://example.test/jobs/177ABCD");
});

test("The Muse selects relevant API categories, maps jobs, and caches pages", async () => {
  const requested = [];
  const connector = theMuseConnector(config({
    theMuseApiKey: "muse-test-key",
    theMusePages: 2,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed);
      assert.equal(parsed.hostname, "www.themuse.com");
      assert.equal(parsed.pathname, "/api/public/jobs");
      assert.equal(parsed.searchParams.get("api_key"), "muse-test-key");
      return Response.json({ results: [{
        id: 21895188,
        name: "Senior .NET Developer",
        contents: "<p>Build ASP.NET services. Flexible / Remote. Relocation Assistance. Salary $150,000 - $160,000 annually.</p>",
        publication_date: "2026-07-30T10:00:00Z",
        type: "external",
        locations: [{ name: "Flexible / Remote" }],
        categories: [{ name: "Software Engineering" }],
        levels: [{ name: "Senior Level" }],
        refs: { landing_page: "https://www.themuse.com/jobs/example/senior-net-developer" },
        company: { name: "Example Corp" },
      }] });
    },
  }));

  const [job] = await connector.search(query);
  await connector.search(query);
  assert.equal(requested.length, 4);
  assert.deepEqual([...new Set(requested.map((url) => url.searchParams.get("category")))], ["Software Engineering", "Computer and IT"]);
  assert.equal(job.id, "the-muse:21895188");
  assert.equal(job.company, "Example Corp");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.equal(job.url, "https://www.themuse.com/jobs/example/senior-net-developer");
  assert.deepEqual(job.salary, { min: 150000, max: 160000, currency: "USD", period: "year", explicit: true });
  assert.deepEqual(connector.getDiagnostics(), { requestedPages: 4, loadedPages: 4, warnings: [] });
});
