import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REQUIRED_CHECKS = ["test-api", "integration-api", "e2e-api", "Build API"];

const PASSING = new Set(["success", "skipped"]);

export function evaluateChecks(checkRuns, required = REQUIRED_CHECKS) {
  const latest = new Map();
  for (const run of checkRuns) {
    const prev = latest.get(run.name);
    if (!prev || run.id > prev.id) latest.set(run.name, run);
  }
  const problems = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run) {
      problems.push({ name, state: "missing", url: null });
    } else if (run.status !== "completed") {
      problems.push({ name, state: "pending", url: run.html_url ?? null });
    } else if (!PASSING.has(run.conclusion)) {
      problems.push({ name, state: `failed (${run.conclusion})`, url: run.html_url ?? null });
    }
  }
  return { ok: problems.length === 0, problems };
}

export function formatReport(sha, problems) {
  const lines = problems.map((p) => `- \`${p.name}\`: ${p.state}${p.url ? ` ${p.url}` : ""}`);
  return `Required checks are not green on \`${sha}\`:\n${lines.join("\n")}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sha, file] = process.argv.slice(2);
  const runs = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const { ok, problems } = evaluateChecks(runs);
  if (ok) {
    console.log(`Required checks are green on ${sha}.`);
  } else {
    console.log(formatReport(sha, problems));
    process.exit(1);
  }
}
