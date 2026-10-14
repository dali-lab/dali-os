import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { term: { findMany: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({
  canBuildForm: vi.fn(),
  formsUsePageAccess: vi.fn(),
}));
vi.mock("~/forms/lib/forms-data", () => ({ loadFormForEdit: vi.fn(), runFormsAction: vi.fn() }));
vi.mock("~/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formUsages: vi.fn(), managingUsage: vi.fn() }));
vi.mock("~/hiring/lib/form-links.server", () => ({ loadFormHiringLinks: vi.fn(), unlinkHiringForm: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listAllGroups: vi.fn() }));
vi.mock("~/forms/lib/version-responses.server", () => ({ loadVersionResponses: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/forms/components/FormDetail", () => ({ FormDetail: () => null }));
vi.mock("~/components/PageIcon", () => ({ PageIcon: () => null }));

import { prisma } from "~/lib/db";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canBuildForm, formsUsePageAccess } from "~/forms/lib/form-access.server";
import { loadFormForEdit, runFormsAction } from "~/forms/lib/forms-data";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import { loadFormHiringLinks } from "~/hiring/lib/form-links.server";
import { listAllGroups } from "~/lib/groups";
import { getCollabToken } from "~/lib/collab-token.server";
import { loader, action } from "~/forms/routes/forms.edit.$formId";

const request = new Request("http://os.test/forms/edit/f1");
const run = () => loader({ request, params: { formId: "f1" } } as never) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canBuildForm).mockResolvedValue(true);
  vi.mocked(formsUsePageAccess).mockResolvedValue(true);
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
  vi.mocked(listAllGroups).mockResolvedValue([]);
  vi.mocked(driveFolderCrumbs).mockResolvedValue(null as never);
  vi.mocked(getCollabToken).mockResolvedValue("tok" as never);
});

describe("forms.edit loader", () => {
  it("lets in whoever canBuildForm for this form, not just Core", async () => {
    const data = await run();
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1", request);
    expect(data.form.id).toBe("f1");
  });

  it("sends everyone else home", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    const res = await run();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    expect(loadFormForEdit).not.toHaveBeenCalled();
  });

  it("returns the page workspace and the access mode for the UI", async () => {
    const data = await run();
    expect(data.page).toEqual({ workspaceType: "Project" });
    expect(data.pageAccess).toBe(true);
    vi.mocked(formsUsePageAccess).mockResolvedValue(false);
    expect((await run()).pageAccess).toBe(false);
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
