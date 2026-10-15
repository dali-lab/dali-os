import { describe, it, expect } from "vitest";
import { portalCycleCard, HIRING_STATUS } from "~/hiring/lib/portal-cycle-card";

const base = {
  open: false,
  closesOn: null,
  applicationStatus: "Submitted" as string | null,
  domains: [] as { name: string; status: string }[],
  applyHref: "/portal/apply/c1",
  trackHref: "/portal/hiring?cycle=c1",
};

describe("portalCycleCard", () => {
  it("offers Apply while open with no application, and nothing once closed", () => {
    expect(portalCycleCard({ ...base, open: true, closesOn: "Fri, Oct 17", applicationStatus: null })).toEqual({
      meta: "Due Fri, Oct 17",
      action: { label: "Apply", href: "/portal/apply/c1" },
    });
    expect(portalCycleCard({ ...base, applicationStatus: null })).toEqual({ meta: "Under review", action: null });
  });

  it("sends a draft back into the form while the cycle is open", () => {
    expect(portalCycleCard({ ...base, open: true, closesOn: "Fri, Oct 17", applicationStatus: "Draft" })).toEqual({
      meta: "Draft · Due Fri, Oct 17",
      action: { label: "Finish", href: "/portal/apply/c1" },
    });
  });

  it("reads Submitted with a Track button only until a domain moves on", () => {
    expect(portalCycleCard({ ...base, domains: [{ name: "Design", status: "Pending" }] })).toEqual({
      meta: "Under review",
      action: { label: "Track", href: "/portal/hiring?cycle=c1" },
    });
    expect(portalCycleCard(base).meta).toBe("Submitted");
  });

  it("asks the applicant to book once a domain invites them to interview", () => {
    expect(portalCycleCard({ ...base, domains: [{ name: "Design", status: "InvitedToInterview" }] })).toEqual({
      meta: "Interview invite",
      action: { label: "Book interview", href: "/portal/hiring?cycle=c1" },
    });
  });

  it("points at the booked interview", () => {
    expect(portalCycleCard({ ...base, domains: [{ name: "Design", status: "InterviewScheduled" }] })).toMatchObject({
      meta: "Interview scheduled",
      action: { label: "View interview" },
    });
  });

  it("shows the decision once every domain is decided", () => {
    expect(
      portalCycleCard({
        ...base,
        domains: [
          { name: "Design", status: "Accepted" },
          { name: "Developer", status: "AcceptedElsewhere" },
        ],
      }),
    ).toMatchObject({ meta: "Design: Accepted · Developer: Placed elsewhere", action: { label: "View decision" } });
  });

  it("names each domain when their statuses differ and keeps Track while one is still open", () => {
    expect(
      portalCycleCard({
        ...base,
        domains: [
          { name: "Design", status: "Rejected" },
          { name: "Developer", status: "Pending" },
        ],
      }),
    ).toEqual({
      meta: "Design: Not accepted · Developer: Under review",
      action: { label: "Track", href: "/portal/hiring?cycle=c1" },
    });
  });

  it("collapses domains that share a status into one label", () => {
    expect(
      portalCycleCard({
        ...base,
        domains: [
          { name: "Design", status: "Pending" },
          { name: "Developer", status: "Pending" },
        ],
      }).meta,
    ).toBe("Under review");
  });

  it("treats a withdrawn application as final", () => {
    expect(portalCycleCard({ ...base, applicationStatus: "Withdrawn", domains: [{ name: "Design", status: "Withdrawn" }] })).toEqual({
      meta: "Withdrawn",
      action: { label: "View", href: "/portal/hiring?cycle=c1" },
    });
  });

  it("has a label for every tracker status", () => {
    for (const status of ["ApplicationOpen", "Pending", "InvitedToInterview", "InterviewScheduled", "PostInterviewPending", "Accepted", "AcceptedElsewhere", "Waitlisted", "Rejected", "Withdrawn"]) {
      expect(HIRING_STATUS[status]?.label).toBeTruthy();
    }
  });
});
