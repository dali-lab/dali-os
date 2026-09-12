// Tests for get_partner_sow.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerApplication: {
      findUnique: vi.fn(),
    },
    collabDocument: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

// readDocAsBlocks internally calls prisma.collabDocument.findUnique then
// decodes Yjs state. We mock it directly so tests don't need a binary Y.Doc.
vi.mock("~/collab/read", () => ({
  readDocAsBlocks: vi.fn(),
}));

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { readDocAsBlocks } from "~/collab/read";
import { runGetPartnerSow, GET_PARTNER_SOW_TOOL } from "../get-partner-sow";

const mockPrisma = prisma as unknown as {
  partnerApplication: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_partner_sow metadata", () => {
  it("requires mcp:read scope", () => {
    expect(GET_PARTNER_SOW_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runGetPartnerSow("u1", { applicationId: "a1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });
});

describe("get_partner_sow", () => {
  it("returns blocks and isEmpty:false for a doc with content", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({
      id: "a1",
      title: "Test App",
      sowDocId: null,
    });
    const fakeBlocks = [{ id: "b1", type: "paragraph", content: [], children: [], props: {} }];
    vi.mocked(readDocAsBlocks).mockResolvedValue(fakeBlocks);

    const out = await runGetPartnerSow("u1", { applicationId: "a1" }) as Record<string, unknown>;
    expect(out.applicationId).toBe("a1");
    expect(out.documentName).toBe("partnersow:a1:body");
    expect(out.blocks).toEqual(fakeBlocks);
    expect(out.isEmpty).toBe(false);
    expect(out.sowDocId).toBeNull();
  });

  it("returns isEmpty:true for an empty doc", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({
      id: "a2",
      title: "Empty SOW App",
      sowDocId: "old-doc-id",
    });
    vi.mocked(readDocAsBlocks).mockResolvedValue([]);

    const out = await runGetPartnerSow("u1", { applicationId: "a2" }) as Record<string, unknown>;
    expect(out.isEmpty).toBe(true);
    expect(out.blocks).toEqual([]);
    expect(out.sowDocId).toBe("old-doc-id");
  });

  it("throws McpNotFoundError when application is missing", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
    await expect(
      runGetPartnerSow("u1", { applicationId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("passes the correct documentName to readDocAsBlocks", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ id: "a3", title: "X", sowDocId: null });
    vi.mocked(readDocAsBlocks).mockResolvedValue([]);

    await runGetPartnerSow("u1", { applicationId: "a3" });
    expect(readDocAsBlocks).toHaveBeenCalledWith("partnersow:a3:body");
  });
});
