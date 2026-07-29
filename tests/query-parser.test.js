import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/core/query-parser.js";

test("parses .NET role and monthly USD threshold", () => {
  const query = parseQuery("Ищу .Net разработчика с заработной платой от 4000$ удаленно");
  assert.match(query.role, /net.*разработчик|разработчик/);
  assert.ok(query.skills.includes(".net"));
  assert.equal(query.salary.currency, "USD");
  assert.equal(query.salary.min, 4000);
  assert.equal(query.salaryMonthlyUsd, 4000);
  assert.equal(query.remote, true);
  assert.ok(query.tags.some((tag) => tag.id === "salary" && tag.required));
});

test("asks for optional location when it is absent", () => {
  const query = parseQuery("Senior Python developer");
  assert.equal(query.experience, "senior");
  assert.ok(query.clarifications.some((item) => item.field === "location"));
});

test("normalizes Russian and English locations to the same international value", () => {
  const russian = parseQuery("Python developer Германия");
  const english = parseQuery("Python developer Germany");

  assert.deepEqual(russian.locations, ["germany"]);
  assert.deepEqual(english.locations, ["germany"]);
  assert.equal(russian.role, "python developer");
  assert.ok(russian.tags.some((tag) => tag.id === "location:germany" && tag.required));
});
