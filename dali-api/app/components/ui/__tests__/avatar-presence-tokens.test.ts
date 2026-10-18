import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../Avatar.tsx"), "utf8");

describe("Avatar presence dots", () => {
  it("mark active with the os green and recent with the os amber ring", () => {
    expect(src).toContain("rounded-full bg-os-green ring-2");
    expect(src).toContain("border-2 border-os-amber");
  });

  it("use no brand palette colours, which have no dark-mode value", () => {
    expect(src).not.toMatch(/accent-(green|yellow|coral|teal)\b/);
  });
});
