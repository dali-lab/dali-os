import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub the registry so the BY_NAME map side-effect doesn't pull in every tool module.
vi.mock("~/mcp/registry", () => {
  class McpInvalidError extends Error {
    status: number;
    constructor(message = "Invalid params") { super(message); this.name = "McpInvalidError"; this.status = 400; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});
vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  LIST_DOC_TAGS_TOOL,
  MANAGE_DOC_TAGS_TOOL,
  APPLY_DOC_TAG_TOOL,
  runListDocTags,
  runManageDocTags,
  runApplyDocTag,
  DocTagError,
} from "~/mcp/tools/docs/doc-tags";

const mockPrisma = prisma as unknown as {
  docTag: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  page: { findUnique: ReturnType<typeof vi.fn> };
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  pageTag: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  projectFileTag: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};

// Ensure the auto-mock populates all model sub-methods (vi.mock("~/lib/db") may omit some).
beforeEach(() => {
  const mp = mockPrisma as Record<string, Record<string, unknown>>;
  for (const [model, methods] of [
    ["docTag", ["findMany", "findUnique", "create", "update"]],
    ["page", ["findUnique"]],
    ["projectFile", ["findUnique"]],
    ["pageTag", ["upsert", "deleteMany"]],
    ["projectFileTag", ["upsert", "deleteMany"]],
  ] as [string, string[]][]) {
    if (!mp[model]) mp[model] = {};
    for (const m of methods) {
      if (!mp[model][m]) mp[model][m] = vi.fn();
    }
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_doc_tags", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_DOC_TAGS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns active tags for any authenticated caller", async () => {
    mockPrisma.docTag.findMany.mockResolvedValue([
      { id: "t1", label: "Design", slug: "design", color: "#blue" },
    ]);

    const out = await runListDocTags("u1", {} as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "Design" });
  });
});

describe("manage_doc_tags", () => {
  it("requires the mcp:admin scope", () => {
    expect(MANAGE_DOC_TAGS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageDocTags("u1", { action: "create", label: "Test" }),
    ).rejects.toMatchObject({ name: "DocTagError", status: 403 });
  });

  it("creates a new tag for Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.docTag.findUnique.mockResolvedValue(null);
    mockPrisma.docTag.create.mockResolvedValue({ id: "t-new", label: "Design", slug: "design", color: null });

    const out = await runManageDocTags("u1", { action: "create", label: "Design" });
    expect(out).toMatchObject({ id: "t-new", label: "Design" });
  });

  it("revives an archived tag on slug collision", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.docTag.findUnique.mockResolvedValue({ id: "t1", archivedAt: new Date(), color: null });
    mockPrisma.docTag.update.mockResolvedValue({ id: "t1", label: "Design", slug: "design", color: null });

    const out = await runManageDocTags("u1", { action: "create", label: "Design" });
    expect(out).toMatchObject({ id: "t1" });
    expect(mockPrisma.docTag.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ archivedAt: null }) }),
    );
  });
});

describe("apply_doc_tag", () => {
  it("requires the mcp:write scope", () => {
    expect(APPLY_DOC_TAG_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runApplyDocTag("u1", { targetType: "doc", targetId: "p1", tagId: "t1", op: "add" }),
    ).rejects.toMatchObject({ name: "DocTagError", status: 403 });
  });

  it("returns 404 for an unknown tag", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.docTag.findUnique.mockResolvedValue(null);
    await expect(
      runApplyDocTag("u1", { targetType: "doc", targetId: "p1", tagId: "missing", op: "add" }),
    ).rejects.toMatchObject({ name: "DocTagError", status: 404 });
  });

  it("adds a tag to a doc for Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.docTag.findUnique.mockResolvedValue({ id: "t1" });
    mockPrisma.page.findUnique.mockResolvedValue({ workspaceType: "Lab", archivedAt: null });
    mockPrisma.pageTag.upsert.mockResolvedValue({});

    const out = await runApplyDocTag("u1", { targetType: "doc", targetId: "p1", tagId: "t1", op: "add" });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.pageTag.upsert).toHaveBeenCalled();
  });
});
