import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASELINE = 126;

const appDir = join(import.meta.dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "generated" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== "exhaustive-deps-baseline.test.ts") yield full;
  }
}

const DISABLE = /eslint-disable[^\n]*react-hooks\/exhaustive-deps/g;

const count = [...sourceFiles(appDir)].reduce((n, f) => n + (readFileSync(f, "utf8").match(DISABLE)?.length ?? 0), 0);

describe("react-hooks/exhaustive-deps suppressions", () => {
  it("do not grow past the baseline", () => {
    expect(
      count,
      `Found ${count} eslint-disable comments for react-hooks/exhaustive-deps, baseline is ${BASELINE}. Fix the dependency array (or restructure the hook) instead of disabling the rule. If a suppression is truly unavoidable, raise BASELINE in this file deliberately; when you remove suppressions, lower it.`,
    ).toBeLessThanOrEqual(BASELINE);
  });
});
