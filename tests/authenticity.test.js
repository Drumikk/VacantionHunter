import test from "node:test";
import assert from "node:assert/strict";
import { assessJob } from "../src/core/authenticity.js";

test("flags expired and payment-request vacancies", () => {
  const result = assessJob({ title: "Developer", company: "Unknown", description: "Оплатите взнос за трудоустройство через Telegram", url: "https://example.com/job", validThrough: "2020-01-01", source: { officialApi: false } });
  assert.equal(result.status, "stale");
  assert.ok(result.risks.includes("expired_valid_through"));
  assert.ok(result.risks.includes("candidate_payment_request"));
});

test("trusted official API vacancy receives strong score", () => {
  const result = assessJob({ title: "Developer", company: "Acme", description: "Detailed role with responsibilities, qualifications, working hours and benefits for candidates.", url: "https://example.com/job", postedAt: "2026-07-28", applyUrl: "https://example.com/apply", companyVerified: true, source: { officialApi: true } });
  assert.ok(result.score >= 80);
  assert.equal(result.status, "verified");
});
