import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import {
  ensureProcessFolder,
  slotFor,
  FOLDER_SLOTS,
  CORE_PROCESS_ID,
} from "~/lib/bindings.server";

vi.mock("~/lib/db", () => ({
  prisma: {
    processFolderBinding: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    page: { findFirst: vi.fn(), create: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
  },
}));

const m = prisma as unknown as {
  processFolderBinding: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  page: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  groupDefinition: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  m.processFolderBinding.create.mockResolvedValue({});
  m.processFolderBinding.update.mockResolvedValue({});
  m.page.findFirst.mockResolvedValue(null);
});

describe("slot registry", () => {
  it("exposes the expected slots per process type", () => {
    expect(FOLDER_SLOTS.Project.map((s) => s.purpose)).toEqual([
      "meeting-notes-team",
      "meeting-notes-partner",
    ]);
    expect(FOLDER_SLOTS.EducationOffering.map((s) => s.purpose)).toEqual(["forms"]);
    // Core files its own meeting notes the way a project does — see
    // ensureCoreMeetingNotesFolder.
    expect(FOLDER_SLOTS.Core.map((s) => s.purpose)).toContain("meeting-notes");
    expect(slotFor("Project", "meeting-notes-team")?.defaultTitle).toBe("Team meeting notes");
    expect(slotFor("Project", "nope")).toBeUndefined();
  });

  it("uses a stable singleton id for Core", () => {
    expect(CORE_PROCESS_ID).toBe("core");
  });
});

describe("ensureProcessFolder", () => {
  it("returns the existing folder without creating one (fast path)", async () => {
    m.processFolderBinding.findUnique.mockResolvedValue({
      folderPage: { id: "f1", archivedAt: null },
    });
    const id = await ensureProcessFolder({
      processType: "Project",
      processId: "p1",
      purpose: "meeting-notes-team",
      createdById: "u1",
    });
    expect(id).toBe("f1");
    expect(m.page.create).not.toHaveBeenCalled();
    expect(m.processFolderBinding.create).not.toHaveBeenCalled();
  });

  it("creates a normal folder + binding when none exists (project → no scope)", async () => {
    m.processFolderBinding.findUnique.mockResolvedValue(null);
    m.page.create.mockResolvedValue({ id: "newf" });

    const id = await ensureProcessFolder({
      processType: "Project",
      processId: "p1",
      purpose: "meeting-notes-team",
      createdById: "u1",
    });

    expect(id).toBe("newf");
    expect(m.processFolderBinding.create).toHaveBeenCalledOnce();
    const folderData = m.page.create.mock.calls[0][0].data;
    expect(folderData).toMatchObject({
      workspaceType: "Project",
      workspaceId: "p1",
      kind: "Folder",
      title: "Team meeting notes",
    });
    // Project folders inherit workspace access — no explicit scope.
    expect(folderData.scopeKind).toBeUndefined();
    expect(m.processFolderBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { folderPageId: "newf" } }),
    );
  });

  it("scopes Core folders to the Core group", async () => {
    m.processFolderBinding.findUnique.mockResolvedValue(null);
    m.groupDefinition.findUnique.mockResolvedValue({ id: "core-grp" });
    m.page.create.mockResolvedValue({ id: "coref" });

    const id = await ensureProcessFolder({
      processType: "Core",
      processId: CORE_PROCESS_ID,
      purpose: "agreements",
      createdById: "u1",
    });

    expect(id).toBe("coref");
    const folderData = m.page.create.mock.calls[0][0].data;
    expect(folderData).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
      scopeKind: "Group",
      scopeGroupId: "core-grp",
      linkAccess: "Restricted",
    });
  });
});
