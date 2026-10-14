import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import { ensureOfferingFormsFolder } from "~/lib/pages";
import { ensureProcessFolder } from "~/lib/bindings.server";
import { filingFolderOr } from "~/lib/drive-receivers.server";
import {
  ensureEducationTemplates,
  createOfferingApplicationForm,
} from "~/education/lib/application-form.server";

const mockCreateForm = vi.hoisted(() => vi.fn());
vi.mock("~/forms/lib/form-page.server", () => ({ createForm: mockCreateForm }));
vi.mock("~/lib/db", () => ({
  prisma: {
    form: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    page: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    formVersion: { create: vi.fn() },
    educationOffering: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/pages", () => ({
  // Drive placement is a side effect; stub the offering Forms folder so only the
  // form create's folderPageId matters.
  ensureOfferingFormsFolder: vi.fn().mockResolvedValue("offering-forms-folder"),
}));
vi.mock("~/lib/bindings.server", () => ({
  ensureProcessFolder: vi.fn().mockResolvedValue("education-templates-folder"),
  CORE_PROCESS_ID: "core",
}));
const receivers = vi.hoisted(() => ({ on: false }));
vi.mock("~/lib/drive-receivers.server", () => ({
  singletonSlot: (processType: string, folderType: string) => ({ processType, processId: "core", folderType }),
  filingFolderOr: vi.fn(async (_slot: unknown, _actor: string, legacy: () => Promise<string | null>) =>
    receivers.on ? "receiver-folder" : legacy(),
  ),
}));
vi.mock("~/forms/lib/reference-sources", () => ({
  resolveReferenceOptions: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/forms/lib/forms-data", () => ({
  safeParseJsonString: (v: unknown) => v,
}));

const mockPrisma = prisma as unknown as {
  form: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  educationOffering: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Templates already exist (the create loop is a no-op); re-home defaults:
  // no legacy folder, and the folder is empty after any move.
  mockPrisma.form.findFirst.mockResolvedValue({ id: "tmpl", versions: [{ id: "v1" }] });
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.page.count.mockResolvedValue(0);
  mockPrisma.form.count.mockResolvedValue(0);
  receivers.on = false;
});

describe("ensureEducationTemplates", () => {
  it("files template forms into the Core education-templates binding folder", async () => {
    await ensureEducationTemplates("actor");

    expect(ensureProcessFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        processType: "Core",
        purpose: "education-templates",
        createdById: "actor",
      }),
    );
    // Templates already exist (beforeEach) → the create loop is a no-op.
    expect(mockCreateForm).not.toHaveBeenCalled();
  });

  it("creates a missing template form in the binding folder", async () => {
    mockPrisma.form.findFirst.mockResolvedValue(null);
    mockCreateForm.mockResolvedValue({ id: "tmpl-new" });

    await ensureEducationTemplates("actor");

    const created = mockCreateForm.mock.calls[0][0];
    expect(created.folderPageId).toBe("education-templates-folder");
  });

  it("looks every template up by templateKey, not by name or folder", async () => {
    await ensureEducationTemplates("actor");

    const wheres = mockPrisma.form.findFirst.mock.calls.map((c) => c[0].where);
    expect(wheres).toHaveLength(3);
    expect(wheres).toEqual(
      expect.arrayContaining([
        { templateKey: "education-template-miniseries" },
        { templateKey: "education-template-fellowship" },
        { templateKey: "education-template-workshop" },
      ]),
    );
    expect(mockCreateForm).not.toHaveBeenCalled();
  });

  it("stamps the templateKey on each template it creates", async () => {
    mockPrisma.form.findFirst.mockResolvedValue(null);
    mockCreateForm.mockResolvedValue({ id: "tmpl-new" });

    await ensureEducationTemplates("actor");

    const keys = mockCreateForm.mock.calls.map((c) => c[0].templateKey);
    expect(keys).toHaveLength(3);
    expect(keys).toEqual(
      expect.arrayContaining([
        "education-template-miniseries",
        "education-template-fellowship",
        "education-template-workshop",
      ]),
    );
  });
});

describe("createOfferingApplicationForm", () => {
  it("files the new form in the offering's own workspace Forms folder", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      type: "Miniseries",
      title: "PM Miniseries 26F",
      applicationFormId: null,
    });
    // ensureEducationTemplates: managed folder present, templates already exist.
    mockPrisma.page.findUnique.mockResolvedValue({ id: "managed-folder" });
    mockCreateForm.mockResolvedValue({ id: "new-form" });

    const id = await createOfferingApplicationForm("off-1", "actor");

    expect(id).toBe("new-form");
    expect(ensureOfferingFormsFolder).toHaveBeenCalledWith("off-1", "actor");
    const created = mockCreateForm.mock.calls[0][0];
    expect(created.folderPageId).toBe("offering-forms-folder");
    expect(created.name).toContain("PM Miniseries 26F");
    expect(mockPrisma.educationOffering.update).toHaveBeenCalledWith({
      where: { id: "off-1" },
      data: { applicationFormId: "new-form" },
    });
  });

  it("clones the offering form from the template found by its templateKey", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      type: "Fellowship",
      title: "Fellowship 26F",
      applicationFormId: null,
    });
    mockPrisma.form.findFirst.mockResolvedValue({
      id: "tmpl",
      versions: [{ id: "v1", questions: [{ key: "q", type: "text", required: false, data: { label: "Q" } }], intro: "hi" }],
    });
    mockCreateForm.mockResolvedValue({ id: "new-form" });

    await createOfferingApplicationForm("off-1", "actor");

    const templateLookup = mockPrisma.form.findFirst.mock.calls.at(-1)![0];
    expect(templateLookup.where).toEqual({ templateKey: "education-template-fellowship" });
    const created = mockCreateForm.mock.calls[0][0];
    expect(created.versions.create.intro).toBe("hi");
  });

  it("is a no-op when the offering already has an application form", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      type: "Workshop",
      title: "X",
      applicationFormId: "existing",
    });
    await expect(createOfferingApplicationForm("off-1", "actor")).resolves.toBe("existing");
    expect(mockCreateForm).not.toHaveBeenCalled();
    expect(ensureOfferingFormsFolder).not.toHaveBeenCalled();
  });
});

describe("ensureEducationTemplates with receiver folders on", () => {
  it("files templates via the Core EducationTemplates slot, not the binding", async () => {
    receivers.on = true;
    mockPrisma.form.findFirst.mockResolvedValue(null);
    mockCreateForm.mockResolvedValue({ id: "t" });

    await ensureEducationTemplates("actor");

    expect(filingFolderOr).toHaveBeenCalledWith(
      { processType: "Core", processId: "core", folderType: "EducationTemplates" },
      "actor",
      expect.any(Function),
    );
    expect(ensureProcessFolder).not.toHaveBeenCalled();
    expect(mockCreateForm.mock.calls[0][0].folderPageId).toBe("receiver-folder");
  });
});
