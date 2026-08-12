import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { action } from "~/routes/api.drive.files";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  projectFile: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  projectFileVersion: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const VALID_LAB_BODY = {
  s3Key: "uploads/lab-files/logo.png",
  title: "Logo",
  fileName: "logo.png",
  contentType: "image/png",
  sizeBytes: 1024,
  scope: { kind: "Lab" },
};

const VALID_PROJECT_BODY = {
  s3Key: "uploads/project-files/proj-1/spec.pdf",
  title: "Spec",
  fileName: "spec.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
  scope: { kind: "Project", projectId: "proj-1" },
};

function makeRequest(body: unknown, method = "POST") {
  return new Request("http://localhost/api/drive/files", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u@test.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(getPageAccess).mockResolvedValue({
    canView: true,
    canEdit: true,
    canComment: true,
    canManageAccess: false,
  } as any);

  mockPrisma.project.findUnique.mockResolvedValue({ id: "proj-1" });
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      projectFile: {
        create: vi.fn().mockResolvedValue({ id: "file-1" }),
        update: vi.fn(),
      },
      projectFileVersion: { create: vi.fn().mockResolvedValue({ id: "ver-1" }) },
    }),
  );
});

describe("POST /api/drive/files — Lab scope", () => {
  it("returns 201 with fileId for a lab member", async () => {
    const res = await action({ request: makeRequest(VALID_LAB_BODY) });
    expect((res as Response).status).toBe(201);
    const json = await (res as Response).json();
    expect(json).toHaveProperty("id");
  });

  it("returns 403 when the caller is not a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    const res = await action({ request: makeRequest(VALID_LAB_BODY) });
    expect((res as Response).status).toBe(403);
  });

  it("returns 400 when s3Key does not start with uploads/", async () => {
    const res = await action({
      request: makeRequest({ ...VALID_LAB_BODY, s3Key: "evil/logo.png" }),
    });
    expect((res as Response).status).toBe(400);
  });

  it("returns 403 when folderPageId is provided but viewer cannot edit the folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: false,
      canManageAccess: false,
    } as any);
    const res = await action({
      request: makeRequest({ ...VALID_LAB_BODY, folderPageId: "folder-1" }),
    });
    expect((res as Response).status).toBe(403);
  });

  it("allows upload into a folder when the viewer has edit access", async () => {
    const res = await action({
      request: makeRequest({ ...VALID_LAB_BODY, folderPageId: "folder-1" }),
    });
    expect((res as Response).status).toBe(201);
    expect(getPageAccess).toHaveBeenCalledWith("u1", "folder-1", expect.anything());
  });

  it("returns 405 for non-POST methods", async () => {
    const req = new Request("http://localhost/api/drive/files", { method: "PUT" });
    const res = await action({ request: req });
    expect((res as Response).status).toBe(405);
  });
});

describe("POST /api/drive/files — Project scope", () => {
  it("allows Core to upload to a project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const res = await action({ request: makeRequest(VALID_PROJECT_BODY) });
    expect((res as Response).status).toBe(201);
  });

  it("allows a project member to upload", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const res = await action({ request: makeRequest(VALID_PROJECT_BODY) });
    expect((res as Response).status).toBe(201);
    expect(isProjectMember).toHaveBeenCalledWith("u1", "proj-1");
  });

  it("returns 403 when neither Core nor a project member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    const res = await action({ request: makeRequest(VALID_PROJECT_BODY) });
    expect((res as Response).status).toBe(403);
  });

  it("returns 404 when the project does not exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    const res = await action({ request: makeRequest(VALID_PROJECT_BODY) });
    expect((res as Response).status).toBe(404);
  });
});
