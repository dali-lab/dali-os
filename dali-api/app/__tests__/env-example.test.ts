import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const IGNORED_DIRS = new Set(["node_modules", "generated", "__tests__"]);
const NOT_DOCUMENTED = new Set(["NODE_ENV", "VITEST", "FLY_APP_NAME"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

const read = (file: string) => readFileSync(file, "utf8");

const appFiles = walk(join(root, "app"));
const otherFiles = [
  join(root, "prisma.config.ts"),
  ...walk(join(root, "prisma")),
  ...walk(join(root, "scripts")),
].filter(existsSync);

const envExample = read(join(root, ".env.example"));
const documented = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
const active = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

const readByApp = new Set<string>();
for (const file of appFiles) {
  for (const m of read(file).matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g)) {
    readByApp.add(m[1] ?? m[2]);
  }
}
for (const m of read(join(root, "app", "lib", "db-pool.ts")).matchAll(/env\.(DATABASE_POOL_[A-Z_]+)/g)) {
  readByApp.add(m[1]);
}

describe(".env.example", () => {
  it("documents every variable the app reads", () => {
    const missing = [...readByApp].filter((name) => !documented.has(name) && !NOT_DOCUMENTED.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it("sets only variables the code reads", () => {
    const sources = [...appFiles, ...otherFiles].map(read).join("\n");
    const unread = active.filter((name) => !new RegExp(`\\b${name}\\b`).test(sources));
    expect(unread).toEqual([]);
  });
});
