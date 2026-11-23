import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { projectTemplate: { findMany: vi.fn(), delete: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/project-templates.server", () => ({
  captureProjectTemplate: vi.fn(),
  instantiateProjectTemplate: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import type { McpCtx } from "~/mcp/registry";
import { LIST_PROJECT_TEMPLATES_TOOL } from "../list-project-templates";
import { MANAGE_PROJECT_TEMPLATE_TOOL } from "../manage-project-template";

const ctx = { user: { id: "u1" } } as unknown as McpCtx;
const findMany = prisma.projectTemplate.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("list_project_templates", () => {
  it("is a read tool that returns the templates", async () => {
    findMany.mockResolvedValue([{ id: "t1", name: "Default" }]);
    expect(LIST_PROJECT_TEMPLATES_TOOL.def.requiredScope).toBe("mcp:read");
    expect(await LIST_PROJECT_TEMPLATES_TOOL.run(ctx, {})).toEqual({ templates: [{ id: "t1", name: "Default" }] });
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(LIST_PROJECT_TEMPLATES_TOOL.run(ctx, {})).rejects.toMatchObject({ status: 403 });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("manage_project_template", () => {
  it("no longer lists", async () => {
    const actions = (MANAGE_PROJECT_TEMPLATE_TOOL.def.inputSchema.properties!.action as { enum: string[] }).enum;
    expect(actions).toEqual(["capture", "instantiate", "delete"]);
    await expect(MANAGE_PROJECT_TEMPLATE_TOOL.run(ctx, { action: "list" })).rejects.toMatchObject({ status: 400 });
  });
});
