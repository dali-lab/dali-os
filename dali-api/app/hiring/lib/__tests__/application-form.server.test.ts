import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import {
  createCycleApplicationForm,
  loadHiringForm,
} from "~/hiring/lib/application-form.server";

vi.mock("~/lib/db", () => ({
  prisma: {
    form: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    formFolder: { findFirst: vi.fn(), create: vi.fn() },
    formVersion: { create: vi.fn(), findUnique: vi.fn() },
    applicationCycle: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/forms/lib/reference-sources", () => ({
  resolveReferenceOptions: vi.fn().mockResolvedValue([{ value: "p1", label: "Project 1" }]),
}));
vi.mock("~/forms/lib/forms-data", () => ({
  safeParseJsonString: (v: unknown) => v,
}));

const mockPrisma = prisma as unknown as {
  form: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  formFolder: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  applicationCycle: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("loadHiringForm", () => {
  it("returns the latest version's questions with reference options resolved", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      id: "form-1",
      name: "Core application",
      versions: [
        {
          id: "fv-2",
          intro: null,
          questions: [
            { key: "q1", type: "textarea", required: true, data: { label: "Why?" } },
            { key: "q2", type: "reference", required: false, data: { label: "Project", referenceSource: "projects" } },
          ],
        },
      ],
    });

    const form = await loadHiringForm("form-1", "user-1");
    expect(form).not.toBeNull();
    expect(form!.versionId).toBe("fv-2");
    expect(form!.questions[1].data.referenceOptions).toEqual([{ value: "p1", label: "Project 1" }]);
    expect(resolveReferenceOptions).toHaveBeenCalledOnce();
  });

  it("returns null when the form has no versions", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", name: "x", versions: [] });
    await expect(loadHiringForm("form-1")).resolves.toBeNull();
  });
});

describe("createCycleApplicationForm", () => {
  it("is a no-op when the cycle is already bound", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: "c1",
      name: "Fall",
      cycleType: "Core",
      applicationFormId: "existing-form",
    });
    await expect(createCycleApplicationForm("c1", "actor")).resolves.toBe("existing-form");
    expect(mockPrisma.form.create).not.toHaveBeenCalled();
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("clones the template into a new Form and binds it", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: "c1",
      name: "Fall",
      cycleType: "Core",
      applicationFormId: null,
    });
    // ensureHiringTemplate: template already exists with a version.
    mockPrisma.formFolder.findFirst.mockResolvedValue({ id: "folder-tmpl" });
    mockPrisma.form.findFirst.mockResolvedValue({ id: "tmpl", versions: [{ id: "tv" }] });
    mockPrisma.form.findUnique.mockResolvedValue({
      versions: [{ questions: [{ key: "q1", type: "text", required: false, data: { label: "Q" } }], intro: null }],
    });
    mockPrisma.form.create.mockResolvedValue({ id: "new-form" });

    const id = await createCycleApplicationForm("c1", "actor");
    expect(id).toBe("new-form");
    // Cloned into a Form with a v1 version…
    const created = mockPrisma.form.create.mock.calls[0][0].data;
    expect(created.name).toContain("Core");
    expect(created.versions.create.versionNumber).toBe(1);
    // …and bound to the cycle.
    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { applicationFormId: "new-form" },
    });
  });
});
