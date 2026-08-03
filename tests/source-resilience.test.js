import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson, HttpError } from "../src/connectors/http.js";
import { hhConnector, hhUserAgentDiagnostics } from "../src/connectors/hh.js";
import { joobleConnector } from "../src/connectors/jooble.js";
import { createConnectors } from "../src/connectors/index.js";
import { JobService } from "../src/services/job-service.js";

test("classifies a Cloudflare challenge without retrying a forbidden response", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("<html>challenge</html>", {
      status: 403,
      headers: { "content-type": "text/html", server: "cloudflare", "cf-mitigated": "challenge" },
    });
  };

  await assert.rejects(
    fetchJson("https://jobs.example.test/api", { fetchImpl, retries: 3 }),
    (error) => error instanceof HttpError && error.status === 403 && error.code === "cloudflare_challenge",
  );
  assert.equal(calls, 1);
});

test("HH is explicitly disabled until a User-Agent and application authorization are configured", () => {
  const connector = hhConnector({ hhUserAgent: "" });
  assert.equal(connector.enabled, false);
  assert.match(connector.disabledReason, /HH_USER_AGENT/);

  const missingAuth = hhConnector({ hhUserAgent: "VacationHunter/0.1 (developer@example.com)" });
  assert.equal(missingAuth.enabled, false);
  assert.match(missingAuth.disabledReason, /HH_ACCESS_TOKEN/);
});

test("HH validates its identifying User-Agent without exposing the email", async () => {
  assert.deepEqual(hhUserAgentDiagnostics("VacationHunter/0.1 (developer@example.com)"), { configured: true, formatValid: true });
  assert.deepEqual(hhUserAgentDiagnostics("VacationHunter/0.1 (contact: developer@example.com)"), { configured: true, formatValid: true });
  const connector = hhConnector({ hhUserAgent: "developer@example.com", hhAccessToken: "secret" });
  await assert.rejects(connector.search({ role: ".NET developer", skills: [".net"] }), (error) => error.code === "invalid_config");
  assert.deepEqual(connector.getDiagnostics(), {
    userAgentConfigured: true,
    userAgentFormatValid: false,
    authConfigured: true,
    authMode: "access_token",
    clientCredentialsComplete: false,
  });
});

test("HH sends a configured application access token without exposing it in diagnostics", async () => {
  const secret = "hh-access-secret";
  let authorization;
  const connector = hhConnector({
    hhUserAgent: "VacationHunter/0.1 (developer@example.com)",
    hhAccessToken: secret,
    maxJobsPerSource: 10,
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return Response.json({ items: [] });
    },
  });
  assert.equal(connector.enabled, true);
  await connector.search({ role: ".NET developer", skills: [".net"] });
  assert.equal(authorization, `Bearer ${secret}`);
  assert.equal(JSON.stringify(connector.getDiagnostics()).includes(secret), false);
});

test("HH obtains and caches an application token from client credentials", async () => {
  const calls = [];
  const connector = hhConnector({
    hhUserAgent: "VacationHunter/0.1 (developer@example.com)",
    hhClientId: "client-id",
    hhClientSecret: "client-secret",
    maxJobsPerSource: 10,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://api.hh.ru/token") return Response.json({ access_token: "issued-token" });
      return Response.json({ items: [] });
    },
  });
  await connector.search({ role: ".NET developer", skills: [".net"] });
  await connector.search({ role: ".NET developer", skills: [".net"] });
  const tokenCalls = calls.filter(({ url }) => url === "https://api.hh.ru/token");
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].options.method, "POST");
  assert.match(tokenCalls[0].options.body, /grant_type=client_credentials/);
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer issued-token");
});

test("source circuit breaker skips repeated calls during cooldown", async () => {
  let calls = 0;
  const connector = {
    id: "blocked",
    name: "Blocked source",
    async search() {
      calls += 1;
      throw new HttpError("HTTP 403 (cloudflare_challenge) from blocked.test", {
        status: 403,
        code: "cloudflare_challenge",
        host: "blocked.test",
      });
    },
  };
  const store = { jobs: [], async load() {}, async merge() {} };
  const service = new JobService({
    connectors: [connector],
    store,
    config: {
      sourceAuthCooldownMs: 60_000,
      sourceRateLimitCooldownMs: 30_000,
      sourceErrorCooldownMs: 1_000,
    },
  });

  const first = await service.refresh(".NET developer");
  const second = await service.refresh(".NET developer");

  assert.equal(first[0].status, "rejected");
  assert.equal(second[0].status, "skipped");
  assert.equal(calls, 1);
  assert.equal(service.getSources()[0].status, "cooldown");
  assert.equal(service.getSources()[0].cooldownReason, "cloudflare_challenge");
});

test("refresh limits total source concurrency while preserving report order", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const connectors = Array.from({ length: 7 }, (_, index) => ({
    id: `source-${index}`,
    name: `Source ${index}`,
    async search() {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return [];
    },
  }));
  const service = new JobService({
    connectors,
    store: { jobs: [], async load() {}, async merge() {} },
    config: { sourceConcurrency: 3, sourceAuthCooldownMs: 60_000, sourceRateLimitCooldownMs: 30_000, sourceErrorCooldownMs: 1_000 },
  });

  const report = await service.refresh("backend developer");

  assert.equal(maxInFlight, 3);
  assert.deepEqual(report.map((item) => item.source), connectors.map((item) => item.id));
});

test("creates an independently observable connector for every ATS board", () => {
  const connectors = createConnectors({
    enableLiveSources: true,
    enableDemoSource: false,
    demoPath: "unused.json",
    hhUserAgent: "",
    joobleApiKey: "",
    usajobsApiKey: "",
    usajobsEmail: "",
    greenhouseBoards: [{ slug: "alpha", name: "Alpha Inc." }, { slug: "beta", name: "Beta Ltd." }],
    ashbyBoards: [{ slug: "gamma", name: "Gamma" }],
    leverSites: [{ slug: "delta", name: "Delta" }],
  });
  assert.deepEqual(
    connectors.filter((connector) => ["greenhouse", "ashby", "lever"].includes(connector.adapter)).map((connector) => [connector.id, connector.name]),
    [
      ["greenhouse:alpha", "Alpha Inc."],
      ["greenhouse:beta", "Beta Ltd."],
      ["ashby:gamma", "Gamma"],
      ["lever:delta", "Delta"],
    ],
  );
});

test("offline mode creates only the demo connector", () => {
  const connectors = createConnectors({
    enableLiveSources: false,
    enableDemoSource: true,
    demoPath: "unused.json",
    greenhouseBoards: [{ slug: "alpha" }],
    ashbyBoards: [{ slug: "beta" }],
    leverSites: [{ slug: "gamma" }],
  });
  assert.deepEqual(connectors.map((connector) => connector.id), ["demo"]);
});

test("exposes source setup metadata without leaking credential values", () => {
  const secret = "jooble-secret-that-must-not-leak";
  const connector = joobleConnector({ joobleApiKey: secret, aggregatorCacheMs: 60_000 });
  const service = new JobService({
    connectors: [connector],
    store: { jobs: [], async load() {}, async merge() {} },
    config: {},
  });
  const [source] = service.getSources();
  assert.equal(source.authType, "api_key");
  assert.deepEqual(source.credentialFields, ["JOOBLE_API_KEY"]);
  assert.equal(source.setupUrl, "https://jooble.org/api/about");
  assert.equal(JSON.stringify(source).includes(secret), false);
});

test("checks one source without refreshing the others", async () => {
  const calls = [];
  const connectors = ["first", "second"].map((id) => ({ id, name: id, async search() { calls.push(id); return []; } }));
  const service = new JobService({
    connectors,
    store: { jobs: [], async load() {}, async merge() {} },
    config: { sourceAuthCooldownMs: 60_000, sourceRateLimitCooldownMs: 30_000, sourceErrorCooldownMs: 1_000 },
  });
  const checked = await service.checkSource("second", "backend developer");
  assert.deepEqual(calls, ["second"]);
  assert.equal(checked.result.status, "fulfilled");
  assert.equal(checked.source.status, "ok");
  await assert.rejects(service.checkSource("missing", "work"), (error) => error.statusCode === 404);
});
