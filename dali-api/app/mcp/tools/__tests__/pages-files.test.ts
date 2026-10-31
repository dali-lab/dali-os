import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/collab/read", () => ({
  readDocAsBlocks: vi.fn(),
}));
vi.mock("~/collab/write", () => ({
  replaceCollabDocContent: vi.fn(),
}));
vi.mock("~/lib/collabAuth", () => ({
  authorizeCollabDoc: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { readDocAsBlocks } from "~/collab/read";
import { authorizeCollabDoc } from "~/lib/collabAuth";
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
  projectFile: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
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

  const pageRow = (id: string, parentPageId: string | null, position = 0) => ({
    id,
    parentPageId,
    title: id,
    kind: "FreeForm",
    iconEmoji: null,
    position,
    archivedAt: null,
  });

  it("list_project_pages renders every level up to MAX_PAGE_DEPTH", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", overviewPageId: null, prdPageId: null });
    mockPrisma.page.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => pageRow(`d${i}`, i === 0 ? null : `d${i - 1}`)),
    );
    const out = await runListProjectPages("u1", { projectId: "p1" });
    let node: any = out.pages[0];
    const seen = [node.id];
    while (node.children.length > 0) {
      node = node.children[0];
      seen.push(node.id);
    }
    expect(seen).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6"]);
  });

  it("list_project_pages pages top-level pages with their subtrees intact", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", overviewPageId: null, prdPageId: null });
    mockPrisma.page.findMany.mockResolvedValue([
      pageRow("r1", null, 0),
      pageRow("r2", null, 1),
      pageRow("r3", null, 2),
      pageRow("r1-c", "r1"),
    ]);
    const first = await runListProjectPages("u1", { projectId: "p1", limit: 2 });
    expect(first.pages.map((p) => p.id)).toEqual(["r1", "r2"]);
    expect(first.pages[0].children.map((c) => c.id)).toEqual(["r1-c"]);
    expect(first.page).toMatchObject({ hasMore: true, total: 3 });
    const second = await runListProjectPages("u1", { projectId: "p1", limit: 2, cursor: first.page.nextCursor! });
    expect(second.pages.map((p) => p.id)).toEqual(["r3"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
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
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Notes",
      kind: "FreeForm",
      workspaceType: "Project",
      workspaceId: "p1",
      contentDocId: null,
      iconEmoji: null,
    });
    vi.mocked(readDocAsBlocks).mockResolvedValue([
      {
        id: "b1",
        type: "heading",
        props: { backgroundColor: "default", textColor: "default", textAlignment: "left", level: 1 },
        content: [{ type: "text", text: "Hi", styles: {} }],
        children: [],
      },
    ]);
    const out = await runReadPage("u1", { pageId: "pg1" });
    // Authorization is keyed on the page's own doc room, not any contentDocId.
    expect(authorizeCollabDoc).toHaveBeenCalledWith("u1", "doc:pg1:body");
    expect(readDocAsBlocks).toHaveBeenCalledWith("doc:pg1:body");
    expect(out.markdown.startsWith("# Hi")).toBe(true);
  });

  it("read_page prefers contentDocId when set (seeded pages)", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Handbook",
      kind: "FreeForm",
      workspaceType: "Lab",
      workspaceId: null,
      contentDocId: "page:lab-handbook",
      iconEmoji: null,
    });
    vi.mocked(readDocAsBlocks).mockResolvedValue([]);
    const out = await runReadPage("u1", { pageId: "pg1" });
    expect(readDocAsBlocks).toHaveBeenCalledWith("page:lab-handbook");
    expect(out.markdown).toBe("");
  });

  it("read_page returns long markdown in chunks that join back to the whole page", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1", title: "Long", kind: "FreeForm", workspaceType: "Lab", workspaceId: null, contentDocId: null, iconEmoji: null,
    });
    const paragraph = (text: string) => ({ id: text, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
    vi.mocked(readDocAsBlocks).mockResolvedValue([paragraph("alpha bravo"), paragraph("charlie delta")] as never);

    const whole = await runReadPage("u1", { pageId: "pg1" });
    expect(whole.page).toEqual({ nextCursor: null, hasMore: false, limit: 50_000, total: whole.markdown.length });

    const first = await runReadPage("u1", { pageId: "pg1", limit: 10 });
    expect(first.markdown).toHaveLength(10);
    expect(first.page).toMatchObject({ hasMore: true, limit: 10, total: whole.markdown.length });

    let text = first.markdown;
    let cursor = first.page.nextCursor;
    while (cursor) {
      const next = await runReadPage("u1", { pageId: "pg1", limit: 10, cursor });
      text += next.markdown;
      cursor = next.page.nextCursor;
    }
    expect(text).toBe(whole.markdown);
  });

  it("read_page 404s missing page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await expect(runReadPage("u1", { pageId: "x" })).rejects.toBeInstanceOf(ReadPageError);
  });

  it("read_page denies callers not authorized on the page's workspace", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      title: "Secret",
      kind: "FreeForm",
      workspaceType: "EducationOffering",
      workspaceId: "off1",
      contentDocId: null,
      iconEmoji: null,
    });
    await expect(
      runReadPage("u1", { pageId: "pg1" }),
    ).rejects.toMatchObject({ name: "ReadPageError", status: 403 });
    expect(readDocAsBlocks).not.toHaveBeenCalled();
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
    // Markdown seeds convert to block JSON before the collab write.
    expect(replaceCollabDocContent).toHaveBeenCalledWith(
      "doc:pg-new:body",
      expect.arrayContaining([expect.objectContaining({ type: "heading" })]),
      "u1",
    );
  });

  it("set_page_content rejects folders and archived pages", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      kind: "Folder",
      workspaceType: "Project",
      workspaceId: "p1",
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
      workspaceId: "p1",
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
      workspaceId: "p1",
      contentDocId: null,
      archivedAt: null,
    });
    mockPrisma.page.update.mockResolvedValue({ id: "pg1" });
    const out = await runSetPageContent("u1", { pageId: "pg1", markdown: "# T\n\nbody" });
    expect(replaceCollabDocContent).toHaveBeenCalledWith(
      "doc:pg1:body",
      expect.arrayContaining([expect.objectContaining({ type: "heading" })]),
      "u1",
    );
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastEditedById: "u1" } }),
    );
    expect(out).toMatchObject({ id: "pg1", blockCount: 2 });
  });

  it("set_page_content denies callers who are neither Core nor staffed", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      kind: "FreeForm",
      workspaceType: "Project",
      workspaceId: "p1",
      contentDocId: null,
      archivedAt: null,
    });
    await expect(
      runSetPageContent("u1", { pageId: "pg1", markdown: "x" }),
    ).rejects.toMatchObject({ status: 403 });
    // set_page_content now gates via getPageAccess (covers Lab + note pages
    // too), which resolves project membership with an optional term arg.
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1", undefined);
  });

  it("set_page_content allows non-Core members staffed on the project (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "pg1",
      kind: "FreeForm",
      workspaceType: "Project",
      workspaceId: "p1",
      contentDocId: null,
      archivedAt: null,
    });
    mockPrisma.page.update.mockResolvedValue({ id: "pg1" });
    const out = await runSetPageContent("u1", { pageId: "pg1", markdown: "hello" });
    expect(out.id).toBe("pg1");
    expect(replaceCollabDocContent).toHaveBeenCalled();
  });

  it("create_page allows non-Core members staffed on the project (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.page.findFirst.mockResolvedValue(null);
    mockPrisma.page.create.mockResolvedValue({ id: "pg-new" });
    const out = await runCreatePage("u1", { projectId: "p1", title: "Member doc" });
    expect(out.id).toBe("pg-new");
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
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

  it("list_project_files pages by offset with an id tiebreak on updatedAt", async () => {
    const file = (id: string) => ({
      id,
      title: id,
      archivedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      currentVersion: null,
    });
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.projectFile.count = vi.fn().mockResolvedValue(3);
    mockPrisma.projectFile.findMany.mockResolvedValueOnce([file("f1"), file("f2")]);
    const first = await runListProjectFiles("u1", { projectId: "p1", limit: 1 });
    expect(first.files.map((f) => f.id)).toEqual(["f1"]);
    expect(first.page).toMatchObject({ hasMore: true, total: 3 });
    expect(mockPrisma.projectFile.findMany.mock.calls.at(-1)![0].orderBy).toEqual([
      { updatedAt: "desc" },
      { id: "asc" },
    ]);

    mockPrisma.projectFile.findMany.mockResolvedValueOnce([file("f2")]);
    const second = await runListProjectFiles("u1", { projectId: "p1", limit: 1, cursor: first.page.nextCursor! });
    expect(mockPrisma.projectFile.findMany.mock.calls.at(-1)![0]).toMatchObject({ skip: 1, take: 2 });
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("list_project_files rejects a bad cursor", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    await expect(runListProjectFiles("u1", { projectId: "p1", cursor: "nope" })).rejects.toThrow(/Invalid cursor/);
  });
});
