import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
import { loadDriveScope, buildLinkedProcessMap } from "~/lib/drive.server";

const mockPrisma = prisma as unknown as {
  page: { findMany: ReturnType<typeof vi.fn> };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
  form: { findMany: ReturnType<typeof vi.fn> };
  applicationCycle: { findMany: ReturnType<typeof vi.fn> };
  cycleDomainForm: { findMany: ReturnType<typeof vi.fn> };
  educationOffering: { findMany: ReturnType<typeof vi.fn> };
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

describe("loadDriveScope — page kinds", () => {
  const scopes = [
    ["Lab", { kind: "Lab" as const }],
    ["Project", { kind: "Project" as const, projectId: "proj-1" }],
    ["Education", { kind: "EducationOffering" as const, offeringId: "off-1" }],
    ["Member", { kind: "Member" as const }],
  ] as const;

  it.each(scopes)("%s: never asks for Shortcut pages", async (_n, scope) => {
    await loadDriveScope({ userSub: "u1", scope });

    const kindQueries = mockPrisma.page.findMany.mock.calls.filter((c) => c[0].where.kind?.in);
    expect(kindQueries.length).toBeGreaterThan(0);
    for (const call of kindQueries) expect(call[0].where.kind.in).not.toContain("Shortcut");
  });
});

describe("loadDriveScope — tags", () => {
  const tagRow = (id: string, label: string, color: string | null = "#ff0000") => ({ tag: { id, label, color } });
  const scopes = [
    { name: "Lab", scope: { kind: "Lab" as const } },
    { name: "Project", scope: { kind: "Project" as const, projectId: "proj-1" } },
    { name: "Education", scope: { kind: "EducationOffering" as const, offeringId: "off-1" } },
    { name: "Member", scope: { kind: "Member" as const } },
  ];

  it.each(scopes)("$name: selects only live tags as part of the page query, with no extra query", async ({ scope }) => {
    await loadDriveScope({ userSub: "u1", scope });
    const pageQueries = mockPrisma.page.findMany.mock.calls.map((c) => c[0]).filter((q) => q.where.kind?.in);
    expect(pageQueries.length).toBeGreaterThan(0);
    for (const q of pageQueries) {
      expect(q.select.tags).toEqual({
        where: { tag: { archivedAt: null } },
        select: { tag: { select: { id: true, label: true, color: true } } },
      });
    }
  });

  it.each(scopes)("$name: maps tags onto docs and folders, sorted by label", async ({ scope }) => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "folder-1", kind: "Folder", tags: [tagRow("t2", "Zeta", null), tagRow("t1", "Alpha")] }),
      pageRow({ id: "doc-1", tags: [tagRow("t3", "Mid", "#00f")] }),
      pageRow({ id: "doc-2" }),
    ]);
    const items = await loadDriveScope({ userSub: "u1", scope });
    expect(items.find((i) => i.id === "folder-1")).toMatchObject({
      tags: [
        { id: "t1", label: "Alpha", color: "#ff0000" },
        { id: "t2", label: "Zeta", color: null },
      ],
    });
    expect(items.find((i) => i.id === "doc-1")).toMatchObject({ tags: [{ id: "t3", label: "Mid", color: "#00f" }] });
    expect(items.find((i) => i.id === "doc-2")).toMatchObject({ tags: [] });
  });
});

describe("loadDriveScope — forms are Form-kind pages", () => {
  const tag = { tag: { id: "t1", label: "Hiring", color: null } };
  const formRow = (over: Record<string, unknown> = {}) =>
    pageRow({ id: "form-1", title: "Application", kind: "Form", tags: [tag], partnerVisible: true, ...over });
  const scopes = [
    { name: "Lab", scope: { kind: "Lab" as const } },
    { name: "Project", scope: { kind: "Project" as const, projectId: "proj-1" } },
    { name: "Education", scope: { kind: "EducationOffering" as const, offeringId: "off-1" } },
  ];

  it.each(scopes)("$name: asks for Form pages in the page query", async ({ scope }) => {
    await loadDriveScope({ userSub: "u1", scope, canViewForms: true });
    const kinds = mockPrisma.page.findMany.mock.calls.map((c) => c[0].where.kind?.in).filter(Boolean);
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(k).toContain("Form");
  });

  it("Member: never asks for Form pages", async () => {
    await loadDriveScope({ userSub: "u1", scope: { kind: "Member" }, canViewForms: true });
    for (const call of mockPrisma.page.findMany.mock.calls.filter((c) => c[0].where.kind?.in)) {
      expect(call[0].where.kind.in).not.toContain("Form");
    }
  });

  it.each(scopes)("$name: maps a Form page to a form item with audience and tags", async ({ scope }) => {
    mockPrisma.page.findMany.mockResolvedValue([formRow()]);
    const items = await loadDriveScope({ userSub: "u1", scope, canViewForms: true });
    expect(items.find((i) => i.id === "form-1")).toEqual({
      type: "form",
      id: "form-1",
      title: "Application",
      parentFolderId: null,
      iconEmoji: null,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      href: "/forms/edit/form-1",
      audience: { kind: "private", label: "aud:form-1", permission: "Edit" },
      tags: [{ id: "t1", label: "Hiring", color: null }],
      partnerVisible: true,
      linkedProcess: null,
    });
  });

  it.each(scopes)("$name: gives a non-canViewForms viewer no form rows", async ({ scope }) => {
    mockPrisma.page.findMany.mockResolvedValue([formRow(), pageRow({ id: "doc-1" })]);
    const items = await loadDriveScope({ userSub: "u1", scope });
    expect(items.some((i) => i.type === "form")).toBe(false);
    expect(items.some((i) => i.id === "doc-1")).toBe(true);
  });

  it("does not run a form through page access, so canViewForms alone shows it", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow()]);
    vi.mocked(getPageAccess).mockResolvedValue(DENIED as any);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" }, canViewForms: true });
    expect(items.some((i) => i.id === "form-1")).toBe(true);
    expect(getPageAccess).not.toHaveBeenCalledWith("u1", expect.objectContaining({ id: "form-1" }));
  });

  it("flags a folder a process files meeting notes into, and asks only for those bindings", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "notes", kind: "Folder", processFolderBindings: [{ purpose: "meeting-notes-team" }] }),
      pageRow({ id: "plain", kind: "Folder", processFolderBindings: [] }),
      pageRow({ id: "legacy", kind: "Folder" }),
    ]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" } });
    expect(items.find((i) => i.id === "notes")).toMatchObject({ meetingNotes: true });
    expect(items.find((i) => i.id === "plain")).toMatchObject({ meetingNotes: false });
    expect(items.find((i) => i.id === "legacy")).toMatchObject({ meetingNotes: false });
    expect(mockPrisma.page.findMany.mock.calls[0][0].select.processFolderBindings).toEqual({
      where: { purpose: { startsWith: "meeting-notes" } },
      select: { purpose: true },
    });
  });

  it("keeps a form in a live folder under that folder", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "folder-1", kind: "Folder" }),
      formRow({ parentPageId: "folder-1" }),
    ]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" }, canViewForms: true });
    expect(items.find((i) => i.id === "form-1")?.parentFolderId).toBe("folder-1");
  });

  it("lifts a form whose folder is archived or gone to the scope top level", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow({ parentPageId: "archived-folder" })]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" }, canViewForms: true });
    expect(items.find((i) => i.id === "form-1")?.parentFolderId).toBeNull();
  });

  it("hides a form whose folder the viewer cannot open", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "core-folder", kind: "Folder" }),
      formRow({ parentPageId: "core-folder" }),
    ]);
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, p: any) =>
      (p.id === "core-folder" ? DENIED : VIEW_ONLY) as any,
    );
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Lab" }, canViewForms: true });
    expect(items.some((i) => i.id === "form-1")).toBe(false);
  });

  it("attaches the process linkage keyed by form id", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow()]);
    const linkedProcessMap = new Map([["form-1", { label: "Hiring 26F", href: "/hiring/c1" }]]);
    const items = await loadDriveScope({
      userSub: "u1",
      scope: { kind: "Lab" },
      canViewForms: true,
      linkedProcessMap,
    });
    expect(items.find((i) => i.id === "form-1")).toMatchObject({
      linkedProcess: { label: "Hiring 26F", href: "/hiring/c1" },
    });
  });
});

describe("loadDriveScope — forms by page access", () => {
  const formRow = (over: Record<string, unknown> = {}) =>
    pageRow({ id: "form-1", title: "Application", kind: "Form", ...over });
  const lab = { kind: "Lab" as const };
  const only = (id: string, access: unknown) => (_u: string, p: any) =>
    Promise.resolve((p.id === id ? access : VIEW_ONLY) as any);

  it("shows a form the viewer can view, with no canViewForms", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow()]);
    const items = await loadDriveScope({ userSub: "u1", scope: lab, formsByPageAccess: true });
    expect(items.find((i) => i.id === "form-1")).toMatchObject({ type: "form", href: "/forms/edit/form-1" });
    expect(getPageAccess).toHaveBeenCalledWith("u1", expect.objectContaining({ id: "form-1" }));
  });

  it("hides a form the viewer cannot view, even with canViewForms", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow(), pageRow({ id: "doc-1" })]);
    vi.mocked(getPageAccess).mockImplementation(only("form-1", DENIED));
    const items = await loadDriveScope({ userSub: "u1", scope: lab, canViewForms: true, formsByPageAccess: true });
    expect(items.some((i) => i.id === "form-1")).toBe(false);
    expect(items.some((i) => i.id === "doc-1")).toBe(true);
  });

  it("hangs a form off its own parent folder", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow({ id: "folder-1", kind: "Folder" }),
      formRow({ parentPageId: "folder-1" }),
    ]);
    const items = await loadDriveScope({ userSub: "u1", scope: lab, formsByPageAccess: true });
    expect(items.find((i) => i.id === "form-1")?.parentFolderId).toBe("folder-1");
  });

  it("keeps the form out of the doc rows and gives it the audience from the shared summary", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow()]);
    const items = await loadDriveScope({ userSub: "u1", scope: lab, formsByPageAccess: true });
    expect(items.filter((i) => i.id === "form-1")).toHaveLength(1);
    expect(items.find((i) => i.id === "form-1")).toMatchObject({ audience: { label: "aud:form-1" } });
  });

  it.each([
    { name: "Project", scope: { kind: "Project" as const, projectId: "proj-1" } },
    { name: "Education", scope: { kind: "EducationOffering" as const, offeringId: "off-1" } },
  ])("$name: lists a Form page without canViewForms", async ({ scope }) => {
    mockPrisma.page.findMany.mockResolvedValue([formRow()]);
    const items = await loadDriveScope({ userSub: "u1", scope, formsByPageAccess: true });
    expect(items.find((i) => i.id === "form-1")).toMatchObject({ type: "form", parentFolderId: null });
  });

  it("Member: asks for Form pages and lists one the viewer owns", async () => {
    mockPrisma.page.findMany.mockResolvedValue([formRow({ parentPageId: "mine-folder" })]);
    const items = await loadDriveScope({ userSub: "u1", scope: { kind: "Member" }, formsByPageAccess: true });
    const kinds = mockPrisma.page.findMany.mock.calls.map((c) => c[0].where.kind?.in).filter(Boolean);
    for (const k of kinds) expect(k).toContain("Form");
    expect(items.find((i) => i.id === "form-1")).toMatchObject({ type: "form", parentFolderId: "mine-folder" });
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

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("file folder checks", () => {
  const fileRow = (id: string, folderPageId: string | null, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    folderPageId,
    projectId: "proj-1",
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  });
  const rows = [fileRow("f1", "slow"), fileRow("f2", "hidden"), fileRow("f3", null), fileRow("f4", "slow")];

  function accessByFolder() {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getPageAccess).mockImplementation((async (_user: string, folderId: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const access = await later(folderId === "hidden" ? DENIED : VIEW_ONLY, folderId === "slow" ? 20 : 1);
      inFlight--;
      return access;
    }) as never);
    return () => peak;
  }

  it.each([
    ["Lab", { kind: "Lab" as const }],
    ["Project", { kind: "Project" as const, projectId: "proj-1" }],
  ])("%s: checks each distinct folder once, all at the same time, and keeps the files' order", async (_n, scope) => {
    mockPrisma.projectFile.findMany.mockResolvedValue(rows);
    const peak = accessByFolder();

    const items = await loadDriveScope({ userSub: "u1", scope });

    expect(items.filter((i) => i.type === "file").map((i) => i.id)).toEqual(["f1", "f3", "f4"]);
    const folders = vi.mocked(getPageAccess).mock.calls.map((c) => c[1]);
    expect(folders.sort()).toEqual(["hidden", "slow"]);
    expect(peak()).toBe(2);
  });
});

describe("buildLinkedProcessMap", () => {
  const cycle = (id: string, name: string, extra: Record<string, unknown>) => ({ id, name, ...extra });

  afterEach(() => {
    mockPrisma.applicationCycle.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.cycleDomainForm.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.educationOffering.findMany.mockReset().mockResolvedValue([]);
  });

  it("lets the first binding win in a fixed order, whichever query answers first", async () => {
    mockPrisma.applicationCycle.findMany.mockImplementation(async (args: any) =>
      args.where.applicationFormId
        ? later([cycle("c1", "26F", { applicationFormId: "shared" })], 20)
        : [cycle("c2", "27W", { continuedInterestFormId: "shared" })],
    );
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { formId: "shared", applicationCycle: { id: "c3", name: "27S" } },
      { formId: "challenge", applicationCycle: { id: "c3", name: "27S" } },
    ]);
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { id: "o1", title: "Intro", applicationFormId: "challenge" },
      { id: "o2", title: "Studio", applicationFormId: "edu" },
    ]);

    const map = await buildLinkedProcessMap();

    expect(map.get("shared")).toEqual({ label: "Hiring – 26F", href: "/hiring/lead/cycle/c1" });
    expect(map.get("challenge")).toEqual({ label: "Hiring – 27S", href: "/hiring/lead/cycle/c3" });
    expect(map.get("edu")).toEqual({ label: "Studio", href: "/education/manage/o2" });
  });

  it("prefers the continued-interest form over a challenge form bound to the same id", async () => {
    mockPrisma.applicationCycle.findMany.mockImplementation(async (args: any) =>
      args.where.continuedInterestFormId ? [cycle("c2", "27W", { continuedInterestFormId: "dup" })] : [],
    );
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { formId: "dup", applicationCycle: { id: "c3", name: "27S" } },
    ]);

    const map = await buildLinkedProcessMap();

    expect(map.get("dup")).toEqual({ label: "Hiring – 27W", href: "/hiring/lead/cycle/c2" });
  });

  it("starts all four lookups before any of them answers", async () => {
    const started: string[] = [];
    const slow = (name: string) => async () => {
      started.push(name);
      return later([], 5);
    };
    mockPrisma.applicationCycle.findMany.mockImplementation(slow("cycle"));
    mockPrisma.cycleDomainForm.findMany.mockImplementation(slow("domain"));
    mockPrisma.educationOffering.findMany.mockImplementation(slow("offering"));

    const pending = buildLinkedProcessMap();
    expect(started.sort()).toEqual(["cycle", "cycle", "domain", "offering"]);
    await pending;
  });
});
