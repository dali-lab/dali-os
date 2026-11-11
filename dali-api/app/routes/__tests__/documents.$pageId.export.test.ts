import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUnique: vi.fn() } } }));
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
vi.mock("~/lib/s3", () => ({
  headObject: vi.fn(),
  getObjectStream: vi.fn(),
  putObjectStream: vi.fn(),
  deleteObject: vi.fn(),
  getDownloadUrl: vi.fn(),
}));
vi.mock("~/lib/pdf/document-pdf.server", () => ({ renderDocumentPdf: vi.fn() }));
vi.mock("~/lib/page-typography", () => ({ normalizePageTypography: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isNonMember, isPartnerAccount, requireAuth } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToMarkdown } from "~/collab/blocknote-server";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import { logAuditEvent } from "~/lib/audit";
import { getDownloadUrl, getObjectStream, headObject, putObjectStream } from "~/lib/s3";
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

describe("markdown export", () => {
  const upload = { id: "b1", type: "image", props: { url: "/api/upload/raw?key=uploads%2Fa%2Fpic.png", name: "pic" }, children: [] };

  it("downloads a document without uploads as a markdown file", async () => {
    const res = await get("md");
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Plan.md"');
    expect(await res.text()).toBe("# Plan\n\nsecret body");
  });

  it("redirects a document with uploads to a zip in storage and logs the export", async () => {
    vi.mocked(readDocAsBlocks).mockResolvedValue([upload] as never);
    vi.mocked(headObject).mockResolvedValue({ sizeBytes: 3, contentType: null });
    vi.mocked(getObjectStream).mockResolvedValue((async function* () { yield new Uint8Array([1, 2, 3]); })());
    vi.mocked(putObjectStream).mockImplementation(async (_key, chunks) => {
      for await (const _chunk of chunks) void _chunk;
    });
    vi.mocked(getDownloadUrl).mockResolvedValue("https://signed.example/Plan.zip");

    const res = await get("md");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://signed.example/Plan.zip");
    expect(vi.mocked(blocksToMarkdown).mock.calls[0]![0]).toMatchObject([{ props: { url: "Plan/pic.png" } }]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { format: "md" } }));
  });

  it("links an upload that is missing from storage by its full address", async () => {
    vi.mocked(readDocAsBlocks).mockResolvedValue([upload] as never);
    vi.mocked(headObject).mockResolvedValue(null);
    await get("md");
    expect(vi.mocked(blocksToMarkdown).mock.calls[0]![0]).toMatchObject([
      { props: { url: "http://localhost/api/upload/raw?key=uploads%2Fa%2Fpic.png" } },
    ]);
  });
});
