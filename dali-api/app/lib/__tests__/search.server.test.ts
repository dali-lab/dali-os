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

import { prisma } from "~/lib/db";
import { searchPageContent } from "~/lib/doc-search.server";
import { runSearch } from "~/lib/search.server";
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
      type: "project",
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
    });
  });
});


describe("runSearch — documents", () => {
  const hit = (id: string, title: string, snippet = "…matched sentence…") => ({
    pageId: id,
    title,
    iconEmoji: null,
    snippet,
    fuzzy: false,
  });

  it("surfaces a page whose body matches even though its title does not", async () => {
    mockPrisma.page.findMany.mockResolvedValue([]);
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
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "pg-title", title: "Query runbook", iconEmoji: null },
    ]);
    mockPageContent.mockResolvedValue([hit("pg-body", "Unrelated title")]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });
    const docs = results.filter((r) => r.type === "document");

    expect(docs.map((d) => d.id)).toEqual(["pg-title", "pg-body"]);
  });

  it("does not list a page twice when its title and body both match", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
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
    mockPrisma.page.findMany.mockResolvedValue(
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
    mockPrisma.page.findMany.mockResolvedValue([]);
    mockPageContent.mockResolvedValue([hit("pg1", "Notes", "")]);

    const docs = (await runSearch({ userId: "u1", roles: MEMBER, q: "query" })).filter(
      (r) => r.type === "document",
    );

    expect(docs[0].subtitle).toBe("Document");
  });
});
