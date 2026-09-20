import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  listMyHiringApplications,
  overallApplicationStatus,
} from "~/hiring/lib/applicant-history.server";

const mockPrisma = prisma as unknown as {
  application: { findMany: ReturnType<typeof vi.fn> };
};

const d = (iso: string) => new Date(iso);

beforeEach(() => vi.clearAllMocks());

describe("overallApplicationStatus", () => {
  it("is Draft with no Submitted entry", () => {
    expect(overallApplicationStatus([{ newStatus: "Draft", createdAt: d("2026-01-01") }])).toBe(
      "Draft",
    );
  });

  it("is Submitted once submitted", () => {
    expect(
      overallApplicationStatus([
        { newStatus: "Draft", createdAt: d("2026-01-01") },
        { newStatus: "Submitted", createdAt: d("2026-01-02") },
      ]),
    ).toBe("Submitted");
  });

  it("lets a later Withdrawn win over the earlier Submitted", () => {
    expect(
      overallApplicationStatus([
        { newStatus: "Submitted", createdAt: d("2026-01-02") },
        { newStatus: "Withdrawn", createdAt: d("2026-01-05") },
      ]),
    ).toBe("Withdrawn");
  });
});

describe("listMyHiringApplications", () => {
  it("resolves each cycle's per-domain status and the first submission date", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      {
        id: "app-1",
        statusUpdates: [
          { newStatus: "Draft", createdAt: d("2026-01-01") },
          { newStatus: "Submitted", createdAt: d("2026-01-03") },
          // A re-submission after an edit shouldn't move the "applied on" date.
          { newStatus: "Submitted", createdAt: d("2026-01-07") },
        ],
        applicationCycle: {
          id: "cycle-1",
          name: "Fall 2026",
          statusUpdates: [{ newStatus: "UnderReview" }],
        },
        domainApplications: [
          {
            id: "da-1",
            domain: { name: "Design" },
            closureReason: null,
            application: {
              statusUpdates: [
                { newStatus: "Draft", createdAt: d("2026-01-01") },
                { newStatus: "Submitted", createdAt: d("2026-01-03") },
              ],
            },
            decisions: [],
            interviews: [],
          },
        ],
      },
    ]);

    const [entry] = await listMyHiringApplications("user-1");

    expect(entry).toMatchObject({
      id: "app-1",
      cycleId: "cycle-1",
      cycleName: "Fall 2026",
      applicationStatus: "Submitted",
      domains: [{ id: "da-1", domainName: "Design", status: "Pending" }],
    });
    expect(entry.submittedAt).toEqual(d("2026-01-03"));
  });

  it("leaves an unsubmitted application in an open cycle as ApplicationOpen", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      {
        id: "app-2",
        statusUpdates: [{ newStatus: "Draft", createdAt: d("2026-02-01") }],
        applicationCycle: {
          id: "cycle-2",
          name: "Winter 2027",
          statusUpdates: [{ newStatus: "Open" }],
        },
        domainApplications: [
          {
            id: "da-2",
            domain: { name: "Dev" },
            closureReason: null,
            application: { statusUpdates: [{ newStatus: "Draft", createdAt: d("2026-02-01") }] },
            decisions: [],
            interviews: [],
          },
        ],
      },
    ]);

    const [entry] = await listMyHiringApplications("user-1");

    expect(entry.applicationStatus).toBe("Draft");
    expect(entry.submittedAt).toBeNull();
    expect(entry.domains[0].status).toBe("ApplicationOpen");
  });
});
