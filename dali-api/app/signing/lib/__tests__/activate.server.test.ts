import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    signingDocumentVersion: { findUnique: vi.fn() },
    signingDocument: { findUniqueOrThrow: vi.fn() },
    signingBinding: { upsert: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/signing/lib/scope.server", () => ({ resolveAdminScope: vi.fn() }));
vi.mock("~/signing/lib/presign.server", () => ({ applyAdminSignatures: vi.fn() }));
vi.mock("~/signing/lib/notify.server", () => ({ notifySignRequest: vi.fn() }));

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { applyAdminSignatures } from "~/signing/lib/presign.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { activateVersion } from "~/signing/lib/activate.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => vi.resetAllMocks());

describe("activateVersion", () => {
  it("errors when the version doesn't belong to the document", async () => {
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: new Date(),
      body: [],
      documentId: "other",
    });
    const r = await activateVersion({ documentId: "doc1", versionId: "v1", userId: "u1" });
    expect(r).toEqual({ error: "Version not found." });
    expect(mockPrisma.signingBinding.upsert).not.toHaveBeenCalled();
  });

  it("errors when the version is unpublished", async () => {
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: null,
      body: [],
      documentId: "doc1",
    });
    const r = await activateVersion({ documentId: "doc1", versionId: "v1", userId: "u1" });
    expect(r).toHaveProperty("error");
    expect(mockPrisma.signingBinding.upsert).not.toHaveBeenCalled();
  });

  it("propagates a scope-resolution error", async () => {
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: new Date(),
      body: [],
      documentId: "doc1",
    });
    mockPrisma.signingDocument.findUniqueOrThrow.mockResolvedValue({ cadence: "PerTerm" });
    vi.mocked(resolveAdminScope).mockResolvedValue({ error: "No current term." });
    const r = await activateVersion({ documentId: "doc1", versionId: "v1", userId: "u1" });
    expect(r).toEqual({ error: "No current term." });
    expect(notifySignRequest).not.toHaveBeenCalled();
  });

  it("upserts the binding, records counter-sigs, audits, and notifies", async () => {
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: new Date(),
      body: [{ t: 1 }],
      documentId: "doc1",
    });
    mockPrisma.signingDocument.findUniqueOrThrow.mockResolvedValue({ cadence: "PerTerm" });
    vi.mocked(resolveAdminScope).mockResolvedValue({ scopeKey: "term:t1", termId: "t1" });
    mockPrisma.signingBinding.upsert.mockResolvedValue({ id: "b1" });

    const r = await activateVersion({ documentId: "doc1", versionId: "v1", userId: "u9" });

    expect(r).toEqual({ ok: true, bindingId: "b1" });
    expect(mockPrisma.signingBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId_scopeKey: { documentId: "doc1", scopeKey: "term:t1" } },
        create: expect.objectContaining({ versionId: "v1", termId: "t1" }),
        update: { versionId: "v1" },
      }),
    );
    expect(applyAdminSignatures).toHaveBeenCalledWith({
      bindingId: "b1",
      versionId: "v1",
      body: [{ t: 1 }],
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "signing.bind", userId: "u9", targetId: "doc1" }),
    );
    expect(notifySignRequest).toHaveBeenCalledWith("b1");
  });
});
