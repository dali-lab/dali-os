import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFormsAction update-form-settings", () => {
  it("updates both settings from their string values", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });

    const res = await runFormsAction(
      fd({
        intent: "update-form-settings",
        id: "form-1",
        oneResponsePerMember: "true",
        notifyOnSubmission: "false",
      }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { oneResponsePerMember: true, notifyOnSubmission: false },
    });
  });

  it("404s for an unknown form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);

    const res = await runFormsAction(
      fd({
        intent: "update-form-settings",
        id: "ghost",
        oneResponsePerMember: "false",
        notifyOnSubmission: "true",
      }),
      "user-1",
    );

    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("rejects values that aren't 'true'/'false'", async () => {
    const res = await runFormsAction(
      fd({
        intent: "update-form-settings",
        id: "form-1",
        oneResponsePerMember: "yes",
        notifyOnSubmission: "false",
      }),
      "user-1",
    );

    expect(res).toEqual({ error: "Invalid input", status: 400 });
  });
});
