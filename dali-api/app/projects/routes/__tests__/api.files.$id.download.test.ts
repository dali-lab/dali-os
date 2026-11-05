import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/fileAccess.server", () => ({ canViewFile: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }),
}));
vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/file"),
  isS3Configured: vi.fn(),
}));

import { requireAuth, isNonMember, redirectPartnerToPortal } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { prisma } from "~/lib/db.server";
import { canViewFile } from "~/lib/fileAccess.server";
import { getDownloadUrl, isS3Configured } from "~/lib/s3";
import { loader } from "~/projects/routes/api.files.$id.download";

const db = prisma as unknown as {
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  projectFileVersion: { findFirst: ReturnType<typeof vi.fn> };
};

function get(query = "") {
  return loader({
    request: new Request(`http://localhost/api/files/f1/download${query}`),
    params: { id: "f1" },
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null);
  vi.mocked(canViewFile).mockResolvedValue(true);
  vi.mocked(isS3Configured).mockReturnValue(true);
  db.projectFile.findUnique.mockResolvedValue({
    title: "Budget",
    archivedAt: null,
    projectId: null,
    workspaceType: "Lab",
    workspaceId: null,
    folderPageId: "folder-1",
    currentVersion: { id: "v2", fileName: "budget-final.xlsx", s3Key: "uploads/v2" },
  });
});

describe("GET /api/files/:id/download", () => {
  it("redirects to a short-lived attachment link named after the title", async () => {
    const res = await get();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://signed.example/file");
    expect(getDownloadUrl).toHaveBeenCalledWith("uploads/v2", { fileName: "Budget.xlsx", expiresIn: 300 });
  });

  it("sends a signed-out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    expect((await get()).headers.get("Location")).toBe("/login");
    expect(db.projectFile.findUnique).not.toHaveBeenCalled();
  });

  it("404s non-members and partners before touching the file", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    expect((await get()).status).toBe(404);

    vi.mocked(isNonMember).mockResolvedValue(false);
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(new Response(null, { status: 302 }) as never);
    expect((await get()).status).toBe(404);
    expect(db.projectFile.findUnique).not.toHaveBeenCalled();
  });

  it("404s a missing or trashed file", async () => {
    db.projectFile.findUnique.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);

    db.projectFile.findUnique.mockResolvedValueOnce({ archivedAt: new Date() });
    expect((await get()).status).toBe(404);
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("404s a file the viewer can't see, signing nothing and logging nothing", async () => {
    vi.mocked(canViewFile).mockResolvedValue(false);
    expect((await get()).status).toBe(404);
    expect(getDownloadUrl).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("serves a named version, scoped to this file", async () => {
    db.projectFileVersion.findFirst.mockResolvedValue({ id: "v1", fileName: "old.csv", s3Key: "uploads/v1" });
    await get("?version=v1");

    expect(db.projectFileVersion.findFirst.mock.calls[0][0].where).toEqual({ id: "v1", fileId: "f1" });
    expect(getDownloadUrl).toHaveBeenCalledWith("uploads/v1", expect.objectContaining({ fileName: "Budget.csv" }));
  });

  it("404s a version from another file", async () => {
    db.projectFileVersion.findFirst.mockResolvedValue(null);
    expect((await get("?version=other")).status).toBe(404);
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("404s a file that has no version yet", async () => {
    db.projectFile.findUnique.mockResolvedValue({ archivedAt: null, currentVersion: null });
    expect((await get()).status).toBe(404);
  });

  it("audits the download", async () => {
    await get();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "projectFile.download",
        userId: "u1",
        targetId: "f1",
        metadata: { versionId: "v2" },
      }),
    );
  });

  it("falls back to the raw route without S3 in local dev", async () => {
    vi.mocked(isS3Configured).mockReturnValue(false);
    expect((await get()).headers.get("Location")).toBe("/api/upload/raw?key=uploads%2Fv2");
  });
});
