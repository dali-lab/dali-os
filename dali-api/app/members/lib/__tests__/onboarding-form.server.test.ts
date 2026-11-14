import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  clearOnboardingFormBinding,
  getOnboardingFormBinding,
  isOnboardingProfileForm,
  setOnboardingFormBinding,
} from "~/members/lib/onboarding-form.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
  db.onboardingProfileFormBinding.findFirst.mockResolvedValue(null);
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("getOnboardingFormBinding", () => {
  it("is null with nothing bound", async () => {
    expect(await getOnboardingFormBinding()).toBeNull();
  });

  it("returns the bound form", async () => {
    db.onboardingProfileFormBinding.findFirst.mockResolvedValue({
      form: { id: "f1", name: "Welcome", published: true, publicToken: "tok", _count: { versions: 2 } },
    });
    expect(await getOnboardingFormBinding()).toEqual({
      formId: "f1",
      formName: "Welcome",
      published: true,
      publicToken: "tok",
      hasVersion: true,
    });
  });
});

describe("isOnboardingProfileForm", () => {
  it("is true only for the bound form", async () => {
    db.onboardingProfileFormBinding.findFirst.mockResolvedValueOnce({ id: "b1" });
    expect(await isOnboardingProfileForm("f1")).toBe(true);
    expect(db.onboardingProfileFormBinding.findFirst).toHaveBeenCalledWith({
      where: { formId: "f1" },
      select: { id: true },
    });
    expect(await isOnboardingProfileForm("f2")).toBe(false);
  });
});

describe("setOnboardingFormBinding", () => {
  it("replaces the one binding", async () => {
    db.form.findUnique.mockResolvedValue({ id: "f1" });
    expect(await setOnboardingFormBinding("f1", "u1")).toEqual({ ok: true });
    expect(db.onboardingProfileFormBinding.deleteMany).toHaveBeenCalledWith({});
    expect(db.onboardingProfileFormBinding.create).toHaveBeenCalledWith({
      data: { formId: "f1", updatedById: "u1" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("refuses a form that doesn't exist", async () => {
    db.form.findUnique.mockResolvedValue(null);
    expect(await setOnboardingFormBinding("gone", "u1")).toEqual({
      ok: false,
      error: "That form no longer exists.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("clearOnboardingFormBinding", () => {
  it("removes the binding", async () => {
    await clearOnboardingFormBinding();
    expect(db.onboardingProfileFormBinding.deleteMany).toHaveBeenCalledWith({});
  });
});
