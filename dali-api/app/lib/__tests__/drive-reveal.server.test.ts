import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUnique: vi.fn() } } }));
vi.mock("~/lib/pageAccess.server", () => ({
  PAGE_ACCESS_SELECT: { id: true },
  getPageAccess: vi.fn(),
}));
vi.mock("~/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { driveHref, driveRevealHref } from "~/lib/drive-reveal.server";

const m = prisma as any;
const YES = { canView: true, canEdit: false, canComment: false };
const NO = { canView: false, canEdit: false, canComment: false };

const folderCrumb = (id: string) => ({ id, title: id, iconEmoji: null });

function pages(rows: Record<string, any>) {
  m.page.findUnique.mockImplementation(async ({ where }: any) => rows[where.id] ?? null);
}

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: "doc",
  kind: "FreeForm",
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: "sub",
  archivedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPageAccess).mockResolvedValue(YES);
  vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "lab", folders: [] });
});

describe("driveHref", () => {
  it("omits the folder when there is none", () => {
    expect(driveHref("lab")).toBe("/drive?scope=lab");
    expect(driveHref("lab", null)).toBe("/drive?scope=lab");
  });
  it("adds the folder", () => {
    expect(driveHref("core", "f1")).toBe("/drive?scope=core&folder=f1");
  });
  it("adds the item to select, with or without a folder", () => {
    expect(driveHref("lab", null, "p1")).toBe("/drive?scope=lab&select=p1");
    expect(driveHref("core", "f1", "p1")).toBe("/drive?scope=core&folder=f1&select=p1");
  });
});

describe("driveRevealHref", () => {
  it("points at the deepest folder the viewer can see, in the crumbs' scope", async () => {
    pages({ doc: doc() , sub: { kind: "Folder", parentPageId: "top" } });
    vi.mocked(driveFolderCrumbs).mockResolvedValue({
      scope: "core",
      folders: [folderCrumb("top"), folderCrumb("sub")],
    });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=core&folder=sub&select=doc");
    expect(driveFolderCrumbs).toHaveBeenCalledWith("sub", "viewer", undefined);
  });

  it("lands on the space's top level for a page filed at the root", async () => {
    pages({ doc: doc({ parentPageId: null }) });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=lab&select=doc");
  });

  it("uses the personal space for a note at the top of My Drive", async () => {
    pages({ doc: doc({ parentPageId: null, workspaceType: "Member", workspaceId: "viewer" }) });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=mine&select=doc");
  });

  it("reveals the synthetic project folder for a page at a project's root", async () => {
    pages({ doc: doc({ parentPageId: null, workspaceType: "Project", workspaceId: "proj-1" }) });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=projects&folder=proj-1&select=doc");
  });

  it("reveals the synthetic offering folder for a page at an offering's root", async () => {
    pages({ doc: doc({ parentPageId: null, workspaceType: "EducationOffering", workspaceId: "off-1" }) });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=education&folder=off-1&select=doc");
  });

  it("prefers a real folder over the synthetic workspace folder", async () => {
    pages({ doc: doc({ workspaceType: "Project", workspaceId: "proj-1" }), sub: { kind: "Folder", parentPageId: null } });
    vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "projects", folders: [folderCrumb("sub")] });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=projects&folder=sub&select=doc");
  });

  it("points a page reached only by a named share at Shared with me", async () => {
    pages({ doc: doc() });
    vi.mocked(getPageAccess).mockImplementation(async (_u, _p, _r, opts) =>
      opts?.ignoreShares ? NO : YES,
    );
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=shared&select=doc");
    expect(driveFolderCrumbs).not.toHaveBeenCalled();
  });

  it("starts from the notebook's folder for a note inside a notebook", async () => {
    pages({
      doc: doc({ parentPageId: "nb" }),
      nb: { kind: "Notebook", parentPageId: "meetings" },
    });
    vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "lab", folders: [folderCrumb("meetings")] });
    expect(await driveRevealHref("doc", "viewer")).toBe("/drive?scope=lab&folder=meetings&select=nb");
    expect(driveFolderCrumbs).toHaveBeenCalledWith("meetings", "viewer", undefined);
  });

  it("reveals a notebook's own folder, not the notebook", async () => {
    pages({ nb: doc({ id: "nb", kind: "Notebook", parentPageId: "meetings" }), meetings: { kind: "Folder", parentPageId: null } });
    vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "lab", folders: [folderCrumb("meetings")] });
    expect(await driveRevealHref("nb", "viewer")).toBe("/drive?scope=lab&folder=meetings&select=nb");
  });

  it("reveals a folder by itself", async () => {
    pages({ f: doc({ id: "f", kind: "Folder", parentPageId: "up" }) });
    vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "lab", folders: [folderCrumb("up"), folderCrumb("f")] });
    expect(await driveRevealHref("f", "viewer")).toBe("/drive?scope=lab&folder=f");
    expect(driveFolderCrumbs).toHaveBeenCalledWith("f", "viewer", undefined);
  });

  it("is null for a missing, archived or unviewable page", async () => {
    pages({ gone: doc({ id: "gone", archivedAt: new Date() }), hidden: doc({ id: "hidden" }) });
    expect(await driveRevealHref("nope", "viewer")).toBeNull();
    expect(await driveRevealHref("gone", "viewer")).toBeNull();
    vi.mocked(getPageAccess).mockResolvedValue(NO);
    expect(await driveRevealHref("hidden", "viewer")).toBeNull();
  });
});
