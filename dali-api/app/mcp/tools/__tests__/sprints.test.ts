import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runListSprints, LIST_SPRINTS_TOOL } from "~/mcp/tools/list-sprints";
import {
  runCreateSprint,
  CREATE_SPRINT_TOOL,
  CreateSprintError,
} from "~/mcp/tools/create-sprint";
import {
  runUpdateSprint,
  UPDATE_SPRINT_TOOL,
  UpdateSprintError,
} from "~/mcp/tools/update-sprint";
import {
  runSetSprintStatus,
  SET_SPRINT_STATUS_TOOL,
} from "~/mcp/tools/set-sprint-status";
import {
  runDeleteSprint,
  DELETE_SPRINT_TOOL,
} from "~/mcp/tools/delete-sprint";

const mockPrisma = prisma as unknown as {
  sprint: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  project: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("sprint tools", () => {
  it("each tool advertises the right scope", () => {
    expect(LIST_SPRINTS_TOOL.requiredScope).toBe("mcp:read");
    expect(CREATE_SPRINT_TOOL.requiredScope).toBe("mcp:write");
    expect(UPDATE_SPRINT_TOOL.requiredScope).toBe("mcp:write");
    expect(SET_SPRINT_STATUS_TOOL.requiredScope).toBe("mcp:write");
    expect(DELETE_SPRINT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("list_sprints serializes dates", async () => {
    mockPrisma.sprint.findMany.mockResolvedValue([
      {
        id: "s1",
        name: "Sprint 1",
        status: "Active",
        startsAt: new Date("2026-06-01T00:00:00Z"),
        endsAt: new Date("2026-06-14T00:00:00Z"),
        epicId: null,
        epic: null,
      },
    ]);
    const out = await runListSprints("u1", { projectId: "p1" });
    expect(out.sprints[0]).toMatchObject({
      id: "s1",
      startsAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("create_sprint rejects non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runCreateSprint("u1", {
        projectId: "p1",
        name: "x",
        startsAt: "2026-06-01",
        endsAt: "2026-06-14",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("create_sprint rejects backwards dates", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runCreateSprint("u1", {
        projectId: "p1",
        name: "x",
        startsAt: "2026-06-14",
        endsAt: "2026-06-01",
      }),
    ).rejects.toBeInstanceOf(CreateSprintError);
  });

  it("create_sprint creates with Planned default", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.sprint.create.mockResolvedValue({ id: "s-new" });
    const out = await runCreateSprint("u1", {
      projectId: "p1",
      name: "Sprint A",
      startsAt: "2026-06-01T00:00:00Z",
      endsAt: "2026-06-14T00:00:00Z",
    });
    expect(out).toEqual({ id: "s-new" });
    expect(mockPrisma.sprint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "Planned", epicId: null }),
      }),
    );
  });

  it("update_sprint validates resulting date range", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.sprint.findUnique.mockResolvedValue({
      id: "s1",
      startsAt: new Date("2026-06-01"),
      endsAt: new Date("2026-06-14"),
    });
    await expect(
      runUpdateSprint("u1", { sprintId: "s1", endsAt: "2026-05-30" }),
    ).rejects.toBeInstanceOf(UpdateSprintError);
  });

  it("set_sprint_status returns prev/new", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.sprint.findUnique.mockResolvedValue({ id: "s1", status: "Planned" });
    mockPrisma.sprint.update.mockResolvedValue({});
    const out = await runSetSprintStatus("u1", { sprintId: "s1", status: "Active" });
    expect(out).toMatchObject({ previousStatus: "Planned", newStatus: "Active" });
  });

  it("delete_sprint nulls tasks then deletes", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.sprint.findUnique.mockResolvedValue({ id: "s1" });
    mockPrisma.$transaction.mockResolvedValue([]);
    const out = await runDeleteSprint("u1", { sprintId: "s1" });
    expect(out).toEqual({ ok: true, sprintId: "s1" });
  });
});
