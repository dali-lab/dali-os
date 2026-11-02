import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
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
  it("updates all three settings from their string values", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });

    const res = await runFormsAction(
      fd({
        intent: "update-form-settings",
        id: "form-1",
        oneResponsePerMember: "true",
        notifyOnSubmission: "false",
        listed: "true",
      }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: {
        oneResponsePerMember: true,
        notifyOnSubmission: false,
        listed: true,
      },
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
        listed: "false",
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
        listed: "false",
      }),
      "user-1",
    );

    expect(res).toEqual({ error: "Invalid input", status: 400 });
  });

  it("rejects a submit missing the listed field", async () => {
    const res = await runFormsAction(
      fd({
        intent: "update-form-settings",
        id: "form-1",
        oneResponsePerMember: "true",
        notifyOnSubmission: "false",
      }),
      "user-1",
    );

    expect(res).toEqual({ error: "Invalid input", status: 400 });
  });
});

describe("runFormsAction update-form-settings allowResponseEdit", () => {
  const settings = (extra: Record<string, string>) =>
    fd({
      intent: "update-form-settings",
      id: "form-1",
      notifyOnSubmission: "false",
      listed: "false",
      ...extra,
    });

  beforeEach(() => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
  });

  it("saves it alongside one response per member", async () => {
    await runFormsAction(settings({ oneResponsePerMember: "true", allowResponseEdit: "true" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data).toMatchObject({
      oneResponsePerMember: true,
      allowResponseEdit: true,
    });
  });

  it("clears it when one response per member is turned off", async () => {
    await runFormsAction(settings({ oneResponsePerMember: "false", allowResponseEdit: "true" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data.allowResponseEdit).toBe(false);
    await runFormsAction(settings({ oneResponsePerMember: "false" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[1][0].data.allowResponseEdit).toBe(false);
  });

  it("leaves it alone when the request omits it", async () => {
    await runFormsAction(settings({ oneResponsePerMember: "true" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data).not.toHaveProperty("allowResponseEdit");
  });

  it("rejects a value that isn't 'true'/'false'", async () => {
    const res = await runFormsAction(settings({ oneResponsePerMember: "true", allowResponseEdit: "yes" }), "user-1");
    expect(res).toEqual({ error: "Invalid input", status: 400 });
  });
});
