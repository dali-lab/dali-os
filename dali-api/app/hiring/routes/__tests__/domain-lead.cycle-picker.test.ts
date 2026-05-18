// Unit tests for the domain-lead cycle picker. The full loader needs ~12
// prisma mocks, so we extract the selection logic as a pure helper and test
// it here in isolation. Behavioral coverage: ?cycle param honored, Standard
// preferred over InternToFull when both active, fallback to Draft, etc.

import { describe, it, expect } from "vitest";
import { selectActiveCycleForDomainLead } from "~/hiring/lib/cycle-picker";

type C = { id: string; cycleType: string; statusUpdates: Array<{ newStatus: string }> };

const draftStandard: C = { id: "std-draft", cycleType: "Standard", statusUpdates: [{ newStatus: "Draft" }] };
const openStandard: C = { id: "std-open", cycleType: "Standard", statusUpdates: [{ newStatus: "Open" }] };
const underReviewStandard: C = { id: "std-ur", cycleType: "Standard", statusUpdates: [{ newStatus: "UnderReview" }] };
const openIntern: C = { id: "itf-open", cycleType: "InternToFull", statusUpdates: [{ newStatus: "Open" }] };
const draftIntern: C = { id: "itf-draft", cycleType: "InternToFull", statusUpdates: [{ newStatus: "Draft" }] };

describe("selectActiveCycleForDomainLead", () => {
  it("returns null when there are no candidates", () => {
    expect(selectActiveCycleForDomainLead([], null)).toBeNull();
  });

  it("returns the only Standard active cycle when no param given", () => {
    expect(selectActiveCycleForDomainLead([openStandard], null)).toBe(openStandard);
  });

  it("returns the only InternToFull active cycle when no Standard is active", () => {
    expect(selectActiveCycleForDomainLead([openIntern], null)).toBe(openIntern);
  });

  it("prefers Standard Open/UnderReview when both Standard and InternToFull are active", () => {
    expect(selectActiveCycleForDomainLead([openIntern, openStandard], null)).toBe(openStandard);
    expect(selectActiveCycleForDomainLead([openIntern, underReviewStandard], null)).toBe(underReviewStandard);
  });

  it("honors ?cycle=<id> when valid even if Standard would normally win", () => {
    expect(
      selectActiveCycleForDomainLead([openIntern, openStandard], openIntern.id),
    ).toBe(openIntern);
  });

  it("ignores ?cycle=<id> if it doesn't match any candidate and falls back to default", () => {
    expect(
      selectActiveCycleForDomainLead([openIntern, openStandard], "bogus"),
    ).toBe(openStandard);
  });

  it("falls back to any Open/UnderReview when no Standard is active", () => {
    expect(selectActiveCycleForDomainLead([openIntern, draftStandard], null)).toBe(openIntern);
  });

  it("falls back to Draft when nothing is Open/UnderReview", () => {
    expect(selectActiveCycleForDomainLead([draftStandard, draftIntern], null)).toBe(draftStandard);
  });
});
