import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, projectRow } = vi.hoisted(() => {
  const projectRow = {
    id: "p1",
    name: "Atlas",
    kind: "Standard",
    description: null,
    status: "Active",
    maintenancePlans: [],
    aiTldr: null,
    aiTldrGeneratedAt: null,
    aiTldrInputHash: null,
    calendarEmail: null,
    teamGroupEmail: null,
    imageUrl: null,
    iconEmoji: null,
    repoUrls: [],
    figmaUrls: [],
    deploymentUrl: null,
    githubTeamSlug: null,
    slackChannelName: null,
    slackChannelId: null,
    tasks: [],
    epics: [],
    assignments: [],
    projectTerms: [],
    domains: [],
    termStatuses: [],
    partners: [],
    termCount: 1,
  };
  const model = (): unknown =>
    new Proxy({} as Record<string, unknown>, {
      get(ops, op: string) {
        ops[op] ??= vi.fn().mockResolvedValue(op === "findUnique" || op === "findFirst" ? null : []);
        return ops[op];
      },
    });
  const prismaMock: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key === "$transaction") return vi.fn().mockResolvedValue([]);
      target[key] ??= model();
      return target[key];
    },
  });
  return { prismaMock, projectRow };
});

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  getUserRoles: vi.fn(),
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  canManageStaffing: vi.fn(),
  currentTerm: vi.fn(),
  isLabMentor: vi.fn(),
}));
vi.mock("~/lib/user-pages.server", () => ({ recordRouteVisit: vi.fn() }));
vi.mock("~/lib/reference-cache.server", () => ({ activeDomainOptions: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/infra/dashboard.server", () => ({
  listKnownOrgs: vi.fn(),
  loadProjectInfra: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/lib/infra/requests.server", () => ({ listProjectInfraRequests: vi.fn() }));
vi.mock("~/lib/chart-string.server", () => ({ listProjectChartStrings: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/presence-user", () => ({ getPresenceUser: vi.fn().mockResolvedValue(null) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: vi.fn().mockReturnValue(false) }));
vi.mock("~/drive/lib/drive-scopes.server", () => ({ loadProjectDriveScope: vi.fn().mockResolvedValue(null) }));
vi.mock("~/drive/lib/drive.server", () => ({ PROJECT_PAGE_SELECT: {}, PROJECT_FILE_SELECT: {} }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn() }));
vi.mock("~/partners/lib/core-members.server", () => ({
  listActiveCoreMembers: vi.fn().mockResolvedValue([]),
  personName: vi.fn(),
}));
vi.mock("~/projects/lib/project-calendar.server", () => ({ buildProjectCalendar: vi.fn() }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import * as roles from "~/lib/roles";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { loadProjectDetail } from "../project-detail.server";

const prisma = prismaMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const load = () =>
  loadProjectDetail({ request: new Request("https://dali.test/projects/p1"), params: { id: "p1" } });

const memberRoles = { isCore: false } as never;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.project.findUnique.mockReset();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.edu" },
  } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(roles.getUserRoles).mockResolvedValue(memberRoles);
  vi.mocked(roles.isProjectMember).mockResolvedValue(false);
  vi.mocked(roles.canManageStaffing).mockResolvedValue(false);
  vi.mocked(roles.isLabMentor).mockResolvedValue(false);
  vi.mocked(roles.currentTerm).mockResolvedValue(null as never);
  prisma.project.findUnique.mockResolvedValue(projectRow);
});

describe("loadProjectDetail", () => {
  it("redirects a logged-out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const login = new Response(null, { status: 302 });
    vi.mocked(redirectToLogin).mockReturnValue(login as never);
    expect(await load()).toBe(login);
  });

  it("returns the portal redirect for a non-member", async () => {
    const portal = new Response(null, { status: 302 });
    vi.mocked(redirectNonMemberToPortal).mockResolvedValue(portal as never);
    expect(await load()).toBe(portal);
  });

  it("throws a 404 for an unknown project", async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(load()).rejects.toMatchObject({ status: 404 });
    expect(recordRouteVisit).not.toHaveBeenCalled();
  });

  it("gives a non-member non-Core viewer read-only data with no recent activity", async () => {
    const data = await load();
    expect(data).toMatchObject({
      canEdit: false,
      canViewScope: false,
      canEditScope: false,
      recentActivity: [],
    });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("loads recent activity for an editor", async () => {
    vi.mocked(roles.isProjectMember).mockResolvedValue(true);
    const data = await load();
    expect(data).toMatchObject({ canEdit: true });
    expect(prisma.auditLog.findMany).toHaveBeenCalled();
  });

  it("does not return the removed documents fields", async () => {
    const data = (await load()) as Record<string, unknown>;
    for (const key of ["documents", "pinnedDocuments", "files"]) expect(data).not.toHaveProperty(key);
  });
});
