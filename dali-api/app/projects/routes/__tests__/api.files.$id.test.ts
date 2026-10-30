import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireMemberSession: vi.fn(),
  isNonMember: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/fileAccess.server", () => ({
  canViewFile: vi.fn(),
  canEditFile: vi.fn(),
}));
vi.mock("~/lib/s3", () => ({ getDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/file") }));
vi.mock("~/lib/collabAuth", () => ({ hydrateAuthors: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../../lib/file-notifications.server", () => ({ notifyFileNewVersion: vi.fn() }));

import { requireAuth, isNonMember, redirectPartnerToPortal } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { canViewFile } from "~/lib/fileAccess.server";
import { loader } from "~/projects/routes/api.files.$id";

const mockPrisma = prisma as unknown as {
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
};

function get() {
  return loader({
    request: new Request("http://localhost/api/files/f1"),
    params: { id: "f1" },
  } as any) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null);
  vi.mocked(canViewFile).mockResolvedValue(true);
  mockPrisma.projectFile.findUnique.mockResolvedValue({
    id: "f1",
    title: "Poster",
    currentVersionId: "v1",
    archivedAt: null,
    projectId: null,
    workspaceType: "Lab",
    workspaceId: null,
    folderPageId: "folder-1",
    versions: [],
  });
});

describe("GET /api/files/:id", () => {
  it("returns the version list to a lab member who can view the file", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "f1", title: "Poster", versions: [] });
    expect(canViewFile).toHaveBeenCalledWith("u1", expect.objectContaining({ folderPageId: "folder-1" }), expect.any(Request));
  });

  it("404s a non-member session before touching the file", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    const res = await get();
    expect(res.status).toBe(404);
    expect(mockPrisma.projectFile.findUnique).not.toHaveBeenCalled();
  });

  it("404s a partner account before touching the file", async () => {
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(new Response(null, { status: 302 }));
    const res = await get();
    expect(res.status).toBe(404);
    expect(mockPrisma.projectFile.findUnique).not.toHaveBeenCalled();
  });

  it("404s a member who cannot view the file", async () => {
    vi.mocked(canViewFile).mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(404);
  });
});
