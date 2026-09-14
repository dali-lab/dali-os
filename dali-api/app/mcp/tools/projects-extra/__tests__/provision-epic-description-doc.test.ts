// Tests for provision_epic_description_doc.
// COLLAB FLAG: collab pipeline calls (replaceCollabDocContent, readDocAsBlocks,
// blocksToPlainText) are fully mocked — no Hocuspocus connection in tests.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    epic: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/collab/write", () => ({
  replaceCollabDocContent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/collab/read", () => ({
  readDocAsBlocks: vi.fn(),
}));
vi.mock("~/collab/blocknote-server", () => ({
  plainTextToBlocks: vi.fn((t: string) => [{ type: "paragraph", content: t }]),
}));
vi.mock("~/components/doc/schema/configs", () => ({
  blocksToPlainText: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { replaceCollabDocContent } from "~/collab/write";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import {
  runProvisionEpicDescriptionDoc,
  PROVISION_EPIC_DESCRIPTION_DOC_TOOL,
} from "~/mcp/tools/projects-extra/provision-epic-description-doc";

const mockPrisma = prisma as unknown as {
  epic: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provision_epic_description_doc", () => {
  it("requires mcp:write scope", () => {
    expect(PROVISION_EPIC_DESCRIPTION_DOC_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError for unknown epic", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue(null);
    await expect(
      runProvisionEpicDescriptionDoc("u1", { epicId: "nope" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.epic.findUnique.mockResolvedValue({
      descriptionDocId: null,
      projectId: "p1",
      description: null,
    });
    await expect(
      runProvisionEpicDescriptionDoc("u1", { epicId: "e1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns existing descriptionDocId without writing (idempotent)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({
      descriptionDocId: "existing-uuid",
      projectId: "p1",
      description: null,
    });
    const out = await runProvisionEpicDescriptionDoc("u1", { epicId: "e1" });
    expect(out).toEqual({ descriptionDocId: "existing-uuid" });
    expect(mockPrisma.epic.update).not.toHaveBeenCalled();
  });

  it("mints a new descriptionDocId when null", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({
      descriptionDocId: null,
      projectId: "p1",
      description: null,
    });
    mockPrisma.epic.update.mockResolvedValue({});
    const out = await runProvisionEpicDescriptionDoc("u1", { epicId: "e1" });
    expect(out.descriptionDocId).toBeTruthy();
    expect(typeof out.descriptionDocId).toBe("string");
    expect(mockPrisma.epic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ descriptionDocId: out.descriptionDocId }),
      }),
    );
  });

  it("seeds plain-text description when doc is empty", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({
      descriptionDocId: "doc-uuid",
      projectId: "p1",
      description: "Some legacy text",
    });
    vi.mocked(readDocAsBlocks).mockResolvedValue([]);
    vi.mocked(blocksToPlainText).mockReturnValue("");
    const out = await runProvisionEpicDescriptionDoc("u1", { epicId: "e1" });
    expect(out).toEqual({ descriptionDocId: "doc-uuid" });
    expect(replaceCollabDocContent).toHaveBeenCalledWith(
      "epic:doc-uuid:description",
      expect.any(Array),
      "u1",
    );
  });

  it("does NOT seed when doc already has content", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({
      descriptionDocId: "doc-uuid",
      projectId: "p1",
      description: "Some legacy text",
    });
    vi.mocked(readDocAsBlocks).mockResolvedValue([{ type: "paragraph" }] as any);
    vi.mocked(blocksToPlainText).mockReturnValue("Existing edited content");
    await runProvisionEpicDescriptionDoc("u1", { epicId: "e1" });
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
  });

  it("does NOT call collab pipeline when epic has no description", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({
      descriptionDocId: "doc-uuid",
      projectId: "p1",
      description: "",
    });
    await runProvisionEpicDescriptionDoc("u1", { epicId: "e1" });
    expect(readDocAsBlocks).not.toHaveBeenCalled();
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
  });
});
