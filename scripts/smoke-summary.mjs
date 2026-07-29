import fs from "node:fs";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node scripts/smoke-summary.mjs <report.json>");
const failOnErrors = process.argv.includes("--fail-on-errors");
const report = JSON.parse(fs.readFileSync(filePath, "utf8"));

console.log(`## Live source smoke — ${report.startedAt}`);
console.log("");
console.log(`Query: \`${report.query.raw}\``);
console.log("");
console.log(`Sources: **${report.summary.ok} ok**, **${report.summary.disabled} disabled**, **${report.summary.errors} errors**; matches: **${report.summary.fullMatches} full**, **${report.summary.partialMatches} partial**.`);
console.log("");
console.log("| Source | Status | Jobs | Full | Partial | Details |");
console.log("|---|---:|---:|---:|---:|---|");
for (const item of report.report) {
  const details = item.error || item.sample?.title || (item.diagnostics?.warnings?.length ? `${item.diagnostics.warnings.length} warning(s)` : "—");
  console.log(`| ${item.name} | ${item.status} | ${item.count} | ${item.fullMatches} | ${item.partialMatches} | ${String(details).replaceAll("|", "\\|")} |`);
}

if (failOnErrors && report.summary.errors > 0) process.exitCode = 1;
