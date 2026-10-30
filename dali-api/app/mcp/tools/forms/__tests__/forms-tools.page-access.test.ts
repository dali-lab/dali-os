// The forms MCP tools follow the form's Drive page, not isCore.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", async () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError, requireForAction };
});

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/forms/lib/forms-data", () => ({ runFormsAction: vi.fn() }));
vi.mock("~/forms/lib/answer-rows.server", () => ({ buildResponseGrid: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({
  canSeeForm: vi.fn(),
  canBuildForm: vi.fn(),
  canCreateForm: vi.fn(),
}));

import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { runFormsAction } from "~/forms/lib/forms-data";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import { canBuildForm, canCreateForm, canSeeForm } from "~/forms/lib/form-access.server";
import { runListForms } from "../list-forms";
import { runGetFormResponses } from "../get-form-responses";
import { runManageForm } from "../manage-form";

const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { user: { id: "u1" }, scopes: [], request: new Request("http://localhost/") } as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
});

describe("list_forms", () => {
  it("lists only the forms the caller can see, with no Core check", async () => {
    m.form.findMany.mockResolvedValue([
      { id: "a", name: "A", folderPageId: null, published: true, publicToken: "t", _count: { versions: 1 } },
      { id: "b", name: "B", folderPageId: null, published: false, publicToken: null, _count: { versions: 0 } },
    ]);
    vi.mocked(canSeeForm).mockImplementation(async (_u, id) => id === "a");
    const out = await runListForms(ctx);
    expect(out.forms.map((f) => f.id)).toEqual(["a"]);
    expect(isCore).not.toHaveBeenCalled();
  });
});

describe("get_form_responses", () => {
  it("requires canBuildForm for the form id", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    await expect(runGetFormResponses(ctx, { formId: "f1" })).rejects.toMatchObject({ name: "McpForbiddenError" });
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1");
  });

  it("returns the grid to an editor who is not Core", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    m.form.findUnique.mockResolvedValue({ id: "f1", name: "Intake" });
    m.formSubmission.count.mockResolvedValue(0);
    m.formSubmission.findMany.mockResolvedValue([]);
    vi.mocked(buildResponseGrid).mockResolvedValue({ columns: [], rowsBySubmission: [] } as never);
    const out = await runGetFormResponses(ctx, { formId: "f1" });
    expect(out).toMatchObject({ formId: "f1", formName: "Intake", totalCount: 0 });
  });
});

describe("manage_form", () => {
  it("requires canBuildForm for every action that targets a form", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    await expect(runManageForm(ctx, { action: "rename", formId: "f1", name: "x" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
    expect(runFormsAction).not.toHaveBeenCalled();
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    expect(await runManageForm(ctx, { action: "rename", formId: "f1", name: "x" })).toEqual({ ok: true });
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1");
  });

  it("create goes by the destination folder, like api.forms", async () => {
    vi.mocked(canCreateForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    await runManageForm(ctx, { action: "create", name: "x", folderPageId: "folder-1" });
    expect(canCreateForm).toHaveBeenCalledWith("u1", "folder-1");
    await runManageForm(ctx, { action: "create", name: "x", folderPageId: "" });
    expect(canCreateForm).toHaveBeenLastCalledWith("u1", null);
    vi.mocked(canCreateForm).mockResolvedValue(false);
    await expect(runManageForm(ctx, { action: "create", name: "x" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("still validates required args before the access check", async () => {
    await expect(runManageForm(ctx, { action: "rename" })).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(canBuildForm).not.toHaveBeenCalled();
  });
});
