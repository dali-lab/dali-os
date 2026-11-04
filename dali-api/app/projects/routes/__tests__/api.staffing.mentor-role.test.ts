import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    staffingCycle: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    staffingMentorRole: { findMany: vi.fn(), upsert: vi.fn() },
    staffingAssignment: { findMany: vi.fn() },
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

import { loader, action } from "../api.staffing.mentor-role";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { publishCycleChange } from "../../lib/staffing-events.server";

const ACTOR = "lead-1";
const get = (qs: string) => loader({ request: new Request(`http://localhost/api/staffing/mentor-role?${qs}`) } as any);
const post = (body: unknown, method = "POST") =>
  action({
    request: new Request("http://localhost/api/staffing/mentor-role", {
      method,
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: ACTOR } } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  prismaMock.staffingMentorRole.findMany.mockResolvedValue([]);
  prismaMock.staffingAssignment.findMany.mockResolvedValue([]);
  prismaMock.staffingCycle.findUnique.mockResolvedValue({ id: "c1" });
  prismaMock.user.findUnique.mockResolvedValue({ id: "u-ada" });
});

describe("auth", () => {
  it("403s non-managers on loader and action without writing", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await get("cycleId=c1")).status).toBe(403);
    expect((await post({ cycleId: "c1", userId: "u", isMentor: true })).status).toBe(403);
    expect(prismaMock.staffingMentorRole.upsert).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("requires cycleId", async () => {
    expect((await get("projectId=p1")).status).toBe(400);
  });

  it("returns cycle-wide overrides and an empty promote list without projectId", async () => {
    prismaMock.staffingMentorRole.findMany.mockResolvedValue([
      { userId: "u-ada", isMentor: true },
      { userId: "u-grace", isMentor: false },
    ]);
    const json = await (await get("cycleId=c1")).json();
    expect(json).toEqual({ overrides: { "u-ada": true, "u-grace": false }, nonP3Mentors: [] });
  });

  it("lists override mentors on this project who are not P3 there, ignoring other projects, non-mentors and P3s", async () => {
    prismaMock.staffingMentorRole.findMany.mockResolvedValue([
      { userId: "u-ada", isMentor: true },
      { userId: "u-p3", isMentor: true },
      { userId: "u-elsewhere", isMentor: true },
      { userId: "u-grace", isMentor: false },
    ]);
    const a = (userId: string, projectId: string, level: string, firstName: string, lastName: string) => ({
      userId,
      projectId,
      level,
      user: { firstName, lastName },
    });
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      a("u-ada", "p1", "P2", "Ada", "Lovelace"),
      a("u-p3", "p1", "P3", "Alan", "Turing"),
      a("u-elsewhere", "p2", "P1", "Bob", "Zed"),
      a("u-grace", "p1", "P1", "Grace", "Hopper"),
    ]);
    const json = await (await get("cycleId=c1&projectId=p1")).json();
    expect(json.nonP3Mentors).toEqual([{ userId: "u-ada", firstName: "Ada", lastName: "Lovelace" }]);
    expect(prismaMock.staffingAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffingCycleId: "c1", status: { not: "Declined" } } }),
    );
  });

  it("treats a P3 assignment on the project as satisfying a user who is also P1 there in another domain", async () => {
    prismaMock.staffingMentorRole.findMany.mockResolvedValue([{ userId: "u-ada", isMentor: true }]);
    const row = (level: string) => ({ userId: "u-ada", projectId: "p1", level, user: { firstName: "Ada", lastName: "L" } });
    prismaMock.staffingAssignment.findMany.mockResolvedValue([row("P1"), row("P3")]);
    expect((await (await get("cycleId=c1&projectId=p1")).json()).nonP3Mentors).toEqual([]);
  });
});

describe("POST", () => {
  const valid = { cycleId: "c1", userId: "u-ada", isMentor: false };

  it("rejects non-POST, bad JSON, and non-boolean isMentor", async () => {
    expect((await post(valid, "PUT")).status).toBe(405);
    expect((await post("{bad")).status).toBe(400);
    expect((await post({ ...valid, isMentor: "true" })).status).toBe(400);
  });

  it("404s for an unknown cycle or user", async () => {
    prismaMock.staffingCycle.findUnique.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(404);
    prismaMock.staffingCycle.findUnique.mockResolvedValue({ id: "c1" });
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(404);
    expect(prismaMock.staffingMentorRole.upsert).not.toHaveBeenCalled();
  });

  it("upserts the override (keeping false, not dropping it), audits and publishes", async () => {
    const res = await post(valid);
    expect(await res.json()).toEqual({ ok: true });
    expect(prismaMock.staffingMentorRole.upsert).toHaveBeenCalledWith({
      where: { staffingCycleId_userId: { staffingCycleId: "c1", userId: "u-ada" } },
      update: { isMentor: false },
      create: { staffingCycleId: "c1", userId: "u-ada", isMentor: false, createdById: ACTOR },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staffing.mentorRole.set",
        userId: ACTOR,
        targetId: "u-ada",
        metadata: { cycleId: "c1", isMentor: false },
      }),
    );
    expect(publishCycleChange).toHaveBeenCalledWith("c1");
  });
});
