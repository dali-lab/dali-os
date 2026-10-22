import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { page: { findUnique: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isPartnerAccount: vi.fn(),
  isNonMember: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/collab/export", () => ({ buildExportHtml: vi.fn(() => "<html/>") }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));
vi.mock("~/collab/blocknote-server", () => ({
  blocksToHtml: vi.fn(),
  blocksToMarkdown: vi.fn(),
}));
vi.mock("~/lib/pdf/document-pdf.server", () => ({ renderDocumentPdf: vi.fn() }));
vi.mock("~/lib/page-typography", () => ({ normalizePageTypography: vi.fn() }));

import { prisma } from "~/lib/db";
import { isNonMember, isPartnerAccount, requireAuth } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToMarkdown } from "~/collab/blocknote-server";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import { logAuditEvent } from "~/lib/audit";
import { loader } from "~/routes/documents.$pageId.export";

function get(format?: string) {
  const query = format ? `?format=${format}` : "";
  return loader({
    request: new Request(`http://localhost/documents/p1/export${query}`),
    params: { pageId: "p1" },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isPartnerAccount).mockResolvedValue(false as never);
  vi.mocked(prisma.page.findUnique).mockResolvedValue({
    id: "p1",
    title: "Plan",
    archivedAt: null,
    meetingNoteId: null,
    typography: null,
  } as never);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true } as never);
  vi.mocked(readDocAsBlocks).mockResolvedValue([{ type: "paragraph" }] as never);
  vi.mocked(blocksToMarkdown).mockResolvedValue("secret body");
  vi.mocked(renderDocumentPdf).mockResolvedValue(Buffer.from("%PDF"));
});

describe("document export audit", () => {
  it("logs a markdown export with its format and no content", async () => {
    await get("md");

    const event = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      action: "document.export",
      userId: "u1",
      targetId: "p1",
      metadata: { format: "md" },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("secret body");
  });

  it("logs a PDF export as the default format", async () => {
    await get();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.export", metadata: { format: "pdf" } }),
    );
  });

  it("logs nothing when the viewer cannot see the page, is a partner or is unauthenticated", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false } as never);
    await get("md");
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true } as never);
    vi.mocked(isPartnerAccount).mockResolvedValue(true as never);
    await get("md");
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    await get("md");
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
