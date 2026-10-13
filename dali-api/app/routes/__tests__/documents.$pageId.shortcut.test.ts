import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { page: { findUnique: vi.fn() } } }));
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
vi.mock("~/lib/shortcuts.server", () => ({ resolveShortcutTarget: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { resolveShortcutTarget } from "~/lib/shortcuts.server";
import { loader } from "../documents.$pageId";

const call = () =>
  loader({ request: new Request("http://localhost/documents/s1?x=1"), params: { pageId: "s1" } } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as any);
  (prisma as any).page.findUnique.mockResolvedValue({ id: "s1", kind: "Shortcut", archivedAt: null });
});

describe("documents.$pageId loader on a shortcut", () => {
  it("redirects to the target without checking the shortcut's own access", async () => {
    vi.mocked(resolveShortcutTarget).mockResolvedValue({ targetId: "t1", targetKind: "FreeForm", href: "/documents/t1" });

    const res = (await call()) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/documents/t1");
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("sends a shortcut to a whiteboard to the canvas", async () => {
    vi.mocked(resolveShortcutTarget).mockResolvedValue({ targetId: "w1", targetKind: "Whiteboard", href: "/whiteboard/w1" });
    const res = (await call()) as Response;
    expect(res.headers.get("Location")).toBe("/whiteboard/w1");
  });

  it("is a 404 when the shortcut has lost its target", async () => {
    vi.mocked(resolveShortcutTarget).mockResolvedValue(null);
    await expect(call()).rejects.toMatchObject({ status: 404 });
  });

  it("is a 404 for a trashed shortcut", async () => {
    (prisma as any).page.findUnique.mockResolvedValue({ id: "s1", kind: "Shortcut", archivedAt: new Date(), meetingNoteId: null });
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(resolveShortcutTarget).not.toHaveBeenCalled();
  });
});
