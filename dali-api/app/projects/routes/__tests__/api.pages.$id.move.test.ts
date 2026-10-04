import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    projectFile: { findMany: vi.fn(), updateMany: vi.fn() },
    signingDocument: { count: vi.fn() },
    rubric: { count: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { canManageSharing } from "~/lib/page-share-access.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { logAuditEvent } from "~/lib/audit";
import { action } from "../api.pages.$id.move";

const m = prisma as any;

function req(body: unknown) {
  return new Request("http://localhost/api/pages/p1/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = (body: unknown) => action({ request: req(body), params: { id: "p1" } } as any);

function labPage(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    workspaceType: "Lab",
    workspaceId: null,
    kind: "FreeForm",
    archivedAt: null,
    createdById: "u1",
    partnerVisible: false,
    publicVisible: false,
    projectAsOverview: null,
    projectAsPRD: null,
    ...over,
  };
}
function projectPage(over: Record<string, unknown> = {}) {
  return labPage({ workspaceType: "Project", workspaceId: "projA", ...over });
}
/** A personal note in My Drive — the Member workspace is keyed by its owner. */
function notePage(over: Record<string, unknown> = {}) {
  return labPage({ workspaceType: "Member", workspaceId: "u1", ...over });
}

/**
 * Child pages keyed by parent id, driving both the subtree BFS and the
 * depth walk. The route fires several `page.findMany` calls per request
 * (one per BFS level, then the destination siblings), so dispatching on the
 * `where` shape is the only stable way to script them.
 */
let childrenByParent: Record<string, string[]> = {};
/** Extra `page.findUnique` answers by id, for the parent-folder + depth walk. */
let pagesById: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(canManageSharing).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(isOfferingManager).mockResolvedValue(false);
  childrenByParent = {};
  pagesById = {};
  m.page.findMany.mockImplementation(async ({ where }: any) => {
    // Subtree BFS: `parentPageId: { in: [...] }`. Siblings: a plain parentPageId.
    const inList = where?.parentPageId?.in;
    if (!inList) return [];
    return inList.flatMap((p: string) => (childrenByParent[p] ?? []).map((id) => ({ id })));
  });
  m.projectFile.findMany.mockResolvedValue([]);
  m.signingDocument.count.mockResolvedValue(0);
  m.rubric.count.mockResolvedValue(0);
  m.$transaction.mockResolvedValue([]);
});

/** Data passed to the FIRST prisma.page.update — the moved page. */
function movedUpdateData() {
  return m.page.update.mock.calls[0][0].data;
}

/** Ids the route handed to `page.updateMany` as the carried subtree. */
function carriedPageIds(): string[] {
  const call = m.page.updateMany.mock.calls.find((c: any) => c[0].data?.workspaceType);
  return call ? call[0].where.id.in : [];
}

describe("POST /api/pages/:id/move", () => {
  it("same-workspace reorder works with no workspace fields (back-compat)", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    const res = await call({ parentPageId: null });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.parentPageId).toBeNull();
    expect(data.workspaceType).toBeUndefined();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("moves Lab → Project when actor manages source and can edit destination", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.workspaceType).toBe("Project");
    expect(data.workspaceId).toBe("projA");
    expect(data.pinnedAt).toBeNull();
    // Leaving the lab shelf drops lab-wide access so it can't follow the doc.
    expect(data.linkAccess).toBe("Restricted");
    expect(data.linkPermission).toBe("View");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "page.move-workspace" }),
    );
  });

  it("resets partner/public sharing when a doc leaves a project", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ partnerVisible: true, publicVisible: true }));
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.workspaceType).toBe("Lab");
    expect(data.partnerVisible).toBe(false);
    expect(data.publicVisible).toBe(false);
    // Landing on the lab shelf opens it to the whole lab (edit), the shelf default.
    expect(data.linkAccess).toBe("LabMembers");
    expect(data.linkPermission).toBe("Edit");
  });

  it("403 when the actor can't manage the source", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(canManageSharing).mockResolvedValue(false);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(403);
  });

  it("403 when the actor can't edit the destination", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(403);
  });

  it("400 when moving the Overview/PRD doc out of its project", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ projectAsOverview: { id: "projA" } }));
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(400);
  });

  it("rejects a Member destination via the enum (400)", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    const res = await call({ parentPageId: null, workspaceType: "Member", workspaceId: "u2" });
    expect(res.status).toBe(400);
  });

  it("403 moving to an EducationOffering the user doesn't manage", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    const res = await call({ parentPageId: null, workspaceType: "EducationOffering", workspaceId: "off1" });
    expect(res.status).toBe(403);
  });

  it("moves into an EducationOffering the user manages (200)", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "EducationOffering", workspaceId: "off1" });
    expect(res.status).toBe(200);
  });

  it("moves a personal note out of My Drive into a project", async () => {
    m.page.findUnique.mockResolvedValue(notePage({ profileVisible: true, labListing: "Listed" }));
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.workspaceType).toBe("Project");
    expect(data.workspaceId).toBe("projA");
    // The personal-note flags are Member-workspace concepts — they don't follow.
    expect(data.profileVisible).toBe(false);
    expect(data.labListing).toBe("None");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "page.move-workspace" }),
    );
  });

  it("moves a personal note onto the lab shelf", async () => {
    m.page.findUnique.mockResolvedValue(notePage());
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.workspaceType).toBe("Lab");
    expect(data.workspaceId).toBeNull();
    expect(data.linkAccess).toBe("LabMembers");
  });

  it("403 when the actor doesn't own the note being moved out of My Drive", async () => {
    m.page.findUnique.mockResolvedValue(notePage({ workspaceId: "u2" }));
    vi.mocked(canManageSharing).mockResolvedValue(false);
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(403);
  });

  it("404 for a Member page with no owner (malformed source)", async () => {
    m.page.findUnique.mockResolvedValue(notePage({ workspaceId: null }));
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(404);
  });

  it("cascades a folder's children to the new workspace (keeping their parent)", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ kind: "Folder" }));
    vi.mocked(isProjectMember).mockResolvedValue(true);
    childrenByParent = { p1: ["c1", "c2"] };
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projB" });
    expect(res.status).toBe(200);
    expect(carriedPageIds().sort()).toEqual(["c1", "c2"]);
    const data = m.page.updateMany.mock.calls[0][0].data;
    expect(data.workspaceType).toBe("Project");
    expect(data.workspaceId).toBe("projB");
    expect(data.parentPageId).toBeUndefined(); // children stay under the folder
  });

  // ── The subtree, not just the first level ─────────────────────────────────
  // A grandchild left behind is listed by neither drive: the destination
  // filters it out by workspace, and the source no longer holds its parent.

  it("carries grandchildren, not only direct children", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ kind: "Folder" }));
    vi.mocked(isProjectMember).mockResolvedValue(true);
    vi.mocked(isLabMember).mockResolvedValue(true);
    childrenByParent = { p1: ["sub"], sub: ["deep"], deep: ["deeper"] };
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(200);
    expect(carriedPageIds().sort()).toEqual(["deep", "deeper", "sub"]);
  });

  it("carries files filed anywhere in the subtree and re-scopes them", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ kind: "Folder" }));
    vi.mocked(isProjectMember).mockResolvedValue(true);
    vi.mocked(isLabMember).mockResolvedValue(true);
    childrenByParent = { p1: ["sub"] };
    m.projectFile.findMany.mockResolvedValue([{ id: "f1" }, { id: "f2" }]);

    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(200);

    // Every folder in the subtree is a candidate parent for a file.
    expect(m.projectFile.findMany.mock.calls[0][0].where.folderPageId.in.sort()).toEqual([
      "p1",
      "sub",
    ]);
    const update = m.projectFile.updateMany.mock.calls[0][0];
    expect(update.where.id.in).toEqual(["f1", "f2"]);
    // Lab-scoped files are keyed by workspaceType, not projectId.
    expect(update.data).toMatchObject({
      projectId: null,
      workspaceType: "Lab",
      workspaceId: null,
      partnerVisible: false,
    });
  });

  it("files landing in a project are keyed by projectId, not workspaceType", async () => {
    m.page.findUnique.mockResolvedValue(labPage({ kind: "Folder" }));
    vi.mocked(isCore).mockResolvedValue(true);
    m.projectFile.findMany.mockResolvedValue([{ id: "f1" }]);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projB" });
    expect(res.status).toBe(200);
    expect(m.projectFile.updateMany.mock.calls[0][0].data).toMatchObject({
      projectId: "projB",
      workspaceType: null,
      workspaceId: null,
    });
  });

  it("leaves files alone on a same-workspace reorder", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ kind: "Folder" }));
    const res = await call({ parentPageId: null });
    expect(res.status).toBe(200);
    expect(m.projectFile.findMany).not.toHaveBeenCalled();
    expect(m.projectFile.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to move a Lab folder holding an agreement out of the Lab drive", async () => {
    m.page.findUnique.mockResolvedValue(labPage({ kind: "Folder" }));
    vi.mocked(isCore).mockResolvedValue(true);
    m.signingDocument.count.mockResolvedValue(1);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projB" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/agreements or rubrics/i);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("allows a Lab folder holding an agreement to be reordered within Lab", async () => {
    m.page.findUnique.mockResolvedValue(labPage({ kind: "Folder" }));
    m.signingDocument.count.mockResolvedValue(1);
    const res = await call({ parentPageId: null });
    expect(res.status).toBe(200);
  });

  it("rejects a move whose subtree would land past the depth cap", async () => {
    // Destination parent sits at depth 4; a folder 3 levels tall would put its
    // deepest page at 8, past MAX_PAGE_DEPTH (6).
    m.page.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "p1" ? labPage({ kind: "Folder" }) : pagesById[where.id] ?? null,
    );
    pagesById = {
      dest: { workspaceType: "Lab", workspaceId: null, parentPageId: "a3", kind: "Folder", archivedAt: null },
      a3: { parentPageId: "a2" },
      a2: { parentPageId: "a1" },
      a1: { parentPageId: null },
    };
    childrenByParent = { p1: ["s1"], s1: ["s2"], s2: ["s3"] };
    const res = await call({ parentPageId: "dest" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too deeply nested/i);
  });

  it("allows the same subtree when the destination leaves room for it", async () => {
    m.page.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === "p1" ? labPage({ kind: "Folder" }) : pagesById[where.id] ?? null,
    );
    // Destination at depth 1 → deepest moved page lands at 5, within the cap.
    pagesById = {
      dest: { workspaceType: "Lab", workspaceId: null, parentPageId: "a1", kind: "Folder", archivedAt: null },
      a1: { parentPageId: null },
    };
    childrenByParent = { p1: ["s1"], s1: ["s2"], s2: ["s3"] };
    const res = await call({ parentPageId: "dest" });
    expect(res.status).toBe(200);
  });
});
