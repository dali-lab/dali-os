// Tests for forms MCP tools.
// Pattern: scope tag + forbidden path + happy path per tool.
// Heavy mocks — no DB connection required.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the registry module to prevent it from importing all tool areas.
vi.mock("~/mcp/registry", async () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
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
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError, requireForAction };
});

vi.mock("~/lib/db");
vi.mock("~/forms/lib/form-access.server", () => ({
  canSeeForm: vi.fn(),
  canBuildForm: vi.fn(),
  canCreateForm: vi.fn(),
}));
vi.mock("~/forms/lib/forms-data", () => ({
  loadFormForEdit: vi.fn(),
  runFormsAction: vi.fn(),
}));
vi.mock("~/forms/lib/public-form", () => ({
  formAccessMeta: vi.fn(),
  formFillAccess: vi.fn(),
  submitMemberForm: vi.fn(),
}));
vi.mock("~/forms/lib/answer-rows.server", () => ({
  buildResponseGrid: vi.fn(),
}));

import { canSeeForm, canBuildForm, canCreateForm } from "~/forms/lib/form-access.server";
import { runFormsAction } from "~/forms/lib/forms-data";
import { formAccessMeta, formFillAccess, submitMemberForm } from "~/forms/lib/public-form";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import { prisma } from "~/lib/db";

import { LIST_FORMS_TOOL, runListForms } from "../list-forms";
import { GET_FORM_RESPONSES_TOOL, runGetFormResponses } from "../get-form-responses";
import { SUBMIT_FORM_TOOL, runSubmitForm } from "../submit-form";
import { MANAGE_FORM_TOOL, runManageForm } from "../manage-form";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  formSubmission: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

function ctx(id = "u1") {
  return {
    user: {
      id,
      daliEmail: "test@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: "d12345",
      firstName: "Test",
      lastName: "User",
    },
    scopes: ["mcp:read", "mcp:write", "mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Scopes ──────────────────────────────────────────────────────────────────

describe("scopes", () => {
  it("list_forms requires mcp:read", () => {
    expect(LIST_FORMS_TOOL.requiredScope).toBe("mcp:read");
  });
  it("get_form_responses requires mcp:read", () => {
    expect(GET_FORM_RESPONSES_TOOL.requiredScope).toBe("mcp:read");
  });
  it("submit_form requires mcp:write", () => {
    expect(SUBMIT_FORM_TOOL.requiredScope).toBe("mcp:write");
  });
  it("manage_form requires mcp:admin", () => {
    expect(MANAGE_FORM_TOOL.requiredScope).toBe("mcp:admin");
  });
});

// ─── list_forms ──────────────────────────────────────────────────────────────

describe("list_forms", () => {
  const rows = [
    { id: "fm1", name: "Application", folderPageId: "page-1", published: true, publicToken: "tok123", _count: { versions: 1 } },
    { id: "fm2", name: "Feedback", folderPageId: null, published: false, publicToken: null, _count: { versions: 2 } },
  ];

  it("returns every form the caller can see with its Drive folder placement", async () => {
    vi.mocked(canSeeForm).mockResolvedValue(true);
    mockPrisma.form.findMany.mockResolvedValue(rows);
    const result = await runListForms(ctx());
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0]).toMatchObject({ id: "fm1", folderPageId: "page-1", versionCount: 1, published: true });
    expect(result.forms[1]).toMatchObject({ id: "fm2", folderPageId: null, versionCount: 2 });
  });

  it("applies the access filter before paging", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...rows[0], id: `f${i}`, name: `F${i}` }));
    vi.mocked(canSeeForm).mockImplementation(async (_u, id) => id !== "f0" && id !== "f1");
    mockPrisma.form.findMany.mockResolvedValue(many);
    const first = await runListForms(ctx(), { limit: 2 });
    expect(first.forms.map((f) => f.id)).toEqual(["f2", "f3"]);
    expect(first.page).toMatchObject({ hasMore: true, total: 3 });
    const second = await runListForms(ctx(), { limit: 2, cursor: first.page.nextCursor! });
    expect(second.forms.map((f) => f.id)).toEqual(["f4"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

// ─── get_form_responses ───────────────────────────────────────────────────────

describe("get_form_responses", () => {
  it("throws not-found when form does not exist", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue(null);
    await expect(
      runGetFormResponses(ctx(), { formId: "missing" })
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns paginated responses with grid", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue({ id: "fm1", name: "Application" });
    mockPrisma.formSubmission.count.mockResolvedValue(1);
    mockPrisma.formSubmission.findMany.mockResolvedValue([
      {
        id: "sub1",
        createdAt: new Date("2026-08-01"),
        answers: { q1: "answer" },
        user: { firstName: "Alice", lastName: "Smith", daliEmail: "alice@dali.edu", personalEmail: null },
        formVersion: { versionNumber: 1, questions: [] },
        slot: null,
        submitterName: null,
        submitterEmail: null,
      },
    ]);
    vi.mocked(buildResponseGrid).mockResolvedValue({
      columns: [{ key: "q1", label: "Question 1" }],
      rowsBySubmission: [[{ key: "q1", label: "Question 1", value: "answer" }]],
    });
    const result = await runGetFormResponses(ctx(), { formId: "fm1" });
    expect(result.formId).toBe("fm1");
    expect(result.page).toMatchObject({ total: 1, hasMore: false, nextCursor: null });
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].name).toBe("Alice Smith");
    expect(result.responses[0].createdAt).toBe("2026-08-01T00:00:00.000Z");
    expect(result.columns).toHaveLength(1);
  });

  it("caps limit at 200", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue({ id: "fm1", name: "App" });
    mockPrisma.formSubmission.count.mockResolvedValue(0);
    mockPrisma.formSubmission.findMany.mockResolvedValue([]);
    vi.mocked(buildResponseGrid).mockResolvedValue({ columns: [], rowsBySubmission: [] });
    await runGetFormResponses(ctx(), { formId: "fm1", limit: 999 });
    expect(mockPrisma.formSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 201 })
    );
  });

  it("orders newest first with an id tiebreak and walks pages with the cursor", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue({ id: "fm1", name: "App" });
    mockPrisma.formSubmission.count.mockResolvedValue(3);
    vi.mocked(buildResponseGrid).mockResolvedValue({ columns: [], rowsBySubmission: [] });
    const sub = (id: string) => ({
      id,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      answers: {},
      user: null,
      formVersion: { versionNumber: 1, questions: [] },
      slot: null,
      submitterName: "Ada",
      submitterEmail: "ada@example.edu",
    });
    mockPrisma.formSubmission.findMany.mockResolvedValueOnce([sub("s3"), sub("s2"), sub("s1")]);
    const first = await runGetFormResponses(ctx(), { formId: "fm1", limit: 2 });
    expect(mockPrisma.formSubmission.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(first.responses.map((r) => r.id)).toEqual(["s3", "s2"]);
    expect(first.page).toMatchObject({ hasMore: true, total: 3 });

    mockPrisma.formSubmission.findMany.mockResolvedValueOnce([sub("s1")]);
    const second = await runGetFormResponses(ctx(), { formId: "fm1", limit: 2, cursor: first.page.nextCursor! });
    expect(JSON.stringify(mockPrisma.formSubmission.findMany.mock.calls[1][0].where.AND[1])).toContain("s2");
    expect(second.responses.map((r) => r.id)).toEqual(["s1"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

// ─── submit_form ──────────────────────────────────────────────────────────────

describe("submit_form", () => {
  it("throws not-found when token is unknown", async () => {
    vi.mocked(formAccessMeta).mockResolvedValue(null);
    await expect(
      runSubmitForm(ctx(), { token: "bad-tok", versionId: "v1", answers: {} })
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws forbidden when access is denied", async () => {
    vi.mocked(formAccessMeta).mockResolvedValue({
      id: "fm1",
      name: "App",
    });
    vi.mocked(formFillAccess).mockResolvedValue("denied");
    await expect(
      runSubmitForm(ctx(), { token: "tok1", versionId: "v1", answers: {} })
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws forbidden when access requires login", async () => {
    vi.mocked(formAccessMeta).mockResolvedValue({
      id: "fm1",
      name: "App",
    });
    vi.mocked(formFillAccess).mockResolvedValue("login");
    await expect(
      runSubmitForm(ctx(), { token: "tok1", versionId: "v1", answers: {} })
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("calls submitMemberForm and returns ok on success", async () => {
    vi.mocked(formAccessMeta).mockResolvedValue({
      id: "fm1",
      name: "App",
    });
    vi.mocked(formFillAccess).mockResolvedValue("ok");
    vi.mocked(submitMemberForm).mockResolvedValue({ ok: true });
    const result = await runSubmitForm(ctx(), {
      token: "tok1",
      versionId: "v1",
      answers: { q1: "hello" },
    });
    expect(submitMemberForm).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "tok1",
        versionId: "v1",
        userId: "u1",
        answers: { q1: "hello" },
      })
    );
    expect(result).toEqual({ ok: true });
  });

  it("throws invalid when submitMemberForm returns an error", async () => {
    vi.mocked(formAccessMeta).mockResolvedValue({
      id: "fm1",
      name: "App",
    });
    vi.mocked(formFillAccess).mockResolvedValue("ok");
    vi.mocked(submitMemberForm).mockResolvedValue({
      error: "Question is required.",
      status: 400,
    });
    await expect(
      runSubmitForm(ctx(), { token: "tok1", versionId: "v1", answers: {} })
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── manage_form ──────────────────────────────────────────────────────────────

describe("manage_form", () => {
  it("throws invalid for unknown action", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(canCreateForm).mockResolvedValue(true);
    await expect(
      runManageForm(ctx(), { action: "bogus" })
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws invalid when required args are missing", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(canCreateForm).mockResolvedValue(true);
    await expect(
      runManageForm(ctx(), { action: "rename", formId: "fm1" }) // name missing
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("calls runFormsAction for create and returns ok", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(canCreateForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true });
    const result = await runManageForm(ctx(), { action: "create", name: "New Form" });
    expect(runFormsAction).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("returns formId on duplicate", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(canCreateForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ ok: true, formId: "fm-copy" });
    const result = await runManageForm(ctx(), { action: "duplicate", formId: "fm1" });
    expect(result).toEqual({ ok: true, formId: "fm-copy" });
  });

  it("throws not-found when runFormsAction returns 404", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(canCreateForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ error: "Not found", status: 404 });
    await expect(
      runManageForm(ctx(), { action: "delete", formId: "gone" })
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});
