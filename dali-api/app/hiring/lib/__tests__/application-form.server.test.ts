import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import {
  createCycleApplicationForm,
  createDomainChallengeForm,
  ensureHiringTemplate,
  loadHiringForm,
} from "~/hiring/lib/application-form.server";

vi.mock("~/lib/db", () => ({
  prisma: {
    form: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    page: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    formVersion: { create: vi.fn(), findUnique: vi.fn() },
    applicationCycle: { findUnique: vi.fn(), update: vi.fn() },
    domain: { findUnique: vi.fn() },
    cycleDomainForm: { create: vi.fn() },
  },
}));
vi.mock("~/lib/pages", () => ({
  // Placement in the Hiring drive is a side effect; stub the roots so the form
  // create just records folderPageId.
  ensureHiringDriveRoot: vi.fn().mockResolvedValue({ id: "hiring-root" }),
  ensureHiringTemplatesFolder: vi.fn().mockResolvedValue("hiring-templates-folder"),
}));
vi.mock("~/forms/lib/reference-sources", () => ({
  resolveReferenceOptions: vi.fn().mockResolvedValue([{ value: "p1", label: "Project 1" }]),
}));
vi.mock("~/forms/lib/forms-data", () => ({
  safeParseJsonString: (v: unknown) => v,
}));

const mockPrisma = prisma as unknown as {
  form: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  page: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  applicationCycle: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  domain: { findUnique: ReturnType<typeof vi.fn> };
  cycleDomainForm: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  // ensureHiringTemplate cleanup path defaults: no legacy folder, empty counts.
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.page.count.mockResolvedValue(0);
  mockPrisma.form.count.mockResolvedValue(0);
});

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

describe("ensureHiringTemplate", () => {
  it("re-homes a legacy top-level template into the Hiring drive and archives the empty folder", async () => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "legacy-folder" });
    mockPrisma.form.findFirst.mockResolvedValue({
      id: "tmpl",
      folderPageId: "legacy-folder",
      versions: [{ id: "tv" }],
    });
    mockPrisma.page.count.mockResolvedValue(0);
    mockPrisma.form.count.mockResolvedValue(0);

    const id = await ensureHiringTemplate("actor");
    expect(id).toBe("tmpl");
    // Moved out of the loose Lab folder into the Hiring ▸ Templates subfolder…
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "tmpl" },
      data: { folderPageId: "hiring-templates-folder" },
    });
    // …and the now-empty legacy folder is archived.
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "legacy-folder" } }),
    );
  });

  it("leaves the legacy folder alone when it still holds other items", async () => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "legacy-folder" });
    mockPrisma.form.findFirst.mockResolvedValue({
      id: "tmpl",
      folderPageId: "hiring-templates-folder", // already in place
      versions: [{ id: "tv" }],
    });
    mockPrisma.form.count.mockResolvedValue(2);

    await ensureHiringTemplate("actor");
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
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
    mockPrisma.page.findFirst.mockResolvedValue({ id: "folder-tmpl" });
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

describe("createDomainChallengeForm", () => {
  it("creates a challenge Form and links it to the (cycle, domain) via CycleDomainForm", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "c1", name: "Fall" });
    mockPrisma.domain.findUnique.mockResolvedValue({ id: "d1", displayName: "Design" });
    // ensureHiringTemplate: template exists with a version.
    mockPrisma.page.findFirst.mockResolvedValue({ id: "folder" });
    mockPrisma.form.findFirst.mockResolvedValue({ id: "tmpl", versions: [{ id: "tv" }] });
    mockPrisma.form.findUnique.mockResolvedValue({
      versions: [{ questions: [{ key: "q", type: "text", required: false, data: { label: "Q" } }], intro: null }],
    });
    mockPrisma.form.create.mockResolvedValue({ id: "chal-form" });

    const id = await createDomainChallengeForm("c1", "d1", "actor");
    expect(id).toBe("chal-form");
    const created = mockPrisma.form.create.mock.calls[0][0].data;
    expect(created.name).toContain("Design");
    expect(mockPrisma.cycleDomainForm.create).toHaveBeenCalledWith({
      data: { applicationCycleId: "c1", domainId: "d1", formId: "chal-form" },
    });
  });
});
