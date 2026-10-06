#!/usr/bin/env node
// Turns coverage/coverage-summary.json into a markdown table grouped by app/ area,
// ordered so the largest untested surfaces come first.
import { readFileSync } from "node:fs";
import path from "node:path";

const summaryPath = process.argv[2] ?? "coverage/coverage-summary.json";

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch (err) {
  console.error(`Could not read ${summaryPath}: ${err.message}`);
  console.error("Run `npm run test:coverage` first.");
  process.exit(1);
}

const { total, ...files } = summary;

const areas = new Map();
for (const [file, metrics] of Object.entries(files)) {
  const rel = path.relative(process.cwd(), file);
  const parts = rel.split(path.sep);
  const area = parts[0] === "app" && parts.length > 2 ? `app/${parts[1]}` : "app/(root)";
  const acc =
    areas.get(area) ??
    { files: 0, statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0] };
  acc.files += 1;
  for (const key of ["statements", "branches", "functions", "lines"]) {
    acc[key][0] += metrics[key].covered;
    acc[key][1] += metrics[key].total;
  }
  areas.set(area, acc);
}

const pct = ([covered, all]) => (all === 0 ? 100 : (covered / all) * 100);
const fmt = (ratio) => `${pct(ratio).toFixed(1)}%`;

const rows = [...areas.entries()]
  .map(([area, acc]) => ({ area, acc, gap: acc.lines[1] - acc.lines[0] }))
  .sort((a, b) => b.gap - a.gap);

const lines = [
  "## Coverage",
  "",
  `**${total.lines.pct.toFixed(1)}% lines** (${total.lines.covered}/${total.lines.total}) · ` +
    `${total.statements.pct.toFixed(1)}% statements · ` +
    `${total.branches.pct.toFixed(1)}% branches · ` +
    `${total.functions.pct.toFixed(1)}% functions`,
  "",
  "| Area | Files | Lines | Statements | Branches | Functions | Uncovered lines |",
  "| --- | --: | --: | --: | --: | --: | --: |",
];

for (const { area, acc, gap } of rows) {
  lines.push(
    `| \`${area}\` | ${acc.files} | ${fmt(acc.lines)} | ${fmt(acc.statements)} | ` +
      `${fmt(acc.branches)} | ${fmt(acc.functions)} | ${gap} |`,
  );
}

lines.push("", "Ordered by uncovered lines. Download the `coverage-report` artifact for the line-by-line HTML.");

console.log(lines.join("\n"));
