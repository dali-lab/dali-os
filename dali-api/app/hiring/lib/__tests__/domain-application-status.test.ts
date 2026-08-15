import { describe, it, expect } from "vitest";
import { inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";

function makeDa(overrides: {
  statusUpdates?: Array<{ newStatus: string }>;
  decisions?: Array<{ stage: string; type: string; createdAt: Date }>;
  interviews?: Array<{ status: string }>;
  closureReason?: "AcceptedElsewhere" | null;
} = {}): any {
  return {
    application: { statusUpdates: overrides.statusUpdates ?? [] },
    decisions: overrides.decisions ?? [],
    interviews: overrides.interviews ?? [],
    closureReason: overrides.closureReason ?? null,
  };
}

describe("inferDomainApplicationStatus", () => {
  it("returns ApplicationOpen when cycle is Open and never submitted", () => {
    expect(
      inferDomainApplicationStatus(makeDa(), "Open"),
    ).toBe("ApplicationOpen");
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
        makeDa({ statusUpdates: [{ newStatus: "Submitted" }] }),
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
});
