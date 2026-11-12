import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { term: { findMany: vi.fn() }, form: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({
  canBuildForm: vi.fn(),
  canCreateForm: vi.fn(),
  canSeeForm: vi.fn(),
}));
vi.mock("~/forms/lib/forms-data", () => ({ loadFormForEdit: vi.fn(), runFormsAction: vi.fn() }));
vi.mock("~/drive/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formUsages: vi.fn(), managingUsage: vi.fn() }));
vi.mock("~/hiring/lib/form-links.server", () => ({ loadFormHiringLinks: vi.fn(), unlinkHiringForm: vi.fn() }));
vi.mock("~/forms/lib/mapped-questions.server", () => ({
  mappedQuestionFeatures: async () => new Map(),
}));
vi.mock("~/forms/lib/prefill.server", () => ({ formFillers: async (id: string) => (id === "f1" ? ["partner"] : []) }));
vi.mock("~/forms/lib/version-responses.server", () => ({ loadVersionResponses: vi.fn() }));
vi.mock("~/forms/lib/version-summary.server", () => ({ loadVersionSummary: vi.fn() }));
vi.mock("~/forms/lib/form-response.server", () => ({ deleteFormResponse: vi.fn() }));
vi.mock("~/forms/lib/form-tracker.server", () => ({
  loadTrackerCounts: vi.fn(),
  loadTrackerList: vi.fn(),
  sendFormReminder: vi.fn(),
}));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/forms/components/FormDetail", () => ({ FormDetail: () => null }));
vi.mock("~/components/PageIcon", () => ({ PageIcon: () => null }));

import { prisma } from "~/lib/db.server";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canBuildForm, canCreateForm, canSeeForm } from "~/forms/lib/form-access.server";
import { loadFormForEdit, runFormsAction } from "~/forms/lib/forms-data";
import { driveFolderCrumbs } from "~/drive/lib/drive-crumbs.server";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import { loadFormHiringLinks, unlinkHiringForm } from "~/hiring/lib/form-links.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { loadVersionResponses } from "~/forms/lib/version-responses.server";
import { loadVersionSummary } from "~/forms/lib/version-summary.server";
import { deleteFormResponse } from "~/forms/lib/form-response.server";
import { loadTrackerCounts, loadTrackerList, sendFormReminder } from "~/forms/lib/form-tracker.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
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
      versions: [{ id: "v2", versionNumber: 2, questions: [] }],
      workspaceType: "Project",
    } as never);
    vi.mocked(loadVersionResponses).mockResolvedValue({ versionId: "v2" } as never);
    const req = new Request("http://os.test/forms/edit/f1?view=results&version=2&show=responses&page=3&q=ada&slot=Tue&member=termsInLab");
    await loader({ request: req, params: { formId: "f1" } } as never);
    expect(loadVersionResponses).toHaveBeenCalledWith("f1", "v2", {
      page: 3,
      q: "ada",
      slot: "Tue",
      answers: [],
      questions: [],
      memberColumns: ["termsInLab"],
    });
  });

  it("reads a bad page as the first", async () => {
    vi.mocked(loadFormForEdit).mockResolvedValue({
      id: "f1",
      folderPageId: null,
      versions: [{ id: "v2", versionNumber: 2, questions: [] }],
      workspaceType: "Project",
    } as never);
    const req = new Request("http://os.test/forms/edit/f1?view=results&show=responses&page=-4");
    await loader({ request: req, params: { formId: "f1" } } as never);
    expect(loadVersionResponses).toHaveBeenCalledWith("f1", "v2", {
      page: 1,
      q: "",
      slot: "",
      answers: [],
      questions: [],
      memberColumns: [],
    });
  });
});

describe("forms.edit saved response columns", () => {
  const withVersion = (responseColumns: string[]) =>
    vi.mocked(loadFormForEdit).mockResolvedValue({
      id: "f1",
      folderPageId: null,
      versions: [{ id: "v2", versionNumber: 2, questions: [] }],
      workspaceType: "Project",
      responseColumns,
    } as never);
  const resultsReq = new Request("http://os.test/forms/edit/f1?view=results&show=responses&member=projectHistory");

  it("loads the form's saved columns and ignores the URL when the flag is on", async () => {
    withVersion(["hiredRoles", "termsInLab"]);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    await loader({ request: resultsReq, params: { formId: "f1" } } as never);
    expect(vi.mocked(loadVersionResponses).mock.calls[0][2]?.memberColumns).toEqual(["hiredRoles", "termsInLab"]);
  });

  it("keeps reading the URL when the flag is off", async () => {
    withVersion(["hiredRoles"]);
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    await loader({ request: resultsReq, params: { formId: "f1" } } as never);
    expect(vi.mocked(loadVersionResponses).mock.calls[0][2]?.memberColumns).toEqual(["projectHistory"]);
  });

  const save = (columns: string) => {
    const body = new FormData();
    body.set("intent", "set-response-columns");
    body.set("columns", columns);
    return action({
      request: new Request("http://os.test/forms/edit/f1", { method: "POST", body }),
      params: { formId: "f1" },
    } as never) as Promise<any>;
  };

  it("saves the columns in the order given", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    expect(await save(JSON.stringify(["member:termsInLab", "member:hiredRoles"]))).toEqual({ ok: true });
    expect((prisma as any).form.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { responseColumns: ["member:termsInLab", "member:hiredRoles"] },
    });
  });

  it("rejects an unknown column without saving", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await save(JSON.stringify(["member:salary"]));
    expect(res.status).toBe(400);
    expect((prisma as any).form.update).not.toHaveBeenCalled();
  });

  it("refuses to save while the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await save(JSON.stringify(["member:hiredRoles"]));
    expect(res.status).toBe(403);
    expect((prisma as any).form.update).not.toHaveBeenCalled();
  });

  it("refuses someone who can't build the form", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await save(JSON.stringify(["member:hiredRoles"]));
    expect(res.status).toBe(403);
    expect((prisma as any).form.update).not.toHaveBeenCalled();
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

  it("returns who the form's sharing lets fill it, for the prefill picker", async () => {
    const data = await run();
    expect(data.fillers).toEqual(["partner"]);
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

  it("refuses a second id value smuggled behind this route's", async () => {
    // get() reads the first value but the action parser keeps the last, so
    // every value must be this form's id.
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    const body = new FormData();
    body.set("intent", "delete-form");
    body.append("id", "f1");
    body.append("id", "someone-elses");
    const res = (await action({
      request: new Request("http://os.test/forms/edit/f1", { method: "POST", body }),
      params: { formId: "f1" },
    } as never)) as Response;
    expect(res.status).toBe(403);
    expect(runFormsAction).not.toHaveBeenCalled();
  });

  it("gates create-form on the destination folder, not this form", async () => {
    vi.mocked(canCreateForm).mockResolvedValue(false);
    expect(
      (await post({ intent: "create-form", name: "x", folderPageId: "folder-1" })).status,
    ).toBe(403);
    expect(canCreateForm).toHaveBeenCalledWith("u1", "folder-1", expect.any(Request));
    expect(runFormsAction).not.toHaveBeenCalled();

    vi.mocked(canCreateForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    await post({ intent: "create-form", name: "x", folderPageId: "folder-1" });
    expect(runFormsAction).toHaveBeenCalled();
  });

  it("scopes unlink-hiring-form to this route's form", async () => {
    vi.mocked(unlinkHiringForm).mockResolvedValue({ ok: true } as never);
    await post({ intent: "unlink-hiring-form", linkType: "application", cycleId: "c1" });
    expect(unlinkHiringForm).toHaveBeenCalledWith(
      { formId: "f1", linkType: "application", cycleId: "c1" },
      "u1",
    );
  });
});

describe("forms.edit action delete-form-response", () => {
  const del = (fields: Record<string, string> = { submissionId: "s1" }) => {
    const body = new FormData();
    body.set("intent", "delete-form-response");
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return action({
      request: new Request("http://os.test/forms/edit/f1", { method: "POST", body }),
      params: { formId: "f1" },
    } as never) as Promise<Response>;
  };

  beforeEach(() => {
    vi.mocked(deleteFormResponse).mockResolvedValue({ ok: true });
  });

  it("deletes for a builder, scoped to this route's form", async () => {
    await del();
    expect(deleteFormResponse).toHaveBeenCalledWith({
      formId: "f1",
      submissionId: "s1",
      actorId: "u1",
      request: expect.any(Request),
    });
    expect(runFormsAction).not.toHaveBeenCalled();
  });

  it("refuses a caller who cannot build this form", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    expect((await del()).status).toBe(403);
    expect(deleteFormResponse).not.toHaveBeenCalled();
  });

  it("needs a submission id", async () => {
    expect((await del({})).status).toBe(400);
    expect(deleteFormResponse).not.toHaveBeenCalled();
  });

  it("relays a refusal with its status", async () => {
    vi.mocked(deleteFormResponse).mockResolvedValue({ error: "nope", status: 409 });
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "nope" });
  });
});

describe("forms.edit tracker", () => {
  const resultsRequest = new Request("http://os.test/forms/edit/f1?view=results&version=1");
  const withVersion = () =>
    vi.mocked(loadFormForEdit).mockResolvedValue({
      id: "f1",
      folderPageId: null,
      versions: [{ id: "v1", versionNumber: 1, questions: [] }],
      workspaceType: "Project",
    } as never);

  it("loads the counts on Results", async () => {
    withVersion();
    vi.mocked(loadTrackerCounts).mockResolvedValue({ expected: 71, responded: 58 });
    const data = await loader({ request: resultsRequest, params: { formId: "f1" } } as never);
    expect((data as any).tracker).toEqual({ expected: 71, responded: 58 });
    expect(loadTrackerCounts).toHaveBeenCalledWith("f1");
  });

  it("does not count on the questions view", async () => {
    withVersion();
    await run();
    expect(loadTrackerCounts).not.toHaveBeenCalled();
  });

  it("serves the name list only for the list request, to a builder", async () => {
    vi.mocked(loadTrackerList).mockResolvedValue({ expected: 2 } as never);
    const res = await loader({
      request: new Request("http://os.test/forms/edit/f1?tracker=list"),
      params: { formId: "f1" },
    } as never);
    expect(await (res as Response).json()).toEqual({ list: { expected: 2 } });
    expect(loadFormForEdit).not.toHaveBeenCalled();
  });

  it("does not serve the list to someone who cannot build the form", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    vi.mocked(canSeeForm).mockResolvedValue(false);
    await loader({
      request: new Request("http://os.test/forms/edit/f1?tracker=list"),
      params: { formId: "f1" },
    } as never);
    expect(loadTrackerList).not.toHaveBeenCalled();
  });
});

describe("forms.edit action send-form-reminder", () => {
  const send = (fields: Record<string, string> = { message: "Please fill it out." }) => {
    const body = new FormData();
    body.set("intent", "send-form-reminder");
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return action({
      request: new Request("http://os.test/forms/edit/f1", { method: "POST", body }),
      params: { formId: "f1" },
    } as never) as Promise<Response>;
  };

  beforeEach(() => {
    vi.mocked(sendFormReminder).mockResolvedValue({ ok: true, sent: 11 });
  });

  it("sends for a builder using only the message from the request", async () => {
    const res = await send({ message: "Hi", userIds: "evil", recipients: "evil" });
    expect(res).toEqual({ ok: true, sent: 11 });
    expect(sendFormReminder).toHaveBeenCalledWith({
      formId: "f1",
      actorId: "u1",
      message: "Hi",
      request: expect.any(Request),
    });
  });

  it("refuses a caller who cannot build this form", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    expect((await send()).status).toBe(403);
    expect(sendFormReminder).not.toHaveBeenCalled();
  });

  it("needs a message", async () => {
    expect((await send({})).status).toBe(400);
    expect(sendFormReminder).not.toHaveBeenCalled();
  });

  it("relays a refusal with its status", async () => {
    vi.mocked(sendFormReminder).mockResolvedValue({ error: "slow down", status: 429 });
    const res = await send();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "slow down" });
  });
});

describe("forms.edit summary", () => {
  const version = {
    id: "v1",
    versionNumber: 1,
    questions: [
      { key: "a", type: "select", data: { label: "A", options: ["Yes"] } },
      { key: "f", type: "file", data: { label: "F" } },
    ],
  };
  const call = (query: string) =>
    loader({
      request: new Request(`http://os.test/forms/edit/f1?${query}`),
      params: { formId: "f1" },
    } as never) as Promise<any>;

  beforeEach(() => {
    vi.mocked(loadFormForEdit).mockResolvedValue({
      id: "f1",
      folderPageId: null,
      versions: [version],
      workspaceType: "Project",
    } as never);
    vi.mocked(loadVersionSummary).mockResolvedValue({ versionId: "v1" } as never);
    vi.mocked(loadVersionResponses).mockResolvedValue({ versionId: "v1" } as never);
    vi.mocked(loadTrackerCounts).mockResolvedValue(null as never);
  });

  it("loads the summary, not the table, on Results", async () => {
    const data = await call("view=results&version=1&slot=level-up");
    expect(loadVersionSummary).toHaveBeenCalledWith("f1", version, { slot: "level-up", answers: [] });
    expect(loadVersionResponses).not.toHaveBeenCalled();
    expect(data.summary).toEqual({ versionId: "v1" });
    expect(data.results).toBeNull();
  });

  it("passes the answer filters to the summary, dropping unusable ones", async () => {
    await call("view=results&version=1&a=a:is:Yes&a=f:answered&a=gone:blank");
    expect(loadVersionSummary).toHaveBeenCalledWith("f1", version, {
      slot: "",
      answers: [{ key: "a", kind: "is", values: ["Yes"] }],
    });
  });

  it("passes the answer filters and the version's questions to the table", async () => {
    await call("view=results&version=1&show=responses&q=ada&a=a:blank");
    expect(loadVersionResponses).toHaveBeenCalledWith("f1", "v1", {
      page: 1,
      q: "ada",
      slot: "",
      answers: [{ key: "a", kind: "blank" }],
      questions: version.questions,
      memberColumns: [],
    });
  });

  it("loads the table, not the summary, on the Responses view", async () => {
    const data = await call("view=results&version=1&show=responses");
    expect(loadVersionResponses).toHaveBeenCalled();
    expect(loadVersionSummary).not.toHaveBeenCalled();
    expect(data.summary).toBeNull();
  });

  it("does not load the summary on the Questions view", async () => {
    await call("");
    expect(loadVersionSummary).not.toHaveBeenCalled();
  });

  it("sends a caller who cannot build the form away before loading anything", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    vi.mocked(canSeeForm).mockResolvedValue(false);
    await call("view=results&version=1");
    expect(loadVersionSummary).not.toHaveBeenCalled();
  });
});
