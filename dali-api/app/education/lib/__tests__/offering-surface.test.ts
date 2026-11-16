import { describe, expect, it } from "vitest";
import { MEMBER_SURFACE, PORTAL_SURFACE, sendsAway, surfaceTitle } from "../offering-surface";

describe("offering surfaces", () => {
  it("keeps each surface's base path and its other surface", () => {
    expect(MEMBER_SURFACE).toMatchObject({ base: "/education", otherBase: "/portal/education" });
    expect(PORTAL_SURFACE).toMatchObject({ base: "/portal/education", otherBase: "/education" });
  });

  it("sends Dartmouth accounts off the member surface and members off the portal", () => {
    expect(sendsAway(MEMBER_SURFACE, "dartmouth")).toBe(true);
    expect(sendsAway(MEMBER_SURFACE, "member")).toBe(false);
    expect(sendsAway(PORTAL_SURFACE, "member")).toBe(true);
    expect(sendsAway(PORTAL_SURFACE, "dartmouth")).toBe(false);
  });

  it("keeps each surface's title suffix", () => {
    expect(surfaceTitle(MEMBER_SURFACE, "Intro")).toBe("Intro · DALI OS");
    expect(surfaceTitle(PORTAL_SURFACE, "Intro")).toBe("Intro · DALI");
  });
});
