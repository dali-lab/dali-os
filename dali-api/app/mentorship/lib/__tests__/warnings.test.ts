import { describe, expect, it } from "vitest";
import { stageLabel, validateWarningCase } from "../warnings";

const valid = { stage: "pending", willAcceptReapp: "", linkUrl: "", meeting1On: "", meeting2On: "" } as const;

describe("validateWarningCase", () => {
  it("accepts a blank case with a known stage", () => {
    expect(validateWarningCase(valid)).toBeNull();
  });

  it("validates only the fields that are present", () => {
    expect(validateWarningCase({})).toBeNull();
    expect(validateWarningCase({ stage: "dropped" })).toBeNull();
  });

  it("rejects an unknown stage", () => {
    expect(validateWarningCase({ ...valid, stage: "bogus" as never })).toBe("Pick a status.");
  });

  it("only allows yes, no or undecided for reapply", () => {
    expect(validateWarningCase({ ...valid, willAcceptReapp: "yes" })).toBeNull();
    expect(validateWarningCase({ ...valid, willAcceptReapp: "maybe" as never })).toBe("Pick yes or no for reapplying.");
  });

  it("requires an http link when one is given", () => {
    expect(validateWarningCase({ ...valid, linkUrl: "https://example.com/doc" })).toBeNull();
    expect(validateWarningCase({ ...valid, linkUrl: "example.com" })).toBe("Enter a full link starting with http.");
  });

  it("rejects malformed meeting dates", () => {
    expect(validateWarningCase({ ...valid, meeting1On: "2026-11-10", meeting2On: "2026-12-01" })).toBeNull();
    expect(validateWarningCase({ ...valid, meeting2On: "12/01/2026" })).toBe("Pick a valid meeting date.");
  });
});

describe("stageLabel", () => {
  it("maps values to labels and falls back to the raw value", () => {
    expect(stageLabel("ok_to_reapp")).toBe("Ok to reapp");
    expect(stageLabel("dropped")).toBe("Dropped from lab");
    expect(stageLabel("legacy")).toBe("legacy");
  });
});
