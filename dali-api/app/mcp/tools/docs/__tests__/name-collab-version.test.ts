import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    collabDocumentVersion: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/collabAuth", () => ({
  authorizeCollabDoc: vi.fn(),
  hydrateAuthors: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/collab/server", () => ({
  getCollabServer: vi.fn(),
}));

vi.mock("~/collab/persistence", () => ({
  restoreVersion: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import {
  NAME_COLLAB_VERSION_TOOL,
  runNameCollabVersion,
  CollabVersionError,
} from "~/mcp/tools/docs/collab-versions";

const mockPrisma = prisma as unknown as {
  collabDocumentVersion: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("name_collab_version", () => {
  it("requires the mcp:write scope", () => {
    expect(NAME_COLLAB_VERSION_TOOL.requiredScope).toBe("mcp:write");
  });

  it("returns 404 for a missing version", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue(null);
    await expect(
      runNameCollabVersion("u1", { versionId: "missing", label: "v1" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 404 });
  });

  it("returns 403 when auth is denied", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    await expect(
      runNameCollabVersion("u1", { versionId: "v1", label: "My label" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 403 });
  });

  it("sets a label on a version for an authorized user", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    mockPrisma.collabDocumentVersion.update.mockResolvedValue({ id: "v1", label: "My label" });

    const out = await runNameCollabVersion("u1", { versionId: "v1", label: "My label" });
    expect(out).toEqual({ ok: true, label: "My label" });
    expect(mockPrisma.collabDocumentVersion.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { label: "My label" },
    });
  });

  it("clears a label when an empty string is given", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });
    mockPrisma.collabDocumentVersion.update.mockResolvedValue({ id: "v1", label: null });

    const out = await runNameCollabVersion("u1", { versionId: "v1", label: "" });
    expect(out).toEqual({ ok: true, label: null });
    expect(mockPrisma.collabDocumentVersion.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { label: null },
    });
  });

  it("is accessible to read-only viewers (readOnly=true does not block naming)", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });
    mockPrisma.collabDocumentVersion.update.mockResolvedValue({ id: "v1", label: "Snapshot" });

    const out = await runNameCollabVersion("u1", { versionId: "v1", label: "Snapshot" });
    expect(out.ok).toBe(true);
  });
});
