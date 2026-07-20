import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/collab/export", () => ({
  collabDocToProseMirror: vi.fn(),
}));
vi.mock("~/collab/write", () => ({
  replaceCollabDocContent: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { collabDocToProseMirror } from "~/collab/export";
import { replaceCollabDocContent } from "~/collab/write";
import {
  runListProjectPages,
  LIST_PROJECT_PAGES_TOOL,
} from "~/mcp/tools/list-project-pages";
import { runReadPage, READ_PAGE_TOOL, ReadPageError } from "~/mcp/tools/read-page";
import { runCreatePage, CREATE_PAGE_TOOL, CreatePageError } from "~/mcp/tools/create-page";
import {
  runListProjectFiles,
  LIST_PROJECT_FILES_TOOL,
} from "~/mcp/tools/list-project-files";
import {
  runSetPageContent,
  SET_PAGE_CONTENT_TOOL,
  SetPageContentError,
} from "~/mcp/tools/set-page-content";
import { UPDATE_PAGE_TOOL } from "~/mcp/tools/update-page";
import { UPLOAD_PROJECT_FILE_TOOL } from "~/mcp/tools/upload-project-file";
import { GET_TASK_TOOL } from "~/mcp/tools/get-task";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("pages + files tools", () => {
  it("scopes are right", () => {
    expect(LIST_PROJECT_PAGES_TOOL.requiredScope).toBe("mcp:read");
    expect(READ_PAGE_TOOL.requiredScope).toBe("mcp:read");
    expect(CREATE_PAGE_TOOL.requiredScope).toBe("mcp:write");
    expect(LIST_PROJECT_FILES_TOOL.requiredScope).toBe("mcp:read");
    expect(SET_PAGE_CONTENT_TOOL.requiredScope).toBe("mcp:write");
    expect(UPDATE_PAGE_TOOL.requiredScope).toBe("mcp:write");
    expect(UPLOAD_PROJECT_FILE_TOOL.requiredScope).toBe("mcp:write");
    expect(GET_TASK_TOOL.requiredScope).toBe("mcp:read");
  });

  it("list_project_pages builds a 2-level tree", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      overviewPageId: "pg-o",
      prdPageId: "pg-prd",
    });
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p-root", parentPageId: null, title: "Overview", kind: "FreeForm", iconEmoji: null, position: 0, archivedAt: null },
      { id: "p-child", parentPageId: "p-root", title: "Subpage", kind: "FreeForm", iconEmoji: null, position: 0, archivedAt: null },
    ]);
    const out = await runListProjectPages("u1", { projectId: "p1" });
    expect(out.overviewPageId).toBe("pg-o");
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children).toHaveLength(1);
    expect(out.pages[0].children[0].id).toBe("p-child");
  });

  it("read_page derives the doc:{id}:body room for app-created pages", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Notes",
      kind: "FreeForm",
      workspaceType: "Project",
      workspaceId: "p1",
      contentDocId: null,
      iconEmoji: null,
    });
    vi.mocked(collabDocToProseMirror).mockResolvedValue({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hi" }] },
      ],
    });
    const out = await runReadPage("u1", { pageId: "pg1" });
    expect(collabDocToProseMirror).toHaveBeenCalledWith("doc:pg1:body");
    expect(out.markdown.startsWith("# Hi")).toBe(true);
  });

  it("read_page prefers contentDocId when set (seeded pages)", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Handbook",
      kind: "FreeForm",
      workspaceType: "Lab",
      workspaceId: null,
      contentDocId: "page:lab-handbook",
      iconEmoji: null,
    });
    vi.mocked(collabDocToProseMirror).mockResolvedValue({ type: "doc", content: [] });
    const out = await runReadPage("u1", { pageId: "pg1" });
    expect(collabDocToProseMirror).toHaveBeenCalledWith("page:lab-handbook");
    expect(out.markdown).toBe("");
  });

  it("read_page 404s missing page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await expect(runReadPage("u1", { pageId: "x" })).rejects.toBeInstanceOf(ReadPageError);
  });

  it("create_page rejects a non-Folder parent (app nesting rule)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "parent",
      parentPageId: null,
      workspaceType: "Project",
      workspaceId: "p1",
      kind: "FreeForm",
      archivedAt: null,
    });
    await expect(
      runCreatePage("u1", { projectId: "p1", title: "x", parentPageId: "parent" }),
    ).rejects.toThrow(/inside a folder/);
  });

  it("create_page rejects a folder-in-folder", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runCreatePage("u1", { projectId: "p1", title: "x", kind: "Folder", parentPageId: "f1" }),
    ).rejects.toBeInstanceOf(CreatePageError);
  });

  it("create_page rejects content on a Folder", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runCreatePage("u1", { projectId: "p1", title: "x", kind: "Folder", content: "# hi" }),
    ).rejects.toBeInstanceOf(CreatePageError);
  });

  it("create_page creates a top-level page", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.page.findFirst.mockResolvedValue({ position: 3 });
    mockPrisma.page.create.mockResolvedValue({ id: "pg-new" });
    const out = await runCreatePage("u1", { projectId: "p1", title: "Plan" });
    expect(out).toMatchObject({ id: "pg-new", kind: "FreeForm", parentPageId: null, position: 4 });
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
  });

  it("create_page with content seeds the body via the collab write pipeline", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.page.findFirst.mockResolvedValue(null);
    mockPrisma.page.create.mockResolvedValue({ id: "pg-new" });
    const out = await runCreatePage("u1", {
      projectId: "p1",
      title: "Imported",
      content: "# Hello\n\nWorld",
    });
    expect(out.id).toBe("pg-new");
    expect(replaceCollabDocContent).toHaveBeenCalledWith(
      "doc:pg-new:body",
      expect.objectContaining({ type: "doc" }),
      "u1",
    );
  });

  it("set_page_content rejects folders and archived pages", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      kind: "Folder",
      workspaceType: "Project",
      contentDocId: null,
      archivedAt: null,
    });
    await expect(
      runSetPageContent("u1", { pageId: "pg1", markdown: "x" }),
    ).rejects.toBeInstanceOf(SetPageContentError);

    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      kind: "FreeForm",
      workspaceType: "Project",
      contentDocId: null,
      archivedAt: new Date(),
    });
    await expect(
      runSetPageContent("u1", { pageId: "pg1", markdown: "x" }),
    ).rejects.toThrow(/archived/);
  });

  it("set_page_content replaces the derived doc and stamps lastEditedBy", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      kind: "FreeForm",
      workspaceType: "Project",
      contentDocId: null,
      archivedAt: null,
    });
    mockPrisma.page.update.mockResolvedValue({ id: "pg1" });
    const out = await runSetPageContent("u1", { pageId: "pg1", markdown: "# T\n\nbody" });
    expect(replaceCollabDocContent).toHaveBeenCalledWith(
      "doc:pg1:body",
      expect.objectContaining({ type: "doc" }),
      "u1",
    );
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastEditedById: "u1" } }),
    );
    expect(out).toMatchObject({ id: "pg1", blockCount: 2 });
  });

  it("set_page_content is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runSetPageContent("u1", { pageId: "pg1", markdown: "x" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("list_project_files returns current-version metadata", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f1",
        title: "Spec",
        archivedAt: null,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-05T00:00:00Z"),
        currentVersion: {
          id: "v1",
          fileName: "spec.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
          createdAt: new Date("2026-06-05T00:00:00Z"),
        },
      },
    ]);
    const out = await runListProjectFiles("u1", { projectId: "p1" });
    expect(out.files[0]).toMatchObject({
      id: "f1",
      title: "Spec",
      currentVersion: { fileName: "spec.pdf" },
    });
  });
});
