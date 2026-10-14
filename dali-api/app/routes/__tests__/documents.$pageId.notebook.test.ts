import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { page: { findUnique: vi.fn(), findMany: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
  isNonMember: vi.fn(),
}));
vi.mock("~/lib/public-doc.server", () => ({ publicDocRedirectForPath: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  PAGE_ACCESS_SELECT: { id: true },
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
}));
vi.mock("~/lib/notebooks.server", () => ({ canManageNotebook: vi.fn() }));
vi.mock("~/lib/notebook-series.server", () => ({ nextNoteTarget: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ isFavorited: vi.fn(), recordPageVisit: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canManageNotebook } from "~/lib/notebooks.server";
import { nextNoteTarget } from "~/lib/notebook-series.server";
import { loader } from "../documents.$pageId";

const call = () =>
  loader({ request: new Request("http://localhost/documents/nb1"), params: { pageId: "nb1" } } as any);

const notebookPage = {
  id: "nb1",
  kind: "Notebook",
  title: "Weekly sync",
  archivedAt: null,
  meetingNoteId: null,
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: "f1",
  templatePage: { id: "tpl1", title: "Template" },
  parent: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as any);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true } as any);
  vi.mocked(canManageNotebook).mockResolvedValue(true);
  vi.mocked(nextNoteTarget).mockResolvedValue({ meetingId: "m1", occurrenceStart: "2026-10-20T14:00:00.000Z" } as any);
  (prisma as any).page.findUnique.mockResolvedValue(notebookPage);
});

describe("documents.$pageId loader on a notebook", () => {
  it("returns the shell for a notebook with no notes instead of redirecting or rendering a document", async () => {
    (prisma as any).page.findMany.mockResolvedValue([]);

    const res = (await call()) as any;

    expect(res).not.toBeInstanceOf(Response);
    expect(res.title).toBe("Weekly sync");
    expect(res.pageId).toBeUndefined();
    expect(res.emptyNotebook).toEqual({
      id: "nb1",
      title: "Weekly sync",
      canEdit: true,
      canManage: true,
      workspaceType: "Lab",
      workspaceId: null,
      folderId: "f1",
      templateId: "tpl1",
      projectId: null,
      nextNote: { meetingId: "m1", occurrenceStart: "2026-10-20T14:00:00.000Z" },
      tabs: [],
    });
  });

  it("hides the next-note action from a viewer who cannot edit", async () => {
    (prisma as any).page.findMany.mockResolvedValue([]);
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: false } as any);
    vi.mocked(canManageNotebook).mockResolvedValue(false);

    const res = (await call()) as any;

    expect(res.emptyNotebook).toMatchObject({ canEdit: false, canManage: false, nextNote: null });
  });

  it("still redirects to the latest tab when the notebook has notes", async () => {
    (prisma as any).page.findMany.mockResolvedValue([
      { id: "n1", meetingOccurrenceStart: new Date("2020-01-01T00:00:00Z") },
    ]);

    const res = (await call()) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/documents/n1");
  });
});
