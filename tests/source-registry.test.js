import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const families = {
  greenhouseBoards: 67,
  ashbyBoards: 39,
  leverSites: 12,
  recruiteeBoards: 7,
  workableBoards: 19,
  personioBoards: 16,
  smartRecruitersCompanies: 10,
};

test("the default ATS registry exposes 170 distinct observable company boards", () => {
  assert.deepEqual(Object.fromEntries(Object.keys(families).map((key) => [key, registry[key].length])), families);
  assert.equal(Object.keys(families).reduce((total, key) => total + registry[key].length, 0), 170);

  for (const [family, expected] of Object.entries(families)) {
    const boards = registry[family];
    assert.equal(boards.length, expected);
    assert.equal(new Set(boards.map((board) => board.slug.toLocaleLowerCase("en-US"))).size, boards.length, `${family} must not contain duplicate slugs`);
    for (const board of boards) {
      assert.ok(board.slug && board.name && board.homepage, `${family}:${board.slug || "unknown"} must have display metadata`);
      assert.ok(Array.isArray(board.regions) && board.regions.length, `${family}:${board.slug} must declare target regions`);
    }
  }
});

test("ATS registry stays inside the configured geographic scope", () => {
  const allowed = new Set(registry.scope.included);
  for (const family of Object.keys(families)) {
    for (const board of registry[family]) {
      for (const region of board.regions) assert.ok(allowed.has(region), `${family}:${board.slug} uses out-of-scope region ${region}`);
    }
  }
});
