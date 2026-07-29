import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson, HttpError } from "../src/connectors/http.js";
import { hhConnector } from "../src/connectors/hh.js";
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

test("HH is explicitly disabled until a real API User-Agent is configured", () => {
  const connector = hhConnector({ hhUserAgent: "" });
  assert.equal(connector.enabled, false);
  assert.match(connector.disabledReason, /HH_USER_AGENT/);
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

test("creates an independently observable connector for every ATS board", () => {
  const connectors = createConnectors({
    enableLiveSources: false,
    demoPath: "unused.json",
    greenhouseBoards: [{ slug: "alpha", name: "Alpha Inc." }, { slug: "beta", name: "Beta Ltd." }],
    ashbyBoards: [{ slug: "gamma", name: "Gamma" }],
    leverSites: [{ slug: "delta", name: "Delta" }],
  });
  assert.deepEqual(
    connectors.slice(1).map((connector) => [connector.id, connector.name]),
    [
      ["greenhouse:alpha", "Alpha Inc."],
      ["greenhouse:beta", "Beta Ltd."],
      ["ashby:gamma", "Gamma"],
      ["lever:delta", "Delta"],
    ],
  );
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
