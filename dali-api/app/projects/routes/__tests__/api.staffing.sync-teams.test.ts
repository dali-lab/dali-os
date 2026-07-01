import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("forbidden", { status: 403 })),
}));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: (req: Request) =>
    req.method === "OPTIONS" ? new Response(null, { status: 204 }) : null,
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock("~/projects/lib/github-team-sync", () => ({ syncProjectTeam: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageStaffing, currentTerm } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { syncProjectTeam } from "~/projects/lib/github-team-sync";
import { action } from "~/projects/routes/api.staffing.sync-teams";
import type { ProjectTeamSyncReport } from "~/projects/lib/github-team-sync";

const TERM = { id: "term-26x", code: "26X" };

const mockPrisma = prisma as unknown as {
  project: { findMany: ReturnType<typeof vi.fn> };
};

function report(over: Partial<ProjectTeamSyncReport> = {}): ProjectTeamSyncReport {
  return {
    projectId: "p",
    projectName: "P",
    status: "ok",
    slug: "p",
    teamCreated: false,
    membersEnsured: 0,
    membersPending: 0,
    missingHandles: [],
    memberErrors: [],
    repos: [],
    message: "ok",
    ...over,
  };
}

function req(opts: { method?: string; body?: unknown; raw?: string } = {}) {
  const { method = "POST", body, raw } = opts;
  return new Request("http://localhost/api/staffing/sync-teams", {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function call(request: Request) {
  return action({ request } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_ORG = "dali-test-org";
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue(TERM as any);
  vi.mocked(syncProjectTeam).mockResolvedValue(report());
  mockPrisma.project = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("POST /api/staffing/sync-teams", () => {
  it("204s on OPTIONS preflight", async () => {
    const res = await call(req({ method: "OPTIONS" }));
    expect(res.status).toBe(204);
  });

  it("401s when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    const res = await call(req({ body: { termId: TERM.id } }));
    expect(res.status).toBe(401);
  });

  it("405s on non-POST", async () => {
    const res = await call(req({ method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("403s when the user can't manage staffing", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    const res = await call(req({ body: { termId: TERM.id } }));
    expect(res.status).toBe(403);
  });

  it("400s on invalid JSON", async () => {
    const res = await call(req({ raw: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("400s when termId is missing", async () => {
    const res = await call(req({ body: {} }));
    expect(res.status).toBe(400);
  });

  it("400s when GITHUB_ORG is unset", async () => {
    delete process.env.GITHUB_ORG;
    const res = await call(req({ body: { termId: TERM.id } }));
    expect(res.status).toBe(400);
  });

  it("400s when there is no current term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as any);
    const res = await call(req({ body: { termId: TERM.id } }));
    expect(res.status).toBe(400);
  });

  it("409s when the posted term isn't the current term", async () => {
    const res = await call(req({ body: { termId: "some-old-term" } }));
    expect(res.status).toBe(409);
    expect(syncProjectTeam).not.toHaveBeenCalled();
  });

  it("enumerates current-term, non-archived projects", async () => {
    await call(req({ body: { termId: TERM.id } }));
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignments: { some: { termId: TERM.id } },
          status: { not: "Archived" },
        }),
      }),
    );
  });

  it("skips duplicate-slug projects without merging teams", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "a", name: "A", githubTeamSlug: "dup" },
      { id: "b", name: "B", githubTeamSlug: "dup" },
    ]);
    const res = await call(req({ body: { termId: TERM.id } }));
    const json = (await res.json()) as { reports: ProjectTeamSyncReport[]; warnings: string[] };
    expect(syncProjectTeam).not.toHaveBeenCalled();
    expect(json.reports.every((r) => r.status === "skipped")).toBe(true);
    expect(json.warnings.join(" ")).toContain("collides");
  });

  it("syncs each project with the current term id and returns ok", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "a", name: "A", githubTeamSlug: "a" },
      { id: "b", name: "B", githubTeamSlug: "b" },
    ]);
    const res = await call(req({ body: { termId: TERM.id } }));
    const json = (await res.json()) as { ok: boolean; reports: ProjectTeamSyncReport[] };
    expect(syncProjectTeam).toHaveBeenCalledWith("a", TERM.id);
    expect(syncProjectTeam).toHaveBeenCalledWith("b", TERM.id);
    expect(json.ok).toBe(true);
    expect(json.reports).toHaveLength(2);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staffing.sync_teams" }),
    );
  });

  it("returns 200 with ok:false when a project errors (partial failure isolation)", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "a", name: "A", githubTeamSlug: "a" },
      { id: "b", name: "B", githubTeamSlug: "b" },
    ]);
    vi.mocked(syncProjectTeam).mockImplementation(async (id: string) =>
      id === "a" ? report({ projectId: "a", status: "error", message: "boom" }) : report({ projectId: "b" }),
    );
    const res = await call(req({ body: { termId: TERM.id } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });
});
