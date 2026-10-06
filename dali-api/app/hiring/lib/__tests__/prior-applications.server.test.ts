import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { listPriorApplications } from "~/hiring/lib/prior-applications.server";

const mockPrisma = prisma as unknown as {
  application: { findMany: ReturnType<typeof vi.fn> };
};

const d = (iso: string) => new Date(iso);

beforeEach(() => vi.clearAllMocks());

function makeApp(opts: {
  id: string;
  applicationType?: string;
  statusUpdates: { newStatus: string; createdAt: Date }[];
}) {
  return {
    id: opts.id,
    applicationType: opts.applicationType ?? "Standard",
    statusUpdates: opts.statusUpdates,
    applicationCycle: {
      id: `cycle-${opts.id}`,
      name: `Cycle ${opts.id}`,
      statusUpdates: [{ newStatus: "UnderReview" }],
    },
    domainApplications: [
      {
        id: `da-${opts.id}`,
        domain: { name: "Design" },
        closureReason: null,
        application: { statusUpdates: opts.statusUpdates },
        decisions: [],
        interviews: [],
      },
    ],
  };
}

describe("listPriorApplications", () => {
  it("excludes the current application and drafts", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      makeApp({
        id: "current",
        statusUpdates: [{ newStatus: "Submitted", createdAt: d("2026-01-01") }],
      }),
      makeApp({
        id: "draft",
        statusUpdates: [{ newStatus: "Draft", createdAt: d("2026-01-02") }],
      }),
      makeApp({
        id: "prior-1",
        statusUpdates: [{ newStatus: "Submitted", createdAt: d("2026-01-03") }],
      }),
    ]);

    const rows = await listPriorApplications({
      userId: "user-1",
      currentApplicationId: "current",
      hideOutcomes: false,
    });

    expect(rows.map((r) => r.id)).toEqual(["prior-1"]);
  });

  it("nulls every domain status when hideOutcomes is set", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      makeApp({
        id: "prior-1",
        statusUpdates: [{ newStatus: "Submitted", createdAt: d("2026-01-03") }],
      }),
    ]);

    const rows = await listPriorApplications({
      userId: "user-1",
      currentApplicationId: "current",
      hideOutcomes: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].domains.length).toBeGreaterThan(0);
    expect(rows[0].domains.every((domain) => domain.status === null)).toBe(true);
  });

  it("leaves domain statuses intact when hideOutcomes is false", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      makeApp({
        id: "prior-1",
        statusUpdates: [{ newStatus: "Submitted", createdAt: d("2026-01-03") }],
      }),
    ]);

    const rows = await listPriorApplications({
      userId: "user-1",
      currentApplicationId: "current",
      hideOutcomes: false,
    });

    expect(rows[0].domains[0].status).toBe("Pending");
  });

  it("includes applicationType on each row", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      makeApp({
        id: "prior-1",
        applicationType: "Fellowship",
        statusUpdates: [{ newStatus: "Submitted", createdAt: d("2026-01-03") }],
      }),
    ]);

    const rows = await listPriorApplications({
      userId: "user-1",
      currentApplicationId: "current",
      hideOutcomes: false,
    });

    expect(rows[0].applicationType).toBe("Fellowship");
  });
});
