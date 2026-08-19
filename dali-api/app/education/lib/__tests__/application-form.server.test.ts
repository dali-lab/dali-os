import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import { ensureCoreDriveRoot } from "~/lib/pages";
import { ensureEducationTemplates } from "~/education/lib/application-form.server";

vi.mock("~/lib/db", () => ({
  prisma: {
    form: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    page: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    formVersion: { create: vi.fn() },
  },
}));
vi.mock("~/lib/pages", () => ({
  // Provisioning the Core drive is a side effect; stub it so only the folder
  // lookups matter.
  ensureCoreDriveRoot: vi.fn().mockResolvedValue({ id: "core-root" }),
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
};

beforeEach(() => {
  vi.clearAllMocks();
  // Templates already exist (the create loop is a no-op); re-home defaults:
  // no legacy folder, and the folder is empty after any move.
  mockPrisma.form.findFirst.mockResolvedValue({ id: "tmpl", versions: [{ id: "v1" }] });
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.page.count.mockResolvedValue(0);
  mockPrisma.form.count.mockResolvedValue(0);
});

describe("ensureEducationTemplates", () => {
  it("targets the managed Core ▸ Templates ▸ Education folder by systemKey", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "managed-folder" });

    await ensureEducationTemplates("actor");

    expect(mockPrisma.page.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { systemKey: "drive:core-templates-education" } }),
    );
    // Managed folder already present → no loose top-level folder is created.
    expect(mockPrisma.page.create).not.toHaveBeenCalled();
    expect(ensureCoreDriveRoot).not.toHaveBeenCalled();
  });

  it("re-homes legacy loose templates into the managed folder and archives the empty folder", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "managed-folder" });
    mockPrisma.page.findFirst.mockResolvedValue({ id: "legacy-folder" });

    await ensureEducationTemplates("actor");

    expect(mockPrisma.form.updateMany).toHaveBeenCalledWith({
      where: {
        folderPageId: "legacy-folder",
        name: { in: ["Miniseries Application Template", "Workshop RSVP Template"] },
      },
      data: { folderPageId: "managed-folder" },
    });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "legacy-folder" } }),
    );
  });

  it("leaves the legacy folder alone when it still holds other items", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "managed-folder" });
    mockPrisma.page.findFirst.mockResolvedValue({ id: "legacy-folder" });
    mockPrisma.form.count.mockResolvedValue(1);

    await ensureEducationTemplates("actor");
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("provisions the Core drive and falls back to a loose folder when the managed folder is missing", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    mockPrisma.page.create.mockResolvedValue({ id: "loose-folder" });

    await ensureEducationTemplates("actor");

    expect(ensureCoreDriveRoot).toHaveBeenCalledWith("actor");
    // No managed folder resolved → ensureFolder creates the loose fallback.
    expect(mockPrisma.page.create).toHaveBeenCalled();
  });
});
