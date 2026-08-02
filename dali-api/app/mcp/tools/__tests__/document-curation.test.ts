import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  runListDocumentSharing,
  runSetDocumentSharing,
  runDeleteProjectDocument,
  runSetFileSharing,
  runDeleteProjectFile,
  CurationNotFoundError,
  CurationForbiddenError,
  CurationInvalidError,
} from "~/mcp/tools/document-curation";

// $transaction sits alongside the model namespaces, so it needs its own entry
// rather than being caught by the index signature.
const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };
const ME = "user-1";
const PID = "proj-1";
const PAGE = {
  id: "pg-1",
  title: "Retro",
  workspaceType: "Project",
  workspaceId: PID,
  archivedAt: null,
  systemKey: null,
  partnerVisible: false,
  publicVisible: false,
  pinnedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(true);
  mockPrisma.page.findUnique.mockResolvedValue(PAGE);
  mockPrisma.page.count.mockResolvedValue(0);
  mockPrisma.page.update.mockResolvedValue({
    partnerVisible: true,
    publicVisible: false,
    pinnedAt: null,
  });
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
});

describe("list_document_sharing", () => {
  it("returns the audience flags list_project_pages doesn't carry", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: PID });
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "pg-1",
        title: "Weekly update",
        kind: "FreeForm",
        partnerVisible: true,
        publicVisible: false,
        pinnedAt: new Date(),
        archivedAt: null,
        systemKey: null,
      },
      {
        id: "pg-2",
        title: "Team meeting notes",
        kind: "Folder",
        partnerVisible: false,
        publicVisible: false,
        pinnedAt: null,
        archivedAt: null,
        systemKey: "project:p:team-meeting-notes",
      },
    ]);
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f-1",
        title: "Spec",
        partnerVisible: true,
        archivedAt: null,
        currentVersion: { fileName: "spec.pdf", sizeBytes: 1024 },
      },
    ]);

    const out = await runListDocumentSharing(ME, { projectId: PID });
    expect(out.pages[0]).toMatchObject({ partnerVisible: true, pinned: true, system: false });
    expect(out.pages[1]).toMatchObject({ system: true });
    expect(out.files[0]).toMatchObject({ partnerVisible: true, fileName: "spec.pdf" });
    expect(mockPrisma.page.findMany.mock.calls[0][0].where).toMatchObject({ archivedAt: null });
  });

  it("refuses someone with no edit access to the project", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: PID });
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(runListDocumentSharing(ME, { projectId: PID })).rejects.toThrow(
      CurationForbiddenError,
    );
  });
});

describe("set_document_sharing", () => {
  it("changes only the flags passed", async () => {
    await runSetDocumentSharing(ME, { pageId: "pg-1", partnerVisible: true });
    const data = mockPrisma.page.update.mock.calls[0][0].data;
    expect(data).toEqual({ partnerVisible: true });
    expect(data).not.toHaveProperty("publicVisible");
  });

  it("audits partner and public changes with the actions the UI uses", async () => {
    await runSetDocumentSharing(ME, { pageId: "pg-1", partnerVisible: true, publicVisible: true });
    const actions = vi.mocked(logAuditEvent).mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["page.partner-visibility", "page.public-visibility"]);
  });

  it("maps pinned to a timestamp", async () => {
    await runSetDocumentSharing(ME, { pageId: "pg-1", pinned: true });
    expect(mockPrisma.page.update.mock.calls[0][0].data.pinnedAt).toBeInstanceOf(Date);
    vi.clearAllMocks();
    mockPrisma.page.findUnique.mockResolvedValue(PAGE);
    mockPrisma.page.update.mockResolvedValue({
      partnerVisible: false,
      publicVisible: false,
      pinnedAt: null,
    });
    await runSetDocumentSharing(ME, { pageId: "pg-1", pinned: false });
    expect(mockPrisma.page.update.mock.calls[0][0].data.pinnedAt).toBeNull();
  });

  it("refuses sharing an archived document", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...PAGE, archivedAt: new Date() });
    await expect(
      runSetDocumentSharing(ME, { pageId: "pg-1", partnerVisible: true }),
    ).rejects.toThrow(/Archived/);
  });

  it("refuses a page outside a project workspace", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...PAGE, workspaceType: "Lab", workspaceId: null });
    await expect(
      runSetDocumentSharing(ME, { pageId: "pg-1", partnerVisible: true }),
    ).rejects.toThrow(CurationNotFoundError);
  });

  it("rejects a call with no flags", async () => {
    await expect(runSetDocumentSharing(ME, { pageId: "pg-1" })).rejects.toThrow(
      /Nothing to change/,
    );
  });
});

describe("delete_project_document", () => {
  it("archives by default and stops sharing at the same time", async () => {
    const res = await runDeleteProjectDocument(ME, { pageId: "pg-1" });
    expect(res).toEqual({ ok: true, archived: true, deleted: false });
    expect(mockPrisma.page.update.mock.calls[0][0].data).toMatchObject({
      partnerVisible: false,
      publicVisible: false,
    });
    expect(mockPrisma.page.delete).not.toHaveBeenCalled();
  });

  it("permanently deletes the page and its body when asked", async () => {
    const res = await runDeleteProjectDocument(ME, { pageId: "pg-1", permanent: true });
    expect(res).toEqual({ ok: true, archived: false, deleted: true });
    expect(mockPrisma.collabDocument.deleteMany).toHaveBeenCalledWith({
      where: { name: "doc:pg-1:body" },
    });
    expect(mockPrisma.page.delete).toHaveBeenCalled();
  });

  it("refuses system documents", async () => {
    // Auto-created folders and the public write-up are ensure-created; deleting
    // them would just make the next ensure call recreate them.
    mockPrisma.page.findUnique.mockResolvedValue({ ...PAGE, systemKey: "project:p:public-writeup" });
    await expect(runDeleteProjectDocument(ME, { pageId: "pg-1" })).rejects.toThrow(
      /system document/,
    );
  });

  it("refuses a folder that still holds documents", async () => {
    mockPrisma.page.count.mockResolvedValue(3);
    await expect(runDeleteProjectDocument(ME, { pageId: "pg-1" })).rejects.toThrow(
      /still holds 3 document/,
    );
  });
});

describe("file sharing and deletion", () => {
  const FILE = { id: "f-1", projectId: PID, archivedAt: null, title: "Spec" };

  it("shares a file with the partner org and audits it", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(FILE);
    const res = await runSetFileSharing(ME, { fileId: "f-1", partnerVisible: true });
    expect(res).toEqual({ ok: true, partnerVisible: true });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].action).toBe(
      "projectFile.partner-visibility",
    );
  });

  it("refuses sharing an archived file", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ ...FILE, archivedAt: new Date() });
    await expect(
      runSetFileSharing(ME, { fileId: "f-1", partnerVisible: true }),
    ).rejects.toThrow(CurationInvalidError);
  });

  it("archives rather than destroying a file, and unshares it", async () => {
    // Versions carry uploader attribution and S3 keys worth keeping.
    mockPrisma.projectFile.findUnique.mockResolvedValue(FILE);
    const res = await runDeleteProjectFile(ME, { fileId: "f-1" });
    expect(res).toEqual({ ok: true, alreadyArchived: false });
    expect(mockPrisma.projectFile.update.mock.calls[0][0].data).toMatchObject({
      partnerVisible: false,
    });
  });

  it("is idempotent on an already-archived file", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({ ...FILE, archivedAt: new Date() });
    const res = await runDeleteProjectFile(ME, { fileId: "f-1" });
    expect(res).toEqual({ ok: true, alreadyArchived: true });
    expect(mockPrisma.projectFile.update).not.toHaveBeenCalled();
  });

  it("404s on an unknown file", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(null);
    await expect(runDeleteProjectFile(ME, { fileId: "ghost" })).rejects.toThrow(
      CurationNotFoundError,
    );
  });
});
