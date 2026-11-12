import { describe, it, expect } from "vitest";
import {
  RESPONSE_LOCKED_APPLICATION,
  RESPONSE_LOCKED_BOUND,
  responseDeletePlan,
  responseLockReason,
  type ResponseLockFields,
} from "~/forms/lib/response-lock";

const free: ResponseLockFields = {
  slot: null,
  staffingCycleId: null,
  educationOfferingId: null,
  educationSessionId: null,
  partnerApplication: null,
  educationApplication: null,
  partnerSurveyFor: null,
};

const partnerApp = { id: "pa1", title: "River sensors", resultingProjectId: null };
const eduApp = (status: string, attendances = 0) => ({
  id: "ea1",
  status,
  offering: { title: "Intro to Figma" },
  _count: { attendances },
});

describe("responseLockReason", () => {
  it("allows an ordinary response", () => {
    expect(responseLockReason(free)).toBeNull();
  });

  it.each([
    ["slot", { slot: "project-bids" }],
    ["staffingCycleId", { staffingCycleId: "c1" }],
    ["educationOfferingId", { educationOfferingId: "o1" }],
    ["educationSessionId", { educationSessionId: "s1" }],
  ])("refuses a response with %s", (_name, over) => {
    expect(responseLockReason({ ...free, ...over })).toBe(RESPONSE_LOCKED_BOUND);
  });

  it.each([
    ["partnerApplication", { partnerApplication: partnerApp }],
    ["educationApplication", { educationApplication: eduApp("Submitted") }],
    ["partnerSurveyFor", { partnerSurveyFor: { id: "a" } }],
  ])("refuses a response with %s", (_name, over) => {
    expect(responseLockReason({ ...free, ...over })).toBe(RESPONSE_LOCKED_APPLICATION);
  });
});

describe("responseDeletePlan", () => {
  it("deletes an ordinary response with nothing else", () => {
    expect(responseDeletePlan(free)).toEqual({ blocked: null, effects: [] });
  });

  it("names the bids a project-bids response carries", () => {
    expect(responseDeletePlan({ ...free, slot: "project-bids", staffingCycleId: "c1" })).toEqual({
      blocked: null,
      effects: ["Removes their project bids for this cycle."],
    });
  });

  it("names the intent an intent-to-work response carries", () => {
    expect(responseDeletePlan({ ...free, slot: "intent-to-work", staffingCycleId: "c1" })).toEqual({
      blocked: null,
      effects: ["Removes their intent to work for this cycle."],
    });
  });

  it.each([
    ["level-up", { slot: "level-up", staffingCycleId: "c1" }],
    ["session feedback", { slot: "session-feedback", educationOfferingId: "o1", educationSessionId: "s1" }],
  ])("deletes a %s response with nothing else", (_name, over) => {
    expect(responseDeletePlan({ ...free, ...over })).toEqual({ blocked: null, effects: [] });
  });

  it("deletes the partner application with its response", () => {
    expect(responseDeletePlan({ ...free, partnerApplication: partnerApp })).toEqual({
      blocked: null,
      effects: ['Deletes the partner application "River sensors".'],
    });
  });

  it("refuses once the partner application became a project", () => {
    expect(
      responseDeletePlan({ ...free, partnerApplication: { ...partnerApp, resultingProjectId: "p1" } }),
    ).toEqual({ blocked: "Its partner application became a project." });
  });

  it.each(["Submitted", "Rejected", "Withdrawn"])(
    "deletes a %s education application with its response",
    (status) => {
      expect(responseDeletePlan({ ...free, educationApplication: eduApp(status) })).toEqual({
        blocked: null,
        effects: ["Deletes their application to Intro to Figma."],
      });
    },
  );

  it.each(["Approved", "Waitlisted"])("refuses an %s education application", (status) => {
    expect(responseDeletePlan({ ...free, educationApplication: eduApp(status) })).toEqual({
      blocked: `Its application to Intro to Figma is ${status.toLowerCase()}. Reject or withdraw it first.`,
    });
  });

  it("refuses an education application with attendance recorded", () => {
    expect(responseDeletePlan({ ...free, educationApplication: eduApp("Rejected", 2) })).toEqual({
      blocked: "Its application to Intro to Figma has attendance recorded.",
    });
  });

  it("reopens the partner survey", () => {
    expect(responseDeletePlan({ ...free, partnerSurveyFor: { id: "pp1" } })).toEqual({
      blocked: null,
      effects: ["Lets the partner fill the post-project survey again."],
    });
  });
});
