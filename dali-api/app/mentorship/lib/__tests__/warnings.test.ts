import { describe, expect, it } from "vitest";
import { reasonLabel, stageLabel, validateWarning, validateWarningCase } from "../warnings";

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

const validCase = { stage: "pending", willAcceptReapp: "", linkUrl: "", meeting1On: "", meeting2On: "" } as const;

describe("validateWarningCase", () => {
  it("accepts a blank case with a known stage", () => {
    expect(validateWarningCase(validCase)).toBeNull();
  });

  it("validates only the fields that are present", () => {
    expect(validateWarningCase({})).toBeNull();
    expect(validateWarningCase({ stage: "dropped" })).toBeNull();
  });

  it("rejects an unknown stage", () => {
    expect(validateWarningCase({ ...validCase, stage: "bogus" as never })).toBe("Pick a status.");
  });

  it("only allows yes, no or undecided for reapply", () => {
    expect(validateWarningCase({ ...validCase, willAcceptReapp: "yes" })).toBeNull();
    expect(validateWarningCase({ ...validCase, willAcceptReapp: "maybe" as never })).toBe("Pick yes or no for reapplying.");
  });

  it("requires an http link when one is given", () => {
    expect(validateWarningCase({ ...validCase, linkUrl: "https://example.com/doc" })).toBeNull();
    expect(validateWarningCase({ ...validCase, linkUrl: "example.com" })).toBe("Enter a full link starting with http.");
  });

  it("rejects malformed meeting dates", () => {
    expect(validateWarningCase({ ...validCase, meeting1On: "2026-11-10", meeting2On: "2026-12-01" })).toBeNull();
    expect(validateWarningCase({ ...validCase, meeting2On: "12/01/2026" })).toBe("Pick a valid meeting date.");
  });
});

describe("stageLabel", () => {
  it("maps values to labels and falls back to the raw value", () => {
    expect(stageLabel("ok_to_reapp")).toBe("Ok to reapp");
    expect(stageLabel("dropped")).toBe("Dropped from lab");
    expect(stageLabel("legacy")).toBe("legacy");
  });
});
