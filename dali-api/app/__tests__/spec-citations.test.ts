import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = join(import.meta.dirname, "..", "..");
const repoRoot = join(apiRoot, "..");

const KNOWN_MISSING = new Set([
  "specs/meeting-notes-model.md",
  "specs/partner-crm.md",
  "specs/education-student-ui.md",
  "specs/betterauth-legacy-auth-cleanup.md",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs|css)$/.test(name)) out.push(path);
  }
  return out;
}

const files = [
  ...walk(join(apiRoot, "app")),
  join(apiRoot, "prisma", "schema.prisma"),
  join(repoRoot, "CLAUDE.md"),
  join(repoRoot, "README.md"),
  join(repoRoot, "CONTRIBUTING.md"),
];

const cited = new Map<string, Set<string>>();
const bare = new Set<string>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const where = relative(repoRoot, file);
  for (const m of text.matchAll(/specs\/[A-Za-z0-9_./-]+?\.md/g)) {
    if (!cited.has(m[0])) cited.set(m[0], new Set());
    cited.get(m[0])!.add(where);
  }
  for (const m of text.matchAll(/(?<![A-Za-z0-9_/])[A-Z][A-Z0-9_]*_PLAN\.md/g)) bare.add(`${m[0]} in ${where}`);
}

describe("spec citations", () => {
  it("point at specs that exist", () => {
    const broken = [...cited]
      .filter(([path]) => !KNOWN_MISSING.has(path) && !existsSync(join(repoRoot, path)))
      .map(([path, from]) => `${path} (cited in ${[...from].join(", ")})`);
    expect(broken).toEqual([]);
  });

  it("use full specs/ paths, never a bare *_PLAN.md name", () => {
    expect([...bare]).toEqual([]);
  });

  it("keep the known-missing list current", () => {
    const stale = [...KNOWN_MISSING].filter((path) => existsSync(join(repoRoot, path)) || !cited.has(path));
    expect(stale).toEqual([]);
  });
});
