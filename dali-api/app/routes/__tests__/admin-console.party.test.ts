import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/db");
vi.mock("~/lib/roles");

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { loader } from "~/routes/admin-console.party";

const ADMIN_ID = "admin-1";

const mockPrisma = prisma as unknown as {
  partyEvent: {
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: { findMany: ReturnType<typeof vi.fn> };
};

function makeRequest(url = "http://localhost/admin-console/party") {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);

  mockPrisma.partyEvent.groupBy.mockImplementation(async (args: any) => {
    const by: string[] = args.by ?? [];
    // by: ["eventType"]
    if (by.length === 1 && by[0] === "eventType") {
      return [
        { eventType: "PARTY_VISIT", _count: { _all: 10 } },
        { eventType: "CODE_UNLOCK_SUCCESS", _count: { _all: 4 } },
        { eventType: "CODE_UNLOCK_FAILURE", _count: { _all: 2 } },
      ];
    }
    // by: ["eventType", "audience"]
    if (by[0] === "eventType" && by[1] === "audience") {
      return [
        { eventType: "CODE_UNLOCK_SUCCESS", audience: "member", _count: { _all: 3 } },
        { eventType: "CODE_UNLOCK_SUCCESS", audience: "applicant", _count: { _all: 1 } },
        { eventType: "CODE_UNLOCK_FAILURE", audience: "applicant", _count: { _all: 2 } },
      ];
    }
    // by: ["userId", "eventType"] with _max
    if (by[0] === "userId" && by[1] === "eventType") {
      return [
        {
          userId: "u-1",
          eventType: "PARTY_VISIT",
          _count: { _all: 5 },
          _max: { createdAt: new Date("2026-04-29T10:00:00Z") },
        },
        {
          userId: "u-1",
          eventType: "CODE_UNLOCK_SUCCESS",
          _count: { _all: 1 },
          _max: { createdAt: new Date("2026-04-30T11:00:00Z") },
        },
        {
          userId: null,
          eventType: "PARTY_VISIT",
          _count: { _all: 2 },
          _max: { createdAt: new Date("2026-04-28T10:00:00Z") },
        },
      ];
    }
    // by: ["userId", "audience"]
    if (by[0] === "userId" && by[1] === "audience") {
      return [
        { userId: "u-1", audience: "member", _count: { _all: 6 } },
        { userId: null, audience: "applicant", _count: { _all: 2 } },
      ];
    }
    return [];
  });

  mockPrisma.partyEvent.findMany.mockImplementation(async (args: any) => {
    if (args?.where?.eventType === "PARTY_VISIT" && args?.distinct) {
      return [{ userId: "u-1" }, { userId: "u-2" }, { userId: null }];
    }
    if (args?.where?.createdAt?.gte) {
      return [
        { eventType: "PARTY_VISIT", createdAt: new Date("2026-04-29T10:00:00Z") },
        { eventType: "CODE_UNLOCK_SUCCESS", createdAt: new Date("2026-04-29T11:00:00Z") },
        { eventType: "PARTY_VISIT", createdAt: new Date("2026-04-30T01:00:00Z") },
      ];
    }
    // recent feed
    return [
      {
        id: "e-1",
        createdAt: new Date("2026-04-30T11:00:00Z"),
        eventType: "CODE_UNLOCK_SUCCESS",
        audience: "member",
        metadata: { color: "blue" },
        user: {
          id: "u-1",
          firstName: "Ada",
          lastName: "Lovelace",
          daliEmail: "ada@dali",
          dartmouthEmail: null,
        },
      },
      {
        id: "e-2",
        createdAt: new Date("2026-04-30T10:00:00Z"),
        eventType: "PARTY_VISIT",
        audience: "applicant",
        metadata: null,
        user: null,
      },
    ];
  });

  mockPrisma.partyEvent.count.mockResolvedValue(125);
  mockPrisma.user.findMany.mockResolvedValue([
    {
      id: "u-1",
      firstName: "Ada",
      lastName: "Lovelace",
      daliEmail: "ada@dali",
      dartmouthEmail: null,
    },
  ]);
});

describe("admin-console.party loader", () => {
  it("redirects non-admins away from the page", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    const res = (await loader({ request: makeRequest(), params: {}, context: {} } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin-console/members");
  });

  it("redirects unauthenticated requests to /login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as any);
    const res = (await loader({ request: makeRequest(), params: {}, context: {} } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("returns totals, segmented timeline, per-user rollup, and paginated recent feed", async () => {
    const data = (await loader({
      request: makeRequest("http://localhost/admin-console/party?recentLimit=25&recentOffset=50"),
      params: {},
      context: {},
    } as any)) as any;

    expect(data.totals.PARTY_VISIT).toBe(10);
    expect(data.totals.CODE_UNLOCK_SUCCESS).toBe(4);

    expect(data.unlocksByAudience.member.success).toBe(3);
    expect(data.unlocksByAudience.applicant.success).toBe(1);
    expect(data.unlocksByAudience.applicant.failure).toBe(2);

    expect(data.uniqueVisitors).toBe(2);

    // Timeline segmented by event type
    expect(Array.isArray(data.timeline)).toBe(true);
    expect(data.timeline.length).toBeGreaterThan(0);
    const day0 = data.timeline.find((b: any) => b.day === "2026-04-29");
    expect(day0).toBeDefined();
    expect(day0.counts.PARTY_VISIT).toBe(1);
    expect(day0.counts.CODE_UNLOCK_SUCCESS).toBe(1);
    expect(day0.total).toBe(2);

    // Per-user rollup hydrated with user record + audiences
    expect(data.perUser.length).toBe(2);
    const ada = data.perUser.find((r: any) => r.userId === "u-1");
    expect(ada).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@dali",
    });
    expect(ada.counts.PARTY_VISIT).toBe(5);
    expect(ada.counts.CODE_UNLOCK_SUCCESS).toBe(1);
    expect(ada.total).toBe(6);
    expect(ada.audiences).toContain("member");
    const anon = data.perUser.find((r: any) => r.userId === null);
    expect(anon).toBeDefined();
    expect(anon.audiences).toContain("applicant");

    // Recent feed shape + pagination passthrough
    expect(data.recent.total).toBe(125);
    expect(data.recent.limit).toBe(25);
    expect(data.recent.offset).toBe(50);
    expect(data.recent.entries.length).toBe(2);
    expect(data.recent.entries[0]).toMatchObject({
      id: "e-1",
      eventType: "CODE_UNLOCK_SUCCESS",
      audience: "member",
      user: { firstName: "Ada", email: "ada@dali" },
    });
    expect(data.recent.entries[1].user).toBeNull();
  });

  it("passes skip/take to the recent-feed findMany based on pagination params", async () => {
    await loader({
      request: makeRequest("http://localhost/admin-console/party?recentLimit=10&recentOffset=30"),
      params: {},
      context: {},
    } as any);

    const recentCall = mockPrisma.partyEvent.findMany.mock.calls.find(
      ([args]) => args?.orderBy?.createdAt === "desc" && args?.include?.user,
    );
    expect(recentCall).toBeDefined();
    expect(recentCall![0]).toMatchObject({ take: 10, skip: 30 });
  });

  it("clamps recentLimit to MAX (200) and floors negative offsets at 0", async () => {
    const data = (await loader({
      request: makeRequest("http://localhost/admin-console/party?recentLimit=9999&recentOffset=-50"),
      params: {},
      context: {},
    } as any)) as any;
    expect(data.recent.limit).toBe(200);
    expect(data.recent.offset).toBe(0);
  });

  it("uses defaults when no pagination params are provided", async () => {
    const data = (await loader({
      request: makeRequest(),
      params: {},
      context: {},
    } as any)) as any;
    expect(data.recent.limit).toBe(50);
    expect(data.recent.offset).toBe(0);
  });
});
