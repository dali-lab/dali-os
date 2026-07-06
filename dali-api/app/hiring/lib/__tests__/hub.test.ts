import { describe, it, expect } from "vitest";
import { releaseQueueCount, type HubDecisionRow } from "~/hiring/lib/hub.server";

describe("releaseQueueCount", () => {
  it("counts domain applications with a Final but no Released decision", () => {
    const rows: HubDecisionRow[] = [
      { domainApplicationId: "da-1", stage: "Final" },
      { domainApplicationId: "da-2", stage: "Final" },
      { domainApplicationId: "da-2", stage: "Released" },
      { domainApplicationId: "da-3", stage: "Released" },
    ];
    expect(releaseQueueCount(rows)).toBe(1);
  });

  it("handles append-only lineages with multiple Final rows", () => {
    const rows: HubDecisionRow[] = [
      { domainApplicationId: "da-1", stage: "Final" },
      { domainApplicationId: "da-1", stage: "Final" },
    ];
    expect(releaseQueueCount(rows)).toBe(1);
  });

  it("returns zero for an empty set", () => {
    expect(releaseQueueCount([])).toBe(0);
  });
});
