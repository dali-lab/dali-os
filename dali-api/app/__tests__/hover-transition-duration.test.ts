import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = join(import.meta.dirname, "..");

describe("hover response time", () => {
  it("sets the default transition to 75ms", () => {
    const css = readFileSync(join(app, "app.css"), "utf8");
    expect(css).toContain("--default-transition-duration: 75ms;");
  });

  it("keeps the rail on the same duration", () => {
    const rail = readFileSync(join(app, "components/shell/Rail.tsx"), "utf8");
    expect(rail).not.toContain("duration-150");
  });
});
