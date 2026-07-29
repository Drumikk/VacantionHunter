import fs from "node:fs";

function parseValue(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value[0] === value.at(-1) && ["'", '"'].includes(value[0])) {
    const inner = value.slice(1, -1);
    return value[0] === '"' ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
  }
  return value;
}

export function loadEnvFile(filePath, target = process.env) {
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const loaded = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || target[match[1]] != null) continue;
    target[match[1]] = parseValue(match[2]);
    loaded.push(match[1]);
  }
  return loaded;
}
