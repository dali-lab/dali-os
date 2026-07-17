import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerApplicationFormBinding: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    form: { findUnique: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("~/forms/lib/public-form", () => ({
  loadPublicForm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { loadPublicForm } from "~/forms/lib/public-form";
import {
  getApplicationFormBinding,
  setApplicationFormBinding,
  loadApplicationForm,
  pitchExcerpt,
} from "../application-form.server";
import type { Question } from "~/types";

const mockPrisma = prisma as any;
const mockLoadPublicForm = loadPublicForm as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getApplicationFormBinding", () => {
  it("returns null when nothing is bound", async () => {
    mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue(null);
    expect(await getApplicationFormBinding()).toBeNull();
  });

  it("maps the bound form", async () => {
    mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue({
      form: {
        id: "f1",
        name: "Partner Application",
        published: true,
        publicToken: "tok",
        _count: { versions: 2 },
      },
    });
    expect(await getApplicationFormBinding()).toEqual({
      formId: "f1",
      formName: "Partner Application",
      published: true,
      publicToken: "tok",
      hasVersion: true,
    });
  });
});

describe("setApplicationFormBinding", () => {
  it("rejects a formId that doesn't exist", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const result = await setApplicationFormBinding("nope", "u1");
    expect(result).toHaveProperty("error");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("replaces the singleton row", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "f1" });
    const result = await setApplicationFormBinding("f1", "u1");
    expect(result).toEqual({ ok: true });
    expect(
      mockPrisma.partnerApplicationFormBinding.deleteMany,
    ).toHaveBeenCalledWith({});
    expect(
      mockPrisma.partnerApplicationFormBinding.create,
    ).toHaveBeenCalledWith({ data: { formId: "f1", updatedById: "u1" } });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});

describe("loadApplicationForm", () => {
  it("returns null when nothing is bound", async () => {
    mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue(null);
    expect(await loadApplicationForm("u1")).toBeNull();
    expect(mockLoadPublicForm).not.toHaveBeenCalled();
  });

  it("returns null when the bound form was never published (no token)", async () => {
    mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue({
      form: {
        id: "f1",
        name: "x",
        published: false,
        publicToken: null,
        _count: { versions: 1 },
      },
    });
    expect(await loadApplicationForm("u1")).toBeNull();
    expect(mockLoadPublicForm).not.toHaveBeenCalled();
  });

  it("delegates to loadPublicForm with the token and user", async () => {
    mockPrisma.partnerApplicationFormBinding.findFirst.mockResolvedValue({
      form: {
        id: "f1",
        name: "x",
        published: true,
        publicToken: "tok",
        _count: { versions: 1 },
      },
    });
    const publicForm = { formId: "f1", versionId: "v1", questions: [] };
    mockLoadPublicForm.mockResolvedValue(publicForm);
    expect(await loadApplicationForm("u1")).toBe(publicForm);
    expect(mockLoadPublicForm).toHaveBeenCalledWith("tok", "u1");
  });
});

describe("pitchExcerpt", () => {
  function q(key: string, type: Question["type"]): Question {
    return { key, type, required: false, data: { label: key } } as Question;
  }

  it("returns the first non-empty textarea answer in question order", () => {
    const questions = [q("name", "text"), q("pitch", "textarea"), q("success", "textarea")];
    expect(
      pitchExcerpt(questions, { name: "x", pitch: "  the pitch  ", success: "later" }),
    ).toBe("the pitch");
  });

  it("skips empty/non-string answers and returns null when none qualify", () => {
    const questions = [q("pitch", "textarea"), q("success", "textarea")];
    expect(pitchExcerpt(questions, { pitch: "   ", success: 42 })).toBeNull();
    expect(pitchExcerpt(questions, {})).toBeNull();
  });

  it("truncates long answers with an ellipsis", () => {
    const questions = [q("pitch", "textarea")];
    const out = pitchExcerpt(questions, { pitch: "a".repeat(300) }, 100);
    expect(out).toHaveLength(100);
    expect(out!.endsWith("…")).toBe(true);
  });
});
