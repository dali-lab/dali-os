import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { signingSignature: { findUnique: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/pdf/document-pdf.server", () => ({ renderDocumentPdf: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import { logAuditEvent } from "~/lib/audit";
import { loader } from "~/signing/routes/core.agreements.$id.signature.$sigId.pdf";

const SIG = {
  id: "sig-1",
  signerUserId: "member-1",
  typedName: "AL",
  frozenBody: [],
  signer: { firstName: "Ada", lastName: "Lovelace" },
  binding: { documentId: "doc-1" },
  version: { body: [], document: { name: "Lab Agreement" } },
};

function get(docId = "doc-1") {
  return loader({
    request: new Request("http://localhost/core/agreements/doc-1/signature/sig-1/pdf"),
    params: { id: docId, sigId: "sig-1" },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(prisma.signingSignature.findUnique).mockResolvedValue(SIG as never);
  vi.mocked(renderDocumentPdf).mockResolvedValue(Buffer.from("%PDF"));
});

describe("signed copy PDF download audit", () => {
  it("logs the download against the signature, with the signer", async () => {
    const res = await get();

    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "signing.signature.download",
        userId: "core-1",
        targetId: "sig-1",
        metadata: { documentId: "doc-1", signerUserId: "member-1" },
      }),
    );
  });

  it("logs nothing for a non-Core caller, a mismatched document or a render failure", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await get();
    vi.mocked(isCore).mockResolvedValue(true);
    await get("other-doc");
    vi.mocked(renderDocumentPdf).mockRejectedValue(new Error("chromium down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get()).status).toBe(500);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
