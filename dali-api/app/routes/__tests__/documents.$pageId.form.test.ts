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

import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { loader } from "../documents.$pageId";

const call = () =>
  loader({ request: new Request("http://localhost/documents/f1"), params: { pageId: "f1" } } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as any);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true } as any);
  (prisma as any).page.findUnique.mockResolvedValue({ id: "f1", kind: "Form", archivedAt: null, meetingNoteId: null });
});

describe("documents.$pageId loader on a form page", () => {
  it("sends the viewer to the form editor", async () => {
    const res = (await call()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/forms/edit/f1");
  });
});
