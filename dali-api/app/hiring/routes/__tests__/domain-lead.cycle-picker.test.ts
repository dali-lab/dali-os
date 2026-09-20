// Unit tests for the domain-lead cycle picker. The full loader needs ~12
// prisma mocks, so we extract the selection logic as a pure helper and test
// it here in isolation. Behavioral coverage: ?cycle param honored, Students
// preferred over Interns when both active, fallback to Draft, etc.

import { describe, it, expect } from "vitest";
import { selectActiveCycleForDomainLead } from "~/hiring/lib/cycle-picker";

type C = { id: string; applicants: string; statusUpdates: Array<{ newStatus: string }> };

const draftStandard: C = { id: "std-draft", applicants: "Students", statusUpdates: [{ newStatus: "Draft" }] };
const openStandard: C = { id: "std-open", applicants: "Students", statusUpdates: [{ newStatus: "Open" }] };
const underReviewStandard: C = { id: "std-ur", applicants: "Students", statusUpdates: [{ newStatus: "UnderReview" }] };
const openIntern: C = { id: "itf-open", applicants: "Interns", statusUpdates: [{ newStatus: "Open" }] };
const draftIntern: C = { id: "itf-draft", applicants: "Interns", statusUpdates: [{ newStatus: "Draft" }] };

describe("selectActiveCycleForDomainLead", () => {
  it("returns null when there are no candidates", () => {
    expect(selectActiveCycleForDomainLead([], null)).toBeNull();
  });

  it("returns the only Students active cycle when no param given", () => {
    expect(selectActiveCycleForDomainLead([openStandard], null)).toBe(openStandard);
  });

  it("returns the only Interns active cycle when no Students is active", () => {
    expect(selectActiveCycleForDomainLead([openIntern], null)).toBe(openIntern);
  });

  it("prefers Students Open/UnderReview when both Students and Interns are active", () => {
    expect(selectActiveCycleForDomainLead([openIntern, openStandard], null)).toBe(openStandard);
    expect(selectActiveCycleForDomainLead([openIntern, underReviewStandard], null)).toBe(underReviewStandard);
  });

  it("honors ?cycle=<id> when valid even if Students would normally win", () => {
    expect(
      selectActiveCycleForDomainLead([openIntern, openStandard], openIntern.id),
    ).toBe(openIntern);
  });

  it("ignores ?cycle=<id> if it doesn't match any candidate and falls back to default", () => {
    expect(
      selectActiveCycleForDomainLead([openIntern, openStandard], "bogus"),
    ).toBe(openStandard);
  });

  it("falls back to any Open/UnderReview when no Students is active", () => {
    expect(selectActiveCycleForDomainLead([openIntern, draftStandard], null)).toBe(openIntern);
  });

  it("falls back to Draft when nothing is Open/UnderReview", () => {
    expect(selectActiveCycleForDomainLead([draftStandard, draftIntern], null)).toBe(draftStandard);
  });
});
