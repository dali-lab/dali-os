import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: { signingDocument: { update: vi.fn() } },
  requireAuth: vi.fn(),
  isCore: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: h.prisma }));
vi.mock("~/lib/auth", () => ({ requireAuth: h.requireAuth }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: () => new Response(null, { status: 302 }) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCore: h.isCore, currentTerm: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock("~/core/coreNav", () => ({ coreHandle: () => ({}) }));
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({ ensureBlocks: vi.fn() }));
vi.mock("~/signing/lib/activate.server", () => ({ activateVersion: vi.fn() }));
vi.mock("~/signing/lib/audiences", () => ({ AUDIENCE_RESOLVERS: {} }));
vi.mock("~/signing/lib/roster.server", () => ({ computeRoster: vi.fn() }));
vi.mock("~/signing/components/SigningDocumentDetail", () => ({ SigningDocumentDetail: () => null }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/collab/roomName", () => ({ signingDraftName: vi.fn() }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));

import { action } from "~/signing/routes/core.agreements.$id";

function run(fields: Record<string, string>) {
  const body = new URLSearchParams({ intent: "update", ...fields });
  const request = new Request("http://x/documents/agreement/doc-1", { method: "POST", body });
  return action({ request, params: { id: "doc-1" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  h.isCore.mockResolvedValue(true);
  h.prisma.signingDocument.update.mockResolvedValue({});
});

describe("agreement update: partner contract template type", () => {
  it("marks the agreement as a partner contract template", async () => {
    await run({ kind: "PartnerContract" });
    expect(h.prisma.signingDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { kind: "PartnerContract" },
    });
  });

  it("clears the kind when set back to General", async () => {
    await run({ kind: "General" });
    expect(h.prisma.signingDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { kind: null },
    });
  });

  it("ignores unknown kind values", async () => {
    const res = await run({ kind: "Bogus" });
    expect(h.prisma.signingDocument.update).not.toHaveBeenCalled();
    expect(res).toEqual({ error: "No valid changes to save." });
  });

  it("rejects non-Core users without writing", async () => {
    h.isCore.mockResolvedValue(false);
    const res = (await run({ kind: "PartnerContract" })) as Response;
    expect(res.status).toBe(302);
    expect(h.prisma.signingDocument.update).not.toHaveBeenCalled();
  });
});
