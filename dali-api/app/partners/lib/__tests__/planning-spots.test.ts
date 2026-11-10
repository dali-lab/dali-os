import { describe, expect, it } from "vitest";
import { planSpotWrites, type SpotRow } from "../planning-spots";

const row = (id: string, domainId: string, level: SpotRow["level"], slots: number): SpotRow => ({
  id,
  domainId,
  level,
  slots,
});

describe("planSpotWrites", () => {
  it("writes nothing when the totals already match", () => {
    const existing = [row("a", "eng", "P1", 2), row("b", "eng", "P3", 1)];
    expect(planSpotWrites(existing, [{ domainId: "eng", slots: 3 }])).toEqual({
      deleteIds: [],
      updates: [],
      creates: [],
    });
  });

  it("adds growth to the P1 row and leaves mentor rows alone", () => {
    const existing = [row("mentor", "eng", "P3", 1), row("learner", "eng", "P1", 2)];
    expect(planSpotWrites(existing, [{ domainId: "eng", slots: 5 }])).toEqual({
      deleteIds: [],
      updates: [{ id: "learner", slots: 4 }],
      creates: [],
    });
  });

  it("creates a P1 row for growth when the domain only has higher levels", () => {
    const existing = [row("mentor", "eng", "P3", 1)];
    expect(planSpotWrites(existing, [{ domainId: "eng", slots: 3 }])).toEqual({
      deleteIds: [],
      updates: [],
      creates: [{ domainId: "eng", slots: 2 }],
    });
  });

  it("cuts from P1 first, then P2, before touching P3", () => {
    const existing = [row("p3", "eng", "P3", 1), row("p2", "eng", "P2", 2), row("p1", "eng", "P1", 1)];
    expect(planSpotWrites(existing, [{ domainId: "eng", slots: 2 }])).toEqual({
      deleteIds: ["p1"],
      updates: [{ id: "p2", slots: 1 }],
      creates: [],
    });
  });

  it("deletes every row of a domain that was removed", () => {
    const existing = [row("a", "eng", "P1", 2), row("b", "eng", "P3", 1), row("c", "des", "P1", 1)];
    expect(planSpotWrites(existing, [{ domainId: "des", slots: 1 }])).toEqual({
      deleteIds: ["a", "b"],
      updates: [],
      creates: [],
    });
  });

  it("creates rows for newly added domains", () => {
    expect(planSpotWrites([], [{ domainId: "des", slots: 2 }])).toEqual({
      deleteIds: [],
      updates: [],
      creates: [{ domainId: "des", slots: 2 }],
    });
  });
});
