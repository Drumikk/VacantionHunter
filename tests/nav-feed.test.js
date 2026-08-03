import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { navConnector } from "../src/connectors/nav.js";
import { parseQuery } from "../src/core/query-parser.js";

function config(overrides = {}) {
  return {
    navApiToken: "",
    navUsePublicToken: false,
    navLookbackDays: 30,
    navMaxFeedPagesPerSync: 2,
    requestTimeoutMs: 1_000,
    atsRequestTimeoutMs: 1_000,
    atsDetailConcurrency: 2,
    maxJobsPerSource: 20,
    httpUserAgent: "VacationHunter/test",
    ...overrides,
  };
}

test("NAV remains disabled until private credentials or explicit public experiment mode are configured", async () => {
  const connector = navConnector(config());
  assert.equal(connector.enabled, false);
  assert.deepEqual(connector.credentialFields, ["NAV_API_TOKEN"]);
  assert.match(connector.disabledReason, /NAV_API_TOKEN/);
  await assert.rejects(connector.search(parseQuery("software engineer")), /NAV API token is required/);
});

test("NAV persists and replays lifecycle changes before advancing the acknowledged feed cursor", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-nav-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "nav-state.json");
  const authorization = "Bearer nav-secret";
  const feedHeaders = [];
  let feedCalls = 0;
  let detailCalls = 0;

  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    assert.equal(options.headers.Authorization, authorization);
    if (url.pathname === "/api/v1/feed") {
      feedCalls += 1;
      feedHeaders.push(options.headers);
      if (feedCalls === 1) {
        return Response.json({
          feed_url: "/api/v1/feed?cursor=tail",
          items: [
            {
              id: "active-1",
              url: "/api/v1/feedentry/active-1",
              title: "Senior Software Engineer",
              content_text: "Software platform engineering",
              date_modified: "2026-08-03T10:00:00Z",
              _feed_entry: {
                uuid: "active-1",
                status: "ACTIVE",
                title: "Senior Software Engineer",
                businessName: "Nordic Product AS",
                municipal: "Oslo",
                sistEndret: "2026-08-03T10:00:00Z",
              },
            },
            {
              id: "inactive-1",
              url: "/api/v1/feedentry/inactive-1",
              title: "Closed Software Engineer",
              _feed_entry: { uuid: "inactive-1", status: "INACTIVE", sistEndret: "2026-08-03T11:00:00Z" },
            },
          ],
        }, {
          headers: {
            "content-type": "application/json",
            etag: "tail-etag",
            "last-modified": "Mon, 03 Aug 2026 11:00:00 GMT",
          },
        });
      }
      return new Response(null, { status: 304 });
    }
    if (url.pathname === "/api/v1/feedentry/active-1") {
      detailCalls += 1;
      return Response.json({
        uuid: "active-1",
        sistEndret: "2026-08-03T10:00:00Z",
        status: "ACTIVE",
        ad_content: {
          uuid: "active-1",
          published: "2026-08-02T08:00:00Z",
          expires: "2026-09-01T23:59:59Z",
          updated: "2026-08-03T10:00:00Z",
          workLocations: [{ city: "Oslo", municipal: "Oslo", country: "NORGE" }],
          title: "Senior Software Engineer",
          jobtitle: "Software Engineer",
          description: "<p>Build a software platform with JavaScript and cloud services.</p>",
          sourceurl: "https://arbeidsplassen.nav.no/stillinger/stilling/active-1",
          applicationUrl: "https://apply.example.test/active-1",
          occupationCategories: [{ level1: "IT", level2: "Software development" }],
          categoryList: [{ name: "Engineering" }],
          employer: { name: "Nordic Product AS", orgnr: "123456789" },
          engagementtype: "Fast",
          extent: "Heltid",
          source: "Stillingsregistrering",
        },
      });
    }
    throw new Error(`Unexpected NAV URL: ${url}`);
  };

  const connector = navConnector(config({ navApiToken: "nav-secret", navStatePath: statePath, fetchImpl }));
  const query = parseQuery("software engineer");
  const first = await connector.search(query);

  assert.equal(first.jobs.length, 1);
  assert.equal(first.jobs[0].externalId, "active-1");
  assert.equal(first.jobs[0].company, "Nordic Product AS");
  assert.equal(first.jobs[0].location, "Oslo, Norway");
  assert.equal(first.jobs[0].applyUrl, "https://apply.example.test/active-1");
  assert.deepEqual(new Set(first.changedExternalIds), new Set(["active-1", "inactive-1"]));
  assert.ok(first.syncToken);
  assert.equal(feedCalls, 1);
  assert.equal(detailCalls, 1);
  assert.ok(feedHeaders[0]["If-Modified-Since"]);

  const replay = await connector.search(query);
  assert.deepEqual(replay, first);
  assert.equal(feedCalls, 1);
  assert.equal(connector.getDiagnostics().replayed, true);

  await connector.acknowledge(first.syncToken);
  const persisted = await fs.readFile(statePath, "utf8");
  assert.equal(persisted.includes("nav-secret"), false);
  assert.equal(JSON.parse(persisted).pending, null);

  const caughtUp = await connector.search(query);
  assert.equal(caughtUp.jobs.length, 1);
  assert.equal(feedCalls, 2);
  assert.equal(detailCalls, 1);
  assert.equal(feedHeaders[1]["If-None-Match"], "tail-etag");
  assert.equal(connector.getDiagnostics().caughtUp, true);
});
