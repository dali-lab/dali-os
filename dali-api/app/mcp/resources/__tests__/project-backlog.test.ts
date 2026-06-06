import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  matchProjectBacklogUri,
  readProjectBacklogResource,
  ProjectBacklogNotFoundError,
  PROJECT_BACKLOG_RESOURCE,
} from "~/mcp/resources/project-backlog";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("project-backlog resource", () => {
  it("template + scope are right", () => {
    expect(PROJECT_BACKLOG_RESOURCE.uriTemplate).toBe("dali://projects/{projectId}/backlog");
    expect(PROJECT_BACKLOG_RESOURCE.requiredScope).toBe("mcp:read");
  });

  it("matches concrete URIs", () => {
    expect(matchProjectBacklogUri("dali://projects/p1/backlog")).toEqual({ projectId: "p1" });
    expect(matchProjectBacklogUri("dali://projects/p1/board")).toBeNull();
  });

  it("404s when project is missing", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(readProjectBacklogResource("x")).rejects.toBeInstanceOf(
      ProjectBacklogNotFoundError,
    );
  });

  it("serializes backlog tasks", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", name: "Alpha" });
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Wire onboarding",
        status: "Todo",
        priority: "High",
        epicId: "e1",
        epic: { title: "Onboarding" },
        dueAt: null,
        assignees: [{ user: { id: "u1", firstName: "A", lastName: "B" } }],
      },
    ]);
    const text = await readProjectBacklogResource("p1");
    const data = JSON.parse(text);
    expect(data.tasks[0]).toMatchObject({
      id: "t1",
      epicTitle: "Onboarding",
      assignees: [{ id: "u1", name: "A B" }],
    });
  });
});
