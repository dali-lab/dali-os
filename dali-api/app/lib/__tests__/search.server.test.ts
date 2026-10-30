import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
// Only reached by the hiring-application category, which these tests keep
// empty (no reviewer rows, not Core) — stubbed so the module loads without
// the real hiring stack.
vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "none" }),
}));
// Page-body search is raw SQL against tsvector/pg_trgm, which the Prisma mock
// can't stand in for — its own behavior is covered in doc-search.test.ts.
vi.mock("~/lib/doc-search.server", () => ({ searchPageContent: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  PAGE_ACCESS_SELECT: { id: true, accessMarker: true },
  getPageAccessBulk: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { searchPageContent } from "~/lib/doc-search.server";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { CATEGORY_RAW_TAKE, runCategorySearch, runSearch, runSearchWithOverflow } from "~/lib/search.server";
import type { UserRoles } from "~/lib/roles";

const mockPageContent = searchPageContent as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

// Plain lab member — no elevated flags, so only the ungated categories run.
const MEMBER: UserRoles = {
  isLabMember: true,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
};

const like = (q: string) => ({ contains: q, mode: "insensitive" });

beforeEach(() => {
  vi.clearAllMocks();
  // Categories not under test stay empty. Most models in the shared db mock
  // default findMany to []; user/cycleReviewer don't, so set them explicitly,
  // and re-pin the ones individual tests override.
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
  mockPrisma.project.findMany.mockResolvedValue([]);
  mockPageContent.mockResolvedValue([]);
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
  mockPrisma.pageDoc.findMany.mockResolvedValue([]);
});

describe("runSearch gating", () => {
  it("returns nothing for a non-member session without querying", async () => {
    const results = await runSearch({
      userId: "u1",
      roles: { ...MEMBER, isLabMember: false },
      q: "query",
    });
    expect(results).toEqual([]);
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });
});

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    firstName: "Ada",
    lastName: String.fromCharCode(65 + i),
    daliEmail: null,
    dartmouthEmail: null,
    photoUrl: null,
  }));
const projectRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Atlas ${String.fromCharCode(65 + i)}`, description: null }));

describe("runSearch default path", () => {
  it("keeps the 40-row candidate fetch with no orderBy and ranks at most 5 per category", async () => {
    mockPrisma.project.findMany.mockResolvedValue(projectRows(7));

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "atlas" });

    const args = mockPrisma.project.findMany.mock.calls[0][0];
    expect(args.take).toBe(40);
    expect(args.orderBy).toBeUndefined();
    expect(results.filter((r) => r.type === "project")).toHaveLength(5);
  });
});

describe("runSearchWithOverflow", () => {
  it("reports a category that had more than 5 and still returns 5 of it", async () => {
    mockPrisma.project.findMany.mockResolvedValue(projectRows(7));
    const found = await runSearchWithOverflow({ userId: "u1", roles: MEMBER, q: "atlas" });
    expect(found.results.filter((r) => r.type === "project")).toHaveLength(5);
    expect(found.categoriesWithMore).toEqual(["project"]);
    expect(mockPrisma.project.findMany.mock.calls.at(-1)?.[0].take).toBe(40);
  });

  it("does not flag a category with exactly 5", async () => {
    mockPrisma.project.findMany.mockResolvedValue(projectRows(5));
    const found = await runSearchWithOverflow({ userId: "u1", roles: MEMBER, q: "atlas" });
    expect(found.categoriesWithMore).toEqual([]);
  });

  it("returns nothing for a non-member", async () => {
    expect(await runSearchWithOverflow({ userId: "u1", roles: { ...MEMBER, isLabMember: false }, q: "atlas" })).toEqual({
      results: [],
      categoriesWithMore: [],
    });
  });
});

describe("runCategorySearch", () => {
  it("queries only that category, in id order, with the larger candidate bound", async () => {
    mockPrisma.user.findMany.mockResolvedValue(people(3));

    await runCategorySearch({ userId: "u1", roles: MEMBER, q: "ada", category: "person", skip: 0, limit: 5 });

    expect(mockPrisma.user.findMany.mock.calls[0][0]).toMatchObject({ take: CATEGORY_RAW_TAKE, orderBy: { id: "asc" } });
    expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  it("returns the window plus one extra row so the caller can tell there is more", async () => {
    mockPrisma.user.findMany.mockResolvedValue(people(7));

    const first = await runCategorySearch({ userId: "u1", roles: MEMBER, q: "ada", category: "person", skip: 0, limit: 5 });
    expect(first.map((r) => r.title)).toEqual(["Ada A", "Ada B", "Ada C", "Ada D", "Ada E", "Ada F"]);

    const second = await runCategorySearch({ userId: "u1", roles: MEMBER, q: "ada", category: "person", skip: 5, limit: 5 });
    expect(second.map((r) => r.title)).toEqual(["Ada F", "Ada G"]);
  });

  it("returns an empty window past the end", async () => {
    mockPrisma.user.findMany.mockResolvedValue(people(2));
    expect(await runCategorySearch({ userId: "u1", roles: MEMBER, q: "ada", category: "person", skip: 10, limit: 5 })).toEqual([]);
  });

  it("covers both document sources and keeps titles first across pages", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "d1", title: "Atlas notes", iconEmoji: null, kind: "FreeForm" }]);
    vi.mocked(getPageAccessBulk).mockResolvedValue(new Map([["d1", { canView: true }]]) as never);
    mockPrisma.projectFile.findMany.mockResolvedValue([
      { id: "f1", title: "Atlas plan", currentVersion: { fileName: "plan.pdf" }, project: { name: "Atlas" } },
    ]);

    const rows = await runCategorySearch({ userId: "u1", roles: MEMBER, q: "atlas", category: "document", skip: 0, limit: 5 });

    expect(rows.map((r) => r.id)).toEqual(["d1", "f1"]);
    expect(mockPrisma.projectFile.findMany.mock.calls[0][0]).toMatchObject({ take: CATEGORY_RAW_TAKE, orderBy: { id: "asc" } });
    expect(mockPageContent).toHaveBeenCalledWith("atlas", 18);
  });

  it("does not run a category the caller's roles gate out", async () => {
    const rows = await runCategorySearch({ userId: "u1", roles: MEMBER, q: "ada", category: "partner", skip: 0, limit: 5 });
    expect(rows).toEqual([]);
    expect(mockPrisma.partnerOrg.findMany).not.toHaveBeenCalled();
  });

  it("returns nothing for a non-member", async () => {
    const rows = await runCategorySearch({
      userId: "u1",
      roles: { ...MEMBER, isLabMember: false },
      q: "ada",
      category: "person",
      skip: 0,
      limit: 5,
    });
    expect(rows).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe("runSearch — projects", () => {
  it("matches on description as well as name, excluding Archived", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "p1", name: "Atlas", description: "A query engine for lab data" },
    ]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "Archived" },
          OR: [{ name: like("query") }, { description: like("query") }],
        },
      }),
    );
    // Name doesn't contain the query — the description match must still rank.
    expect(results).toContainEqual({
      type: "project",
      id: "p1",
      title: "Atlas",
      subtitle: "Project",
      url: "/projects/p1",
    });
  });
});

describe("runSearch — tasks", () => {
  it("returns board tasks deep-linked to the task modal on the project board", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Query builder",
        status: "InProgress",
        projectId: "p1",
        project: { name: "DALI OS" },
      },
    ]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    // Tasks of Archived projects are excluded, like project search itself;
    // auto-archived tasks are off the board so they're out here too.
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          title: like("query"),
          archivedAt: null,
          project: { status: { not: "Archived" } },
        },
      }),
    );
    expect(results).toContainEqual({
      type: "task",
      id: "t1",
      title: "Query builder",
      subtitle: "DALI OS · In progress",
      url: "/projects/p1?tab=board&task=t1",
    });
  });
});

describe("runSearch — project files", () => {
  it("matches title or current version filename, excluding archived files", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f1",
        title: "Pitch deck",
        currentVersion: { fileName: "query-pitch-final.pdf" },
        project: { name: "Atlas" },
      },
    ]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    expect(mockPrisma.projectFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          OR: [
            { title: like("query") },
            { currentVersion: { fileName: like("query") } },
          ],
        },
      }),
    );
    // Title doesn't match — the filename field must carry the ranking.
    expect(results).toContainEqual({
      type: "document",
      id: "f1",
      title: "Pitch deck",
      subtitle: "Atlas",
      url: "/documents/file/f1",
      fileCategory: "pdf",
    });
  });

  it.each([
    ["roster.xlsx", "office"],
    ["headshot.png", "image"],
    ["demo.mp4", "video"],
    ["bundle.zip", "archive"],
    ["mystery.bin", "other"],
  ])("classifies %s as %s from the uploaded filename", async (fileName, category) => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      { id: "f1", title: "Query file", currentVersion: { fileName }, project: { name: "Atlas" } },
    ]);

    const [file] = (await runSearch({ userId: "u1", roles: MEMBER, q: "query" })).filter(
      (r) => r.type === "document",
    );

    expect(file.fileCategory).toBe(category);
  });

  it("falls back to the title for a file with no current version", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      { id: "f1", title: "query-notes.pdf", currentVersion: null, project: null },
    ]);

    const [file] = (await runSearch({ userId: "u1", roles: MEMBER, q: "query" })).filter(
      (r) => r.type === "document",
    );

    expect(file.fileCategory).toBe("pdf");
  });
});


describe("runSearch — documents", () => {
  const hit = (id: string, title: string, snippet = "…matched sentence…", kind = "FreeForm") => ({
    pageId: id,
    title,
    iconEmoji: null,
    kind,
    snippet,
    fuzzy: false,
  });

  // Title pass and the content-hit access lookup share prisma.page.findMany;
  // the lookup is the only call filtering by id.
  const stubPages = (titleRows: Array<{ id: string; title: string; iconEmoji: string | null; kind?: string }>) =>
    mockPrisma.page.findMany.mockImplementation(async (args: any) =>
      args.where.id?.in ? args.where.id.in.map((id: string) => ({ id })) : titleRows,
    );
  const allow = (viewable: string[] | "all") =>
    vi.mocked(getPageAccessBulk).mockImplementation(
      async (_u, pages) =>
        new Map(
          pages.map((p) => [
            p.id,
            { canView: viewable === "all" || viewable.includes(p.id), canEdit: false, canComment: false },
          ]),
        ),
    );
  const docsOf = async (userId = "u1") =>
    (await runSearch({ userId, roles: MEMBER, q: "query" })).filter((r) => r.type === "document");

  beforeEach(() => {
    stubPages([]);
    allow("all");
  });

  it("surfaces a page whose body matches even though its title does not", async () => {
    stubPages([]);
    mockPageContent.mockResolvedValue([hit("pg1", "Week 3 notes", "the query engine rollout")]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    expect(results).toContainEqual({
      type: "document",
      id: "pg1",
      title: "Week 3 notes",
      // The matched sentence explains a result the title doesn't account for.
      subtitle: "the query engine rollout",
      url: "/documents/pg1",
      iconEmoji: null,
    });
  });

  it("ranks title matches above body matches", async () => {
    stubPages([
      { id: "pg-title", title: "Query runbook", iconEmoji: null },
    ]);
    mockPageContent.mockResolvedValue([hit("pg-body", "Unrelated title")]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });
    const docs = results.filter((r) => r.type === "document");

    expect(docs.map((d) => d.id)).toEqual(["pg-title", "pg-body"]);
  });

  it("does not list a page twice when its title and body both match", async () => {
    stubPages([
      { id: "pg1", title: "Query runbook", iconEmoji: null },
    ]);
    mockPageContent.mockResolvedValue([hit("pg1", "Query runbook")]);

    const docs = (await runSearch({ userId: "u1", roles: MEMBER, q: "query" })).filter(
      (r) => r.type === "document",
    );

    expect(docs).toHaveLength(1);
    // The title match wins, so the subtitle stays the plain type label.
    expect(docs[0].subtitle).toBe("Document");
  });

  it("caps the category even when both sources are full", async () => {
    stubPages(
      Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: `Query ${i}`, iconEmoji: null })),
    );
    mockPageContent.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => hit(`b${i}`, `Body ${i}`)),
    );

    const docs = (await runSearch({ userId: "u1", roles: MEMBER, q: "query" })).filter(
      (r) => r.type === "document",
    );

    expect(docs).toHaveLength(5);
    expect(docs.every((d) => d.id.startsWith("t"))).toBe(true);
  });

  it("falls back to the type label when a hit has no snippet", async () => {
    stubPages([]);
    mockPageContent.mockResolvedValue([hit("pg1", "Notes", "")]);

    const docs = (await runSearch({ userId: "u1", roles: MEMBER, q: "query" })).filter(
      (r) => r.type === "document",
    );

    expect(docs[0].subtitle).toBe("Document");
  });

  it("drops a member's personal note the viewer cannot open and keeps a viewable page", async () => {
    stubPages([
      { id: "note-private", title: "Query journal", iconEmoji: null },
      { id: "pg-open", title: "Query runbook", iconEmoji: null },
    ]);
    allow(["pg-open"]);

    expect((await docsOf()).map((d) => d.id)).toEqual(["pg-open"]);
  });

  it("hides a Core-folder doc from a non-Core viewer but keeps it for a Core viewer", async () => {
    stubPages([{ id: "core-doc", title: "Query budget", iconEmoji: null }]);
    vi.mocked(getPageAccessBulk).mockImplementation(
      async (userId, pages) =>
        new Map(pages.map((p) => [p.id, { canView: userId === "core-user", canEdit: false, canComment: false }])),
    );

    expect(await docsOf("plain-user")).toEqual([]);
    expect((await docsOf("core-user")).map((d) => d.id)).toEqual(["core-doc"]);
  });

  it("drops a body hit on a non-viewable page and keeps the snippet on a viewable one", async () => {
    mockPageContent.mockResolvedValue([hit("secret", "Private", "secret text"), hit("open", "Open", "open text")]);
    allow(["open"]);

    const docs = await docsOf();

    expect(docs).toEqual([expect.objectContaining({ id: "open", subtitle: "open text" })]);
  });

  it("selects the access fields and over-fetches the title query", async () => {
    await docsOf();

    const titleCall = mockPrisma.page.findMany.mock.calls
      .map((c) => c[0])
      .find((args) => args.where.title);
    expect(titleCall.select).toEqual({ id: true, accessMarker: true, title: true, iconEmoji: true, kind: true });
    expect(titleCall.take).toBe(120);
  });

  it("asks the content pass for 3x the cap, then caps the merged list with titles first", async () => {
    stubPages(Array.from({ length: 2 }, (_, i) => ({ id: `t${i}`, title: `Query ${i}`, iconEmoji: null })));
    mockPageContent.mockResolvedValue(Array.from({ length: 15 }, (_, i) => hit(`b${i}`, `Body ${i}`)));

    const docs = await docsOf();

    expect(mockPageContent).toHaveBeenCalledWith("query", 15);
    expect(docs.map((d) => d.id)).toEqual(["t0", "t1", "b0", "b1", "b2"]);
  });

  it.each(["Folder", "Whiteboard", "Notebook"])(
    "labels a %s title match by its kind instead of as a document",
    async (kind) => {
      stubPages([{ id: "pg1", title: "Query", iconEmoji: null, kind }]);

      const [doc] = await docsOf();

      expect(doc).toMatchObject({ id: "pg1", pageKind: kind, subtitle: kind });
    },
  );

  it.each(["FreeForm", "Structured"])("leaves a %s page as a plain document", async (kind) => {
    stubPages([{ id: "pg1", title: "Query", iconEmoji: null, kind }]);

    const [doc] = await docsOf();

    expect(doc.subtitle).toBe("Document");
    expect(doc).not.toHaveProperty("pageKind");
  });

  it("keeps a folder's custom emoji alongside its kind", async () => {
    stubPages([{ id: "pg1", title: "Query", iconEmoji: "📁", kind: "Folder" }]);

    const [doc] = await docsOf();

    expect(doc).toMatchObject({ iconEmoji: "📁", pageKind: "Folder" });
  });

  it("carries the kind on a body hit and labels it by kind when there is no snippet", async () => {
    mockPageContent.mockResolvedValue([
      hit("nb", "Standups", "", "Notebook"),
      hit("wb", "Sketch", "the query flow", "Whiteboard"),
    ]);

    const docs = await docsOf();

    expect(docs).toEqual([
      expect.objectContaining({ id: "nb", pageKind: "Notebook", subtitle: "Notebook" }),
      expect.objectContaining({ id: "wb", pageKind: "Whiteboard", subtitle: "the query flow" }),
    ]);
  });

  it("skips the content access lookup when the body pass finds nothing", async () => {
    await docsOf();

    expect(
      mockPrisma.page.findMany.mock.calls.some((c) => c[0].where.id?.in),
    ).toBe(false);
  });
});

describe("runSearch — guides", () => {
  it("surfaces a page guide by its declared title before anyone authors it", async () => {
    // No PageDoc row yet — the guide still ranks on its GUIDE_PAGES title,
    // deep-linked to the ?doc=1 overlay on its host route.
    mockPrisma.pageDoc.findMany.mockResolvedValue([]);

    const guides = (await runSearch({ userId: "u1", roles: MEMBER, q: "staffing" })).filter(
      (r) => r.type === "guide",
    );

    expect(guides).toContainEqual({
      type: "guide",
      id: "projects.staffing",
      title: "Staffing",
      subtitle: "Guide",
      url: "/projects/staffing?doc=1",
    });
  });

  it("indexes authored section titles and bodies, using the row's own title", async () => {
    mockPrisma.pageDoc.findMany.mockResolvedValue([
      {
        pageKey: "drive.mine",
        title: "My Drive",
        body: null,
        sections: [
          {
            id: "s1",
            title: "Overview",
            body: [{ type: "paragraph", content: [{ type: "text", text: "upload a spreadsheet here" }] }],
            videoKey: null,
          },
        ],
      },
    ]);

    // "spreadsheet" appears only in the section body — so body indexing is what
    // surfaces it — and the host route already carries ?scope=mine.
    const guides = (await runSearch({ userId: "u1", roles: MEMBER, q: "spreadsheet" })).filter(
      (r) => r.type === "guide",
    );

    expect(guides).toContainEqual({
      type: "guide",
      id: "drive.mine",
      title: "My Drive",
      subtitle: "Guide",
      url: "/drive?scope=mine&doc=1",
    });
  });

  it("does not run for a non-member session", async () => {
    const results = await runSearch({
      userId: "u1",
      roles: { ...MEMBER, isLabMember: false },
      q: "calendar",
    });
    expect(results).toEqual([]);
    expect(mockPrisma.pageDoc.findMany).not.toHaveBeenCalled();
  });
});

describe("runSearch — partner orgs and contacts", () => {
  it("does not query partner tables for a non-Core member", async () => {
    await runSearch({ userId: "u1", roles: MEMBER, q: "atlas" });

    expect(mockPrisma.partnerOrg.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.partnerContact.findMany).not.toHaveBeenCalled();
  });

  it("surfaces matching orgs and contacts to a Core viewer, deep-linked to the org/contact pages", async () => {
    mockPrisma.partnerOrg.findMany.mockResolvedValue([{ id: "org1", name: "Atlas Robotics" }]);
    mockPrisma.partnerContact.findMany.mockResolvedValue([
      { id: "ct1", name: "Atlas Jones", email: "atlas@example.com" },
    ]);

    const results = await runSearch({ userId: "u1", roles: { ...MEMBER, isCore: true }, q: "atlas" });

    expect(results).toContainEqual({
      type: "partner",
      id: "org1",
      title: "Atlas Robotics",
      subtitle: "Partner",
      url: "/core/partners/orgs/org1",
    });
    expect(results).toContainEqual({
      type: "partnerContact",
      id: "ct1",
      title: "Atlas Jones",
      subtitle: "atlas@example.com",
      url: "/core/partners/contacts/ct1",
    });
  });
});

describe("runSearch — help articles", () => {
  it("surfaces a /help article by title", async () => {
    const help = (await runSearch({ userId: "u1", roles: MEMBER, q: "shortcuts" })).filter(
      (r) => r.type === "helpArticle",
    );

    expect(help).toContainEqual({
      type: "helpArticle",
      id: "shortcuts",
      title: "Keyboard shortcuts",
      subtitle: "Help",
      url: "/help/shortcuts",
    });
  });

  it("matches on a keyword the title doesn't contain", async () => {
    // "MCP" is only a keyword of the AI-assistants article, not its title.
    const help = (await runSearch({ userId: "u1", roles: MEMBER, q: "mcp" })).filter(
      (r) => r.type === "helpArticle",
    );

    expect(help.map((r) => r.id)).toContain("mcp");
  });
});

describe("runSearch — forms", () => {
  const viewable = (ids: string[]) =>
    vi.mocked(getPageAccessBulk).mockImplementation(
      async (_u, pages) =>
        new Map(pages.map((p) => [p.id, { canView: ids.includes(p.id), canEdit: false, canComment: false }])),
    );

  it("returns the Form pages the viewer can view, without canViewForms", async () => {
    mockPrisma.page.findMany.mockImplementation(async (args: any) =>
      args.where.kind === "Form"
        ? [
            { id: "seen", title: "Intake form", iconEmoji: null },
            { id: "hidden", title: "Intake secret", iconEmoji: null },
          ]
        : [],
    );
    viewable(["seen"]);
    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "intake" });
    expect(results.filter((r) => r.type === "form")).toEqual([
      expect.objectContaining({ id: "seen", title: "Intake form", subtitle: "Form" }),
    ]);
    expect(mockPrisma.form.findMany).not.toHaveBeenCalled();
  });

  it("queries live Form pages by title only", async () => {
    await runSearch({ userId: "u1", roles: MEMBER, q: "intake" });
    const formQuery = mockPrisma.page.findMany.mock.calls.map((c) => c[0]).find((a: any) => a.where.kind === "Form");
    expect(formQuery.where).toEqual({ kind: "Form", archivedAt: null, title: like("intake") });
  });

  it("keeps Form pages out of the page-title search so a form is not listed twice or leaked", async () => {
    await runSearch({ userId: "u1", roles: MEMBER, q: "query" });
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archivedAt: null, kind: { not: "Form" }, title: like("query") },
      }),
    );
  });
});
