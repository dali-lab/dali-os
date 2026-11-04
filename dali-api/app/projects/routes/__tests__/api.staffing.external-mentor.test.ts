import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    staffingCycle: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    domain: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    staffingAssignment: { findMany: vi.fn() },
    externalMentor: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../../lib/staffing-events.server", () => ({ publishCycleChange: vi.fn() }));

import { loader, action } from "../api.staffing.external-mentor";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../../lib/staffing-events.server";

const ACTOR = "lead-1";
const get = (qs: string) => loader({ request: new Request(`http://localhost/api/staffing/external-mentor?${qs}`) } as any);
const act = (method: string, body?: unknown, qs = "") =>
  action({
    request: new Request(`http://localhost/api/staffing/external-mentor${qs}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: ACTOR } } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  prismaMock.staffingAssignment.findMany.mockResolvedValue([]);
  prismaMock.externalMentor.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe("auth", () => {
  it("403s non-managers everywhere without touching data", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await get("cycleId=c1")).status).toBe(403);
    expect((await act("DELETE", undefined, "?id=x")).status).toBe(403);
    expect((await act("POST", {})).status).toBe(403);
    expect(prismaMock.externalMentor.delete).not.toHaveBeenCalled();
    expect(prismaMock.externalMentor.upsert).not.toHaveBeenCalled();
  });
});

describe("GET list", () => {
  it("requires cycleId", async () => {
    expect((await get("")).status).toBe(400);
  });

  it("flattens placements for the cycle", async () => {
    prismaMock.externalMentor.findMany.mockResolvedValue([
      { id: "e1", projectId: "p1", domainId: "d1", userId: "u1", user: { firstName: "Ada", lastName: "Lovelace" } },
    ]);
    const json = await (await get("cycleId=c1")).json();
    expect(prismaMock.externalMentor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffingCycleId: "c1" } }),
    );
    expect(json.externalMentors).toEqual([
      { id: "e1", projectId: "p1", domainId: "d1", userId: "u1", firstName: "Ada", lastName: "Lovelace" },
    ]);
  });
});

describe("GET member search", () => {
  const u = (id: string) => ({ id, firstName: "Grace", lastName: "Hopper", daliEmail: `${id}@example.edu`, dartmouthEmail: null });

  it("returns nothing for a query under 2 chars", async () => {
    expect(await (await get("cycleId=c1&q=g")).json()).toEqual({ results: [] });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("excludes members already staffed (not Declined) or already external mentors on the project", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([{ userId: "u-staffed" }]);
    prismaMock.externalMentor.findMany.mockResolvedValue([{ userId: "u-ext" }]);
    prismaMock.user.findMany.mockResolvedValue([u("u-staffed"), u("u-ext"), u("u-free")]);
    const json = await (await get("cycleId=c1&projectId=p1&q=hopper")).json();
    expect(prismaMock.staffingAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffingCycleId: "c1", projectId: "p1", status: { not: "Declined" } } }),
    );
    expect(json.results).toEqual([{ userId: "u-free", name: "Grace Hopper", email: expect.any(String) }]);
  });

  it("skips exclusion lookups without projectId and limits to DALI members", async () => {
    prismaMock.user.findMany.mockResolvedValue([u("u1")]);
    const json = await (await get("cycleId=c1&q=hopper")).json();
    expect(prismaMock.staffingAssignment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany.mock.calls[0][0].where.daliMember).toEqual({ isNot: null });
    expect(json.results).toHaveLength(1);
  });
});

describe("DELETE", () => {
  it("requires id", async () => {
    expect((await act("DELETE")).status).toBe(400);
  });

  it("is a no-op success for an unknown id (no delete, no audit)", async () => {
    prismaMock.externalMentor.findUnique.mockResolvedValue(null);
    const res = await act("DELETE", undefined, "?id=gone");
    expect(await res.json()).toEqual({ ok: true });
    expect(prismaMock.externalMentor.delete).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("deletes the placement, audits, and publishes the placement's own cycle", async () => {
    prismaMock.externalMentor.findUnique.mockResolvedValue({ staffingCycleId: "c9" });
    await act("DELETE", undefined, "?id=e1");
    expect(prismaMock.externalMentor.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staffing.externalMentor.remove", userId: ACTOR, targetId: "e1" }),
    );
    expect(publishCycleChange).toHaveBeenCalledWith("c9");
  });
});

describe("POST", () => {
  const body = { cycleId: "c1", projectId: "p1", domainId: "d1", userId: "u1" };
  const allExist = () => {
    prismaMock.staffingCycle.findUnique.mockResolvedValue({ id: "c1" });
    prismaMock.project.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.domain.findUnique.mockResolvedValue({ id: "d1" });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.externalMentor.upsert.mockResolvedValue({ id: "e1" });
  };

  it("rejects other methods, bad JSON and incomplete bodies", async () => {
    expect((await act("PUT", body)).status).toBe(405);
    expect((await act("POST", "{bad")).status).toBe(400);
    expect((await act("POST", { ...body, domainId: undefined })).status).toBe(400);
  });

  it.each(["staffingCycle", "project", "domain", "user"] as const)("404s when the %s does not exist", async (missing) => {
    allExist();
    prismaMock[missing].findUnique.mockResolvedValue(null);
    expect((await act("POST", body)).status).toBe(404);
    expect(prismaMock.externalMentor.upsert).not.toHaveBeenCalled();
  });

  it("upserts idempotently on the composite key, records the creator, audits and publishes", async () => {
    allExist();
    const res = await act("POST", body);
    expect(await res.json()).toEqual({ id: "e1" });
    expect(prismaMock.externalMentor.upsert).toHaveBeenCalledWith({
      where: {
        staffingCycleId_projectId_userId_domainId: {
          staffingCycleId: "c1",
          projectId: "p1",
          userId: "u1",
          domainId: "d1",
        },
      },
      update: {},
      create: { staffingCycleId: "c1", projectId: "p1", domainId: "d1", userId: "u1", createdById: ACTOR },
      select: { id: true },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staffing.externalMentor.add",
        userId: ACTOR,
        targetId: "p1",
        metadata: { userId: "u1", domainId: "d1" },
      }),
    );
    expect(publishCycleChange).toHaveBeenCalledWith("c1");
  });
});
