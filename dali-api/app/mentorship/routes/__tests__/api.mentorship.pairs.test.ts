import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    mentorshipPair: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../lib/visibility", () => ({
  canViewMentorship: vi.fn(),
  mentorshipPairWhere: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { isCore } from "~/lib/roles";
import { action } from "../api.mentorship.pairs";

const m = prisma as any;

const BODY = {
  menteeUserId: "mentee-a",
  mentorUserId: "mentor-y",
  projectId: "proj1",
  termId: "term1",
  domainId: "d1",
};

function post(body: unknown) {
  return action({
    request: new Request("http://localhost/api/mentorship/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("POST /api/mentorship/pairs — one mentor per mentee", () => {
  it("creates a pair (manual) when the mentee is unpaired in the domain", async () => {
    m.mentorshipPair.findMany.mockResolvedValue([]);
    m.mentorshipPair.create.mockResolvedValue({ id: "new" });

    const res = await post(BODY);
    expect(await res.json()).toEqual({ id: "new", created: true });
    expect(m.mentorshipPair.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ...BODY, manual: true }) }),
    );
    expect(m.mentorshipPair.update).not.toHaveBeenCalled();
  });

  it("reassigns the existing pair instead of adding a second mentor", async () => {
    m.mentorshipPair.findMany.mockResolvedValue([{ id: "old" }]);
    m.mentorshipPair.update.mockResolvedValue({ id: "old" });

    const res = await post(BODY);
    expect(await res.json()).toEqual({ id: "old", created: false });
    expect(m.mentorshipPair.update).toHaveBeenCalledWith({
      where: { id: "old" },
      data: { mentorUserId: "mentor-y", manual: true },
      select: { id: true },
    });
    expect(m.mentorshipPair.create).not.toHaveBeenCalled();
    expect(m.mentorshipPair.deleteMany).not.toHaveBeenCalled();
  });

  it("collapses stray extra rows down to one when reassigning", async () => {
    m.mentorshipPair.findMany.mockResolvedValue([
      { id: "keep" },
      { id: "extra1" },
      { id: "extra2" },
    ]);
    m.mentorshipPair.deleteMany.mockResolvedValue({ count: 2 });
    m.mentorshipPair.update.mockResolvedValue({ id: "keep" });

    const res = await post(BODY);
    expect(await res.json()).toEqual({ id: "keep", created: false });
    expect(m.mentorshipPair.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["extra1", "extra2"] } },
    });
    expect(m.mentorshipPair.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "keep" } }),
    );
  });

  it("forbids non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(m.mentorshipPair.findMany).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("mentorship pair audit trail", () => {
  const send = (method: "PATCH" | "DELETE", body?: unknown, query = "") =>
    action({
      request: new Request(`http://localhost/api/mentorship/pairs${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    } as any);

  it("logs a created pair", async () => {
    m.mentorshipPair.findMany.mockResolvedValue([]);
    m.mentorshipPair.create.mockResolvedValue({ id: "new" });

    await post(BODY);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mentorship.pair.create",
        userId: "u1",
        targetId: "new",
        metadata: BODY,
      }),
    );
  });

  it("logs a reassignment from the POST path with the old and new mentor and collapsed extras", async () => {
    m.mentorshipPair.findMany.mockResolvedValue([
      { id: "keep", mentorUserId: "mentor-x" },
      { id: "extra", mentorUserId: "mentor-z" },
    ]);
    m.mentorshipPair.deleteMany.mockResolvedValue({ count: 1 });
    m.mentorshipPair.update.mockResolvedValue({ id: "keep" });

    await post(BODY);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mentorship.pair.update",
        targetId: "keep",
        metadata: expect.objectContaining({
          menteeUserId: "mentee-a",
          fromMentorUserId: "mentor-x",
          toMentorUserId: "mentor-y",
          collapsedExtras: 1,
        }),
      }),
    );
  });

  it("logs a PATCH reassignment", async () => {
    m.mentorshipPair.findUnique.mockResolvedValue({
      menteeUserId: "mentee-a",
      mentorUserId: "mentor-x",
      projectId: "proj1",
      termId: "term1",
      domainId: "d1",
    });
    m.mentorshipPair.findFirst.mockResolvedValue(null);
    m.mentorshipPair.update.mockResolvedValue({ id: "p1" });

    await send("PATCH", { id: "p1", mentorUserId: "mentor-y" });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mentorship.pair.update",
        userId: "u1",
        targetId: "p1",
        metadata: { menteeUserId: "mentee-a", fromMentorUserId: "mentor-x", toMentorUserId: "mentor-y" },
      }),
    );
  });

  it("logs a PATCH that merges into an existing pair against the surviving row", async () => {
    m.mentorshipPair.findUnique.mockResolvedValue({
      menteeUserId: "mentee-a",
      mentorUserId: "mentor-x",
      projectId: "proj1",
      termId: "term1",
      domainId: "d1",
    });
    m.mentorshipPair.findFirst.mockResolvedValue({ id: "already" });

    await send("PATCH", { id: "p1", mentorUserId: "mentor-y" });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mentorship.pair.update",
        targetId: "already",
        metadata: expect.objectContaining({ mergedFromPairId: "p1", toMentorUserId: "mentor-y" }),
      }),
    );
  });

  it("logs a batch delete once with the ids and the deleted count", async () => {
    m.mentorshipPair.deleteMany.mockResolvedValue({ count: 2 });

    await send("DELETE", undefined, "?id=p1&id=p2");

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mentorship.pair.delete",
        userId: "u1",
        targetId: "p1",
        metadata: { ids: ["p1", "p2"], deleted: 2 },
      }),
    );
  });

  it("logs nothing for a delete with no ids or a PATCH on a missing pair", async () => {
    await send("DELETE");
    m.mentorshipPair.findUnique.mockResolvedValue(null);
    await send("PATCH", { id: "missing", mentorUserId: "mentor-y" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
