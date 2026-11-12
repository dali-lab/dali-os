import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..");

describe("core route modules", () => {
  it("never re-export another route's loader", () => {
    const offenders = readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /export\s*\{[^}]*\b(loader|action|default)\b[^}]*\}\s*from/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
