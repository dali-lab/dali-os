import { describe, expect, it } from "vitest";
import {
  GUIDE_STATE_MESSAGE,
  readGuideState,
} from "~/components/page-docs/guide-bridge";

// The shell and the page are separate documents in tab mode, so this shape is
// a contract: a shell that mis-reads it either hides a guide that exists or
// offers one that doesn't.
describe("readGuideState", () => {
  it("reads a guide announcement", () => {
    expect(
      readGuideState({ type: GUIDE_STATE_MESSAGE, hasGuide: true, open: false }),
    ).toEqual({ hasGuide: true, open: false });
  });

  it("ignores every other message on the bridge", () => {
    expect(readGuideState({ type: "dali:tabNavigated", url: "/projects" })).toBeNull();
    expect(readGuideState(null)).toBeNull();
    expect(readGuideState("dali:pageGuide")).toBeNull();
  });

  it("defaults the flags, so a truncated message reads as no guide", () => {
    expect(readGuideState({ type: GUIDE_STATE_MESSAGE })).toEqual({
      hasGuide: false,
      open: false,
    });
  });
});
