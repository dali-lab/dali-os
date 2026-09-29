import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mentorshipPair: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../lib/visibility", () => ({
  canViewMentorship: vi.fn(),
  mentorshipPairWhere: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
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
  });
});
