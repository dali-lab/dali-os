import { describe, expect, it } from "vitest";
import { REFERRAL_STATUS_LABEL, referralStatus } from "../referral-status";

const none = { reachedOutAt: null, partnerApplicationId: null, resultingProjectId: null };

describe("referralStatus", () => {
  it("is Sent with nothing recorded", () => {
    expect(referralStatus(none)).toBe("Sent");
  });
  it("is DaliCalled once reached out", () => {
    expect(referralStatus({ ...none, reachedOutAt: new Date() })).toBe("DaliCalled");
  });
  it("is Applied when linked to an application", () => {
    expect(
      referralStatus({ reachedOutAt: new Date(), partnerApplicationId: "a1", resultingProjectId: null }),
    ).toBe("Applied");
    expect(referralStatus({ ...none, partnerApplicationId: "a1" })).toBe("Applied");
  });
  it("is Project when the linked application became a project", () => {
    expect(
      referralStatus({ reachedOutAt: null, partnerApplicationId: "a1", resultingProjectId: "p1" }),
    ).toBe("Project");
  });
  it("ignores a project id without a link", () => {
    expect(referralStatus({ ...none, resultingProjectId: "p1" })).toBe("Sent");
  });
  it("has a plain label for each status", () => {
    expect(REFERRAL_STATUS_LABEL).toEqual({
      Sent: "Sent",
      DaliCalled: "DALI called",
      Applied: "Applied",
      Project: "Now a project",
    });
  });
});
