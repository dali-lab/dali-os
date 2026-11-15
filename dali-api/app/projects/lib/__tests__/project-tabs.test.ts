import { describe, expect, it } from "vitest";
import { LEGACY_TAB_TO_TAB } from "../project-tabs";

describe("LEGACY_TAB_TO_TAB", () => {
  it("sends old ?tab=board links to progress and ?tab=overview links to details", () => {
    expect(LEGACY_TAB_TO_TAB.board).toBe("progress");
    expect(LEGACY_TAB_TO_TAB.overview).toBe("details");
    expect(LEGACY_TAB_TO_TAB.mentorship).toBe("mentorship");
  });
});
