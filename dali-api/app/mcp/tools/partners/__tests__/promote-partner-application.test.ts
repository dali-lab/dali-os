import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/github-slug", () => ({
  githubTeamSlug: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
}));
// Stub the registry so the BY_NAME map side-effect doesn't pull in every
// tool module. We only need the error classes here.
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
import {
  runPromotePartnerApplication,
  PROMOTE_PARTNER_APPLICATION_TOOL,
} from "../promote-partner-application";

const mockPrisma = prisma as unknown as {
  partnerApplication: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promote_partner_application", () => {
  it("requires mcp:admin scope", () => {
    expect(PROMOTE_PARTNER_APPLICATION_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runPromotePartnerApplication("u1", { applicationId: "app-1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws McpNotFoundError when application does not exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication = { findUnique: vi.fn().mockResolvedValue(null) };
    await expect(
      runPromotePartnerApplication("u1", { applicationId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns alreadyExisted=true when resultingProjectId is set", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication = {
      findUnique: vi.fn().mockResolvedValue({
        id: "app-1",
        title: "Cool Project",
        summary: null,
        resultingProjectId: "proj-existing",
        partnerOrgId: "org-1",
        targetTerms: [],
        domains: [],
      }),
    };
    const out = await runPromotePartnerApplication("u1", { applicationId: "app-1" });
    expect(out).toMatchObject({ projectId: "proj-existing", alreadyExisted: true });
  });

  it("promotes application and returns new projectId", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication = {
      findUnique: vi.fn().mockResolvedValue({
        id: "app-1",
        title: "AI Health Tool",
        summary: "A useful tool",
        resultingProjectId: null,
        partnerOrgId: "org-1",
        targetTerms: [{ termId: "term-26s" }],
        domains: [
          { domainId: "domain-ml", expectedMembers: 2 },
          { domainId: "domain-web", expectedMembers: 0 },
        ],
      }),
    };
    mockPrisma.$transaction = vi.fn().mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        project: { create: vi.fn().mockResolvedValue({ id: "proj-new", name: "AI Health Tool" }) },
        partnerApplication: { update: vi.fn() },
      } as unknown as typeof prisma);
    });

    const out = await runPromotePartnerApplication("u1", { applicationId: "app-1" });
    expect(out).toMatchObject({ projectId: "proj-new", name: "AI Health Tool", alreadyExisted: false });
  });

  it("promotes without terms or domains when none provided", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication = {
      findUnique: vi.fn().mockResolvedValue({
        id: "app-2",
        title: "Empty App",
        summary: null,
        resultingProjectId: null,
        partnerOrgId: "org-2",
        targetTerms: [],
        domains: [],
      }),
    };
    const createFn = vi.fn().mockResolvedValue({ id: "proj-bare", name: "Empty App" });
    mockPrisma.$transaction = vi.fn().mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        project: { create: createFn },
        partnerApplication: { update: vi.fn() },
      } as unknown as typeof prisma);
    });

    const out = await runPromotePartnerApplication("u1", { applicationId: "app-2" });
    expect(out).toMatchObject({ projectId: "proj-bare", alreadyExisted: false });
    // No terms, role requests, or domains created — just the partner link.
    const createCall = createFn.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data).not.toHaveProperty("projectTerms");
    expect(createCall.data).not.toHaveProperty("roleRequests");
    expect(createCall.data).not.toHaveProperty("domains");
  });
});
