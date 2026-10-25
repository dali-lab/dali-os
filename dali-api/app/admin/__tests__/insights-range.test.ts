import { describe, it, expect } from "vitest";
import { DEFAULT_RANGE, resolveRange } from "~/admin/lib/insights-range";

describe("resolveRange", () => {
  it("accepts 7d, 30d and 90d", () => {
    expect(resolveRange("7d").days).toBe(7);
    expect(resolveRange("30d").days).toBe(30);
    expect(resolveRange("90d").days).toBe(90);
  });

  it("falls back to 30 days for a missing or unknown value", () => {
    expect(DEFAULT_RANGE).toBe("30d");
    expect(resolveRange(null).key).toBe("30d");
    expect(resolveRange("14d").key).toBe("30d");
  });
});
