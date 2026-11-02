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

describe("runFormsAction update-form-settings remindBeforeClose", () => {
  const settings = (extra: Record<string, string>) =>
    fd({
      intent: "update-form-settings",
      id: "form-1",
      oneResponsePerMember: "false",
      notifyOnSubmission: "false",
      listed: "false",
      ...extra,
    });

  it("saves it when the form has a close time", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", closesAt: new Date("2026-11-08T05:00:00Z") });
    await runFormsAction(settings({ remindBeforeClose: "true" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data.remindBeforeClose).toBe(true);
  });

  it("refuses to turn it on without a close time", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", closesAt: null });
    const res = await runFormsAction(settings({ remindBeforeClose: "true" }), "user-1");
    expect(res).toEqual({ error: "Set a close time to use this.", status: 400 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("turns it off without a close time", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", closesAt: null });
    await runFormsAction(settings({ remindBeforeClose: "false" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data.remindBeforeClose).toBe(false);
  });

  it("leaves it alone when the request omits it", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", closesAt: null });
    await runFormsAction(settings({}), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data).not.toHaveProperty("remindBeforeClose");
  });

  it("turns it off when the close time is cleared", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    await runFormsAction(fd({ intent: "update-form-window", id: "form-1", opensAt: "", closesAt: "" }), "user-1");
    expect(mockPrisma.form.update.mock.calls[0][0].data).toMatchObject({ closesAt: null, remindBeforeClose: false });
  });

  it("keeps it when the close time is only moved", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    await runFormsAction(
      fd({ intent: "update-form-window", id: "form-1", opensAt: "", closesAt: "2026-11-09T05:00:00.000Z" }),
      "user-1",
    );
    expect(mockPrisma.form.update.mock.calls[0][0].data).not.toHaveProperty("remindBeforeClose");
  });
});
