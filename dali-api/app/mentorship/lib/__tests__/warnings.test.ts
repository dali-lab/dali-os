import { describe, expect, it } from "vitest";
import { reasonLabel, validateWarning } from "../warnings";

const valid = { memberId: "u1", reason: "missed_lab" as const, notes: "", occurredOn: "2026-11-02" };

describe("validateWarning", () => {
  it("accepts a complete warning without notes", () => {
    expect(validateWarning(valid)).toBeNull();
  });

  it("rejects a missing member", () => {
    expect(validateWarning({ ...valid, memberId: "" })).toBe("Pick a member.");
  });

  it.each([undefined, "late", ""])("rejects reason %j", (reason) => {
    expect(validateWarning({ ...valid, reason: reason as never })).toBe("Pick a reason.");
  });

  it.each([undefined, "", "11/02/2026", "2026-1-2", "2026-11-02T00:00"])("rejects date %j", (occurredOn) => {
    expect(validateWarning({ ...valid, occurredOn })).toBe("Pick a date.");
  });

  it.each([undefined, "", "   "])("requires notes for Other (notes %j)", (notes) => {
    expect(validateWarning({ ...valid, reason: "other", notes })).toBe("Add notes when the reason is Other.");
  });

  it("accepts Other with notes", () => {
    expect(validateWarning({ ...valid, reason: "other", notes: "Left early" })).toBeNull();
  });
});

describe("reasonLabel", () => {
  it("names known reasons and passes unknown ones through", () => {
    expect(reasonLabel("missed_meeting")).toBe("Missed mentorship meeting");
    expect(reasonLabel("legacy")).toBe("legacy");
  });
});
