import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/collab/export", () => ({
  collabDocToProseMirror: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { collabDocToProseMirror } from "~/collab/export";
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

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
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

  it("read_page returns markdown for a doc with content", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Notes",
      kind: "FreeForm",
      workspaceType: "Project",
      workspaceId: "p1",
      contentDocId: "doc:pg1",
      iconEmoji: null,
    });
    vi.mocked(collabDocToProseMirror).mockResolvedValue({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hi" }] },
      ],
    });
    const out = await runReadPage("u1", { pageId: "pg1" });
    expect(out.markdown.startsWith("# Hi")).toBe(true);
  });

  it("read_page returns empty markdown when no contentDocId", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Empty",
      kind: "FreeForm",
      workspaceType: "Project",
      workspaceId: "p1",
      contentDocId: null,
      iconEmoji: null,
    });
    const out = await runReadPage("u1", { pageId: "pg1" });
    expect(out.markdown).toBe("");
    expect(collabDocToProseMirror).not.toHaveBeenCalled();
  });

  it("read_page 404s missing page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await expect(runReadPage("u1", { pageId: "x" })).rejects.toBeInstanceOf(ReadPageError);
  });

  it("create_page rejects a non-top-level parent", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "parent",
      parentPageId: "grandparent",
      workspaceType: "Project",
      workspaceId: "p1",
    });
    await expect(
      runCreatePage("u1", { projectId: "p1", title: "x", parentPageId: "parent" }),
    ).rejects.toBeInstanceOf(CreatePageError);
  });

  it("create_page creates a top-level page", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.page.findFirst.mockResolvedValue({ position: 3 });
    mockPrisma.page.create.mockResolvedValue({ id: "pg-new" });
    const out = await runCreatePage("u1", { projectId: "p1", title: "Plan" });
    expect(out).toMatchObject({ id: "pg-new", parentPageId: null, position: 4 });
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
