import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/core/query-parser.js";
import { parseSalaryText } from "../src/core/salary.js";

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

test("treats explicitly requested relocation as a required condition", () => {
  const query = parseQuery(".NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией");
  const relocation = query.tags.find((tag) => tag.id === "relocation");
  assert.equal(query.relocation, true);
  assert.equal(relocation?.required, true);
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

test("parses comma and dot thousands separators in salary text", () => {
  assert.deepEqual(parseSalaryText("Salary $150,000 - $160,000 annually"), {
    min: 150_000, max: 160_000, currency: "USD", period: "year", explicit: true,
  });
  assert.deepEqual(parseSalaryText("EUR 50.000 - 70.000 per annum"), {
    min: 50_000, max: 70_000, currency: "EUR", period: "year", explicit: true,
  });
  assert.equal(parseSalaryText("$10.5k monthly").min, 10_500);
});
