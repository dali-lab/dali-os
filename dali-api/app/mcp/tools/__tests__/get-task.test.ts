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
      comments: [],
      files: [],
    });
    const out = await runGetTask("u1", { taskId: "t1" });
    expect(out.github).toBeNull();
    expect(out.checklist).toEqual([]);
  });
});
