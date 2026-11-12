import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPmDocToBlocks } from "./pm-to-blocknote";

describe("pm-to-blocknote", () => {
  it("gives every block of a 3-paragraph doc a unique id", () => {
    const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const { blocks } = mapPmDocToBlocks({ type: "doc", content: [para("a"), para("b"), para("c")] });
    const ids = blocks.map((b) => b.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("imports no node builtins anywhere in the legacy layer", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/from ["']node:/);
    }
  });
});
