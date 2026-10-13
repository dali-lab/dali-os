import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/pageAccess.server", () => {
  const getPageAccess = vi.fn();
  return {
    getPageAccess,
    PAGE_ACCESS_SELECT: { id: true },
    // Delegates to the getPageAccess mock per page so existing per-page mock
    // setups drive the batched path unchanged.
    getPageAccessBulk: vi.fn(async (userId: string, pages: Array<{ id: string }>) => {
      const m = new Map();
      for (const p of pages) m.set(p.id, await getPageAccess(userId, p));
      return m;
    }),
    // Files use this via canViewFile; default false → unscoped files stay visible.
    isUnderGoverningScope: vi.fn().mockResolvedValue(false),
    governingScopeMap: vi.fn((rows: Array<{ id: string }>) => new Map(rows.map((r) => [r.id, null]))),
  };
});
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/lib/page-audience.server", () => ({
  summarizeAudience: vi.fn(async (_viewer: string, rows: Array<{ id: string }>) =>
    new Map(rows.map((r) => [r.id, { kind: "private", label: `aud:${r.id}`, permission: "Edit" }])),
  ),
}));

import { prisma } from "~/lib/db";
import { getPageAccess, getPageAccessBulk, governingScopeMap } from "~/lib/pageAccess.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { summarizeAudience } from "~/lib/page-audience.server";
import { loadDriveScope, loadOrphanForms } from "~/lib/drive.server";

const mockPrisma = prisma as unknown as {
  page: { findMany: ReturnType<typeof vi.fn> };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
  form: { findMany: ReturnType<typeof vi.fn> };
};

const VIEW_ONLY = { canView: true, canEdit: false, canComment: false, canManageAccess: false };
const DENIED = { canView: false, canEdit: false, canComment: false, canManageAccess: false };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty results
  mockPrisma.page.findMany.mockResolvedValue([]);
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
  mockPrisma.form.findMany.mockResolvedValue([]);
  vi.mocked(getPageAccess).mockResolvedValue(VIEW_ONLY as any);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
});

describe("loadDriveScope — Lab scope", () => {
  it("returns lab-scoped files as DriveItems with type='file'", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f1",
        title: "Logo",
        folderPageId: null,
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      },
    ]);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    const file = items.find((i) => i.id === "f1");
    expect(file).toBeDefined();
    expect(file?.type).toBe("file");
    expect(file?.href).toBe("/documents/file/f1");
  });

  it("queries projectFile with workspaceType=Lab, archivedAt=null (no-widening: never fetches project files)", async () => {
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(mockPrisma.projectFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceType: "Lab", archivedAt: null }),
      }),
    );
    // Must NOT include a projectId filter that could leak project-scoped files.
    const callArg = mockPrisma.projectFile.findMany.mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty("projectId");
  });

  it("places the file at its folderPageId as parentFolderId", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f2",
        title: "Brand Kit",
        folderPageId: "folder-1",
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      },
    ]);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    const file = items.find((i) => i.id === "f2");
    expect(file?.parentFolderId).toBe("folder-1");
  });

  it("excludes forms when canViewForms is false (default)", async () => {
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(mockPrisma.form.findMany).not.toHaveBeenCalled();
  });

  it("includes forms when canViewForms is true", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "form1", name: "Application", folderPageId: null, updatedAt: new Date() },
    ]);
    const items = await loadDriveScope({
      userSub: "u1",
      scope: { kind: "Lab" },
      canViewForms: true,
    });
    expect(items.some((i) => i.type === "form")).toBe(true);
  });

  it("filters out pages the viewer cannot see via getPageAccess", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "pg-secret",
        title: "Secret",
        kind: "FreeForm",
        parentPageId: null,
        iconEmoji: null,
        updatedAt: new Date(),
        workspaceType: "Lab",
        workspaceId: null,
        archivedAt: null,
        createdById: "other",
        partnerVisible: false,
        profileVisible: false,
        labListing: false,
        linkAccess: "Disabled",
        linkPermission: "View",
        scopeKind: null,
        scopeGroupId: null,
        scopePermission: null,
      },
    ]);
    vi.mocked(getPageAccess).mockResolvedValue(DENIED as any);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "pg-secret")).toBeUndefined();
  });
});

const pageRow = (over: Record<string, unknown>) => ({
  id: "pg",
  title: "Page",
  kind: "FreeForm",
  parentPageId: null,
  iconEmoji: null,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  workspaceType: "Lab",
  workspaceId: null,
  archivedAt: null,
  createdById: "other",
  partnerVisible: false,
  profileVisible: false,
  labListing: "None",
  linkAccess: "Restricted",
  linkPermission: "View",
  scopeKind: null,
  scopeGroupId: null,
  scopePermission: null,
  ...over,
});

describe("loadDriveScope — notebooks", () => {
  it("asks for Notebook pages in every Lab, Project, Education and Member page query", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([]);
    for (const scope of [
      { kind: "Lab" as const },
      { kind: "Project" as const, projectId: "proj-1" },
      { kind: "EducationOffering" as const, offeringId: "off-1" },
      { kind: "Member" as const },
    ]) {
      mockPrisma.page.findMany.mockClear();
      await loadDriveScope({ userSub: "u1", scope });
      const pageQueries = mockPrisma.page.findMany.mock.calls.map((c) => c[0].where.kind?.in);
      expect(pageQueries.filter(Boolean).length).toBeGreaterThan(0);
      for (const kinds of pageQueries.filter(Boolean)) expect(kinds).toContain("Notebook");
    }
  });

  it("lists a Lab notebook as a document that opens at /documents", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "nb-1", title: "Weekly sync", kind: "Notebook", parentPageId: "folder-1" }),
    ]);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "nb-1")).toMatchObject({
      type: "doc",
      isWhiteboard: false,
      parentFolderId: "folder-1",
      href: "/documents/nb-1",
    });
  });

  it("still hides a notebook the viewer cannot see", async () => {
    mockPrisma.page.findMany.mockResolvedValue([pageRow({ id: "nb-2", kind: "Notebook" })]);
    vi.mocked(getPageAccess).mockResolvedValue(DENIED as any);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "nb-2")).toBeUndefined();
  });
});

describe("loadDriveScope — shortcuts", () => {
  const shortcutRow = (over: Record<string, unknown> = {}) =>
    pageRow({ id: "sc-1", title: "Shortcut", kind: "Shortcut", parentPageId: "folder-1", targetPageId: "t-1", ...over });
  const targetRow = (over: Record<string, unknown> = {}) =>
    pageRow({ id: "t-1", title: "Kickoff notes", kind: "FreeForm", archivedAt: null, ...over });

  /** Page rows for the workspace query, target rows for the distinct-target query. */
  function pages(rows: unknown[], targets: unknown[]) {
    mockPrisma.page.findMany.mockImplementation(async (args: any) => (args.where.id?.in ? targets : rows));
  }
  const scopes = [
    ["Lab", { kind: "Lab" as const }],
    ["Project", { kind: "Project" as const, projectId: "proj-1" }],
    ["Education", { kind: "EducationOffering" as const, offeringId: "off-1" }],
    ["Member", { kind: "Member" as const }],
  ] as const;

  it.each(scopes)("%s: lists a shortcut as the target's title and glyph, opening the target", async (_n, scope) => {
    pages([shortcutRow()], [targetRow({ kind: "Whiteboard" })]);

    const items = await loadDriveScope({ userSub: "u1", scope });

    expect(items.find((i) => i.id === "sc-1")).toMatchObject({
      type: "shortcut",
      title: "Kickoff notes",
      parentFolderId: "folder-1",
      targetId: "t-1",
      targetType: "whiteboard",
      canOpen: true,
      originalInTrash: false,
      href: "/whiteboard/t-1",
    });
  });

  it.each([
    ["Folder", "folder", "/documents/t-1"],
    ["Notebook", "notebook", "/documents/t-1"],
    ["FreeForm", "doc", "/documents/t-1"],
    ["Structured", "doc", "/documents/t-1"],
  ])("types a %s target as %s", async (kind, targetType, href) => {
    pages([shortcutRow()], [targetRow({ kind })]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "sc-1")).toMatchObject({ targetType, href });
  });

  it("asks for the targets of all shortcuts in one query over distinct ids", async () => {
    pages(
      [shortcutRow(), shortcutRow({ id: "sc-2" }), shortcutRow({ id: "sc-3", targetPageId: "t-2" })],
      [targetRow(), targetRow({ id: "t-2" })],
    );

    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });

    const targetQueries = mockPrisma.page.findMany.mock.calls.filter((c) => c[0].where.id?.in);
    expect(targetQueries).toHaveLength(1);
    expect(targetQueries[0][0].where.id.in).toEqual(["t-1", "t-2"]);
  });

  it("makes no target query when the drive holds no shortcut", async () => {
    pages([pageRow({ id: "d1" })], []);
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(mockPrisma.page.findMany.mock.calls.filter((c) => c[0].where.id?.in)).toHaveLength(0);
  });

  it("hides the title of a target the viewer can't open and refuses to open it", async () => {
    pages([shortcutRow()], [targetRow()]);
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, p: any) =>
      (p.id === "t-1" ? DENIED : VIEW_ONLY) as any,
    );

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });

    expect(items.find((i) => i.id === "sc-1")).toMatchObject({
      type: "shortcut",
      title: "Shortcut (no access)",
      canOpen: false,
      originalInTrash: false,
      targetType: "doc",
      href: "/documents/sc-1",
    });
  });

  it("treats a target that no longer exists the same as one the viewer can't open", async () => {
    pages([shortcutRow()], []);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "sc-1")).toMatchObject({ title: "Shortcut (no access)", canOpen: false });
  });

  it("marks a trashed original, keeps its title, and does not open it", async () => {
    pages([shortcutRow()], [targetRow({ archivedAt: new Date() })]);

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });

    expect(items.find((i) => i.id === "sc-1")).toMatchObject({
      title: "Kickoff notes",
      canOpen: false,
      originalInTrash: true,
    });
    expect(getPageAccessBulk).toHaveBeenCalledWith("u1", expect.anything(), undefined, { includeArchived: true });
  });

  it("hides the shortcut row itself when its folder is hidden from the viewer", async () => {
    pages([shortcutRow()], [targetRow()]);
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, p: any) =>
      (p.id === "sc-1" ? DENIED : VIEW_ONLY) as any,
    );

    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });

    expect(items.find((i) => i.id === "sc-1")).toBeUndefined();
  });

  it("asks for Shortcut pages in every page query", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([]);
    for (const [, scope] of scopes) {
      mockPrisma.page.findMany.mockClear();
      await loadDriveScope({ userSub: "u1", scope });
      for (const call of mockPrisma.page.findMany.mock.calls.filter((c) => c[0].where.kind?.in)) {
        expect(call[0].where.kind.in).toContain("Shortcut");
      }
    }
  });
});

describe("loadOrphanForms — archived/deleted-folder safety-net", () => {
  it("surfaces a form whose folder is gone at the General root, but not one in a live folder", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "orphan", name: "Stray", folderPageId: "gone-folder", updatedAt: new Date() },
      { id: "kept", name: "Placed", folderPageId: "live-folder", updatedAt: new Date() },
    ]);
    // Only "live-folder" survives (non-archived, still exists); "gone-folder" was
    // archived or deleted → not returned.
    mockPrisma.page.findMany.mockResolvedValue([{ id: "live-folder" }]);

    const items = await loadOrphanForms();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "form",
      id: "orphan",
      parentFolderId: null,
      href: "/forms/edit/orphan",
    });
    // Only the archived/deleted-folder set is checked for liveness.
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null }),
      }),
    );
  });

  it("returns nothing when there are no placed forms", async () => {
    mockPrisma.form.findMany.mockResolvedValue([]);
    const items = await loadOrphanForms();
    expect(items).toEqual([]);
    expect(mockPrisma.page.findMany).not.toHaveBeenCalled();
  });
});

describe("loadDriveScope — Project scope", () => {
  it("returns project-scoped files, not lab files", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      { id: "pf1", title: "Report", folderPageId: null, updatedAt: new Date() },
    ]);

    const items = await loadDriveScope({
      userSub: "u1",
      scope: { kind: "Project", projectId: "proj-1" },
    });

    // Should query by projectId, NOT workspaceType
    const callArg = mockPrisma.projectFile.findMany.mock.calls[0][0];
    expect(callArg.where).toHaveProperty("projectId");
    expect(callArg.where).not.toHaveProperty("workspaceType");
    expect(items.some((i) => i.id === "pf1")).toBe(true);
  });
});

describe("loadDriveScope — audience", () => {
  const audienceOf = (items: Array<{ id: string }>, id: string) =>
    (items.find((i) => i.id === id) as { audience?: unknown } | undefined)?.audience;
  const folder = (over: Record<string, unknown> = {}) =>
    pageRow({ id: "folder-1", title: "Plans", kind: "Folder", ...over });
  const file = (over: Record<string, unknown> = {}) => ({
    id: "f1",
    title: "Brief",
    folderPageId: null,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  });
  const managers = () => {
    const [, , opts] = vi.mocked(summarizeAudience).mock.calls[0] as unknown as [
      string,
      unknown,
      { canManageSharing: (id: string) => boolean; governingByPageId: unknown },
    ];
    return opts;
  };

  it("summarises the pages the viewer can see in one call and attaches it to folders and docs", async () => {
    mockPrisma.page.findMany.mockResolvedValue([folder(), pageRow({ id: "doc-1", parentPageId: "folder-1" })]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(summarizeAudience).toHaveBeenCalledTimes(1);
    expect(items.find((i) => i.id === "folder-1")).toMatchObject({ audience: { label: "aud:folder-1" } });
    expect(items.find((i) => i.id === "doc-1")).toMatchObject({ audience: { label: "aud:doc-1" } });
  });

  it("only summarises pages the viewer can see", async () => {
    mockPrisma.page.findMany.mockResolvedValue([pageRow({ id: "secret" }), pageRow({ id: "open" })]);
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, p: any) =>
      (p.id === "secret" ? DENIED : VIEW_ONLY) as any,
    );
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    const rows = vi.mocked(summarizeAudience).mock.calls[0][1] as unknown as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["open"]);
  });

  it("hands the in-process governing map to both access and the summary (Lab)", async () => {
    mockPrisma.page.findMany.mockResolvedValue([folder()]);
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    const map = vi.mocked(governingScopeMap).mock.results[0].value;
    expect(vi.mocked(getPageAccessBulk).mock.calls[0][4]).toBe(map);
    expect(managers().governingByPageId).toBe(map);
  });

  it("hands the governing map to access when a project folder is scoped", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "pf", workspaceType: "Project", workspaceId: "proj-1", scopeKind: "Private" }),
    ]);
    await loadDriveScope({ userSub: "u1", scope: { kind: "Project", projectId: "proj-1" } });
    const map = vi.mocked(governingScopeMap).mock.results[0].value;
    expect(vi.mocked(getPageAccessBulk).mock.calls[0][4]).toBe(map);
    expect(managers().governingByPageId).toBe(map);
  });

  it("Lab: Core manages every page, a creator manages their own, others manage nothing", async () => {
    const rows = [pageRow({ id: "mine", createdById: "u1" }), pageRow({ id: "theirs", createdById: "x" })];
    mockPrisma.page.findMany.mockResolvedValue(rows);
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(managers().canManageSharing("mine")).toBe(true);
    expect(managers().canManageSharing("theirs")).toBe(false);

    vi.mocked(summarizeAudience).mockClear();
    vi.mocked(isCore).mockResolvedValue(true);
    await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(managers().canManageSharing("theirs")).toBe(true);
  });

  it("Project: Core or a project member manages; a lab-only viewer does not", async () => {
    mockPrisma.page.findMany.mockResolvedValue([pageRow({ id: "p", workspaceType: "Project", workspaceId: "proj-1" })]);
    const scope = { kind: "Project" as const, projectId: "proj-1" };
    await loadDriveScope({ userSub: "u1", scope });
    expect(managers().canManageSharing("p")).toBe(false);

    vi.mocked(summarizeAudience).mockClear();
    vi.mocked(isProjectMember).mockResolvedValue(true);
    await loadDriveScope({ userSub: "u1", scope });
    expect(managers().canManageSharing("p")).toBe(true);
    expect(isProjectMember).toHaveBeenCalledWith("u1", "proj-1", undefined);
  });

  it("Education: Core or an assigned instructor manages", async () => {
    mockPrisma.page.findMany.mockResolvedValue([pageRow({ id: "e", workspaceType: "EducationOffering", workspaceId: "off-1" })]);
    const assignment = (prisma as any).instructorAssignment.findFirst as ReturnType<typeof vi.fn>;
    const scope = { kind: "EducationOffering" as const, offeringId: "off-1" };
    assignment.mockResolvedValue(null);
    await loadDriveScope({ userSub: "u1", scope });
    expect(managers().canManageSharing("e")).toBe(false);

    vi.mocked(summarizeAudience).mockClear();
    assignment.mockResolvedValue({ id: "ia" });
    await loadDriveScope({ userSub: "u1", scope });
    expect(managers().canManageSharing("e")).toBe(true);
    expect(assignment).toHaveBeenCalledWith({ where: { userId: "u1", offeringId: "off-1" }, select: { id: true } });
  });

  it("does not summarise anything for the viewer's own Member drive", async () => {
    mockPrisma.page.findMany.mockResolvedValue([pageRow({ id: "note", workspaceType: "Member" })]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Member" } });
    expect(summarizeAudience).not.toHaveBeenCalled();
    expect(audienceOf(items, "note")).toBeUndefined();
  });

  describe("files", () => {
    it("a file takes its folder's audience, pointed at that folder, without the share list", async () => {
      mockPrisma.page.findMany.mockResolvedValue([folder({ title: "Plans" })]);
      vi.mocked(summarizeAudience).mockResolvedValueOnce(
        new Map([
          [
            "folder-1",
            {
              kind: "people",
              label: "Shared with 2 people and groups",
              count: 2,
              permission: "Edit",
              people: [{ id: "u2", name: "Ada", photoUrl: null }],
              canManage: true,
              inheritedFrom: { id: "elsewhere", title: "Elsewhere" },
            },
          ],
        ]),
      );
      mockPrisma.projectFile.findMany.mockResolvedValue([file({ folderPageId: "folder-1" })]);
      const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
      expect(audienceOf(items, "f1")).toEqual({
        kind: "people",
        label: "Shared with 2 people and groups",
        permission: "Edit",
        inheritedFrom: { id: "folder-1", title: "Plans" },
      });
    });

    it("a loose Lab file is open to the whole lab and editable", async () => {
      mockPrisma.projectFile.findMany.mockResolvedValue([file()]);
      const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
      expect(audienceOf(items, "f1")).toEqual({
        kind: "lab",
        label: "Everyone in the lab",
        permission: "Edit",
      });
    });

    it("a loose project file is lab-visible but not lab-editable", async () => {
      mockPrisma.projectFile.findMany.mockResolvedValue([file({ projectId: "proj-1" })]);
      const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Project", projectId: "proj-1" } });
      expect(audienceOf(items, "f1")).toMatchObject({ kind: "lab", permission: "View" });
    });

    it("a file whose folder is not in the listing gets no audience", async () => {
      mockPrisma.projectFile.findMany.mockResolvedValue([file({ folderPageId: "unlisted" })]);
      const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
      expect(audienceOf(items, "f1")).toBeUndefined();
    });

    it("Member files carry no audience", async () => {
      mockPrisma.projectFile.findMany.mockResolvedValue([file()]);
      const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Member" } });
      expect(audienceOf(items, "f1")).toBeUndefined();
    });
  });
});
