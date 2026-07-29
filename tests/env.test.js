import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "../src/env.js";

test("loads local secrets without overriding the process environment", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vacation-hunter-env-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, ".env");
  await fs.writeFile(filePath, [
    "# local credentials",
    "JOOBLE_API_KEY='local-secret'",
    "USAJOBS_EMAIL=owner@example.test",
    "EXISTING=must-not-win",
  ].join("\n"));
  const target = { EXISTING: "system-wins" };

  const loaded = loadEnvFile(filePath, target);

  assert.deepEqual(loaded, ["JOOBLE_API_KEY", "USAJOBS_EMAIL"]);
  assert.equal(target.JOOBLE_API_KEY, "local-secret");
  assert.equal(target.USAJOBS_EMAIL, "owner@example.test");
  assert.equal(target.EXISTING, "system-wins");
});
