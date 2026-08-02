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
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { notifyFileComment } from "~/projects/lib/file-notifications.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { action, loader } from "~/routes/api.comments";

const FILE_ID = "file-1";
const PAGE_ID = "page-1";
const CALLER = "mentor-1";

const mockPrisma = prisma as unknown as {
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  projectFileVersion: { findFirst: ReturnType<typeof vi.fn> };
  page: { findUnique: ReturnType<typeof vi.fn> };
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

function get(params: Record<string, string>) {
  const url = new URL("http://localhost/api/comments");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return loader({ request: new Request(url), params: {} } as any);
}

function fileComment(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "file",
    targetId: FILE_ID,
    body: "Tighten the easing on the logo reveal",
    ...overrides,
  };
}

function docComment(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "doc",
    targetId: PAGE_ID,
    body: "Great section",
    ...overrides,
  };
}

function memberAuth(sub = CALLER) {
  return { ok: true, user: { sub, type: "member" } };
}

function partnerAuth(sub = "partner-1") {
  return { ok: true, user: { sub, type: "partner" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(memberAuth() as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  // Serves both targetExists gate (archivedAt) and currentVersionId fallback.
  mockPrisma.projectFile.findUnique.mockResolvedValue({
    archivedAt: null,
    projectId: "proj-1",
    currentVersionId: "v-current",
  });
  mockPrisma.page.findUnique.mockResolvedValue({ archivedAt: null });
  mockPrisma.docComment.create.mockResolvedValue({ id: "c1" });
  mockPrisma.docComment.findMany.mockResolvedValue([]);
  vi.mocked(getPageAccess).mockResolvedValue({
    canView: true,
    canEdit: true,
    canComment: true,
    canResolve: true,
  });
});

// ── File version pinning (existing tests, preserved) ────────────────────────
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

// ── Doc comments — permission model ─────────────────────────────────────────
describe("doc comments permission model", () => {
  it("allows a member who canView to POST a doc comment", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: true,
      canResolve: false,
    });
    const res = (await post(docComment())) as Response;
    expect(res.status).toBe(201);
    expect(getPageAccess).toHaveBeenCalledWith(CALLER, PAGE_ID);
  });

  it("denies a member who cannot canComment on a doc", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: false,
      canEdit: false,
      canComment: false,
      canResolve: false,
    });
    const res = (await post(docComment())) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.docComment.create).not.toHaveBeenCalled();
  });

  it("allows a partner who canComment (partner-visible page)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(partnerAuth() as any);
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: true,
      canResolve: false,
    });
    const res = (await post(docComment())) as Response;
    expect(res.status).toBe(201);
  });

  it("denies a partner who cannot canComment (non-partner-visible)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(partnerAuth() as any);
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: false,
      canEdit: false,
      canComment: false,
      canResolve: false,
    });
    const res = (await post(docComment())) as Response;
    expect(res.status).toBe(403);
  });
});

// ── targetExists: any workspace type (P0-4 fix) ─────────────────────────────
describe("targetExists accepts all workspace types", () => {
  it("accepts a Lab-workspace page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ archivedAt: null });
    const res = (await post(docComment())) as Response;
    // If workspaceType were still checked for "Project", this would 404.
    expect(res.status).toBe(201);
  });

  it("rejects an archived page (still checks archivedAt)", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ archivedAt: new Date() });
    const res = (await post(docComment())) as Response;
    expect(res.status).toBe(404);
    expect(mockPrisma.docComment.create).not.toHaveBeenCalled();
  });
});

// ── GET loader includes updatedAt ────────────────────────────────────────────
describe("GET /api/comments loader", () => {
  it("returns updatedAt on each comment", async () => {
    const now = new Date();
    mockPrisma.docComment.findMany.mockResolvedValue([
      {
        id: "c1",
        parentId: null,
        authorId: "u1",
        body: "hello",
        anchor: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        versionId: null,
      },
    ]);
    const res = (await get({ targetType: "file", targetId: FILE_ID })) as Response;
    const data = await res.json();
    expect(data.comments[0]).toHaveProperty("updatedAt");
  });
});
