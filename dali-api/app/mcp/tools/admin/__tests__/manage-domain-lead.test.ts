import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  isAdmin: vi.fn(),
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isAdmin, currentTerm } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  runManageDomainLead,
  MANAGE_DOMAIN_LEAD_TOOL,
} from "~/mcp/tools/admin/manage-domain-lead";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

function makeCtx(userId = "admin-u1"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Admin",
      lastName: "User",
    },
    scopes: ["mcp:admin"],
    request: new Request("https://example.com"),
  };
}

const FAKE_TERM = { id: "term-26s", name: "26S" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_domain_lead", () => {
  it("requires the mcp:admin scope", () => {
    expect(MANAGE_DOMAIN_LEAD_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws Forbidden when caller is not an admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(
      runManageDomainLead(makeCtx(), { action: "add", domainId: "d1", userId: "u2" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
  });

  describe("add", () => {
    it("creates an assignment for the current term and logs an audit event", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      vi.mocked(currentTerm).mockResolvedValue(FAKE_TERM as never);

      const assignment = {
        id: "dla-1",
        userId: "u2",
        domainId: "d1",
        termId: FAKE_TERM.id,
        user: { id: "u2" },
        domain: { id: "d1" },
        term: FAKE_TERM,
      };
      mockPrisma.domainLeadAssignment.create.mockResolvedValue(assignment);

      const out = await runManageDomainLead(makeCtx(), {
        action: "add",
        domainId: "d1",
        userId: "u2",
      });

      expect(mockPrisma.domainLeadAssignment.create).toHaveBeenCalledWith({
        data: { userId: "u2", domainId: "d1", termId: FAKE_TERM.id },
        include: { user: true, domain: true, term: true },
      });
      expect(out).toMatchObject({ id: "dla-1", termId: FAKE_TERM.id });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "domain.lead.add",
          targetId: "u2",
          metadata: expect.objectContaining({ domainId: "d1", termId: FAKE_TERM.id }),
        }),
      );
    });

    it("throws InvalidError when there is no current term", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      vi.mocked(currentTerm).mockResolvedValue(null as never);

      await expect(
        runManageDomainLead(makeCtx(), { action: "add", domainId: "d1", userId: "u2" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });
  });

  describe("remove", () => {
    it("deletes an assignment and logs an audit event", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);

      const removed = { id: "dla-1", userId: "u2", domainId: "d1", termId: FAKE_TERM.id };
      mockPrisma.domainLeadAssignment.delete.mockResolvedValue(removed);

      const out = await runManageDomainLead(makeCtx(), {
        action: "remove",
        assignmentId: "dla-1",
      });

      expect(mockPrisma.domainLeadAssignment.delete).toHaveBeenCalledWith({
        where: { id: "dla-1" },
      });
      expect(out).toEqual({ ok: true });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "domain.lead.remove",
          targetId: "u2",
          metadata: expect.objectContaining({ domainId: "d1", assignmentId: "dla-1" }),
        }),
      );
    });
  });
});
