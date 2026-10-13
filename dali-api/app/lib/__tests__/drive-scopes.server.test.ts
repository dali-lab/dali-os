import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { groupDefinition: { findUnique: vi.fn() }, page: { findMany: vi.fn() } },
}));
vi.mock("~/lib/drive.server", () => ({
  loadDriveScope: vi.fn(),
  loadForms: vi.fn(),
  loadOrphanForms: vi.fn(),
  buildLinkedProcessMap: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({ isImpersonating: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ favoritePageIds: vi.fn() }));
vi.mock("~/lib/drive-shared.server", () => ({ loadSharedWithMe: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/drive-roots.server", () => ({
  findAllRoots: vi.fn(),
  ensureAllRoots: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { loadDriveScope, loadForms, loadOrphanForms, buildLinkedProcessMap } from "~/lib/drive.server";
import { isImpersonating } from "~/lib/auth";
import type { AuthSuccess } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { findAllRoots, ensureAllRoots } from "~/lib/drive-roots.server";
import { loadSharedWithMe } from "~/lib/drive-shared.server";
import { liftOrphans, loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

const m = prisma as any;
const VIEWER = { ok: true, user: { sub: "viewer" } } as unknown as AuthSuccess;

const form = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "form",
  id,
  title: id,
  parentFolderId,
  iconEmoji: null,
  updatedAt: new Date(0),
  href: `/forms/edit/${id}`,
});

const folder = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "folder",
  id,
  title: id,
  parentFolderId,
  iconEmoji: null,
  updatedAt: new Date(0),
  href: `/documents/${id}`,
});

// A carved-out space lists a subset of its workspace. The browser builds its
// tree from parentFolderId, so an item pointing at a parent the space doesn't
// hold is never drawn — it disappears from the Drive rather than rendering
// somewhere wrong. That happens as soon as a Core-scoped folder is moved
// inside an unscoped Lab folder.
describe("liftOrphans", () => {
  it("lifts an item whose parent isn't in the space to the top level", () => {
    const out = liftOrphans([folder("core-ish", "some-lab-folder"), form("a", "core-ish")]);
    expect(out.find((i) => i.id === "core-ish")?.parentFolderId).toBeNull();
    // Its own children still resolve, so the subtree stays intact under it.
    expect(out.find((i) => i.id === "a")?.parentFolderId).toBe("core-ish");
  });

  it("leaves items whose parent is present exactly where they are", () => {
    const items = [folder("root", null), form("a", "root"), form("b", null)];
    const out = liftOrphans(items);
    expect(out.map((i) => i.parentFolderId)).toEqual([null, "root", null]);
  });

  it("lifts every orphan, not just the first", () => {
    const out = liftOrphans([form("a", "gone"), form("b", "also-gone")]);
    expect(out.every((i) => i.parentFolderId === null)).toBe(true);
  });

  it("returns items unchanged when nothing is orphaned", () => {
    const items = [folder("root", null), form("a", "root")];
    expect(liftOrphans(items)).toEqual(items);
  });
});

// The Core, Hiring and Mentorship spaces are the contents of real root folders.
describe("loadDriveScopes: process-root spaces", () => {
  const doc = (id: string, parentFolderId: string | null): DriveItem => ({
    type: "doc",
    id,
    title: id,
    parentFolderId,
    iconEmoji: null,
    updatedAt: new Date(0),
    href: `/documents/${id}`,
  });

  // Lab tree as the Lab loader returns it for a Core viewer.
  const LAB: DriveItem[] = [
    folder("coreRoot", null),
    folder("agreements", "coreRoot"),
    doc("template", "agreements"),
    doc("coreNote", "coreRoot"),
    folder("hiringRoot", null),
    folder("hiringForms", "hiringRoot"),
    folder("mentorRoot", null),
    doc("mentorNote", "mentorRoot"),
    folder("legacyCore", null),
    doc("legacyDoc", "legacyCore"),
    folder("general", null),
    doc("generalDoc", "general"),
  ];

  const ROOTS = { coreRoot: "coreRoot", hiringRoot: "hiringRoot", mentorRoot: "mentorRoot" };

  function load(opts: { isCore?: boolean; labItems?: DriveItem[] } = {}) {
    vi.mocked(loadDriveScope).mockImplementation(async ({ scope }: any) =>
      scope.kind === "Lab" ? (opts.labItems ?? LAB) : [],
    );
    return loadDriveScopes({
      auth: VIEWER,
      projectWorkspaces: [],
      educationWorkspaces: [],
      canViewForms: opts.isCore ?? true,
      canManageAgreements: opts.isCore ?? true,
      isCore: opts.isCore ?? true,
      request: new Request("http://localhost/drive"),
    });
  }

  const ids = (scopes: Awaited<ReturnType<typeof load>>, id: string) =>
    scopes.find((s) => s.id === id)?.items.map((i) => i.id).sort();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildLinkedProcessMap).mockResolvedValue(new Map() as any);
    vi.mocked(favoritePageIds).mockResolvedValue(new Set());
    vi.mocked(isImpersonating).mockReturnValue(false);
    vi.mocked(loadForms).mockResolvedValue([]);
    vi.mocked(loadOrphanForms).mockResolvedValue([]);
    vi.mocked(loadSharedWithMe).mockResolvedValue([]);
    vi.mocked(findAllRoots).mockResolvedValue({
      byKey: { core: "coreRoot", hiring: "hiringRoot", mentorship: "mentorRoot" },
      ids: Object.values(ROOTS),
    });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true });
    m.groupDefinition.findUnique.mockResolvedValue({ id: "grp_core" });
    m.page.findMany.mockResolvedValue([]);
  });

  it("lists the Core root's children at the top level and leaves the root out", async () => {
    const scopes = await load();
    const core = scopes.find((s) => s.id === "core")!;
    expect(ids(scopes, "core")).toEqual(["agreements", "coreNote", "template"]);
    expect(core.items.find((i) => i.id === "agreements")?.parentFolderId).toBeNull();
    expect(core.items.find((i) => i.id === "coreNote")?.parentFolderId).toBeNull();
    expect(core.items.find((i) => i.id === "template")?.parentFolderId).toBe("agreements");
  });

  it("points the scope's rootFolderId at the root so New and Move land inside it", async () => {
    const scopes = await load();
    expect(scopes.find((s) => s.id === "core")?.rootFolderId).toBe("coreRoot");
    expect(scopes.find((s) => s.id === "hiring")?.rootFolderId).toBe("hiringRoot");
    expect(scopes.find((s) => s.id === "mentorship")?.rootFolderId).toBe("mentorRoot");
  });

  it("builds Hiring and Mentorship from their own roots with their audience labels", async () => {
    const scopes = await load();
    expect(ids(scopes, "hiring")).toEqual(["hiringForms"]);
    expect(ids(scopes, "mentorship")).toEqual(["mentorNote"]);
    expect(scopes.find((s) => s.id === "core")?.scopeAudience).toBe("Core only");
    expect(scopes.find((s) => s.id === "hiring")?.scopeAudience).toBe("Core only");
    expect(scopes.find((s) => s.id === "mentorship")?.scopeAudience).toBe("Mentors");
  });

  it("keeps every root, and its subtree, out of General", async () => {
    const scopes = await load();
    expect(ids(scopes, "lab")).toEqual(["general", "generalDoc", "legacyCore", "legacyDoc"]);
  });

  it("still shows a not-yet-reparented Core-scoped top-level folder in Core, not General", async () => {
    m.page.findMany.mockResolvedValue([
      { id: "legacyCore", folderType: null },
      { id: "coreRoot", folderType: "Root" },
    ]);
    const scopes = await load();
    expect(ids(scopes, "core")).toEqual(["agreements", "coreNote", "legacyCore", "legacyDoc", "template"]);
    expect(scopes.find((s) => s.id === "core")?.items.find((i) => i.id === "legacyCore")?.parentFolderId).toBeNull();
    expect(ids(scopes, "lab")).toEqual(["general", "generalDoc"]);
  });

  it("does not look for transitional folders for a non-Core viewer", async () => {
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, pageId: string) => ({
      canView: pageId === "mentorRoot",
      canEdit: false,
      canComment: false,
    }));
    await load({ isCore: false });
    expect(m.page.findMany).not.toHaveBeenCalled();
  });

  it("gives a viewer who cannot view a root no space for it, but still hides it from General", async () => {
    vi.mocked(getPageAccess).mockImplementation(async (_u: string, pageId: string) => ({
      canView: pageId === "mentorRoot",
      canEdit: false,
      canComment: false,
    }));
    const scopes = await load({ isCore: false });
    expect(scopes.map((s) => s.id)).toEqual(["mine", "shared", "lab", "mentorship"]);
    expect(scopes.find((s) => s.id === "hiring")).toBeUndefined();
    expect(ids(scopes, "lab")).not.toContain("hiringRoot");
    expect(ids(scopes, "lab")).not.toContain("mentorRoot");
  });

  it("skips a space whose root does not exist yet", async () => {
    vi.mocked(findAllRoots).mockResolvedValue({ byKey: { core: "coreRoot" }, ids: ["coreRoot"] });
    const scopes = await load({ isCore: false });
    expect(scopes.map((s) => s.id)).toEqual(["mine", "shared", "lab", "core"]);
  });

  it("creates missing roots for a Core viewer, then re-reads them", async () => {
    vi.mocked(findAllRoots)
      .mockResolvedValueOnce({ byKey: {}, ids: [] })
      .mockResolvedValueOnce({
        byKey: { core: "coreRoot", hiring: "hiringRoot", mentorship: "mentorRoot" },
        ids: Object.values(ROOTS),
      });
    const scopes = await load();
    expect(ensureAllRoots).toHaveBeenCalledWith("viewer");
    expect(scopes.map((s) => s.id)).toEqual(["mine", "shared", "lab", "core", "hiring", "mentorship"]);
  });

  it("never creates roots on behalf of a non-Core viewer", async () => {
    vi.mocked(findAllRoots).mockResolvedValue({ byKey: {}, ids: [] });
    await load({ isCore: false });
    expect(ensureAllRoots).not.toHaveBeenCalled();
  });

  it("does not call ensureAllRoots when every root exists", async () => {
    await load();
    expect(ensureAllRoots).not.toHaveBeenCalled();
  });

  it("still loads Drive when creating roots fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findAllRoots).mockResolvedValue({ byKey: {}, ids: [] });
    vi.mocked(ensureAllRoots).mockRejectedValue(new Error("no core group"));
    const scopes = await load();
    expect(scopes.map((s) => s.id)).toEqual(["mine", "shared", "lab"]);
  });

  it("re-roots a form filed on the root to the space's top level", async () => {
    vi.mocked(loadForms).mockResolvedValue([
      { ...form("formAtRoot", "coreRoot") },
      { ...form("formInFolder", "agreements") },
      { ...form("formElsewhere", "general") },
    ]);
    const scopes = await load();
    const core = scopes.find((s) => s.id === "core")!;
    expect(core.items.find((i) => i.id === "formAtRoot")?.parentFolderId).toBeNull();
    expect(core.items.find((i) => i.id === "formInFolder")?.parentFolderId).toBe("agreements");
    expect(core.items.find((i) => i.id === "formElsewhere")).toBeUndefined();
    expect(scopes.find((s) => s.id === "lab")!.items.some((i) => i.id === "formElsewhere")).toBe(true);
  });
});

describe("loadDriveScopes: Shared with me space", () => {
  const shared = (id: string): DriveItem => ({
    type: "doc",
    id,
    title: id,
    parentFolderId: null,
    iconEmoji: null,
    updatedAt: new Date(0),
    href: `/documents/${id}`,
    sharedBy: { name: "Alice Ng" },
    sharedAt: new Date(0),
    sharedWithMe: true,
  });

  function load(opts: { isCore?: boolean } = {}) {
    vi.mocked(loadDriveScope).mockResolvedValue([]);
    return loadDriveScopes({
      auth: VIEWER,
      projectWorkspaces: [],
      educationWorkspaces: [],
      canViewForms: false,
      canManageAgreements: false,
      isCore: opts.isCore ?? false,
      request: new Request("http://localhost/drive"),
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildLinkedProcessMap).mockResolvedValue(new Map() as any);
    vi.mocked(favoritePageIds).mockResolvedValue(new Set());
    vi.mocked(isImpersonating).mockReturnValue(false);
    vi.mocked(loadForms).mockResolvedValue([]);
    vi.mocked(loadOrphanForms).mockResolvedValue([]);
    vi.mocked(findAllRoots).mockResolvedValue({ byKey: {}, ids: [] } as any);
    vi.mocked(loadSharedWithMe).mockResolvedValue([]);
    m.page.findMany.mockResolvedValue([]);
  });

  it("sits right after My Drive", async () => {
    const scopes = await load();
    expect(scopes.slice(0, 3).map((s) => s.id)).toEqual(["mine", "shared", "lab"]);
    expect(scopes.find((s) => s.id === "shared")?.label).toBe("Shared with me");
  });

  it("carries the loader's items through, tagging favorites", async () => {
    vi.mocked(loadSharedWithMe).mockResolvedValue([shared("a"), shared("b")]);
    vi.mocked(favoritePageIds).mockResolvedValue(new Set(["b"]));
    const items = (await load()).find((s) => s.id === "shared")!.items;
    expect(items.map((i) => [i.id, i.favorited ?? false])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(items[0]).toMatchObject({ sharedBy: { name: "Alice Ng" }, sharedWithMe: true });
  });

  it("is still present, empty, for a Core viewer with nothing shared by name", async () => {
    const shared = (await load({ isCore: true })).find((s) => s.id === "shared");
    expect(shared).toBeDefined();
    expect(shared?.items).toEqual([]);
  });

  it("loads nothing while an admin is impersonating", async () => {
    vi.mocked(isImpersonating).mockReturnValue(true);
    vi.mocked(loadSharedWithMe).mockResolvedValue([shared("a")]);
    const scope = (await load()).find((s) => s.id === "shared");
    expect(scope?.items).toEqual([]);
    expect(loadSharedWithMe).not.toHaveBeenCalled();
  });
});

// The Lab load is the slow leg; everything that doesn't need its items starts
// alongside it instead of after it.
describe("loadDriveScopes: what starts without waiting for the Lab load", () => {
  const ROOTS = { core: "coreRoot", hiring: "hiringRoot", mentorship: "mentorRoot" };
  const folderItem = (id: string, parentFolderId: string | null): DriveItem => ({
    type: "folder",
    id,
    title: id,
    parentFolderId,
    iconEmoji: null,
    updatedAt: new Date(0),
    href: `/documents/${id}`,
  });

  let labResolve: ((items: DriveItem[]) => void) | undefined;
  const finishLab = async (items: DriveItem[]) => {
    await vi.waitFor(() => expect(labResolve).toBeDefined());
    labResolve!(items);
  };

  function start(opts: { isCore?: boolean; canViewForms?: boolean; projects?: string[] } = {}) {
    const isCore = opts.isCore ?? true;
    labResolve = undefined;
    vi.mocked(loadDriveScope).mockImplementation(({ scope }: any) =>
      scope.kind === "Lab" ? new Promise<DriveItem[]>((resolve) => (labResolve = resolve)) : Promise.resolve([]),
    );
    return loadDriveScopes({
      auth: VIEWER,
      projectWorkspaces: (opts.projects ?? []).map((key) => ({ key, label: key, kind: "project" as const })),
      educationWorkspaces: [{ key: "off1", label: "Offering", kind: "education" as const }],
      canViewForms: opts.canViewForms ?? isCore,
      canManageAgreements: isCore,
      isCore,
      request: new Request("http://localhost/drive"),
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildLinkedProcessMap).mockResolvedValue(new Map() as any);
    vi.mocked(favoritePageIds).mockResolvedValue(new Set());
    vi.mocked(isImpersonating).mockReturnValue(false);
    vi.mocked(loadForms).mockResolvedValue([]);
    vi.mocked(loadOrphanForms).mockResolvedValue([]);
    vi.mocked(loadSharedWithMe).mockResolvedValue([]);
    vi.mocked(findAllRoots).mockResolvedValue({ byKey: ROOTS, ids: Object.values(ROOTS) });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true });
    m.groupDefinition.findUnique.mockResolvedValue({ id: "grp_core" });
    m.page.findMany.mockResolvedValue([]);
  });

  it("checks the roots, reads forms and looks for legacy Core folders while the Lab load is pending", async () => {
    const pending = start();
    await vi.waitFor(() => {
      expect(getPageAccess).toHaveBeenCalledTimes(3);
      expect(loadForms).toHaveBeenCalled();
      expect(loadOrphanForms).toHaveBeenCalled();
      expect(m.page.findMany).toHaveBeenCalled();
    });
    await finishLab([]);
    await pending;
  });

  it("loads every project and offering alongside the Lab", async () => {
    const pending = start({ projects: ["p1", "p2"] });
    await vi.waitFor(() => {
      const kinds = vi.mocked(loadDriveScope).mock.calls.map(([o]: any) => o.scope.kind);
      expect(kinds.sort()).toEqual(["EducationOffering", "Lab", "Member", "Project", "Project"]);
    });
    await finishLab([]);
    await pending;
  });

  it("reads forms without narrowing to folder ids, since those aren't known yet", async () => {
    const pending = start();
    await finishLab([]);
    await pending;
    expect(loadForms).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadForms).mock.calls[0][0]).toBeUndefined();
  });

  it("still places a form only where its folder is in view, and drops one filed elsewhere", async () => {
    vi.mocked(loadForms).mockResolvedValue([
      form("unfiled", null),
      form("inGeneral", "general"),
      form("inCore", "coreFolder"),
      form("inNowhere", "someone-elses-folder"),
    ]);
    const pending = start();
    await vi.waitFor(() => expect(loadDriveScope).toHaveBeenCalled());
    await finishLab([
      folderItem("coreRoot", null),
      folderItem("coreFolder", "coreRoot"),
      folderItem("hiringRoot", null),
      folderItem("mentorRoot", null),
      folderItem("general", null),
    ]);
    const scopes = await pending;
    const ids = (id: string) => scopes.find((s) => s.id === id)!.items.map((i) => i.id).sort();

    expect(ids("lab")).toEqual(["general", "inGeneral", "unfiled"]);
    expect(ids("core")).toEqual(["coreFolder", "inCore"]);
    const everywhere = scopes.flatMap((s) => s.items.map((i) => i.id));
    expect(everywhere).not.toContain("inNowhere");
    expect(everywhere.filter((id) => id === "unfiled")).toHaveLength(1);
  });

  it("surfaces orphaned forms in General only for a viewer with the un-widened forms gate", async () => {
    vi.mocked(loadOrphanForms).mockResolvedValue([form("orphan", null)]);
    const withGate = start({ isCore: true, canViewForms: true });
    await finishLab([]);
    expect((await withGate).find((s) => s.id === "lab")!.items.map((i) => i.id)).toContain("orphan");

    const withoutGate = start({ isCore: true, canViewForms: false });
    await finishLab([]);
    await withoutGate;
    expect(loadOrphanForms).toHaveBeenCalledTimes(1);
  });

  it("reads no forms for a viewer who can't see them", async () => {
    const pending = start({ isCore: false, canViewForms: false });
    await finishLab([]);
    await pending;
    expect(loadForms).not.toHaveBeenCalled();
    expect(loadOrphanForms).not.toHaveBeenCalled();
  });

  it("looks for legacy Core folders only for a Core viewer", async () => {
    const pending = start({ isCore: false });
    await finishLab([]);
    await pending;
    expect(m.groupDefinition.findUnique).not.toHaveBeenCalled();
  });

  it("builds spaces in registry order however the root checks finish", async () => {
    vi.mocked(getPageAccess).mockImplementation(
      (async (_u: string, rootId: string) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ canView: true, canEdit: true, canComment: true }), rootId === "coreRoot" ? 20 : 1),
        )) as never,
    );
    const pending = start();
    await finishLab([folderItem("coreRoot", null), folderItem("hiringRoot", null), folderItem("mentorRoot", null)]);
    expect((await pending).map((s) => s.id)).toEqual(["mine", "shared", "lab", "education", "core", "hiring", "mentorship"]);
  });
});
