// The delibs board takes its columns and title from its round's place in the
// cycle's timeline, and shows a notice when that round was removed.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCycleAdmin: vi.fn().mockResolvedValue(true) }));
vi.mock("~/lib/user-pages.server", () => ({ recordRouteVisit: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: () => "tok" }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requirePageSignedOrRedirect: vi.fn().mockResolvedValue(null) }));
vi.mock("~/hiring/lib/cycle-stages.server", () => ({ delibsQualifier: vi.fn().mockResolvedValue({}) }));
vi.mock("~/hiring/lib/email-engagement.server", () => ({ getEngagementSummaries: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { delibsQualifier } from "~/hiring/lib/cycle-stages.server";
import { getEngagementSummaries } from "~/hiring/lib/email-engagement.server";
import { STANDARD_TIMELINE } from "~/hiring/lib/cycle-timeline";
import { loader } from "~/hiring/routes/domain-lead.delibs.$id";

const mockPrisma = prisma as unknown as Record<string, any>;

function board(roundId: string) {
  mockPrisma.delibsSession = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      id: "s1",
      roundId,
      domainId: "d1",
      applicationCycleId: "c1",
      columnOrder: {},
      domain: { name: "Engineering" },
      applicationCycle: { statusUpdates: [] },
    }),
  };
}

const callLoader = () =>
  loader({ request: new Request("http://localhost/hiring/domain-lead/delibs/s1"), params: { id: "s1" }, context: {} } as any) as Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEngagementSummaries).mockResolvedValue(new Map());
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", email: "u@x" } } as any);
  mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ firstName: "A", lastName: "B" }) };
  mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.applicationCycle = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "c1", timeline: STANDARD_TIMELINE, anonymizeReview: false }),
  };
  mockPrisma.domainApplication = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("domain-lead delibs board loader", () => {
  it("uses the first round's columns (it leads to interviews) and its label", async () => {
    board("first");
    const res = await callLoader();
    expect(res.columns).toEqual(["No Decision", "Interview", "Reject"]);
    expect(res.round).toMatchObject({ id: "first", label: "First delib", index: 0 });
    expect(vi.mocked(delibsQualifier).mock.calls[0][1]).toBe("first");
  });

  it("uses accept/waitlist/reject on the last round", async () => {
    board("final");
    const res = await callLoader();
    expect(res.columns).toEqual(["Accept", "Waitlist", "Reject"]);
  });

  it("shows no board when the round is gone from the timeline", async () => {
    board("gone");
    const res = await callLoader();
    expect(res.round).toBeNull();
    expect(res.columns).toEqual([]);
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("attaches each applicant's email engagement to their card, null when they never wrote", async () => {
    board("first");
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      { id: "da1", application: { id: "a1", userId: "wrote", user: { firstName: "A", lastName: "B" } }, reviews: [] },
      { id: "da2", application: { id: "a2", userId: "silent", user: { firstName: "C", lastName: "D" } }, reviews: [] },
    ]);
    const summary = { fromThem: 1, threadsStarted: 1, lastFromThemAt: "2026-01-01T00:00:00.000Z" };
    vi.mocked(getEngagementSummaries).mockResolvedValue(new Map([["wrote", summary]]));

    const res = await callLoader();

    expect(getEngagementSummaries).toHaveBeenCalledWith(["wrote", "silent"]);
    expect(res.domainApplications.map((d: any) => [d.id, d.emailEngagement])).toEqual([
      ["da1", summary],
      ["da2", null],
    ]);
  });
});
