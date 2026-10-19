import { describe, it, expect } from "vitest";
import {
  isPartnerStage,
  isStale,
  OPEN_STAGES,
  PARTNER_EDITABLE_STAGES,
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  partnerTrackIndex,
  UNDECIDED_STAGES,
} from "../partner-application";

const now = new Date("2026-10-18T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("partner stages", () => {
  it("orders the board with Backlog first", () => {
    expect(PARTNER_STAGES).toEqual(["Backlog", "New", "Interview", "Accepted", "Rejected"]);
  });

  it("labels every stage", () => {
    for (const s of PARTNER_STAGES) expect(PARTNER_STAGE_LABELS[s]).toBeTruthy();
  });

  it("accepts Backlog as a stage", () => {
    expect(isPartnerStage("Backlog")).toBe(true);
    expect(isPartnerStage("Parked")).toBe(false);
  });

  it("keeps Backlog out of the stale sweep and next-step reminders", () => {
    expect(OPEN_STAGES).not.toContain("Backlog");
    expect(isStale({ stage: "Backlog", lastActivityAt: daysAgo(90) }, 14, now)).toBe(false);
  });

  it("still flags a quiet New or Interview application as stale", () => {
    expect(isStale({ stage: "New", lastActivityAt: daysAgo(20) }, 14, now)).toBe(true);
    expect(isStale({ stage: "Interview", lastActivityAt: daysAgo(20) }, 14, now)).toBe(true);
    expect(isStale({ stage: "Interview", lastActivityAt: daysAgo(2) }, 14, now)).toBe(false);
  });

  it("counts Backlog as undecided so a renewal is not created beside it", () => {
    expect(UNDECIDED_STAGES).toEqual(["Backlog", "New", "Interview"]);
  });

  it("lets the partner edit their pitch while it sits in Backlog or New", () => {
    expect(PARTNER_EDITABLE_STAGES).toEqual(["Backlog", "New"]);
  });

  it("shows a Backlog application to the partner as submitted", () => {
    expect(partnerTrackIndex({ stage: "Backlog", resultingProjectId: null })).toBe(0);
    expect(partnerTrackIndex({ stage: "New", resultingProjectId: null })).toBe(0);
    expect(partnerTrackIndex({ stage: "Interview", resultingProjectId: null })).toBe(1);
    expect(partnerTrackIndex({ stage: "Rejected", resultingProjectId: null })).toBe(2);
    expect(partnerTrackIndex({ stage: "Accepted", resultingProjectId: "p1" })).toBe(3);
  });
});
