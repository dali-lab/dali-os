import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/projects/lib/sprints.server", () => ({ deleteEpic: vi.fn() }));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { deleteEpic } from "~/projects/lib/sprints.server";
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

  it("list_epics derives status, sprint span and progress from tasks", async () => {
    const sprint = (s: string, e: string) => ({ startsOn: new Date(s), endsOn: new Date(e) });
    mockPrisma.epic.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Onboarding",
        description: null,
        cancelledAt: null,
        stories: [],
        tasks: [
          { status: "Done", sprint: sprint("2026-09-23T00:00:00Z", "2026-09-29T00:00:00Z") },
          { status: "InProgress", sprint: sprint("2026-09-16T00:00:00Z", "2026-09-22T00:00:00Z") },
          { status: "Todo", sprint: null },
          { status: "Cancelled", sprint: null },
        ],
      },
      { id: "e2", title: "Later", description: null, cancelledAt: null, stories: [], tasks: [] },
    ]);
    const out = await runListEpics("u1", { projectId: "p1" });
    expect(out.epics[0]).toEqual({
      id: "e1",
      title: "Onboarding",
      description: null,
      status: "InProgress",
      startsOn: "2026-09-16T00:00:00.000Z",
      endsOn: "2026-09-29T00:00:00.000Z",
      tasks: { done: 1, total: 3 },
      stories: [],
    });
    expect(out.epics[1]).toMatchObject({ status: "NotStarted", startsOn: null, endsOn: null });
    const filtered = await runListEpics("u1", { projectId: "p1", status: ["NotStarted"] });
    expect(filtered.epics.map((e) => e.id)).toEqual(["e2"]);
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
        data: { projectId: "p1", title: "Build", description: null, position: 3 },
      }),
    );
  });

  it("update_epic clears description with empty string", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1", projectId: "p1", cancelledAt: null });
    mockPrisma.epic.update.mockResolvedValue({});
    await runUpdateEpic("u1", { epicId: "e1", description: "  " });
    expect(mockPrisma.epic.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { description: null },
    });
  });

  it("update_epic cancels and reopens, and no-ops when unchanged", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1", projectId: "p1", cancelledAt: null });
    mockPrisma.epic.update.mockResolvedValue({});
    await runUpdateEpic("u1", { epicId: "e1", cancelled: true });
    expect(mockPrisma.epic.update.mock.calls[0]![0].data.cancelledAt).toBeInstanceOf(Date);
    expect(await runUpdateEpic("u1", { epicId: "e1", cancelled: false })).toMatchObject({ noop: true });
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1", projectId: "p1", cancelledAt: new Date() });
    await runUpdateEpic("u1", { epicId: "e1", cancelled: false });
    expect(mockPrisma.epic.update.mock.calls[1]![0].data).toEqual({ cancelledAt: null });
  });

  it("delete_epic moves tasks to General via deleteEpic, refusing a busy General", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.epic.findUnique.mockResolvedValue({ id: "e1", projectId: "p1" });
    vi.mocked(deleteEpic).mockResolvedValueOnce("ok");
    expect(await runDeleteEpic("u1", { epicId: "e1" })).toEqual({ ok: true, epicId: "e1" });
    expect(deleteEpic).toHaveBeenCalledWith("e1", "p1");
    vi.mocked(deleteEpic).mockResolvedValueOnce("general-in-use");
    await expect(runDeleteEpic("u1", { epicId: "e1" })).rejects.toMatchObject({ status: 409 });
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
    mockPrisma.userStory.findUnique.mockResolvedValue({
      id: "us1",
      epic: { projectId: "p1" },
    });
    await expect(
      runUpdateStory("u1", { storyId: "us1", title: "  " }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("delete_story rejects callers without project edit access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.userStory.findUnique.mockResolvedValue({
      id: "us1",
      epic: { projectId: "p1" },
    });
    await expect(runDeleteStory("u1", { storyId: "us1" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("delete_story allows a non-Core project member (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.userStory.findUnique.mockResolvedValue({
      id: "us1",
      epic: { projectId: "p1" },
    });
    mockPrisma.userStory.delete.mockResolvedValue({});
    const out = await runDeleteStory("u1", { storyId: "us1" });
    expect(out).toEqual({ ok: true, storyId: "us1" });
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
  });
});
