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
vi.mock("~/lib/fileAccess.server", () => ({ canViewFile: vi.fn(), canEditFile: vi.fn() }));
vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(async (key: string, o?: { fileName?: string }) => `url:${key}:${o?.fileName ?? ""}`),
}));
vi.mock("~/lib/collabAuth", () => ({ hydrateAuthors: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../../lib/file-notifications.server", () => ({ notifyFileNewVersion: vi.fn() }));

import { requireAuth, requireMemberSession, isNonMember, redirectPartnerToPortal } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { canViewFile, canEditFile } from "~/lib/fileAccess.server";
import { hydrateAuthors } from "~/lib/collabAuth";
import { logAuditEvent } from "~/lib/audit";
import { notifyFileNewVersion } from "../../lib/file-notifications.server";
import { loader, action } from "~/projects/routes/api.files.$id";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const FILE = {
  id: "f1",
  archivedAt: null,
  projectId: "p1",
  workspaceType: "Project",
  workspaceId: "p1",
  folderPageId: null,
};

function call(method: string, body?: unknown, raw?: string) {
  const request = new Request("http://localhost/api/files/f1", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return action({ request, params: { id: "f1" } } as any) as Promise<Response>;
}

const VERSION = { intent: "version", s3Key: "uploads/abc", fileName: "v2.pdf", contentType: "application/pdf", sizeBytes: 12 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  vi.mocked(canEditFile).mockResolvedValue(true);
  vi.mocked(notifyFileNewVersion).mockResolvedValue(undefined as never);
  db.projectFile.findUnique.mockResolvedValue(FILE);
  db.projectFile.update.mockResolvedValue({});
  db.projectFileVersion.create.mockResolvedValue({ id: "v2" });
});

describe("files action — access", () => {
  it("rejects methods other than POST and DELETE", async () => {
    expect((await call("PUT", {})).status).toBe(405);
    expect(db.projectFile.findUnique).not.toHaveBeenCalled();
  });

  it("404s a missing or archived file", async () => {
    db.projectFile.findUnique.mockResolvedValue(null);
    expect((await call("DELETE")).status).toBe(404);
    db.projectFile.findUnique.mockResolvedValue({ ...FILE, archivedAt: new Date() });
    expect((await call("DELETE")).status).toBe(404);
    expect(db.projectFile.update).not.toHaveBeenCalled();
  });

  it("returns the member-session failure for non-members", async () => {
    const denied = new Response("no", { status: 401 });
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await call("DELETE")).toBe(denied);
    expect(db.projectFile.update).not.toHaveBeenCalled();
  });

  it("403s a member who cannot edit the file and checks edit rights against the file's workspace", async () => {
    vi.mocked(canEditFile).mockResolvedValue(false);
    expect((await call("POST", { intent: "rename", title: "X" })).status).toBe(403);
    expect(canEditFile).toHaveBeenCalledWith("u1", expect.objectContaining({ projectId: "p1", workspaceType: "Project" }), expect.any(Request));
    expect(db.projectFile.update).not.toHaveBeenCalled();
  });
});

describe("files action — DELETE", () => {
  it("soft-deletes by stamping archivedAt and audits it", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    const arg = db.projectFile.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "f1" });
    expect(arg.data.archivedAt).toBeInstanceOf(Date);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "projectFile.delete", userId: "u1", targetId: "f1", metadata: { soft: true } }),
    );
  });
});

describe("files action — POST validation", () => {
  it("rejects malformed JSON, unknown intents, blank titles and bad version fields", async () => {
    expect((await call("POST", undefined, "{bad")).status).toBe(400);
    expect((await call("POST", { intent: "other" })).status).toBe(400);
    expect((await call("POST", { intent: "rename", title: "   " })).status).toBe(400);
    expect((await call("POST", { intent: "rename", title: "x".repeat(201) })).status).toBe(400);
    expect((await call("POST", { ...VERSION, sizeBytes: -1 })).status).toBe(400);
    expect((await call("POST", { ...VERSION, sizeBytes: 1.5 })).status).toBe(400);
    expect(db.projectFile.update).not.toHaveBeenCalled();
    expect(db.projectFileVersion.create).not.toHaveBeenCalled();
  });

  it("refuses a version whose key is outside uploads/", async () => {
    const res = await call("POST", { ...VERSION, s3Key: "private/other-file" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid file key" });
    expect(db.projectFileVersion.create).not.toHaveBeenCalled();
  });
});

describe("files action — rename", () => {
  it("writes the trimmed title", async () => {
    const res = await call("POST", { intent: "rename", title: "  New name " });
    expect(res.status).toBe(200);
    expect(db.projectFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { title: "New name" } });
  });
});

describe("files action — new version", () => {
  it("appends a version by the caller, makes it current, audits and notifies prior commenters", async () => {
    const res = await call("POST", VERSION);
    expect(await res.json()).toEqual({ ok: true, versionId: "v2" });
    expect(db.projectFileVersion.create.mock.calls[0][0].data).toEqual({
      fileId: "f1",
      s3Key: "uploads/abc",
      fileName: "v2.pdf",
      contentType: "application/pdf",
      sizeBytes: 12,
      uploadedById: "u1",
    });
    expect(db.projectFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { currentVersionId: "v2" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "projectFile.version", targetId: "f1", metadata: { versionId: "v2" } }),
    );
    expect(notifyFileNewVersion).toHaveBeenCalledWith({ fileId: "f1", uploadedById: "u1" });
  });

  it("still succeeds when the notification fails", async () => {
    vi.mocked(notifyFileNewVersion).mockRejectedValue(new Error("mail down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("POST", VERSION)).status).toBe(200);
    spy.mockRestore();
  });
});

describe("files loader — versions", () => {
  it("lists versions newest first with uploader names, current flag and a title-named download URL", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
    vi.mocked(isNonMember).mockResolvedValue(false);
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(null);
    vi.mocked(canViewFile).mockResolvedValue(true);
    vi.mocked(hydrateAuthors).mockResolvedValue([{ id: "u1", name: "Ada Lovelace" }] as any);
    db.projectFile.findUnique.mockResolvedValue({
      ...FILE,
      title: "Brief",
      currentVersionId: "v2",
      versions: [
        { id: "v2", fileName: "b2.pdf", contentType: "application/pdf", sizeBytes: 2, uploadedById: "u1", createdAt: new Date("2026-02-01T00:00:00Z"), s3Key: "uploads/b2" },
        { id: "v1", fileName: "b1.pdf", contentType: "application/pdf", sizeBytes: 1, uploadedById: "gone", createdAt: new Date("2026-01-01T00:00:00Z"), s3Key: "uploads/b1" },
      ],
    });
    const res = (await loader({ request: new Request("http://localhost/api/files/f1"), params: { id: "f1" } } as any)) as Response;
    const body = await res.json();
    expect(body.versions.map((v: any) => [v.id, v.isCurrent, v.uploadedBy])).toEqual([
      ["v2", true, "Ada Lovelace"],
      ["v1", false, expect.any(String)],
    ]);
    expect(body.versions[0].downloadUrl).toBe("url:uploads/b2:Brief.pdf");
    expect(body.versions[1].uploadedBy).not.toBe("Ada Lovelace");
  });

  it("404s an archived file", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
    vi.mocked(isNonMember).mockResolvedValue(false);
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(null);
    db.projectFile.findUnique.mockResolvedValue({ ...FILE, archivedAt: new Date(), versions: [] });
    const res = (await loader({ request: new Request("http://localhost/api/files/f1"), params: { id: "f1" } } as any)) as Response;
    expect(res.status).toBe(404);
    expect(canViewFile).not.toHaveBeenCalled();
  });
});
