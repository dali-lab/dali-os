import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runListEpics, LIST_EPICS_TOOL } from "~/mcp/tools/list-epics";
import {
  runCreateEpic,
  CREATE_EPIC_TOOL,
  CreateEpicError,
} from "~/mcp/tools/create-epic";
import { runUpdateEpic, UPDATE_EPIC_TOOL } from "~/mcp/tools/update-epic";
import { runDeleteEpic, DELETE_EPIC_TOOL } from "~/mcp/tools/delete-epic";
import { runCreateStory, CREATE_STORY_TOOL } from "~/mcp/tools/create-story";
import { runUpdateStory, UPDATE_STORY_TOOL } from "~/mcp/tools/update-story";
import { runDeleteStory, DELETE_STORY_TOOL } from "~/mcp/tools/delete-story";

const mockPrisma = prisma as unknown as {
  epic: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  userStory: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  project: { findUnique: ReturnType<typeof vi.fn> };
  term: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("epic + story tools", () => {
  it("scopes are right", () => {
    expect(LIST_EPICS_TOOL.requiredScope).toBe("mcp:read");
    expect(CREATE_EPIC_TOOL.requiredScope).toBe("mcp:write");
    expect(UPDATE_EPIC_TOOL.requiredScope).toBe("mcp:write");
    expect(DELETE_EPIC_TOOL.requiredScope).toBe("mcp:write");
    expect(CREATE_STORY_TOOL.requiredScope).toBe("mcp:write");
    expect(UPDATE_STORY_TOOL.requiredScope).toBe("mcp:write");
    expect(DELETE_STORY_TOOL.requiredScope).toBe("mcp:write");
  });

  it("list_epics resolves term code via separate query", async () => {
    mockPrisma.epic.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Onboarding",
        description: null,
        status: "Open",
        startsAt: null,
        endsAt: null,
        targetTermId: "tm1",
        stories: [],
      },
    ]);
    if (!mockPrisma.term) (mockPrisma as { term?: unknown }).term = {};
    (prisma as unknown as { term: { findMany: ReturnType<typeof vi.fn> } }).term = {
      findMany: vi.fn().mockResolvedValue([{ id: "tm1", code: "26S" }]),
    };
    const out = await runListEpics("u1", { projectId: "p1" });
    expect(out.epics[0]).toMatchObject({ id: "e1", targetTermCode: "26S" });
  });

  it("create_epic enforces title and date order", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runCreateEpic("u1", { projectId: "p1", title: "x", startsAt: "2026-06-14", endsAt: "2026-06-01" }),
    ).rejects.toBeInstanceOf(CreateEpicError);
  });

  it("create_epic creates with defaults", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.epic.findFirst.mockResolvedValue({ position: 2 });
    mockPrisma.epic.create.mockResolvedValue({ id: "e-new" });
    const out = await runCreateEpic("u1", { projectId: "p1", title: "Build" });
    expect(out).toEqual({ id: "e-new" });
    expect(mockPrisma.epic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 3, status: "Open", description: null }),
      }),
    );
  });

  it("update_epic clears description with empty string", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1", startsAt: null, endsAt: null });
    mockPrisma.epic.update.mockResolvedValue({});
    await runUpdateEpic("u1", { epicId: "e1", description: "  " });
    expect(mockPrisma.epic.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { description: null },
    });
  });

  it("delete_epic nulls sprint/task epicId and removes stories", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1" });
    mockPrisma.$transaction.mockResolvedValue([]);
    const out = await runDeleteEpic("u1", { epicId: "e1" });
    expect(out).toEqual({ ok: true, epicId: "e1" });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("create_story appends position 0 when first", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1" });
    mockPrisma.userStory.findFirst.mockResolvedValue(null);
    mockPrisma.userStory.create.mockResolvedValue({ id: "us1" });
    const out = await runCreateStory("u1", { epicId: "e1", title: "Story" });
    expect(out).toEqual({ id: "us1" });
    expect(mockPrisma.userStory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 0, status: "Todo", notes: null }),
      }),
    );
  });

  it("update_story rejects empty title", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.userStory.findUnique.mockResolvedValue({ id: "us1" });
    await expect(
      runUpdateStory("u1", { storyId: "us1", title: "  " }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("delete_story is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runDeleteStory("u1", { storyId: "us1" })).rejects.toMatchObject({
      status: 403,
    });
  });
});
