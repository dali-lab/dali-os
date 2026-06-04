import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loader, action } from "~/internal-processes/routes/internal-processes.onboarding";

const mockPrisma = prisma as unknown as Record<string, any>;
const CORE_ID = "core-1";

function decisionRow(over: {
  userId: string;
  first: string;
  domainCode: string;
  domainName: string;
  daliEmail?: string | null;
  slackUserId?: string | null;
  figmaInvitedAt?: Date | null;
  onboardedAt?: Date | null;
}) {
  return {
    id: `dec-${over.userId}-${over.domainCode}`,
    createdAt: new Date("2026-05-01"),
    domainApplication: {
      domain: { displayName: over.domainName, name: over.domainName, code: over.domainCode },
      application: {
        user: {
          id: over.userId,
          firstName: over.first,
          lastName: "Test",
          daliEmail: over.daliEmail ?? null,
          slackUserId: over.slackUserId ?? null,
          figmaInvitedAt: over.figmaInvitedAt ?? null,
          daliMember: { onboardedAt: over.onboardedAt ?? null },
        },
      },
    },
  };
}

function call(url = "http://localhost/internal-processes/onboarding") {
  return loader({ request: new Request(url), params: {}, context: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycle = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_ID, type: "member" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("internal-processes/onboarding loader", () => {
  it("redirects non-core users home", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = (await call()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("returns no selected cycle when none exist", async () => {
    const data = (await call()) as any;
    expect(data.selectedCycleId).toBeNull();
    expect(data.rows).toEqual([]);
    expect(mockPrisma.decision.findMany).not.toHaveBeenCalled();
  });

  it("defaults to the newest cycle and derives live status per accepted applicant", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
      { id: "cyc-old", name: "Fall 2025", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      // Fully provisioned but not yet onboarded → still shows, all green except profile.
      decisionRow({ userId: "u1", first: "Ada", domainCode: "fullstack", domainName: "Fullstack", daliEmail: "ada@dali.dartmouth.edu", slackUserId: "U1", figmaInvitedAt: new Date(), onboardedAt: null }),
      decisionRow({ userId: "u2", first: "Bea", domainCode: "design", domainName: "Design", daliEmail: null, slackUserId: null, figmaInvitedAt: null, onboardedAt: null }),
    ]);

    const data = (await call()) as any;

    // Newest cycle chosen, and the query was scoped to it.
    expect(data.selectedCycleId).toBe("cyc-new");
    expect(mockPrisma.decision.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.decision.findMany.mock.calls[0][0].where;
    expect(where.stage).toBe("Released");
    expect(where.type).toBe("Accepted");
    expect(where.domainApplication.application.applicationCycleId).toBe("cyc-new");

    expect(data.rows).toEqual([
      {
        userId: "u1",
        name: "Ada Test",
        domainKey: "fullstack",
        role: "Fullstack",
        daliEmail: "ada@dali.dartmouth.edu",
        emailCreated: true,
        inSlack: true,
        figmaInvited: true,
        profileSubmitted: false,
      },
      {
        userId: "u2",
        name: "Bea Test",
        domainKey: "design",
        role: "Design",
        daliEmail: null,
        emailCreated: false,
        inSlack: false,
        figmaInvited: false,
        profileSubmitted: false,
      },
    ]);

    // Domain options derived from the cycle's accepted rows, sorted by label.
    expect(data.domains).toEqual([
      { key: "design", label: "Design" },
      { key: "fullstack", label: "Fullstack" },
    ]);
    expect(data.selectedDomain).toBeNull();
  });

  it("honors a valid ?cycle= override", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
      { id: "cyc-old", name: "Fall 2025", cycleType: "Standard" },
    ]);
    const data = (await call("http://localhost/internal-processes/onboarding?cycle=cyc-old")) as any;
    expect(data.selectedCycleId).toBe("cyc-old");
  });

  it("falls back to the newest cycle when ?cycle= is unknown", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    const data = (await call("http://localhost/internal-processes/onboarding?cycle=bogus")) as any;
    expect(data.selectedCycleId).toBe("cyc-new");
  });

  it("collapses duplicate accepted decisions for the same user+domain to one row", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    // Two released-accepted rows for the same (user, domain) — e.g. a re-release.
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({ userId: "u1", first: "Ada", domainCode: "fullstack", domainName: "Fullstack", daliEmail: "ada@dali.dartmouth.edu" }),
      decisionRow({ userId: "u1", first: "Ada", domainCode: "fullstack", domainName: "Fullstack", daliEmail: "ada@dali.dartmouth.edu" }),
      // Same user, different domain → a distinct row.
      decisionRow({ userId: "u1", first: "Ada", domainCode: "design", domainName: "Design" }),
    ]);

    const data = (await call()) as any;
    expect(data.rows).toHaveLength(2);
    expect(data.rows.map((r: any) => r.role)).toEqual(["Fullstack", "Design"]);
  });

  it("includes already-onboarded members (full accepted roster)", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      // Already onboarded → still listed; profileSubmitted reads true (all-green).
      decisionRow({ userId: "u1", first: "Ada", domainCode: "fullstack", domainName: "Fullstack", daliEmail: "ada@dali.dartmouth.edu", slackUserId: "U1", onboardedAt: new Date() }),
      decisionRow({ userId: "u2", first: "Bea", domainCode: "design", domainName: "Design", onboardedAt: null }),
    ]);

    const data = (await call()) as any;
    expect(data.rows.map((r: any) => r.userId)).toEqual(["u1", "u2"]);
    // The onboarded member shows as profile-submitted; the other is still pending.
    expect(data.rows.find((r: any) => r.userId === "u1").profileSubmitted).toBe(true);
    expect(data.rows.find((r: any) => r.userId === "u2").profileSubmitted).toBe(false);
    // Both domains appear in the filter dropdown now.
    expect(data.domains.map((d: any) => d.key)).toEqual(["design", "fullstack"]);
  });

  it("filters rows by a valid ?domain=", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({ userId: "u1", first: "Ada", domainCode: "fullstack", domainName: "Fullstack" }),
      decisionRow({ userId: "u2", first: "Bea", domainCode: "design", domainName: "Design" }),
    ]);

    const data = (await call("http://localhost/internal-processes/onboarding?domain=design")) as any;
    expect(data.selectedDomain).toBe("design");
    // Dropdown still lists every domain in the cycle, not just the selected one.
    expect(data.domains.map((d: any) => d.key)).toEqual(["design", "fullstack"]);
    expect(data.rows.map((r: any) => r.userId)).toEqual(["u2"]);
  });

  it("ignores an unknown ?domain= and shows all rows", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({ userId: "u1", first: "Ada", domainCode: "fullstack", domainName: "Fullstack" }),
      decisionRow({ userId: "u2", first: "Bea", domainCode: "design", domainName: "Design" }),
    ]);

    const data = (await call("http://localhost/internal-processes/onboarding?domain=bogus")) as any;
    expect(data.selectedDomain).toBeNull();
    expect(data.rows).toHaveLength(2);
  });
});

describe("internal-processes/onboarding action (toggle Figma)", () => {
  function postForm(fields: Record<string, string>) {
    const body = new URLSearchParams(fields);
    return action({
      request: new Request("http://localhost/internal-processes/onboarding", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      params: {},
      context: {},
    } as any);
  }

  beforeEach(() => {
    mockPrisma.user = { update: vi.fn().mockResolvedValue({}) };
  });

  it("stamps figmaInvitedAt when checking", async () => {
    const res = (await postForm({ intent: "toggleFigma", userId: "u1", invited: "true" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    expect(arg.data.figmaInvitedAt).toBeInstanceOf(Date);
  });

  it("clears figmaInvitedAt when unchecking", async () => {
    await postForm({ intent: "toggleFigma", userId: "u1", invited: "false" });
    expect(mockPrisma.user.update.mock.calls[0][0].data.figmaInvitedAt).toBeNull();
  });

  it("403s for non-core users", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = (await postForm({ intent: "toggleFigma", userId: "u1", invited: "true" })) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    const res = (await postForm({ intent: "somethingElse", userId: "u1" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
