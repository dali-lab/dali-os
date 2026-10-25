import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    term: { findMany: vi.fn() },
    activity: { findUnique: vi.fn() },
    activityEvent: { count: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/groups", () => ({ listAllGroups: vi.fn() }));
vi.mock("~/lib/activities.server", () => ({
  cloneActivity: vi.fn(),
  createActivity: vi.fn(),
  deleteActivity: vi.fn(),
  listActivitiesForAdmin: vi.fn(),
  listActivityTeams: vi.fn(),
  resolveActivityRoster: vi.fn(),
  saveActivityTeams: vi.fn(),
  setActivityStatus: vi.fn(),
  updateActivity: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { listAllGroups } from "~/lib/groups";
import * as activities from "~/lib/activities.server";
import { loader as listLoader, handle as listHandle } from "~/admin/routes/admin.activities";
import { loader as detailLoader, handle as detailHandle } from "~/admin/routes/admin.activities.$id";

const args = (params: Record<string, string> = {}) =>
  ({ request: new Request("http://x/admin/onboarding"), params, context: {} }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(prisma.term.findMany).mockResolvedValue([]);
  vi.mocked(activities.listActivitiesForAdmin).mockResolvedValue([]);
  vi.mocked(prisma.activity.findUnique).mockResolvedValue({ id: "a1", name: "Fall hunt" } as never);
  vi.mocked(listAllGroups).mockResolvedValue([]);
  vi.mocked(prisma.activityEvent.count).mockResolvedValue(0);
  vi.mocked(activities.resolveActivityRoster).mockResolvedValue([]);
  vi.mocked(activities.listActivityTeams).mockResolvedValue([]);
});

describe("onboarding loaders", () => {
  it.each([true, false])("report the viewer's real admin status (%s)", async (admin) => {
    vi.mocked(isAdmin).mockResolvedValue(admin);
    expect(((await listLoader(args())) as any).viewerIsAdmin).toBe(admin);
    expect(((await detailLoader(args({ id: "a1" }))) as any).viewerIsAdmin).toBe(admin);
  });

  it("404s an unknown activity", async () => {
    vi.mocked(prisma.activity.findUnique).mockResolvedValue(null);
    await expect(detailLoader(args({ id: "nope" }))).rejects.toMatchObject({ status: 404 });
  });
});

describe("onboarding breadcrumbs", () => {
  const labels = (trail: { label: string }[]) => trail.map((c) => c.label);

  it("reads Admin › Onboarding on the list", () => {
    expect(labels(listHandle.breadcrumbTrail({ viewerIsAdmin: true }))).toEqual(["Admin", "Onboarding"]);
  });

  it("reads Admin › Onboarding › <name> on an activity", () => {
    expect(
      labels(detailHandle.breadcrumbTrail({ activity: { name: "Fall hunt" }, viewerIsAdmin: false })),
    ).toEqual(["Admin", "Onboarding", "Fall hunt"]);
  });
});
