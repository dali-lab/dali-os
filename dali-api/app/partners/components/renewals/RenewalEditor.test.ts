import { describe, it, expect } from "vitest";
import { toFormFields } from "./RenewalEditor";

const base = { projectId: "p", nextStep: "Call", nextStepDue: "2026-11-02" };

describe("toFormFields", () => {
  it("sends only the next step for undecided", () => {
    expect(toFormFields({ ...base, intent: "undecided", termId: "t", reason: "x" })).toEqual({
      intent: "undecided",
      projectId: "p",
      nextStep: "Call",
      nextStepDue: "2026-11-02",
    });
  });
  it("serializes term, fee and spots for continue", () => {
    const f = toFormFields({
      ...base,
      intent: "continue",
      termId: "t3",
      feeCents: 5000,
      roles: [{ domainId: "d", name: "Design", slots: 2 }],
    });
    expect(f).toMatchObject({ termId: "t3", feeCents: "5000", roles: '[{"domainId":"d","slots":2}]' });
  });
  it("sends an empty fee when none is set", () => {
    expect(toFormFields({ ...base, intent: "continue", termId: "t", feeCents: null, roles: [] }).feeCents).toBe("");
  });
  it("sends the reason for not continuing", () => {
    expect(toFormFields({ ...base, intent: "not-continuing", reason: "No budget" }).reason).toBe("No budget");
  });
});

describe("toFormFields for maintenance", () => {
  it("sends the plan and fee, and no spots or reason", () => {
    const f = toFormFields({ ...base, intent: "maintain", plan: "Medium", feeCents: 300000, reason: "x", roles: [] });
    expect(f).toEqual({
      intent: "maintain",
      projectId: "p",
      nextStep: "Call",
      nextStepDue: "2026-11-02",
      plan: "Medium",
      feeCents: "300000",
    });
  });

  it("sends an empty fee when none is set", () => {
    expect(toFormFields({ ...base, intent: "maintain", plan: "Hosting", feeCents: null }).feeCents).toBe("");
  });
});
