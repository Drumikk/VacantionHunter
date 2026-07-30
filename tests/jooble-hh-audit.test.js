import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Jooble HH audit never prints or embeds the API key", async () => {
  const source = await readFile(new URL("../scripts/audit-jooble-hh.mjs", import.meta.url), "utf8");
  assert.match(source, /providerSource/);
  assert.match(source, /apiKeyExposed:\s*false/);
  assert.doesNotMatch(source, /console\.log\([^\n]*joobleApiKey/);
});
