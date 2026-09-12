// Tests for newly added fields on update_story (startsAt, endsAt, priority,
// successMetric, acceptanceCriteria, category, dependsOn).
// The existing epics-stories.test.ts covers the core contract; this file
// covers the new fields only.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    userStory: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    userStoryDependency: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  Prisma: {
    DbNull: Symbol.for("Prisma.DbNull"),
    JsonNull: Symbol.for("Prisma.JsonNull"),
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runUpdateStory, UPDATE_STORY_TOOL } from "~/mcp/tools/update-story";

const mockPrisma = prisma as unknown as {
  userStory: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  userStoryDependency: {
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const STORY = { id: "s1", epic: { projectId: "p1" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.userStory.findUnique.mockResolvedValue(STORY);
  // Default $transaction: execute the ops array
  mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  mockPrisma.userStory.update.mockResolvedValue({});
  mockPrisma.userStoryDependency.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.userStoryDependency.create.mockResolvedValue({});
});

describe("update_story schema additions", () => {
  it("new fields appear in inputSchema", () => {
    const props = UPDATE_STORY_TOOL.inputSchema.properties;
    expect(props).toHaveProperty("startsAt");
    expect(props).toHaveProperty("endsAt");
    expect(props).toHaveProperty("priority");
    expect(props).toHaveProperty("successMetric");
    expect(props).toHaveProperty("acceptanceCriteria");
    expect(props).toHaveProperty("category");
    expect(props).toHaveProperty("dependsOn");
  });

  it("sets priority to Must", async () => {
    await runUpdateStory("u1", { storyId: "s1", priority: "Must" });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: "Must" }) }),
    );
  });

  it("clears priority with empty string", async () => {
    await runUpdateStory("u1", { storyId: "s1", priority: "" });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: null }) }),
    );
  });

  it("rejects invalid priority", async () => {
    await expect(
      runUpdateStory("u1", { storyId: "s1", priority: "Blocker" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("sets startsAt from date-only string (UTC midnight)", async () => {
    await runUpdateStory("u1", { storyId: "s1", startsAt: "2026-10-01" });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startsAt: new Date("2026-10-01T00:00:00.000Z"),
        }),
      }),
    );
  });

  it("clears startsAt with empty string", async () => {
    await runUpdateStory("u1", { storyId: "s1", startsAt: "" });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startsAt: null }) }),
    );
  });

  it("rejects invalid startsAt", async () => {
    await expect(
      runUpdateStory("u1", { storyId: "s1", startsAt: "not-a-date" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("sets successMetric and acceptanceCriteria", async () => {
    await runUpdateStory("u1", {
      storyId: "s1",
      successMetric: "10% faster",
      acceptanceCriteria: "All tests pass",
    });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          successMetric: "10% faster",
          acceptanceCriteria: "All tests pass",
        }),
      }),
    );
  });

  it("clears successMetric with empty string", async () => {
    await runUpdateStory("u1", { storyId: "s1", successMetric: "" });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ successMetric: null }) }),
    );
  });

  it("sets category", async () => {
    await runUpdateStory("u1", { storyId: "s1", category: "auth" });
    expect(mockPrisma.userStory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "auth" }) }),
    );
  });

  it("replaces dependsOn (with duplicate dedup)", async () => {
    mockPrisma.userStory.count.mockResolvedValue(2);
    await runUpdateStory("u1", { storyId: "s1", dependsOn: ["s2", "s3", "s2"] });
    // $transaction should receive: deleteMany + 2 creates
    const ops: unknown[] = mockPrisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3); // deleteMany + 2 creates
    expect(mockPrisma.userStory.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["s2", "s3"] } }) }),
    );
  });

  it("clears all dependencies with empty array", async () => {
    await runUpdateStory("u1", { storyId: "s1", dependsOn: [] });
    const ops: unknown[] = mockPrisma.$transaction.mock.calls[0][0];
    // deleteMany only — no creates
    expect(ops).toHaveLength(1);
  });

  it("rejects a dependency target from another project", async () => {
    mockPrisma.userStory.count.mockResolvedValue(0); // 0 of 1 valid
    await expect(
      runUpdateStory("u1", { storyId: "s1", dependsOn: ["s-other"] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("self-dependency is silently removed from dependsOn", async () => {
    // Only "s1" in the list → after filter it's empty → skip count
    await runUpdateStory("u1", { storyId: "s1", dependsOn: ["s1"] });
    expect(mockPrisma.userStory.count).not.toHaveBeenCalled();
  });

  it("returns noop when nothing changes", async () => {
    const out = await runUpdateStory("u1", { storyId: "s1" });
    expect(out).toMatchObject({ noop: true });
  });
});
