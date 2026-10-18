import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../QuestionField.tsx"), "utf8");

describe("QuestionField", () => {
  it("marks selection, focus and upload states with the os accent, not brand coral", () => {
    expect(src).not.toContain("accent-coral");
    expect(src).toContain("focus:border-os-accent");
  });
});
