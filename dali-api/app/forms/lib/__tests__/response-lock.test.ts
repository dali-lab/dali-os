import { describe, it, expect } from "vitest";
import {
  RESPONSE_LOCKED_APPLICATION,
  RESPONSE_LOCKED_BOUND,
  RESPONSE_LOCKED_PROFILE,
  responseLockReason,
  type ResponseLockFields,
} from "~/forms/lib/response-lock";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";

const free: ResponseLockFields = {
  slot: null,
  staffingCycleId: null,
  educationOfferingId: null,
  educationSessionId: null,
  partnerApplication: null,
  educationApplication: null,
  partnerSurveyFor: null,
};

describe("responseLockReason", () => {
  it("allows an ordinary response", () => {
    expect(responseLockReason(free, "Feedback")).toBeNull();
  });

  it.each([
    ["slot", { slot: "project-bids" }],
    ["staffingCycleId", { staffingCycleId: "c1" }],
    ["educationOfferingId", { educationOfferingId: "o1" }],
    ["educationSessionId", { educationSessionId: "s1" }],
  ])("refuses a response with %s", (_name, over) => {
    expect(responseLockReason({ ...free, ...over }, "Feedback")).toBe(RESPONSE_LOCKED_BOUND);
  });

  it.each([
    ["partnerApplication", { partnerApplication: { id: "a" } }],
    ["educationApplication", { educationApplication: { id: "a" } }],
    ["partnerSurveyFor", { partnerSurveyFor: { id: "a" } }],
  ])("refuses a response with %s", (_name, over) => {
    expect(responseLockReason({ ...free, ...over }, "Feedback")).toBe(RESPONSE_LOCKED_APPLICATION);
  });

  it("refuses the onboarding profile form", () => {
    expect(responseLockReason(free, NEW_MEMBER_PROFILE_FORM_NAME)).toBe(RESPONSE_LOCKED_PROFILE);
  });
});
