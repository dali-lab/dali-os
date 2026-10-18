import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../WeekGrid.tsx"), "utf8");

describe("WeekGrid today, current-time and drag states", () => {
  it("use the os accent, not brand coral", () => {
    expect(src).not.toContain("accent-coral");
    expect(src).toContain("bg-os-accent");
  });

  it("draw today's date on the page colour so it reads on the pale dark accent", () => {
    expect(src).toContain("bg-os-accent text-sm font-bold text-os-bg");
  });
});
