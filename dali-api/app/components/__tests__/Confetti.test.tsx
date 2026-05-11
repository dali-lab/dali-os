import { describe, it, expect } from "vitest";
import { decideConfettiAction } from "../Confetti";

describe("decideConfettiAction", () => {
  it("returns 'noop' when trigger is false (animation must not fire on plain /portal loads)", () => {
    expect(decideConfettiAction(false, false)).toBe("noop");
    expect(decideConfettiAction(false, true)).toBe("noop");
  });

  it("returns 'fire' when trigger is true and reduced-motion is not requested", () => {
    expect(decideConfettiAction(true, false)).toBe("fire");
  });

  it("returns 'skip-reduced-motion' when the user prefers reduced motion", () => {
    expect(decideConfettiAction(true, true)).toBe("skip-reduced-motion");
  });
});
