import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/db.server", () => ({
  prisma: { tunnelRun: { findMany: vi.fn(), aggregate: vi.fn() } },
}));
vi.mock("~/admin/lib/people.server", () => ({ loadPeopleById: vi.fn() }));

import { loadPeopleById } from "~/admin/lib/people.server";
import { loader } from "~/admin/routes/admin.games";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";

const load = (url = "http://os.test/admin/insights/games") =>
  loader({ request: new Request(url), params: {}, context: {} } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(prisma.tunnelRun.findMany).mockResolvedValue([]);
  vi.mocked(loadPeopleById).mockResolvedValue(new Map());
});

describe("admin.games loader", () => {
  it("sends anyone signed out to log in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await load()) as Response;
    expect(res.status).toBe(302);
    expect(prisma.tunnelRun.findMany).not.toHaveBeenCalled();
  });

  it("sends members who aren't Core home without reading runs", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await load()) as Response;
    expect(res.headers.get("Location")).toBe("/");
    expect(prisma.tunnelRun.findMany).not.toHaveBeenCalled();
  });

  it("summarizes the runs in the window and names the players", async () => {
    const at = new Date();
    vi.mocked(prisma.tunnelRun.findMany).mockResolvedValue([
      { userId: "ada", score: 400, durationMs: 9000, endedBy: "fall", obstacle: "gap", createdAt: at },
      { userId: "ada", score: 100, durationMs: 3000, endedBy: "quit", obstacle: null, createdAt: at },
    ] as never);
    vi.mocked(loadPeopleById).mockResolvedValue(new Map([["ada", { name: "Ada Lovelace", photoUrl: null }]]) as never);

    const data = (await load()) as Exclude<Awaited<ReturnType<typeof loader>>, Response>;
    expect(data.summary.runs).toBe(2);
    expect(data.summary.quits).toBe(1);
    expect(data.summary.playerRows).toEqual([expect.objectContaining({ userId: "ada", name: "Ada Lovelace", runs: 2, best: 400 })]);
    expect(data.series.reduce((a, b) => a + b, 0)).toBe(2);
    const where = vi.mocked(prisma.tunnelRun.findMany).mock.calls[0][0]?.where;
    expect(where?.createdAt).toEqual({ gte: expect.any(Date), lte: expect.any(Date) });
  });

  it("starts an all-time window at the first logged run", async () => {
    vi.mocked(prisma.tunnelRun.aggregate).mockResolvedValue({ _min: { createdAt: new Date("2026-11-16T12:00:00Z") } } as never);
    const data = (await load("http://os.test/admin/insights/games?range=all")) as Exclude<
      Awaited<ReturnType<typeof loader>>,
      Response
    >;
    expect(prisma.tunnelRun.aggregate).toHaveBeenCalled();
    expect(data.rangeKey).toBe("all");
  });
});
