import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(async () => null) }));

import { prisma } from "~/lib/db.server";
import { listMyProjects } from "../my-projects.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const project = (id: string, imageUrl: string | null) => ({ id, name: id, status: "Active", imageUrl, projectTerms: [] });

beforeEach(() => {
  vi.clearAllMocks();
  db.projectAssignment.findMany.mockResolvedValue([
    { projectId: "a", termId: "t", level: "P1", term: { code: "26F" }, domain: { displayName: "Dev" } },
    { projectId: "b", termId: "t", level: "P1", term: { code: "26F" }, domain: { displayName: "Dev" } },
    { projectId: "c", termId: "t", level: "P1", term: { code: "26F" }, domain: { displayName: "Dev" } },
  ]);
  db.task.groupBy.mockResolvedValue([]);
});

describe("listMyProjects imageUrl", () => {
  it("returns null for a pattern cover and leaves other values as they were", async () => {
    db.project.findMany.mockResolvedValue([
      project("a", "pattern:poster?c=plum"),
      project("b", "uploads/b.webp"),
      project("c", null),
    ]);
    const { projects } = await listMyProjects("u1", {});
    const byId = Object.fromEntries(projects.map((p) => [p.id, p.imageUrl]));
    expect(byId).toEqual({ a: null, b: "uploads/b.webp", c: null });
    expect("imageUrl" in projects[0]!).toBe(true);
  });
});
