import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ resolveRoleRef: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/time-entry-sync", () => ({ syncManualBlockTimeEntry: vi.fn() }));

import { prisma } from "~/lib/db";
import { resolveRoleRef } from "~/lib/roles";
import { syncManualBlockTimeEntry } from "~/lib/time-entry-sync";
import {
  runAddManualBlock,
  runUpdateManualBlock,
  runDeleteManualBlock,
  runListMyManualBlocks,
  ManualBlockNotFoundError,
  ManualBlockInvalidError,
} from "~/mcp/tools/manual-blocks";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ME = "user-1";
const BASE = {
  title: "Focus block",
  startTime: "2026-07-29T09:00:00.000Z",
  endTime: "2026-07-29T11:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveRoleRef).mockResolvedValue({ projectId: "proj-1" });
  vi.mocked(syncManualBlockTimeEntry).mockResolvedValue({ ok: true });
  mockPrisma.manualBlock.create.mockResolvedValue({ id: "mb-1" });
});

describe("add_manual_block", () => {
  it("creates a plain block without any confirmation, since it logs no time", async () => {
    const res = await runAddManualBlock(ME, BASE);
    expect(res).toEqual({ ok: true, id: "mb-1", loggedHours: null });
    expect(mockPrisma.manualBlock.create.mock.calls[0][0].data).toMatchObject({
      userId: ME,
      isWork: false,
    });
    // Still synced — that's what clears any stale entry.
    expect(syncManualBlockTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ isWork: false }),
    );
  });

  it("previews a work block instead of writing it", async () => {
    const res = await runAddManualBlock(ME, {
      ...BASE,
      isWork: true,
      assignmentType: "Project",
      roleRefId: "pa-1",
    });
    expect(res.ok).toBe(false);
    expect((res as any).preview).toMatchObject({
      action: "add-work-block",
      hoursToLog: 2,
      assignmentType: "Project",
    });
    expect(mockPrisma.manualBlock.create).not.toHaveBeenCalled();
  });

  it("creates the work block and logs time once confirmed", async () => {
    const res = await runAddManualBlock(ME, {
      ...BASE,
      isWork: true,
      assignmentType: "Project",
      roleRefId: "pa-1",
      confirmed: true,
    });
    expect(res).toEqual({ ok: true, id: "mb-1", loggedHours: 2 });
    expect(syncManualBlockTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ manualBlockId: "mb-1", isWork: true, roleRefId: "pa-1" }),
    );
  });

  it("rejects an end at or before the start", async () => {
    await expect(
      runAddManualBlock(ME, { ...BASE, endTime: BASE.startTime }),
    ).rejects.toThrow(/after startTime/);
  });

  it("refuses to mark a recurring block as work", async () => {
    // TimeEntry has no recurrence expansion, so one row would stand in for all
    // occurrences — same rule the calendar action enforces.
    await expect(
      runAddManualBlock(ME, {
        ...BASE,
        isWork: true,
        assignmentType: "Project",
        roleRefId: "pa-1",
        recurrenceRule: "FREQ=WEEKLY",
        confirmed: true,
      }),
    ).rejects.toThrow(/Recurring blocks can't be marked as work/);
  });

  it("requires a complete role when isWork", async () => {
    await expect(
      runAddManualBlock(ME, { ...BASE, isWork: true, confirmed: true }),
    ).rejects.toThrow(/requires both assignmentType and roleRefId/);
  });

  it("rejects a role that isn't the caller's", async () => {
    vi.mocked(resolveRoleRef).mockResolvedValue(null);
    await expect(
      runAddManualBlock(ME, {
        ...BASE,
        isWork: true,
        assignmentType: "Project",
        roleRefId: "someone-elses",
        confirmed: true,
      }),
    ).rejects.toThrow(/not one of this member's roles/);
  });

  it("rolls the block back if the time-entry sync fails", async () => {
    // Otherwise a block would sit on the calendar claiming to be work while
    // having logged nothing.
    vi.mocked(syncManualBlockTimeEntry).mockResolvedValue({ ok: false, error: "bad role" });
    await expect(
      runAddManualBlock(ME, {
        ...BASE,
        isWork: true,
        assignmentType: "Project",
        roleRefId: "pa-1",
        confirmed: true,
      }),
    ).rejects.toThrow(ManualBlockInvalidError);
    expect(mockPrisma.manualBlock.delete).toHaveBeenCalledWith({ where: { id: "mb-1" } });
  });
});

describe("update_manual_block", () => {
  const existing = {
    id: "mb-1",
    userId: ME,
    title: "Focus block",
    startTime: new Date(BASE.startTime),
    endTime: new Date(BASE.endTime),
    allDay: false,
    recurrenceRule: null,
    isWork: false,
    assignmentType: null,
    roleRefId: null,
  };

  it("refuses another member's block", async () => {
    mockPrisma.manualBlock.findUnique.mockResolvedValue({ ...existing, userId: "other" });
    await expect(runUpdateManualBlock(ME, { id: "mb-1", title: "x" })).rejects.toThrow(
      ManualBlockNotFoundError,
    );
  });

  it("writes a non-work edit straight through", async () => {
    mockPrisma.manualBlock.findUnique.mockResolvedValue(existing);
    const res = await runUpdateManualBlock(ME, { id: "mb-1", title: "Renamed" });
    expect(res).toEqual({ ok: true, loggedHours: null });
    expect(mockPrisma.manualBlock.update.mock.calls[0][0].data.title).toBe("Renamed");
  });

  it("confirms before turning a block into work", async () => {
    mockPrisma.manualBlock.findUnique.mockResolvedValue(existing);
    const res = await runUpdateManualBlock(ME, {
      id: "mb-1",
      isWork: true,
      assignmentType: "Project",
      roleRefId: "pa-1",
    });
    expect(res.ok).toBe(false);
    expect((res as any).preview.before.isWork).toBe(false);
    expect((res as any).preview.after.hoursToLog).toBe(2);
    expect(mockPrisma.manualBlock.update).not.toHaveBeenCalled();
  });

  it("confirms a times-only edit to an existing work block", async () => {
    // This silently changes how many hours are on the timesheet, so it gates
    // even though isWork itself isn't being touched.
    mockPrisma.manualBlock.findUnique.mockResolvedValue({
      ...existing,
      isWork: true,
      assignmentType: "Project",
      roleRefId: "pa-1",
    });
    const res = await runUpdateManualBlock(ME, {
      id: "mb-1",
      endTime: "2026-07-29T17:00:00.000Z",
    });
    expect(res.ok).toBe(false);
    expect((res as any).preview.after.hoursToLog).toBe(8);
  });

  it("removes the logged time when work is turned off, no confirmation needed", async () => {
    mockPrisma.manualBlock.findUnique.mockResolvedValue({
      ...existing,
      isWork: true,
      assignmentType: "Project",
      roleRefId: "pa-1",
    });
    const res = await runUpdateManualBlock(ME, { id: "mb-1", isWork: false });
    expect(res).toEqual({ ok: true, loggedHours: null });
    expect(syncManualBlockTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ isWork: false }),
    );
  });

  it("clears recurrence on an empty string", async () => {
    mockPrisma.manualBlock.findUnique.mockResolvedValue({
      ...existing,
      recurrenceRule: "FREQ=WEEKLY",
    });
    await runUpdateManualBlock(ME, { id: "mb-1", recurrenceRule: "" });
    expect(mockPrisma.manualBlock.update.mock.calls[0][0].data.recurrenceRule).toBeNull();
  });
});

describe("delete_manual_block", () => {
  it("removes the linked time entry before the block", async () => {
    // TimeEntry.manualBlockId restricts by default, so the block delete would
    // fail if the entry were left in place.
    mockPrisma.manualBlock.findUnique.mockResolvedValue({ userId: ME, isWork: true });
    mockPrisma.timeEntry.deleteMany.mockResolvedValue({ count: 1 });
    const res = await runDeleteManualBlock(ME, { id: "mb-1" });
    expect(res).toEqual({ ok: true, removedTimeEntry: true });
    expect(mockPrisma.timeEntry.deleteMany).toHaveBeenCalledWith({
      where: { manualBlockId: "mb-1", userId: ME },
    });
    expect(mockPrisma.manualBlock.delete).toHaveBeenCalled();
  });

  it("refuses another member's block", async () => {
    mockPrisma.manualBlock.findUnique.mockResolvedValue({ userId: "other", isWork: false });
    await expect(runDeleteManualBlock(ME, { id: "mb-1" })).rejects.toThrow(
      ManualBlockNotFoundError,
    );
    expect(mockPrisma.manualBlock.delete).not.toHaveBeenCalled();
  });
});

describe("list_my_manual_blocks", () => {
  it("scopes to the caller and reports hours logged via each block", async () => {
    mockPrisma.manualBlock.findMany.mockResolvedValue([
      {
        id: "mb-1",
        title: "Focus",
        startTime: new Date(BASE.startTime),
        endTime: new Date(BASE.endTime),
        allDay: false,
        recurrenceRule: null,
        isWork: true,
        assignmentType: "Project",
        roleRefId: "pa-1",
        timeEntries: [{ hours: 2 }],
      },
    ]);
    const { blocks } = await runListMyManualBlocks(ME, {});
    expect(mockPrisma.manualBlock.findMany.mock.calls[0][0].where.userId).toBe(ME);
    expect(blocks[0]).toMatchObject({ id: "mb-1", isWork: true, loggedHours: 2 });
  });

  it("rejects malformed bounds", async () => {
    await expect(runListMyManualBlocks(ME, { from: "nonsense" })).rejects.toThrow(
      /ISO datetimes/,
    );
  });
});
