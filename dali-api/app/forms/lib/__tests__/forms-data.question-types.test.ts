import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  formVersion: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const saveVersion = (questions: unknown[]) =>
  runFormsAction(
    fd({ intent: "save-version", id: "form-1", questions: JSON.stringify(questions) }),
    "user-1",
  );

const q = (type: string, data: Record<string, unknown> = {}) => ({
  key: "q1",
  type,
  required: false,
  data: { label: "Question", ...data },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
  mockPrisma.formVersion.findFirst.mockResolvedValue({ versionNumber: 1 });
  mockPrisma.$transaction.mockResolvedValue([]);
});

describe("save-version with the new question types", () => {
  it.each([
    q("radio", { options: ["A", "B"] }),
    q("radio", { options: ["A", "B"], allowOther: true }),
    q("scale", { scaleLow: "Low", scaleHigh: "High" }),
    q("scale"),
    q("date"),
    q("number"),
    q("number", { min: 1, max: 10 }),
    q("number", { min: 5, max: 5 }),
    q("email"),
  ])("accepts $type", async (question) => {
    expect(await saveVersion([question])).toEqual({ ok: true });
  });

  it("rejects a radio with fewer than two options", async () => {
    for (const options of [undefined, [], ["Only"]]) {
      const res = await saveVersion([q("radio", { options })]);
      expect(res).toEqual({ error: '"Question" needs at least two options.', status: 400 });
    }
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a number whose min exceeds its max", async () => {
    const res = await saveVersion([q("number", { min: 10, max: 1 })]);
    expect(res).toEqual({ error: '"Question" has a minimum higher than its maximum.', status: 400 });
  });

  it("rejects non-numeric number bounds", async () => {
    const res = await saveVersion([q("number", { min: "1" })]);
    expect(res).toMatchObject({ status: 400 });
  });

  it("still rejects an unknown type", async () => {
    expect(await saveVersion([q("hologram")])).toEqual({
      error: "Add at least one valid question.",
      status: 400,
    });
  });
});

describe("save-version with a prefill", () => {
  it.each([
    q("text", { prefill: "me.name" }),
    q("email", { prefill: "me.email" }),
    q("textarea", { prefill: "partnerOrg.address" }),
    q("reference", { referenceSource: "projects:my-organization", prefill: "partnerOrg.project" }),
  ])("accepts $data.prefill on a $type question", async (question) => {
    expect(await saveVersion([question])).toEqual({ ok: true });
  });

  it.each([
    q("text", { prefill: "me.password" }),
    q("radio", { options: ["A", "B"], prefill: "me.name" }),
    q("email", { prefill: "me.name" }),
    q("reference", { referenceSource: "projects:active", prefill: "partnerOrg.project" }),
  ])("rejects $data.prefill on a $type question", async (question) => {
    expect(await saveVersion([question])).toEqual({
      error: '"Question" can\'t fill in from that record.',
      status: 400,
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
