import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/drive-scopes.server", () => ({ loadDriveScopes: vi.fn() }));
vi.mock("~/lib/drive-home.server", () => ({ loadDriveHome: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ formsUsePageAccess: vi.fn() }));
vi.mock("~/lib/drive-hub.server", () => ({
  loadProjectWorkspaces: vi.fn(),
  loadEducationWorkspaces: vi.fn(),
  loadAllDocTags: vi.fn(),
  loadItemTagIds: vi.fn(),
}));

import { requireAuth, isNonMember, redirectPartnerToPortal } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import { loadDriveHome } from "~/lib/drive-home.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { formsUsePageAccess } from "~/forms/lib/form-access.server";
import {
  loadProjectWorkspaces,
  loadEducationWorkspaces,
  loadAllDocTags,
  loadItemTagIds,
} from "~/lib/drive-hub.server";
import { loader } from "~/routes/drive.hub";

const AUTH = { ok: true, user: { sub: "u1" } };
const ROLES = { isCore: false, canViewForms: true };
const request = new Request("http://localhost/drive");
const run = () => loader({ request } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as never);
  vi.mocked(getUserRoles).mockResolvedValue(ROLES as never);
  vi.mocked(resolveTermFilter).mockResolvedValue({ isAll: false, termId: "t1", terms: [], selected: null } as never);
  vi.mocked(loadProjectWorkspaces).mockResolvedValue([{ key: "p1" }] as never);
  vi.mocked(loadEducationWorkspaces).mockResolvedValue([{ key: "o1" }] as never);
  vi.mocked(loadDriveScopes).mockResolvedValue([{ id: "lab", items: [] }] as never);
  vi.mocked(loadItemTagIds).mockResolvedValue({ d1: ["t1"] });
  vi.mocked(loadAllDocTags).mockResolvedValue([{ id: "t1" }] as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(loadDriveHome).mockResolvedValue({ recent: [] } as never);
  vi.mocked(formsUsePageAccess).mockResolvedValue(false);
});

describe("drive hub loader", () => {
  it("tells the client whether forms follow page access", async () => {
    expect(await run()).toMatchObject({ formsPageAccess: false });
    vi.mocked(formsUsePageAccess).mockResolvedValue(true);
    expect(await run()).toMatchObject({ formsPageAccess: true });
    expect(formsUsePageAccess).toHaveBeenCalledWith(request);
  });

  it("returns the scopes, tags and flags together", async () => {
    const data = await run();
    expect(data).toMatchObject({
      driveScopes: [{ id: "lab", items: [] }],
      allTags: [{ id: "t1" }],
      itemTagIds: { d1: ["t1"] },
      canViewForms: true,
      canManageAgreements: false,
      homeEnabled: true,
      home: { recent: [] },
      viewerId: "u1",
    });
  });

  it("redirects an anonymous visitor, a non-member and a partner before reading anything else", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await run()) as Response).toBeInstanceOf(Response);
    vi.mocked(requireAuth).mockResolvedValue(AUTH as never);
    vi.mocked(isNonMember).mockResolvedValue(true);
    expect(((await run()) as Response).headers.get("Location")).toBe("/portal");
    vi.mocked(isNonMember).mockResolvedValue(false);
    const partner = new Response(null, { status: 302 });
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(partner as never);
    expect(await run()).toBe(partner);

    expect(getUserRoles).not.toHaveBeenCalled();
    expect(loadDriveScopes).not.toHaveBeenCalled();
    expect(loadAllDocTags).not.toHaveBeenCalled();
  });

  it("hands the scopes the viewer's session, term and workspaces", async () => {
    await run();
    const viewer = { userId: "u1", isCore: false, termId: "t1" };
    expect(loadProjectWorkspaces).toHaveBeenCalledWith(viewer);
    expect(loadEducationWorkspaces).toHaveBeenCalledWith(viewer);
    expect(loadDriveScopes).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: AUTH,
        projectWorkspaces: [{ key: "p1" }],
        educationWorkspaces: [{ key: "o1" }],
        canViewForms: true,
        isCore: false,
        request,
      }),
    );
    expect(loadItemTagIds).toHaveBeenCalledWith([{ id: "lab", items: [] }]);
  });

  it("drops the term gate under All terms", async () => {
    vi.mocked(resolveTermFilter).mockResolvedValue({ isAll: true, termId: "ignored", terms: [], selected: null } as never);
    await run();
    expect(loadProjectWorkspaces).toHaveBeenCalledWith(expect.objectContaining({ termId: null }));
  });

  it("skips the home query when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const data = await run();
    expect(loadDriveHome).not.toHaveBeenCalled();
    expect(data).toMatchObject({ homeEnabled: false, home: null });
  });

  it("starts the tags, receivers flag and home before the slow scope load finishes", async () => {
    let finishScopes!: () => void;
    vi.mocked(loadDriveScopes).mockImplementation(
      () => new Promise((resolve) => (finishScopes = () => resolve([]))) as never,
    );

    const pending = run();
    await vi.waitFor(() => {
      expect(loadDriveScopes).toHaveBeenCalled();
      expect(loadAllDocTags).toHaveBeenCalled();
      expect(loadDriveHome).toHaveBeenCalled();
    });
    expect(loadItemTagIds).not.toHaveBeenCalled();
    finishScopes();
    await pending;
    expect(loadItemTagIds).toHaveBeenCalled();
  });

  it("loads projects and education together, ahead of the scopes", async () => {
    let finishProjects!: () => void;
    vi.mocked(loadProjectWorkspaces).mockImplementation(
      () => new Promise((resolve) => (finishProjects = () => resolve([]))) as never,
    );
    const pending = run();
    await vi.waitFor(() => expect(loadEducationWorkspaces).toHaveBeenCalled());
    expect(loadDriveScopes).not.toHaveBeenCalled();
    finishProjects();
    await pending;
    expect(loadDriveScopes).toHaveBeenCalled();
  });
});
