import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogCoverageSummary, expandRussianCompanyCatalog, isLinkedInUrl, splitSourceUrls } from "../src/source-catalog.js";

const registry = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("../config/russian-company-sources.json", import.meta.url), "utf8"));

test("accounts for every PDF row and excludes only blank or LinkedIn-only sources", () => {
  const expanded = expandRussianCompanyCatalog({ registry, catalog });
  const summary = catalogCoverageSummary(expanded.audit);

  assert.equal(catalog.source.rowCount, 202);
  assert.equal(catalog.rows.length, 202);
  assert.equal(catalog.rows.filter((row) => row.company).length, 200);
  assert.deepEqual(summary, {
    rows: 202,
    dispositions: {
      "metadata-row": 2,
      added: 175,
      "already-covered": 5,
      "no-job-site": 18,
      "excluded-linkedin": 2,
    },
    connectors: 181,
  });

  const coveredCompanies = expanded.audit.filter((row) => ["added", "already-covered"].includes(row.disposition));
  assert.equal(coveredCompanies.length, 180);
  assert.ok(coveredCompanies.every((row) => row.connectorIds.length > 0));
  assert.ok(expanded.audit.filter((row) => row.disposition === "excluded-linkedin").every((row) => splitSourceUrls(row.jobSite).every(isLinkedInUrl)));
  assert.equal(catalog.research.unresolved.length, 20);
  assert.equal(new Set(catalog.research.unresolved.map((row) => row.row)).size, 20);

  const originallyUnavailable = catalog.rows
    .filter((row) => row.company)
    .filter((row) => {
      const urls = splitSourceUrls(row.jobSite);
      return !urls.length || urls.every(isLinkedInUrl);
    })
    .map((row) => row.row)
    .sort((a, b) => a - b);
  const supplemented = Object.keys(catalog.research.supplementalSources).map(Number);
  const unresolved = catalog.research.unresolved.map((row) => row.row);
  assert.equal(originallyUnavailable.length, 30);
  assert.deepEqual([...supplemented, ...unresolved].sort((a, b) => a - b), originallyUnavailable);
  assert.equal(new Set([...supplemented, ...unresolved]).size, 30);
  assert.ok(Object.values(catalog.research.supplementalSources).flat().every((source) => !isLinkedInUrl(source.url)));
});

test("routes supported ATS links and leaves the rest to isolated career-page connectors", () => {
  const expanded = expandRussianCompanyCatalog({ registry, catalog });

  assert.equal(expanded.greenhouseBoards.length, 9);
  assert.equal(expanded.ashbyBoards.length, 1);
  assert.equal(expanded.leverSites.length, 12);
  assert.equal(expanded.workableBoards.length, 3);
  assert.equal(expanded.personioBoards.length, 1);
  assert.equal(expanded.careerPages.length, 150);
  assert.equal(expanded.greenhouseBoards.length + expanded.ashbyBoards.length + expanded.leverSites.length + expanded.workableBoards.length + expanded.personioBoards.length + expanded.careerPages.length, 176);

  assert.equal(expanded.personioBoards[0].slug, "finom");
  assert.equal(expanded.ashbyBoards[0].slug, "salmon-group");
  assert.equal(expanded.leverSites.find((board) => board.name === "CoinsPaid").apiBase, "https://api.eu.lever.co");
  assert.equal(expanded.audit.find((row) => row.company === "Temporal").disposition, "already-covered");
  assert.ok(expanded.careerPages.every((entry) => !isLinkedInUrl(entry.url)));
  assert.equal(new Set(expanded.careerPages.map((entry) => entry.id)).size, expanded.careerPages.length);
  assert.equal(new Set(expanded.careerPages.map((entry) => entry.url)).size, expanded.careerPages.length);
});
