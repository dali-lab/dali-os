import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn(() => new Response(null, { status: 403 })) }));
vi.mock("~/forms/lib/form-access.server", () => ({ canBuildForm: vi.fn() }));
vi.mock("~/forms/lib/forms-data", () => ({ isQuestionArray: (x: unknown) => Array.isArray(x) }));
vi.mock("~/forms/lib/reference-sources", () => ({ resolveReferenceOptions: vi.fn() }));
vi.mock("~/lib/question-blocks.server", () => ({ normalizeQuestionBodies: (q: unknown) => q }));
vi.mock("~/forms/lib/prefill.server", () => ({ resolvePrefill: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { resolvePrefill } from "~/forms/lib/prefill.server";
import { action } from "~/forms/routes/forms.preview-resolve";

const questions = [{ key: "n", type: "text", required: false, data: { label: "Name", prefill: "me.name" } }];
const run = () => {
  const body = new FormData();
  body.set("formId", "f1");
  body.set("questions", JSON.stringify(questions));
  return action({ request: new Request("http://x/forms/preview-resolve", { method: "POST", body }) } as never) as Promise<any>;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "editor" } } as never);
  vi.mocked(canBuildForm).mockResolvedValue(true);
  vi.mocked(resolvePrefill).mockResolvedValue({ n: "Ada Lovelace" });
});

describe("forms preview-resolve", () => {
  it("returns the editor's own prefill so the preview shows it", async () => {
    expect(await run()).toEqual({ ok: true, questions, prefill: { n: "Ada Lovelace" } });
    expect(resolvePrefill).toHaveBeenCalledWith(questions, "editor");
  });

  it("refuses someone who can't build the form, before resolving anything", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    const res = await run();
    expect(res.status).toBe(403);
    expect(resolvePrefill).not.toHaveBeenCalled();
  });
});
