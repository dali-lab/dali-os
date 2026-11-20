import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = join(import.meta.dirname, "..", "..");
const scriptsDir = join(apiRoot, "scripts");

const scriptFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? scriptFiles(path) : [path];
  });

const CLASS_YEAR_EMAIL = /\b[A-Z][a-z]+(\.[A-Z])?\.[A-Z][a-z]+\.\d{2}@dartmouth\.edu/;

describe("repo hygiene", () => {
  it.skipIf(!existsSync(scriptsDir))("keeps data files out of scripts/", () => {
    const data = scriptFiles(scriptsDir).filter((f) => /\.(json|csv)$/i.test(f));
    expect(data).toEqual([]);
  });

  it.skipIf(!existsSync(scriptsDir))("keeps real class-year emails out of scripts/", () => {
    const hits = scriptFiles(scriptsDir).filter((f) => CLASS_YEAR_EMAIL.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("ignores local data and test output at the repo root", () => {
    const ignore = readFileSync(join(apiRoot, "..", ".gitignore"), "utf8");
    for (const pattern of ["/.staffing-*.json", "/dali-api/test-results/", "/.ds-sync/"]) {
      expect(ignore).toContain(pattern);
    }
  });
});
