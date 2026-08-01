import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma and its dependencies before importing the module under test.
vi.mock("~/lib/db", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    collabDocument: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { duplicatePage } from "../page-copy.server";

const mockPrisma = prisma as any;
const mockGetPageAccess = getPageAccess as ReturnType<typeof vi.fn>;

const SOURCE_PAGE = {
  id: "src-page-id",
  title: "My Document",
  workspaceType: "Lab" as const,
  workspaceId: null,
  parentPageId: null,
  kind: "FreeForm" as const,
  iconEmoji: null,
  coverImageUrl: null,
  archivedAt: null,
};

const NEW_PAGE_ID = "new-page-id";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.page.findUnique.mockResolvedValue(SOURCE_PAGE);
  mockGetPageAccess.mockResolvedValue({ canEdit: true, canView: true, canComment: true, canResolve: true });
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.page.create.mockResolvedValue({ id: NEW_PAGE_ID });
  mockPrisma.collabDocument.findUnique.mockResolvedValue(null);
});

describe("duplicatePage", () => {
  it("creates a new page with '(copy)' suffix", async () => {
    const result = await duplicatePage({
      sourcePageId: SOURCE_PAGE.id,
      createdById: "user-1",
    });

    expect(result.id).toBe(NEW_PAGE_ID);
    expect(mockPrisma.page.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "My Document (copy)",
          isTemplate: false,
        }),
      }),
    );
  });

  it("uses titleOverride when provided", async () => {
    await duplicatePage({
      sourcePageId: SOURCE_PAGE.id,
      createdById: "user-1",
      titleOverride: "Custom title",
    });

    expect(mockPrisma.page.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Custom title" }),
      }),
    );
  });

  it("copies the CollabDocument state when one exists", async () => {
    const stateBytes = new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>;
    mockPrisma.collabDocument.findUnique.mockResolvedValue({ state: stateBytes });

    await duplicatePage({ sourcePageId: SOURCE_PAGE.id, createdById: "user-1" });

    expect(mockPrisma.collabDocument.create).toHaveBeenCalledWith({
      data: { name: `doc:${NEW_PAGE_ID}:body`, state: stateBytes },
    });
  });

  it("skips CollabDocument copy when source has no collab doc yet", async () => {
    mockPrisma.collabDocument.findUnique.mockResolvedValue(null);

    await duplicatePage({ sourcePageId: SOURCE_PAGE.id, createdById: "user-1" });

    expect(mockPrisma.collabDocument.create).not.toHaveBeenCalled();
  });

  it("throws when user lacks canEdit", async () => {
    mockGetPageAccess.mockResolvedValue({ canEdit: false, canView: true, canComment: false, canResolve: false });

    await expect(
      duplicatePage({ sourcePageId: SOURCE_PAGE.id, createdById: "user-no-edit" }),
    ).rejects.toThrow("Permission denied");
  });

  it("throws when source page is archived", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...SOURCE_PAGE, archivedAt: new Date() });

    await expect(
      duplicatePage({ sourcePageId: SOURCE_PAGE.id, createdById: "user-1" }),
    ).rejects.toThrow("Page not found");
  });
});
