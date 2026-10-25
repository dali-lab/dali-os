import { describe, it, expect } from "vitest";
import { AI_COST_PER_MILLION_TOKENS, estimateAiCost, formatUsd } from "~/admin/lib/ai-cost";

describe("estimateAiCost", () => {
  it("uses $3 per 1M input and $15 per 1M output tokens", () => {
    expect(AI_COST_PER_MILLION_TOKENS).toEqual({ input: 3, output: 15 });
    expect(estimateAiCost(1_000_000, 0)).toBe(3);
    expect(estimateAiCost(0, 1_000_000)).toBe(15);
    expect(estimateAiCost(2_000_000, 500_000)).toBe(13.5);
  });

  it("is zero with no tokens", () => {
    expect(estimateAiCost(0, 0)).toBe(0);
  });
});

describe("formatUsd", () => {
  it("formats dollars with cents", () => {
    expect(formatUsd(13.5)).toBe("$13.50");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("shows a floor for amounts under a cent", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
  });
});
