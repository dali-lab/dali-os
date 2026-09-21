// Unit tests for the domain-lead cycle picker. The full loader needs ~12
// prisma mocks, so we extract the selection logic as a pure helper and test
// it here in isolation. Behavioral coverage: ?cycle param honored, Standard
// preferred over Fellowship when both active, fallback to Draft, etc.

import { describe, it, expect } from "vitest";
import { selectActiveCycleForDomainLead } from "~/hiring/lib/cycle-picker";

type C = { id: string; cycleType: string; statusUpdates: Array<{ newStatus: string }> };

const draftStandard: C = { id: "std-draft", cycleType: "Standard", statusUpdates: [{ newStatus: "Draft" }] };
const openStandard: C = { id: "std-open", cycleType: "Standard", statusUpdates: [{ newStatus: "Open" }] };
const underReviewStandard: C = { id: "std-ur", cycleType: "Standard", statusUpdates: [{ newStatus: "UnderReview" }] };
const openIntern: C = { id: "itf-open", cycleType: "Fellowship", statusUpdates: [{ newStatus: "Open" }] };
const draftIntern: C = { id: "itf-draft", cycleType: "Fellowship", statusUpdates: [{ newStatus: "Draft" }] };
const completedStandard: C = { id: "std-done", cycleType: "Standard", statusUpdates: [{ newStatus: "Completed" }] };
const completedIntern: C = { id: "itf-done", cycleType: "Fellowship", statusUpdates: [{ newStatus: "Completed" }] };

describe("selectActiveCycleForDomainLead", () => {
  it("returns null when there are no candidates", () => {
    expect(selectActiveCycleForDomainLead([], null)).toBeNull();
  });

  it("returns the only Standard active cycle when no param given", () => {
    expect(selectActiveCycleForDomainLead([openStandard], null)).toBe(openStandard);
  });

  it("returns the only Fellowship active cycle when no Standard is active", () => {
    expect(selectActiveCycleForDomainLead([openIntern], null)).toBe(openIntern);
  });

  it("prefers Standard Open/UnderReview when both Standard and Fellowship are active", () => {
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

  // Past cycles are offered in the picker so a lead can reopen one, but they
  // are only ever reached deliberately.
  it("opens a Completed cycle when ?cycle=<id> names one", () => {
    expect(
      selectActiveCycleForDomainLead([completedStandard, openStandard], completedStandard.id),
    ).toBe(completedStandard);
  });

  it("never defaults to a Completed cycle while a live one exists", () => {
    expect(selectActiveCycleForDomainLead([completedStandard, openIntern], null)).toBe(openIntern);
    expect(selectActiveCycleForDomainLead([completedStandard, draftStandard], null)).toBe(draftStandard);
  });

  it("returns null when every cycle is Completed, so the page keeps its empty state", () => {
    expect(selectActiveCycleForDomainLead([completedStandard, completedIntern], null)).toBeNull();
  });
});
