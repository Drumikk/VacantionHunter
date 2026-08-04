import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jobMarketFinlandConnector } from "../src/connectors/job-market-finland.js";
import { restrictedConnectors } from "../src/connectors/restricted.js";
import { parseQuery } from "../src/core/query-parser.js";

function config(overrides = {}) {
  return {
    jobMarketFinlandApiKey: "",
    requestTimeoutMs: 1_000,
    atsRequestTimeoutMs: 1_000,
    maxJobsPerSource: 20,
    httpUserAgent: "VacationHunter/test",
    jobMarketFinlandMaxResponseBytes: 2_000_000,
    ...overrides,
  };
}

function posting(id, { title, description, company, modified, archived = null, salary = "" }) {
  return {
    languages: ["en", "fi"],
    descriptionsContentType: "plain",
    metadata: { externalId: id, created: "2026-08-01T08:00:00Z", lastModified: modified, archived },
    owner: { company: { en: company }, businessId: "1234567-8" },
    position: {
      title: { en: title }, jobDescription: { en: description }, mainOccupation: title,
      skills: ["http://data.europa.eu/esco/skill/example"], employmentRelationship: "01",
      continuityOfWork: ["01"], workTime: "01", wagePrincipalInfo: { en: salary },
    },
    location: { countries: ["FI"], workplaceName: { en: "Helsinki office" }, workplacePostOffice: "Helsinki" },
    application: {
      published: "2026-08-01T08:00:00Z", expires: "2026-09-01T20:59:59Z",
      url: { en: `https://apply.example.test/${id}` },
    },
  };
}

function ndjson(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

test("Job Market Finland is disabled until KEHA issues a subscription key", async () => {
  const connector = jobMarketFinlandConnector(config());
  assert.equal(connector.enabled, false);
  assert.equal(connector.authType, "subscription_key");
  assert.deepEqual(connector.credentialFields, ["JOBMARKET_FINLAND_API_KEY"]);
  await assert.rejects(connector.search(parseQuery("software engineer")), /API key is required/);
});

test("Job Market Finland imports a full NDJSON snapshot and then applies published and archived deltas", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-finland-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "finland-state.json");
  const softwareId = "11111111-1111-4111-8111-111111111111";
  const nurseId = "22222222-2222-4222-8222-222222222222";
  const requests = [];
  const initialSoftware = posting(softwareId, {
    title: "Senior Software Engineer", description: "Build a remote cloud platform. Relocation support is available.",
    company: "Suomi Product Oy", modified: "2026-08-02T10:00:00Z", salary: "€5,000 - €6,000 per month",
  });
  const nurse = posting(nurseId, {
    title: "Registered Nurse", description: "Hospital role", company: "Care Oy", modified: "2026-08-02T11:00:00Z",
  });

  const fetchImpl = async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.headers["KIPA-Subscription-Key"], "finland-secret");
    assert.equal(options.headers.Accept, "application/x-ndjson");
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      assert.deepEqual(body, { onlyStatus: "PUBLISHED" });
      return new Response(ndjson([initialSoftware, nurse]), { headers: { "content-type": "application/x-ndjson" } });
    }
    if (body.onlyStatus === "PUBLISHED") {
      assert.ok(body.modified.from);
      assert.ok(body.modified.to);
      return new Response(ndjson([posting(softwareId, {
        title: "Senior Software Engineer", description: "Updated remote platform role.", company: "Suomi Product Oy",
        modified: "2026-08-04T09:00:00Z", salary: "€5,500 per month",
      })]), { headers: { "content-type": "application/x-ndjson" } });
    }
    assert.equal(body.onlyStatus, "ARCHIVED");
    assert.ok(body.archived.from);
    assert.ok(body.archived.to);
    return new Response(ndjson([posting(nurseId, {
      title: "Registered Nurse", description: "Hospital role", company: "Care Oy",
      modified: "2026-08-04T09:30:00Z", archived: "2026-08-04T09:30:00Z",
    })]), { headers: { "content-type": "application/x-ndjson" } });
  };

  const connector = jobMarketFinlandConnector(config({
    jobMarketFinlandApiKey: "finland-secret", jobMarketFinlandStatePath: statePath, fetchImpl,
  }));
  const query = parseQuery("software engineer");
  const initial = await connector.search(query);

  assert.equal(initial.replaceSourceSnapshot, true);
  assert.deepEqual(new Set(initial.changedExternalIds), new Set([softwareId, nurseId]));
  assert.equal(initial.jobs.length, 1);
  assert.equal(initial.jobs[0].title, "Senior Software Engineer");
  assert.equal(initial.jobs[0].company, "Suomi Product Oy");
  assert.equal(initial.jobs[0].location, "Helsinki office, Helsinki, Finland");
  assert.equal(initial.jobs[0].applyUrl, `https://apply.example.test/${softwareId}`);
  assert.equal(initial.jobs[0].url, `https://tyomarkkinatori.fi/en/personal-customers/vacancies/${softwareId}/en`);
  assert.equal(initial.jobs[0].remote, true);
  assert.equal(initial.jobs[0].relocation, true);
  assert.equal(requests.length, 1);

  const replay = await connector.search(query);
  assert.deepEqual(replay, initial);
  assert.equal(requests.length, 1);
  assert.equal(connector.getDiagnostics().replayed, true);

  await connector.acknowledge(initial.syncToken);
  const persisted = await fs.readFile(statePath, "utf8");
  assert.equal(persisted.includes("finland-secret"), false);
  assert.equal(JSON.parse(persisted).pending, null);

  const delta = await connector.search(query);
  assert.equal(delta.replaceSourceSnapshot, false);
  assert.deepEqual(new Set(delta.changedExternalIds), new Set([softwareId, nurseId]));
  assert.equal(delta.jobs.length, 1);
  assert.equal(delta.jobs[0].description, "Updated remote platform role.");
  assert.equal(requests.length, 3);
  assert.deepEqual(connector.getDiagnostics(), { initialized: true, published: 1, archived: 1, active: 1, matched: 1, replayed: false });
});

test("Levels.fyi is registered as partner-only because its terms prohibit job-board scraping", () => {
  const source = restrictedConnectors().find((connector) => connector.id === "levels-fyi");
  assert.ok(source);
  assert.equal(source.enabled, false);
  assert.equal(source.authType, "partner");
  assert.equal(source.attributionUrl, "https://www.levels.fyi/jobs");
  assert.equal(source.setupUrl, "https://www.levels.fyi/api-access/");
  assert.match(source.note, /Terms запрещают scraping/);
});
