import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    staffingCycle: { findUnique: vi.fn() },
    staffingPreference: { findMany: vi.fn() },
    staffingAssignment: { findMany: vi.fn() },
    staffingBoardMember: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
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

import { loader, action } from "../api.staffing.board-member";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../../lib/staffing-events.server";

const ACTOR = "lead-1";

const search = (qs: string) =>
  loader({ request: new Request(`http://localhost/api/staffing/board-member?${qs}`) } as any);
const mutate = (method: string, body: unknown) =>
  action({
    request: new Request("http://localhost/api/staffing/board-member", {
      method,
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: ACTOR } } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  prismaMock.staffingCycle.findUnique.mockResolvedValue({ id: "c1" });
  prismaMock.staffingPreference.findMany.mockResolvedValue([]);
  prismaMock.staffingAssignment.findMany.mockResolvedValue([]);
  prismaMock.staffingBoardMember.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe("auth", () => {
  it("returns 403 from loader and action for non-managers", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await search("cycleId=c1&q=ada")).status).toBe(403);
    expect((await mutate("POST", { cycleId: "c1", userId: "u" })).status).toBe(403);
    expect(prismaMock.staffingBoardMember.upsert).not.toHaveBeenCalled();
  });

  it("passes through an unauthenticated response", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as any);
    expect((await search("cycleId=c1&q=ada")).status).toBe(401);
    expect((await mutate("DELETE", {})).status).toBe(401);
  });
});

describe("GET search", () => {
  it("requires cycleId", async () => {
    expect((await search("q=ada")).status).toBe(400);
  });

  it("returns no results and runs no query for a query under 2 chars", async () => {
    const res = await search("cycleId=c1&q=%20a%20");
    expect(await res.json()).toEqual({ results: [] });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("excludes bidders, Proposed assignees and existing board members, and maps name/email", async () => {
    prismaMock.staffingPreference.findMany.mockResolvedValue([{ userId: "u-bid" }]);
    prismaMock.staffingAssignment.findMany.mockResolvedValue([{ userId: "u-prop" }]);
    prismaMock.staffingBoardMember.findMany.mockResolvedValue([{ userId: "u-board" }]);
    const mk = (id: string, first: string) => ({
      id,
      firstName: first,
      lastName: "Lovelace",
      daliEmail: `${first.toLowerCase()}@example.edu`,
      dartmouthEmail: null,
    });
    prismaMock.user.findMany.mockResolvedValue([mk("u-bid", "A"), mk("u-prop", "B"), mk("u-board", "C"), mk("u-ok", "Ada")]);
    const json = await (await search("cycleId=c1&q=lovelace")).json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({ userId: "u-ok", name: "Ada Lovelace" });
    expect(prismaMock.staffingAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffingCycleId: "c1", status: "Proposed" } }),
    );
  });

  it("restricts to DALI members, ANDs up to 4 tokens, and caps results at 10", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        id: `u${i}`,
        firstName: "Ada",
        lastName: "L",
        daliEmail: null,
        dartmouthEmail: null,
      })),
    );
    const json = await (await search("cycleId=c1&q=a%20b%20c%20d%20e%20f")).json();
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.daliMember).toEqual({ isNot: null });
    expect(where.AND).toHaveLength(4);
    expect(json.results).toHaveLength(10);
  });
});

describe("POST / DELETE", () => {
  it("rejects other methods, bad JSON and bad bodies", async () => {
    expect((await mutate("PUT", { cycleId: "c1", userId: "u" })).status).toBe(405);
    expect((await mutate("POST", "{bad")).status).toBe(400);
    expect((await mutate("POST", { cycleId: "c1" })).status).toBe(400);
  });

  it("404s for an unknown cycle", async () => {
    prismaMock.staffingCycle.findUnique.mockResolvedValue(null);
    expect((await mutate("POST", { cycleId: "nope", userId: "u" })).status).toBe(404);
  });

  it("refuses to add a user who is not a DALI member", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const res = await mutate("POST", { cycleId: "c1", userId: "u-x" });
    expect(res.status).toBe(400);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u-x", daliMember: { isNot: null } },
      select: { id: true },
    });
    expect(prismaMock.staffingBoardMember.upsert).not.toHaveBeenCalled();
  });

  it("adds idempotently, records who added, audits and publishes", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "u-ada" });
    const res = await mutate("POST", { cycleId: "c1", userId: "u-ada" });
    expect(await res.json()).toEqual({ ok: true });
    expect(prismaMock.staffingBoardMember.upsert).toHaveBeenCalledWith({
      where: { userId_staffingCycleId: { userId: "u-ada", staffingCycleId: "c1" } },
      update: {},
      create: { userId: "u-ada", staffingCycleId: "c1", addedById: ACTOR },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staffing.board-member.add",
        userId: ACTOR,
        targetId: "u-ada",
        metadata: { cycleId: "c1" },
      }),
    );
    expect(publishCycleChange).toHaveBeenCalledWith("c1");
  });

  it("DELETE removes only the board-member row for that cycle and user", async () => {
    const res = await mutate("DELETE", { cycleId: "c1", userId: "u-ada" });
    expect(await res.json()).toEqual({ ok: true });
    expect(prismaMock.staffingBoardMember.deleteMany).toHaveBeenCalledWith({
      where: { staffingCycleId: "c1", userId: "u-ada" },
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staffing.board-member.remove", targetId: "u-ada" }),
    );
    expect(publishCycleChange).toHaveBeenCalledWith("c1");
  });
});
