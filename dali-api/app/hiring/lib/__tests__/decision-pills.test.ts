import { describe, it, expect } from "vitest";
import {
  summarizeDecisionPills,
  synthesizePrePipelinePill,
} from "~/hiring/lib/decision-pills";
import type { DecisionStage, DecisionType } from "~/types";

function row(
  type: DecisionType,
  stage: DecisionStage,
  createdAtIso: string,
  extras: { waitlistRank?: number | null } = {},
) {
  return {
    type,
    stage,
    createdAt: new Date(createdAtIso),
    waitlistRank: extras.waitlistRank ?? null,
  };
}

describe("summarizeDecisionPills", () => {
  it("returns empty when there are no decisions", () => {
    expect(summarizeDecisionPills({ decisions: [] })).toEqual([]);
  });

  it("Interview (final): closed initial delibs, not yet released", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("InvitedToInterview", "Draft", "2025-01-01T10:00:00Z"),
        row("InvitedToInterview", "Final", "2025-01-02T10:00:00Z"),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({ type: "InvitedToInterview", stage: "Final" }),
    ]);
  });

  it("Interview (released): invited, awaiting interview", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("InvitedToInterview", "Draft", "2025-01-01T10:00:00Z"),
        row("InvitedToInterview", "Final", "2025-01-02T10:00:00Z"),
        row("InvitedToInterview", "Released", "2025-01-03T10:00:00Z"),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({
        type: "InvitedToInterview",
        stage: "Released",
      }),
    ]);
  });

  it("Interview (released), Accept (final): post-interview decision pending release", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("InvitedToInterview", "Released", "2025-01-03T10:00:00Z"),
        row("Accepted", "Draft", "2025-02-01T10:00:00Z"),
        row("Accepted", "Final", "2025-02-02T10:00:00Z"),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({
        type: "InvitedToInterview",
        stage: "Released",
      }),
      expect.objectContaining({ type: "Accepted", stage: "Final" }),
    ]);
  });

  it("Interview (released), Reject (released): post-interview rejection", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("InvitedToInterview", "Released", "2025-01-03T10:00:00Z"),
        row("Rejected", "Draft", "2025-02-01T10:00:00Z"),
        row("Rejected", "Final", "2025-02-02T10:00:00Z"),
        row("Rejected", "Released", "2025-02-03T10:00:00Z"),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({
        type: "InvitedToInterview",
        stage: "Released",
      }),
      expect.objectContaining({ type: "Rejected", stage: "Released" }),
    ]);
  });

  it("Interview (released), Waitlist #3 (released): includes waitlistRank", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("InvitedToInterview", "Released", "2025-01-03T10:00:00Z"),
        row("Waitlisted", "Released", "2025-02-01T10:00:00Z", {
          waitlistRank: 3,
        }),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({
        type: "InvitedToInterview",
        stage: "Released",
      }),
      expect.objectContaining({
        type: "Waitlisted",
        stage: "Released",
        waitlistRank: 3,
      }),
    ]);
  });

  it("ignores a stale Final when a newer Draft of the same type follows (#77 guard)", () => {
    // Per the issue: "the row at the highest stage" wins. A Draft created
    // after a Final does NOT supersede that Final on this view — the Final
    // still represents a real decision the lead made.
    const pills = summarizeDecisionPills({
      decisions: [
        row("InvitedToInterview", "Final", "2025-01-01T10:00:00Z"),
        row("InvitedToInterview", "Draft", "2025-01-02T10:00:00Z"),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({
        type: "InvitedToInterview",
        stage: "Final",
      }),
    ]);
  });

  it("at the same stage, picks the newer row", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("Waitlisted", "Released", "2025-01-01T10:00:00Z", {
          waitlistRank: 5,
        }),
        row("Waitlisted", "Released", "2025-01-02T10:00:00Z", {
          waitlistRank: 2,
        }),
      ],
    });
    expect(pills).toEqual([
      expect.objectContaining({
        type: "Waitlisted",
        stage: "Released",
        waitlistRank: 2,
      }),
    ]);
  });

  it("orders pills by chosen row's createdAt, oldest first", () => {
    const pills = summarizeDecisionPills({
      decisions: [
        row("Accepted", "Final", "2025-03-01T10:00:00Z"),
        row("InvitedToInterview", "Released", "2025-01-01T10:00:00Z"),
      ],
    });
    expect(pills.map((p) => p.type)).toEqual([
      "InvitedToInterview",
      "Accepted",
    ]);
  });
});

describe("synthesizePrePipelinePill", () => {
  it("returns null when any decision exists (caller is supposed to gate, but be safe)", () => {
    expect(
      synthesizePrePipelinePill({
        application: { statusUpdates: [{ newStatus: "Submitted" }] },
        interviews: [],
        decisions: [{}],
      }),
    ).toBe(null);
  });

  it("Reviewing: submitted, no decisions, no interview", () => {
    expect(
      synthesizePrePipelinePill({
        application: { statusUpdates: [{ newStatus: "Submitted" }] },
        interviews: [],
        decisions: [],
      }),
    ).toBe("Reviewing");
  });

  it("InterviewScheduled: any Scheduled interview row", () => {
    expect(
      synthesizePrePipelinePill({
        application: { statusUpdates: [{ newStatus: "Submitted" }] },
        interviews: [{ status: "Scheduled" }],
        decisions: [],
      }),
    ).toBe("InterviewScheduled");
  });

  it("PostInterview: Completed interview, no decisions", () => {
    expect(
      synthesizePrePipelinePill({
        application: { statusUpdates: [{ newStatus: "Submitted" }] },
        interviews: [{ status: "Completed" }],
        decisions: [],
      }),
    ).toBe("PostInterview");
  });

  it("Scheduled wins over Completed when both present", () => {
    expect(
      synthesizePrePipelinePill({
        application: { statusUpdates: [{ newStatus: "Submitted" }] },
        interviews: [{ status: "Completed" }, { status: "Scheduled" }],
        decisions: [],
      }),
    ).toBe("InterviewScheduled");
  });

  it("returns null when no submission and no interview", () => {
    expect(
      synthesizePrePipelinePill({
        application: { statusUpdates: [] },
        interviews: [],
        decisions: [],
      }),
    ).toBe(null);
  });
});
