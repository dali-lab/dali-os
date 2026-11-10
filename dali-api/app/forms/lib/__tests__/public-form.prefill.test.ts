import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn(),
  sendFormReceipt: vi.fn(),
}));
vi.mock("~/forms/lib/prefill.server", () => ({ resolvePrefill: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { loadPublicForm } from "~/forms/lib/public-form";
import { resolvePrefill } from "~/forms/lib/prefill.server";

const m = prisma as any;
const QUESTIONS = [{ key: "org", type: "text", required: true, data: { label: "Org", prefill: "partnerOrg.name" } }];

beforeEach(() => {
  vi.resetAllMocks();
  m.form.findUnique.mockResolvedValue({
    id: "form-1",
    name: "Plan",
    published: true,
    page: null,
    versions: [{ id: "ver-1", questions: QUESTIONS, intro: null, updatedAt: new Date("2026-11-01") }],
    cycleBindings: [],
  });
  vi.mocked(resolvePrefill).mockResolvedValue({ org: "Analytical Co" });
});

describe("loadPublicForm prefill", () => {
  it("serves the filler's prefill alongside the questions", async () => {
    const form = await loadPublicForm("tok", "u1");
    expect(form?.prefill).toEqual({ org: "Analytical Co" });
    expect(resolvePrefill).toHaveBeenCalledWith([expect.objectContaining({ key: "org" })], "u1");
  });

  it("resolves with no filler on an anonymous load", async () => {
    await loadPublicForm("tok");
    expect(resolvePrefill).toHaveBeenCalledWith(expect.any(Array), null);
  });
});
