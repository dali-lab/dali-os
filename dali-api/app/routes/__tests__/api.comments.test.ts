import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMember: vi.fn(),
  isProjectMember: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/collabAuth", () => ({ hydrateAuthors: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/mentions", () => ({
  extractHandlesFromText: vi.fn(() => []),
  resolveHandles: vi.fn().mockResolvedValue([]),
  notifyMentions: vi.fn(),
  pageDocLink: vi.fn(() => "/"),
}));
vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/projects/lib/file-notifications.server", () => ({
  notifyFileComment: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { notifyFileComment } from "~/projects/lib/file-notifications.server";
import { action } from "~/routes/api.comments";

const FILE_ID = "file-1";
const CALLER = "mentor-1";

const mockPrisma = prisma as unknown as {
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  projectFileVersion: { findFirst: ReturnType<typeof vi.fn> };
  docComment: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

function post(body: unknown) {
  const request = new Request("http://localhost/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: {} } as any);
}

function fileComment(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "file",
    targetId: FILE_ID,
    body: "Tighten the easing on the logo reveal",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CALLER, type: "member" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  // Serves both the targetExists gate (archivedAt) and the currentVersionId
  // fallback — the route selects each separately.
  mockPrisma.projectFile.findUnique.mockResolvedValue({
    archivedAt: null,
    currentVersionId: "v-current",
  });
  mockPrisma.docComment.create.mockResolvedValue({ id: "c1" });
  mockPrisma.docComment.findMany.mockResolvedValue([]);
});

describe("POST /api/comments (file version pinning)", () => {
  it("stamps the version the commenter was viewing", async () => {
    mockPrisma.projectFileVersion.findFirst.mockResolvedValue({ id: "v-old" });

    const res = (await post(fileComment({ versionId: "v-old" }))) as Response;

    expect(res.status).toBe(201);
    expect(mockPrisma.projectFileVersion.findFirst).toHaveBeenCalledWith({
      where: { id: "v-old", fileId: FILE_ID },
      select: { id: true },
    });
    expect(mockPrisma.docComment.create.mock.calls[0][0].data.versionId).toBe("v-old");
  });

  it("rejects a version that doesn't belong to the file", async () => {
    mockPrisma.projectFileVersion.findFirst.mockResolvedValue(null);

    const res = (await post(fileComment({ versionId: "other-files-version" }))) as Response;

    expect(res.status).toBe(400);
    expect(mockPrisma.docComment.create).not.toHaveBeenCalled();
  });

  it("falls back to the current version when the caller doesn't send one", async () => {
    const res = (await post(fileComment())) as Response;

    expect(res.status).toBe(201);
    expect(mockPrisma.projectFileVersion.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.docComment.create.mock.calls[0][0].data.versionId).toBe("v-current");
  });

  it("notifies the file audience on root comments but not replies", async () => {
    mockPrisma.projectFileVersion.findFirst.mockResolvedValue({ id: "v-old" });

    await post(fileComment({ versionId: "v-old" }));
    expect(notifyFileComment).toHaveBeenCalledTimes(1);

    vi.mocked(notifyFileComment).mockClear();
    mockPrisma.docComment.findUnique.mockResolvedValue({
      targetType: "file",
      targetId: FILE_ID,
      parentId: null,
    });
    await post(fileComment({ versionId: "v-old", parentId: "root-1" }));
    expect(notifyFileComment).not.toHaveBeenCalled();
  });
});
