import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runGetTask, GET_TASK_TOOL, GetTaskError } from "~/mcp/tools/get-task";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("get_task", () => {
  it("scope is read", () => {
    expect(GET_TASK_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns full detail incl. description, checklist, comments", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "MCP sync tools",
      description: "Add page-content tools",
      status: "Todo",
      priority: "High",
      dueAt: null,
      archivedAt: null,
      checklist: [{ text: "write it", done: false }],
      githubRepo: "dali-lab/dali-os",
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/dali-lab/dali-os/issues/42",
      createdAt: new Date("2026-07-20T00:00:00Z"),
      updatedAt: new Date("2026-07-20T01:00:00Z"),
      project: { id: "p1", name: "DALI OS" },
      sprint: null,
      epic: null,
      domain: { name: "Fullstack Dev" },
      createdBy: { id: "u1", firstName: "Kiran", lastName: "Jones" },
      assignees: [{ user: { id: "u1", firstName: "Kiran", lastName: "Jones" } }],
      _count: { comments: 1 },
      comments: [
        {
          id: "c1",
          body: "on it",
          createdAt: new Date("2026-07-20T00:30:00Z"),
          author: { id: "u1", firstName: "Kiran", lastName: "Jones" },
        },
      ],
      files: [{ file: { id: "f1", title: "Spec" } }],
    });

    const out = await runGetTask("u1", { taskId: "t1" });
    expect(out).toMatchObject({
      id: "t1",
      description: "Add page-content tools",
      checklist: [{ text: "write it", done: false }],
      domainName: "Fullstack Dev",
      assignees: [{ id: "u1", name: "Kiran Jones" }],
      commentCount: 1,
      commentsPage: { hasMore: false, nextCursor: null, limit: 50, total: 1 },
      comments: [{ id: "c1", body: "on it", author: { name: "Kiran Jones" } }],
      github: { repo: "dali-lab/dali-os", issueNumber: 42 },
      linkedFiles: [{ id: "f1", title: "Spec" }],
    });
  });

  it("404s a missing task", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(runGetTask("u1", { taskId: "nope" })).rejects.toBeInstanceOf(GetTaskError);
  });

  it("null github triple maps to null", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "x",
      description: null,
      status: "Todo",
      priority: "Normal",
      dueAt: null,
      archivedAt: null,
      checklist: null,
      githubRepo: null,
      githubIssueNumber: null,
      githubIssueUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { id: "p1", name: "P" },
      sprint: null,
      epic: null,
      domain: null,
      createdBy: { id: "u1", firstName: "A", lastName: "B" },
      assignees: [],
      _count: { comments: 0 },
      comments: [],
      files: [],
    });
    const out = await runGetTask("u1", { taskId: "t1" });
    expect(out.github).toBeNull();
    expect(out.checklist).toEqual([]);
  });

  describe("comment paging", () => {
    const comment = (id: string, minute: number) => ({
      id,
      body: id,
      createdAt: new Date(Date.UTC(2026, 6, 20, 0, minute)),
      author: { id: "u1", firstName: "Ada", lastName: "Lovelace" },
    });
    const task = (comments: ReturnType<typeof comment>[], count: number) => ({
      id: "t1",
      title: "x",
      description: null,
      status: "Todo",
      priority: "Normal",
      dueAt: null,
      archivedAt: null,
      checklist: null,
      githubRepo: null,
      githubIssueNumber: null,
      githubIssueUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { id: "p1", name: "P" },
      epic: null,
      domain: null,
      createdBy: { id: "u1", firstName: "Ada", lastName: "Lovelace" },
      assignees: [],
      _count: { comments: count },
      comments,
      files: [],
    });

    it("returns the newest page in chronological order and a cursor to older ones", async () => {
      mockPrisma.task.findUnique.mockResolvedValueOnce(
        task([comment("c3", 3), comment("c2", 2), comment("c1", 1)], 3),
      );
      const first = await runGetTask("u1", { taskId: "t1", limit: 2 });
      const args = mockPrisma.task.findUnique.mock.calls[0][0];
      expect(args.select.comments).toMatchObject({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 3,
      });
      expect(first.comments.map((c) => c.id)).toEqual(["c2", "c3"]);
      expect(first.commentCount).toBe(3);
      expect(first.commentsPage).toMatchObject({ hasMore: true, limit: 2, total: 3 });

      mockPrisma.task.findUnique.mockResolvedValueOnce(task([comment("c1", 1)], 3));
      const second = await runGetTask("u1", {
        taskId: "t1",
        limit: 2,
        cursor: first.commentsPage.nextCursor!,
      });
      const where = mockPrisma.task.findUnique.mock.calls[1][0].select.comments.where;
      expect(where.OR).toHaveLength(2);
      expect(second.comments.map((c) => c.id)).toEqual(["c1"]);
      expect(second.commentsPage).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it("rejects a bad cursor", async () => {
      await expect(runGetTask("u1", { taskId: "t1", cursor: "nope" })).rejects.toThrow(/Invalid cursor/);
    });
  });
});
