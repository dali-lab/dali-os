import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    dALIMember: { findUnique: vi.fn() },
    signingDocumentVersion: { findFirst: vi.fn(), create: vi.fn() },
    signingDocument: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles");
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({ ensureBlocks: (b: unknown) => b }));
vi.mock("~/hiring/components/ConfidentialityAgreementDetail", () => ({ ConfidentialityAgreementDetail: () => null }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore, isDomainLead } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/hiring/routes/confidentiality-agreements.$id";

function submit(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/hiring/confidentiality-agreements/doc-1", { method: "POST", body }),
    params: { id: "doc-1" },
    context: {},
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isDomainLead).mockResolvedValue(false);
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(prisma.dALIMember.findUnique).mockResolvedValue({ id: "m1" } as never);
  vi.mocked(prisma.signingDocumentVersion.findFirst).mockResolvedValue({ versionNumber: 1 } as never);
  vi.mocked(prisma.signingDocumentVersion.create).mockResolvedValue({ id: "ver-2" } as never);
  vi.mocked(prisma.signingDocument.findUnique).mockResolvedValue({ name: "Old name" } as never);
});

describe("confidentiality-agreements.$id action", () => {
  it("logs a new version without its body", async () => {
    await submit({ intent: "create-version", body: JSON.stringify([{ type: "paragraph", content: "secret terms" }]) });

    const event = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      action: "confidentiality.version.create",
      userId: "u1",
      targetId: "ver-2",
      metadata: { documentId: "doc-1", versionNumber: 2 },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("secret terms");
  });

  it("logs a rename with the old and new name", async () => {
    await submit({ intent: "rename", name: "  New name " });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "confidentiality.rename",
        targetId: "doc-1",
        metadata: { before: "Old name", after: "New name" },
      }),
    );
  });

  it("logs nothing for invalid JSON, an empty name or an unauthorised caller", async () => {
    await submit({ intent: "create-version", body: "{not json" });
    await submit({ intent: "rename", name: " " });
    vi.mocked(isCore).mockResolvedValue(false);
    await submit({ intent: "rename", name: "Whatever" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
