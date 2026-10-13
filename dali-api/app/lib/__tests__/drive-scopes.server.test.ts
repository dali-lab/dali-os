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
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isImpersonating: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ favoritePageIds: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/drive-roots.server", () => ({
  findAllRoots: vi.fn(),
  ensureAllRoots: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { loadDriveScope, loadForms, loadOrphanForms, buildLinkedProcessMap } from "~/lib/drive.server";
import { requireAuth, isImpersonating } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { findAllRoots, ensureAllRoots } from "~/lib/drive-roots.server";
import { liftOrphans, loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

const m = prisma as any;

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
      userSub: "viewer",
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
    vi.mocked(requireAuth).mockResolvedValue({ ok: true } as any);
    vi.mocked(isImpersonating).mockReturnValue(false);
    vi.mocked(loadForms).mockResolvedValue([]);
    vi.mocked(loadOrphanForms).mockResolvedValue([]);
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
    expect(scopes.map((s) => s.id)).toEqual(["mine", "lab", "mentorship"]);
    expect(scopes.find((s) => s.id === "hiring")).toBeUndefined();
    expect(ids(scopes, "lab")).not.toContain("hiringRoot");
    expect(ids(scopes, "lab")).not.toContain("mentorRoot");
  });

  it("skips a space whose root does not exist yet", async () => {
    vi.mocked(findAllRoots).mockResolvedValue({ byKey: { core: "coreRoot" }, ids: ["coreRoot"] });
    const scopes = await load({ isCore: false });
    expect(scopes.map((s) => s.id)).toEqual(["mine", "lab", "core"]);
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
    expect(scopes.map((s) => s.id)).toEqual(["mine", "lab", "core", "hiring", "mentorship"]);
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
    expect(scopes.map((s) => s.id)).toEqual(["mine", "lab"]);
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
