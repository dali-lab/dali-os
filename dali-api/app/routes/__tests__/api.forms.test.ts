import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })) }));
vi.mock("~/forms/lib/forms-data", () => ({ runFormsAction: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({
  canBuildForm: vi.fn(),
  canCreateForm: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { runFormsAction } from "~/forms/lib/forms-data";
import { canBuildForm, canCreateForm } from "~/forms/lib/form-access.server";
import { action } from "~/routes/api.forms";

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({ request: new Request("http://os.test/api/forms", { method: "POST", body }) } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(runFormsAction).mockResolvedValue({ ok: true, formId: "f1" });
});

describe("POST /api/forms", () => {
  it("create-form asks canCreateForm for the destination folder", async () => {
    vi.mocked(canCreateForm).mockResolvedValue(true);
    expect((await post({ intent: "create-form", name: "x", folderPageId: "folder-1" })).status).toBe(200);
    expect(canCreateForm).toHaveBeenCalledWith("u1", "folder-1", expect.any(Request));
  });

  it("create-form with no folder passes null", async () => {
    vi.mocked(canCreateForm).mockResolvedValue(true);
    await post({ intent: "create-form", name: "x", folderPageId: "" });
    expect(canCreateForm).toHaveBeenCalledWith("u1", null, expect.any(Request));
  });

  it("refuses create-form when the folder is not editable", async () => {
    vi.mocked(canCreateForm).mockResolvedValue(false);
    expect((await post({ intent: "create-form", name: "x", folderPageId: "folder-1" })).status).toBe(403);
    expect(runFormsAction).not.toHaveBeenCalled();
  });

  it.each(["rename-form", "delete-form", "move-form", "duplicate-form", "save-draft", "publish-form", "update-form-audience"])(
    "%s requires canBuildForm on the form id",
    async (intent) => {
      vi.mocked(canBuildForm).mockResolvedValue(false);
      expect((await post({ intent, id: "f1" })).status).toBe(403);
      expect(canBuildForm).toHaveBeenCalledWith("u1", "f1", expect.any(Request));
      expect(runFormsAction).not.toHaveBeenCalled();
      vi.mocked(canBuildForm).mockResolvedValue(true);
      await post({ intent, id: "f1", name: "x" });
      expect(runFormsAction).toHaveBeenCalled();
    },
  );

  it("refuses an intent that carries no id", async () => {
    expect((await post({ intent: "rename-form" })).status).toBe(403);
    expect(canBuildForm).not.toHaveBeenCalled();
  });

  it("passes the action result through", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(runFormsAction).mockResolvedValue({ error: "Not found", status: 404 });
    const res = await post({ intent: "rename-form", id: "f1", name: "x" });
    expect(res.status).toBe(404);
  });
});
