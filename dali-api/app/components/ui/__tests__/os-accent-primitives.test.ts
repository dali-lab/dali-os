import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

// These primitives have no .os-shell CSS override (unlike Button, Checkbox,
// Radio and Toggle), so whatever colour they name is what every page shows.
describe("field and control primitives", () => {
  it.each(["DateField.tsx", "TimeField.tsx", "SearchInput.tsx", "IconButton.tsx"])(
    "%s marks focus and selection with the os accent, not brand coral or teal",
    (file) => {
      const code = src(file);
      expect(code).not.toMatch(/accent-(coral|teal)/);
      expect(code).toContain("os-accent");
    },
  );

  it("fills a selected date with the accent and keeps its text readable in both themes", () => {
    expect(src("DateField.tsx")).toContain("bg-os-accent text-os-bg");
    expect(src("DateField.tsx")).not.toContain("bg-os-accent text-white");
  });
});
