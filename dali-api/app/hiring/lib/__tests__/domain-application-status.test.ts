import { describe, it, expect } from "vitest";
import { inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";

function makeDa(overrides: {
  statusUpdates?: Array<{ newStatus: string }>;
  decisions?: Array<{ stage: string; type: string; createdAt: Date; interviewRoundId?: string | null }>;
  interviews?: Array<{ status: string; interviewRoundId?: string }>;
  closureReason?: "AcceptedElsewhere" | null;
  submittedAt?: Date | null;
} = {}): any {
  return {
    application: { statusUpdates: overrides.statusUpdates ?? [] },
    decisions: overrides.decisions ?? [],
    interviews: (overrides.interviews ?? []).map((i) => ({ interviewRoundId: "interviews", ...i })),
    closureReason: overrides.closureReason ?? null,
    submittedAt: overrides.submittedAt ?? null,
  };
}

describe("inferDomainApplicationStatus", () => {
  it("returns ApplicationOpen when never submitted", () => {
    expect(
      inferDomainApplicationStatus(makeDa(), "Open"),
    ).toBe("ApplicationOpen");
  });

  it("returns ApplicationOpen for a DA added after the application was submitted, regardless of cycle status", () => {
    // The application-level Submitted update exists, but this particular DA's
    // own submittedAt is still null (e.g. the domain was added afterward).
    const status = inferDomainApplicationStatus(
      makeDa({ statusUpdates: [{ newStatus: "Submitted" }], submittedAt: null }),
      "UnderReview",
    );
    expect(status).toBe("ApplicationOpen");
  });

  it("a never-submitted DA reads ApplicationOpen even with a Released decision and a Completed cycle", () => {
    const status = inferDomainApplicationStatus(
      makeDa({
        statusUpdates: [{ newStatus: "Submitted" }],
        submittedAt: null,
        decisions: [{ type: "Rejected", stage: "Released", createdAt: new Date() }],
      }),
      "Completed",
    );
    expect(status).toBe("ApplicationOpen");
  });

  it("returns Withdrawn when application has a Withdrawn status update (terminal)", () => {
    const status = inferDomainApplicationStatus(
      makeDa({
        statusUpdates: [
          { newStatus: "Submitted" },
          { newStatus: "Withdrawn" },
        ],
      }),
      "UnderReview",
    );
    expect(status).toBe("Withdrawn");
  });

  it("Withdrawn short-circuits past Released decisions", () => {
    // Even if a decision has been Released, a subsequent withdrawal should
    // surface as Withdrawn so the application drops out of the active queue.
    const status = inferDomainApplicationStatus(
      makeDa({
        statusUpdates: [
          { newStatus: "Submitted" },
          { newStatus: "Withdrawn" },
        ],
        decisions: [
          { type: "InvitedToInterview", stage: "Released", createdAt: new Date() },
        ],
      }),
      "UnderReview",
    );
    expect(status).toBe("Withdrawn");
  });

  it("returns Pending when submitted and no Released decision", () => {
    expect(
      inferDomainApplicationStatus(
        makeDa({ statusUpdates: [{ newStatus: "Submitted" }], submittedAt: new Date() }),
        "UnderReview",
      ),
    ).toBe("Pending");
  });

  it("returns AcceptedElsewhere for a closed DA instead of a stale Pending", () => {
    // Accepted into another domain this cycle → this sibling was closed.
    const status = inferDomainApplicationStatus(
      makeDa({
        statusUpdates: [{ newStatus: "Submitted" }],
        closureReason: "AcceptedElsewhere",
      }),
      "UnderReview",
    );
    expect(status).toBe("AcceptedElsewhere");
  });

  it("closure applies even when the app was never submitted (over ApplicationOpen)", () => {
    const status = inferDomainApplicationStatus(
      makeDa({ closureReason: "AcceptedElsewhere" }),
      "Open",
    );
    expect(status).toBe("AcceptedElsewhere");
  });

  it("an explicit Withdrawal still wins over closure", () => {
    const status = inferDomainApplicationStatus(
      makeDa({
        statusUpdates: [{ newStatus: "Submitted" }, { newStatus: "Withdrawn" }],
        closureReason: "AcceptedElsewhere",
      }),
      "UnderReview",
    );
    expect(status).toBe("Withdrawn");
  });

  it("an applicant cancel is a withdrawal, but an admin cancel leaves them invited to rebook", () => {
    const invited = [{ type: "InvitedToInterview", stage: "Released", createdAt: new Date() }];
    const base = { statusUpdates: [{ newStatus: "Submitted" }], decisions: invited, submittedAt: new Date() };
    expect(
      inferDomainApplicationStatus(
        makeDa({ ...base, interviews: [{ status: "CancelledByApplicant" }] }),
        "UnderReview",
      ),
    ).toBe("Withdrawn");
    // The include fragment filters CancelledByAdmin rows out before derivation,
    // so from the derivation's point of view nothing was ever booked.
    expect(inferDomainApplicationStatus(makeDa({ ...base, interviews: [] }), "UnderReview")).toBe(
      "InvitedToInterview",
    );
  });

  describe("a second Interviews round", () => {
    const submitted = { statusUpdates: [{ newStatus: "Submitted" }], submittedAt: new Date() };
    const invites = [
      { type: "InvitedToInterview", stage: "Released", createdAt: new Date("2026-10-10"), interviewRoundId: "iv2" },
      { type: "InvitedToInterview", stage: "Released", createdAt: new Date("2026-10-01"), interviewRoundId: "interviews" },
    ];

    it("reads invited again once round 1's interview is done", () => {
      const da = makeDa({ ...submitted, decisions: invites, interviews: [{ status: "Completed" }] });
      expect(inferDomainApplicationStatus(da, "UnderReview")).toBe("InvitedToInterview");
    });

    it("reads scheduled, then done, from round 2's own interview", () => {
      const scheduled = makeDa({
        ...submitted,
        decisions: invites,
        interviews: [{ status: "Scheduled", interviewRoundId: "iv2" }, { status: "Completed" }],
      });
      expect(inferDomainApplicationStatus(scheduled, "UnderReview")).toBe("InterviewScheduled");
      const done = makeDa({
        ...submitted,
        decisions: invites,
        interviews: [{ status: "Completed", interviewRoundId: "iv2" }, { status: "Completed" }],
      });
      expect(inferDomainApplicationStatus(done, "UnderReview")).toBe("PostInterviewPending");
    });

    it("doesn't read a round 1 applicant cancel as withdrawing from round 2", () => {
      const da = makeDa({
        ...submitted,
        decisions: invites,
        interviews: [{ status: "CancelledByApplicant" }, { status: "Completed" }],
      });
      expect(inferDomainApplicationStatus(da, "UnderReview")).toBe("InvitedToInterview");
    });

    it("treats an invite with no round as round 1", () => {
      const da = makeDa({
        ...submitted,
        decisions: [{ type: "InvitedToInterview", stage: "Released", createdAt: new Date(), interviewRoundId: null }],
        interviews: [{ status: "Completed" }],
      });
      expect(inferDomainApplicationStatus(da, "UnderReview")).toBe("PostInterviewPending");
    });
  });
});
