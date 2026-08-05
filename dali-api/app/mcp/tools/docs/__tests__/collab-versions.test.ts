import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
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
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";
import {
  LIST_COLLAB_VERSIONS_TOOL,
  GET_COLLAB_VERSION_TOOL,
  RESTORE_COLLAB_VERSION_TOOL,
  runListCollabVersions,
  runGetCollabVersion,
  runRestoreCollabVersion,
  CollabVersionError,
} from "~/mcp/tools/docs/collab-versions";

const mockPrisma = prisma as unknown as {
  collabDocumentVersion: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

// Ensure vi.mock("~/lib/db") gives us actual vi.fn() on the methods we need
beforeEach(() => {
  if (!mockPrisma.collabDocumentVersion.findUnique) {
    (mockPrisma.collabDocumentVersion as Record<string, unknown>).findUnique = vi.fn();
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_collab_versions", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_COLLAB_VERSIONS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects when authorizeCollabDoc denies access", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    await expect(
      runListCollabVersions("u1", { docName: "doc:p1:body" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 403 });
  });

  it("returns versions for an authorized user", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    mockPrisma.collabDocumentVersion.findMany.mockResolvedValue([
      { id: "v1", createdAt: new Date("2026-01-01"), plainText: "Hello world", authorIds: [] },
    ]);

    const out = await runListCollabVersions("u1", { docName: "doc:p1:body" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "v1", plainTextPreview: "Hello world" });
  });
});

describe("get_collab_version", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_COLLAB_VERSION_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns 404 for missing version", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue(null);
    await expect(
      runGetCollabVersion("u1", { versionId: "missing" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 404 });
  });

  it("returns 403 when auth is denied after version lookup", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({
      id: "v1", name: "doc:p1:body", createdAt: new Date(), plainText: "hi", authorIds: [],
    });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });

    await expect(
      runGetCollabVersion("u1", { versionId: "v1" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 403 });
  });

  it("returns full plain text for an authorized user", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({
      id: "v1", name: "doc:p1:body", createdAt: new Date("2026-01-01"), plainText: "Full content", authorIds: [],
    });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });

    const out = await runGetCollabVersion("u1", { versionId: "v1" });
    expect(out).toMatchObject({ id: "v1", plainText: "Full content" });
  });
});

describe("restore_collab_version", () => {
  it("requires the mcp:write scope", () => {
    expect(RESTORE_COLLAB_VERSION_TOOL.requiredScope).toBe("mcp:write");
  });

  it("returns 404 for missing version", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue(null);
    await expect(
      runRestoreCollabVersion("u1", { versionId: "missing" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 404 });
  });

  it("rejects read-only callers (viewer-only access)", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });

    await expect(
      runRestoreCollabVersion("u1", { versionId: "v1" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 403 });
  });

  it("returns 503 when collab server is not running", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    vi.mocked(getCollabServer).mockReturnValue(null as never);

    await expect(
      runRestoreCollabVersion("u1", { versionId: "v1" }),
    ).rejects.toMatchObject({ name: "CollabVersionError", status: 503 });
  });

  it("restores via the collab pipeline for an authorized editor", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "doc:p1:body" });
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    const fakeServer = { name: "server" };
    vi.mocked(getCollabServer).mockReturnValue(fakeServer as never);

    const out = await runRestoreCollabVersion("u1", { versionId: "v1" });
    expect(out).toEqual({ ok: true });
    expect(restoreVersion).toHaveBeenCalledWith(fakeServer, "doc:p1:body", "v1");
  });
});
