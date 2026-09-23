import { describe, it, expect } from "vitest";
import {
  buildApplicationTimeline,
  visibleTimeline,
} from "~/hiring/lib/application-timeline";

const at = (d: string) => new Date(`2026-09-${d}T12:00:00.000Z`);

describe("buildApplicationTimeline", () => {
  it("puts every kind of stage change in one list, oldest first", () => {
    const entries = buildApplicationTimeline({
      statusUpdates: [{ newStatus: "Submitted", createdAt: at("01") }],
      delibs: [
        { id: "s1", label: "First delib", status: "Closed", column: "Interview", updatedAt: at("05") },
      ],
      interviews: [
        { id: "iv1", startTime: at("08"), endTime: at("09"), status: "Completed" },
      ],
      decisions: [
        {
          id: "d1",
          type: "InvitedToInterview",
          stage: "Released",
          createdAt: at("06"),
          madeByName: "Sophie Park",
        },
        { id: "d2", type: "Accepted", stage: "Draft", createdAt: at("10") },
      ],
    });

    expect(entries.map((e) => e.label)).toEqual([
      "Application submitted",
      "First delib",
      "Invited to interview",
      "Interview completed",
      "Accepted",
    ]);
  });

  it("labels a delib entry with its column and marks it lead-only", () => {
    const [entry] = buildApplicationTimeline({
      delibs: [
        { id: "s1", label: "Final delib", status: "Active", column: "Waitlist", updatedAt: at("02") },
      ],
    });
    expect(entry).toMatchObject({
      label: "Final delib",
      badge: "In delibs",
      detail: 'In "Waitlist"',
      leadsOnly: true,
    });
  });

  it("skips a delibs board this applicant isn't on", () => {
    expect(
      buildApplicationTimeline({
        delibs: [{ id: "s1", label: "First delib", status: "Closed", column: null, updatedAt: at("02") }],
      }),
    ).toEqual([]);
  });

  it("shows a decision's stage, waitlist rank, notes and author", () => {
    const [entry] = buildApplicationTimeline({
      decisions: [
        {
          id: "d1",
          type: "Waitlisted",
          stage: "Final",
          waitlistRank: 3,
          notes: "Moved without delibs.",
          createdAt: at("04"),
          madeByName: "Sophie Park",
        },
      ],
    });
    expect(entry).toMatchObject({
      label: "Waitlisted #3",
      badge: "Finalized",
      tone: "warning",
      detail: "Moved without delibs.",
      by: "Sophie Park",
      leadsOnly: true,
    });
  });

  it("treats a released decision as visible to everyone", () => {
    const [entry] = buildApplicationTimeline({
      decisions: [{ id: "d1", type: "Rejected", stage: "Released", createdAt: at("04") }],
    });
    expect(entry.leadsOnly).toBe(false);
  });
});

describe("visibleTimeline", () => {
  it("hides lead-only entries from a reviewer and keeps them for a lead", () => {
    const entries = buildApplicationTimeline({
      statusUpdates: [{ newStatus: "Submitted", createdAt: at("01") }],
      delibs: [
        { id: "s1", label: "First delib", status: "Closed", column: "Reject", updatedAt: at("05") },
      ],
      decisions: [
        { id: "d1", type: "Rejected", stage: "Draft", createdAt: at("06") },
        { id: "d2", type: "Rejected", stage: "Released", createdAt: at("07") },
      ],
    });

    expect(visibleTimeline(entries, false).map((e) => e.label)).toEqual([
      "Application submitted",
      "Rejected",
    ]);
    expect(visibleTimeline(entries, true)).toHaveLength(4);
  });
});
