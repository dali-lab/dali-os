import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    dALIMember: { findUnique: vi.fn() },
    delibsSession: { upsert: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireCoreOrDomainLead: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn() }));
vi.mock("~/hiring/lib/cycle-timeline.server", () => ({ loadCycleTimeline: vi.fn() }));
vi.mock("~/hiring/lib/cycle-timeline", () => ({ findRound: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireCoreOrDomainLead } from "~/lib/auth";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { findRound } from "~/hiring/lib/cycle-timeline";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/hiring/routes/api.cycles.$cycleId.delibs";

const run = (body: unknown) =>
  action({
    request: new Request("http://localhost/api/cycles/c1/delibs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { cycleId: "c1" },
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireCoreOrDomainLead).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(null as never);
  vi.mocked(prisma.dALIMember.findUnique).mockResolvedValue({ id: "m1" } as never);
  vi.mocked(findRound).mockReturnValue({ id: "r1" } as never);
  vi.mocked(prisma.delibsSession.upsert).mockResolvedValue({ id: "s1" } as never);
});

describe("POST /api/cycles/:cycleId/delibs", () => {
  it("logs the board being opened or reopened", async () => {
    const res = await run({ domainId: "d1", roundId: "final" });

    expect(res.status).toBe(201);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delibs.open",
        userId: "u1",
        targetId: "s1",
        metadata: { cycleId: "c1", domainId: "d1", roundId: "final" },
      }),
    );
  });

  it("logs nothing when the round is not in the timeline", async () => {
    vi.mocked(findRound).mockReturnValue(undefined as never);
    expect((await run({ domainId: "d1", roundId: "gone" })).status).toBe(400);
    expect(prisma.delibsSession.upsert).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing when the caller is not a DALI member", async () => {
    vi.mocked(prisma.dALIMember.findUnique).mockResolvedValue(null);
    expect((await run({ domainId: "d1", roundId: "final" })).status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
