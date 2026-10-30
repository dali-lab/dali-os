import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { term: { findMany: vi.fn() }, form: { findUnique: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({
  canBuildForm: vi.fn(),
  canSeeForm: vi.fn(),
}));
vi.mock("~/forms/lib/forms-data", () => ({ loadFormForEdit: vi.fn(), runFormsAction: vi.fn() }));
vi.mock("~/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formUsages: vi.fn(), managingUsage: vi.fn() }));
vi.mock("~/hiring/lib/form-links.server", () => ({ loadFormHiringLinks: vi.fn(), unlinkHiringForm: vi.fn() }));
vi.mock("~/forms/lib/version-responses.server", () => ({ loadVersionResponses: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/forms/components/FormDetail", () => ({ FormDetail: () => null }));
vi.mock("~/components/PageIcon", () => ({ PageIcon: () => null }));

import { prisma } from "~/lib/db";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canBuildForm, canSeeForm } from "~/forms/lib/form-access.server";
import { loadFormForEdit, runFormsAction } from "~/forms/lib/forms-data";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import { loadFormHiringLinks } from "~/hiring/lib/form-links.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { loadVersionResponses } from "~/forms/lib/version-responses.server";
import { loader, action, handle } from "~/forms/routes/forms.edit.$formId";

const request = new Request("http://os.test/forms/edit/f1");
const run = () => loader({ request, params: { formId: "f1" } } as never) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canBuildForm).mockResolvedValue(true);
  vi.mocked(loadFormForEdit).mockResolvedValue({
    id: "f1",
    name: "Intake",
    folderPageId: null,
    versions: [],
    workspaceType: "Project",
  } as never);
  (prisma as any).term.findMany.mockResolvedValue([]);
  vi.mocked(formUsages).mockResolvedValue([]);
  vi.mocked(managingUsage).mockReturnValue(null as never);
  vi.mocked(loadFormHiringLinks).mockResolvedValue([] as never);
  vi.mocked(driveFolderCrumbs).mockResolvedValue(null as never);
  vi.mocked(getCollabToken).mockResolvedValue("tok" as never);
});

describe("forms.edit loader results paging", () => {
  it("passes page, search and slot to the responses loader", async () => {
    vi.mocked(loadFormForEdit).mockResolvedValue({
      id: "f1",
      folderPageId: null,
      versions: [{ id: "v2", versionNumber: 2 }],
      workspaceType: "Project",
    } as never);
    vi.mocked(loadVersionResponses).mockResolvedValue({ versionId: "v2" } as never);
    const req = new Request("http://os.test/forms/edit/f1?view=results&version=2&page=3&q=ada&slot=Tue");
    await loader({ request: req, params: { formId: "f1" } } as never);
    expect(loadVersionResponses).toHaveBeenCalledWith("f1", "v2", { page: 3, q: "ada", slot: "Tue" });
  });

  it("reads a bad page as the first", async () => {
    vi.mocked(loadFormForEdit).mockResolvedValue({
      id: "f1",
      folderPageId: null,
      versions: [{ id: "v2", versionNumber: 2 }],
      workspaceType: "Project",
    } as never);
    const req = new Request("http://os.test/forms/edit/f1?view=results&page=-4");
    await loader({ request: req, params: { formId: "f1" } } as never);
    expect(loadVersionResponses).toHaveBeenCalledWith("f1", "v2", { page: 1, q: "", slot: "" });
  });
});

describe("forms.edit loader", () => {
  it("lets in whoever canBuildForm for this form, not just Core", async () => {
    const data = await run();
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1", request);
    expect(data.form.id).toBe("f1");
  });

  describe("a caller who cannot build the form", () => {
    beforeEach(() => {
      vi.mocked(canBuildForm).mockResolvedValue(false);
    });

    it("is sent to Drive with a notice when they cannot see it either", async () => {
      vi.mocked(canSeeForm).mockResolvedValue(false);
      const res = await run();
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/drive?scope=lab&notice=form-no-access");
      expect(loadFormForEdit).not.toHaveBeenCalled();
    });

    it("opens a published form for filling when they can see it", async () => {
      vi.mocked(canSeeForm).mockResolvedValue(true);
      (prisma as any).form.findUnique.mockResolvedValue({ published: true, publicToken: "tok123", folderPageId: "fold" });
      const res = await run();
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/forms/fill/tok123");
    });

    it("returns an unpublished form's viewer to its folder with a notice", async () => {
      vi.mocked(canSeeForm).mockResolvedValue(true);
      (prisma as any).form.findUnique.mockResolvedValue({ published: false, publicToken: null, folderPageId: "fold" });
      vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "group:g1", folders: [] } as never);
      const res = await run();
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/drive?scope=group:g1&folder=fold&notice=form-view-only");
      expect(driveFolderCrumbs).toHaveBeenCalledWith("fold", "u1", request);
    });
  });

  it("returns the page workspace for the UI", async () => {
    const data = await run();
    expect(data.page).toEqual({ workspaceType: "Project" });
  });
});

describe("forms.edit breadcrumb trail", () => {
  const leaf = (iconEmoji: string | null) =>
    handle.breadcrumbTrail({ form: { name: "Intake", iconEmoji }, driveCrumbs: null })!.at(-1) as {
      label: string;
      emoji?: string | null;
      icon?: unknown;
    };

  it("ends at the form, carrying its emoji for the tab and an icon for the crumb", () => {
    const crumb = leaf("📋");
    expect(crumb).toMatchObject({ label: "Intake", emoji: "📋" });
    expect(crumb.icon).toBeTruthy();
  });

  it("leaves the leaf bare when the form has no emoji", () => {
    const crumb = leaf(null);
    expect(crumb).toMatchObject({ label: "Intake", emoji: null });
    expect(crumb.icon).toBeUndefined();
  });
});

describe("forms.edit action", () => {
  const post = (fields: Record<string, string>) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return action({
      request: new Request("http://os.test/forms/edit/f1", { method: "POST", body }),
      params: { formId: "f1" },
    } as never) as Promise<Response>;
  };

  it("refuses a caller who cannot build this form", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    expect((await post({ intent: "rename-form", id: "f1", name: "x" })).status).toBe(403);
    expect(runFormsAction).not.toHaveBeenCalled();
  });

  it("refuses a crafted id that is not this route's form", async () => {
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    expect((await post({ intent: "delete-form", id: "someone-elses" })).status).toBe(403);
    expect(runFormsAction).not.toHaveBeenCalled();
  });

  it("runs the action for a builder", async () => {
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    await post({ intent: "rename-form", id: "f1", name: "x" });
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1", expect.any(Request));
    expect(runFormsAction).toHaveBeenCalled();
  });
});
