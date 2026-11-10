import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({
  resolveRoleRef: vi.fn(),
  currentTerm: vi.fn(),
  // Pure label helper — keep the real behaviour so the labels this file
  // asserts stay tied to the one definition in ~/lib/roles.
  coreRoleLabel: (leadTitle: string | null) => leadTitle || "Core",
}));
vi.mock("~/lib/time-entries.server", () => ({
  addTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { resolveRoleRef, currentTerm } from "~/lib/roles";
import { addTimeEntry, updateTimeEntry, deleteTimeEntry } from "~/lib/time-entries.server";
import {
  runAddTimeEntry,
  runUpdateTimeEntry,
  runDeleteTimeEntry,
  runListMyTimeEntries,
  runListMyRoles,
  ADD_TIME_ENTRY_TOOL,
  DELETE_TIME_ENTRY_TOOL,
  TimeEntryNotFoundError,
  TimeEntryInvalidError,
} from "~/mcp/tools/time-entries";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ME = "user-1";
const VALID = {
  date: "2026-07-29",
  hours: 1,
  assignmentType: "Project" as const,
  roleRefId: "pa-1",
  startTime: "2026-07-29T09:00:00-04:00",
  endTime: "2026-07-29T10:00:00-04:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveRoleRef).mockResolvedValue({ projectId: "proj-1" });
  vi.mocked(currentTerm).mockResolvedValue({ id: "term-1", code: "26X" } as never);
  vi.mocked(addTimeEntry).mockResolvedValue({ ok: true, entry: { id: "te-1" } } as never);
  vi.mocked(updateTimeEntry).mockResolvedValue({ ok: true, entry: { id: "te-1" } } as never);
  vi.mocked(deleteTimeEntry).mockResolvedValue({ ok: true, id: "te-1" });
});

describe("add_time_entry confirmation gate", () => {
  it("previews instead of writing when confirmed is absent", async () => {
    const res = await runAddTimeEntry(ME, { ...VALID, note: "Fixed the importer" });
    expect(res.ok).toBe(false);
    expect((res as any).needsConfirmation).toBe(true);
    expect((res as any).preview).toMatchObject({
      action: "add",
      hours: 1,
      note: "Fixed the importer",
      projectId: "proj-1",
      startTime: VALID.startTime,
      endTime: VALID.endTime,
    });
    expect(addTimeEntry).not.toHaveBeenCalled();
  });

  it("writes through the shared timesheet write once confirmed", async () => {
    const res = await runAddTimeEntry(ME, { ...VALID, note: "n", confirmed: true });
    expect(res).toEqual({ ok: true, id: "te-1" });
    expect(addTimeEntry).toHaveBeenCalledWith(ME, {
      date: "2026-07-29",
      hours: 1,
      assignmentType: "Project",
      roleRefId: "pa-1",
      note: "n",
      startTime: VALID.startTime,
      endTime: VALID.endTime,
    });
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("passes a missing note as null", async () => {
    await runAddTimeEntry(ME, { ...VALID, confirmed: true });
    expect(vi.mocked(addTimeEntry).mock.calls[0][1].note).toBeNull();
  });

  it("surfaces a rejection from the shared write as invalid input", async () => {
    vi.mocked(addTimeEntry).mockResolvedValue({ ok: false, error: "Invalid role", status: 400 });
    await expect(runAddTimeEntry(ME, { ...VALID, confirmed: true })).rejects.toThrow(
      new TimeEntryInvalidError("Invalid role"),
    );
  });

  it("validates before previewing, so an approved preview is one that would succeed", async () => {
    vi.mocked(resolveRoleRef).mockResolvedValue(null);
    await expect(runAddTimeEntry(ME, VALID)).rejects.toThrow(TimeEntryInvalidError);
    expect(addTimeEntry).not.toHaveBeenCalled();
  });
});

describe("add_time_entry validation", () => {
  it("rejects a role that isn't the caller's", async () => {
    vi.mocked(resolveRoleRef).mockResolvedValue(null);
    await expect(runAddTimeEntry(ME, { ...VALID, confirmed: true })).rejects.toThrow(
      /not one of this member's roles/,
    );
    expect(addTimeEntry).not.toHaveBeenCalled();
  });

  it("rejects non-positive hours", async () => {
    await expect(runAddTimeEntry(ME, { ...VALID, hours: 0 })).rejects.toThrow(/greater than 0/);
  });

  it("rejects hours that disagree with the start/end span", async () => {
    await expect(runAddTimeEntry(ME, { ...VALID, hours: 8 })).rejects.toThrow(
      /match the start\/end range/,
    );
  });

  it.each([
    ["startTime", { startTime: undefined }],
    ["endTime", { endTime: undefined }],
    ["both times", { startTime: undefined, endTime: undefined }],
  ])("rejects an entry missing %s, since payroll needs clock times", async (_label, patch) => {
    await expect(runAddTimeEntry(ME, { ...VALID, ...patch } as never)).rejects.toThrow(
      /startTime and endTime are required/,
    );
  });

  it("rejects an end before the start", async () => {
    await expect(
      runAddTimeEntry(ME, { ...VALID, startTime: VALID.endTime, endTime: VALID.startTime }),
    ).rejects.toThrow(/after start/);
  });

  it("rejects a malformed date", async () => {
    await expect(runAddTimeEntry(ME, { ...VALID, date: "29/07/2026" })).rejects.toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("requires start and end in its schema, and declares confirmed without requiring it", () => {
    expect(ADD_TIME_ENTRY_TOOL.inputSchema.required).toEqual(
      expect.arrayContaining(["startTime", "endTime"]),
    );
    expect(ADD_TIME_ENTRY_TOOL.inputSchema.properties).toHaveProperty("confirmed");
    expect(ADD_TIME_ENTRY_TOOL.inputSchema.required).not.toContain("confirmed");
    expect(ADD_TIME_ENTRY_TOOL.requiredScope).toBe("mcp:write");
  });
});

describe("update_time_entry", () => {
  const existing = {
    userId: ME,
    source: "Manual",
    date: new Date("2026-07-29T00:00:00.000Z"),
    hours: 2,
    note: "old",
    assignmentType: "Project",
    roleRefId: "pa-1",
    projectId: "proj-1",
    startTime: null,
    endTime: null,
  };
  const meetingEntry = {
    ...existing,
    source: "Meeting",
    hours: 1,
    note: null,
    assignmentType: null,
    roleRefId: null,
    projectId: null,
    startTime: new Date("2026-10-15T16:30:00.000Z"),
    endTime: new Date("2026-10-15T17:30:00.000Z"),
  };

  it("refuses an entry belonging to someone else", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ ...existing, userId: "someone-else" });
    await expect(runUpdateTimeEntry(ME, { id: "te-1" })).rejects.toThrow(TimeEntryNotFoundError);
    expect(updateTimeEntry).not.toHaveBeenCalled();
  });

  it("refuses an entry that doesn't exist", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(null);
    await expect(runUpdateTimeEntry(ME, { id: "te-1" })).rejects.toThrow(TimeEntryNotFoundError);
  });

  it("previews a before/after diff with the entry's source before writing", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    const res = await runUpdateTimeEntry(ME, { id: "te-1", hours: 3, note: "new" });
    expect(res.ok).toBe(false);
    expect((res as any).preview.source).toBe("Manual");
    expect((res as any).preview.before).toMatchObject({ hours: 2, note: "old" });
    expect((res as any).preview.after).toMatchObject({ hours: 3, note: "new" });
    expect(updateTimeEntry).not.toHaveBeenCalled();
  });

  it("writes only the patched fields through the shared timesheet write once confirmed", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    const res = await runUpdateTimeEntry(ME, { id: "te-1", hours: 3, confirmed: true });
    expect(res).toEqual({ ok: true });
    expect(updateTimeEntry).toHaveBeenCalledWith(ME, {
      id: "te-1",
      date: undefined,
      hours: 3,
      assignmentType: undefined,
      roleRefId: undefined,
      note: undefined,
      startTime: undefined,
      endTime: undefined,
    });
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it("clears the note on an empty string", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    await runUpdateTimeEntry(ME, { id: "te-1", note: "", confirmed: true });
    expect(vi.mocked(updateTimeEntry).mock.calls[0][1].note).toBeNull();
  });

  it("gives a Meeting entry a role and note", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(meetingEntry);
    vi.mocked(resolveRoleRef).mockResolvedValue({ projectId: null });
    const preview = await runUpdateTimeEntry(ME, {
      id: "te-m",
      assignmentType: "Core",
      roleRefId: "ca-1",
      note: "Core meeting, planned hiring.",
    });
    expect((preview as any).preview).toMatchObject({
      source: "Meeting",
      after: { assignmentType: "Core", roleRefId: "ca-1", note: "Core meeting, planned hiring." },
    });

    await runUpdateTimeEntry(ME, {
      id: "te-m",
      assignmentType: "Core",
      roleRefId: "ca-1",
      note: "Core meeting, planned hiring.",
      confirmed: true,
    });
    expect(updateTimeEntry).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({
        id: "te-m",
        assignmentType: "Core",
        roleRefId: "ca-1",
        note: "Core meeting, planned hiring.",
      }),
    );
  });

  it("moves a Meeting entry's time range", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(meetingEntry);
    await runUpdateTimeEntry(ME, {
      id: "te-m",
      startTime: "2026-10-15T13:05:00-04:00",
      endTime: "2026-10-15T13:30:00-04:00",
      hours: 0.42,
      confirmed: true,
    });
    expect(updateTimeEntry).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({
        startTime: "2026-10-15T13:05:00-04:00",
        endTime: "2026-10-15T13:30:00-04:00",
        hours: 0.42,
      }),
    );
  });

  it("rejects a time change whose stored hours no longer match", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(meetingEntry);
    await expect(
      runUpdateTimeEntry(ME, {
        id: "te-m",
        startTime: "2026-10-15T13:05:00-04:00",
        confirmed: true,
      }),
    ).rejects.toThrow(/match the start\/end range/);
    expect(updateTimeEntry).not.toHaveBeenCalled();
  });

  it("won't let a half-specified role clear the attribution", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({
      ...existing,
      assignmentType: null,
      roleRefId: null,
    });
    await expect(
      runUpdateTimeEntry(ME, { id: "te-1", assignmentType: "Core", confirmed: true }),
    ).rejects.toThrow(/complete role/);
    expect(updateTimeEntry).not.toHaveBeenCalled();
  });

  it("maps a not-found from the shared write to TimeEntryNotFoundError", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    vi.mocked(updateTimeEntry).mockResolvedValue({ ok: false, error: "Not found", status: 404 });
    await expect(runUpdateTimeEntry(ME, { id: "te-1", hours: 3, confirmed: true })).rejects.toThrow(
      TimeEntryNotFoundError,
    );
  });
});

describe("delete_time_entry", () => {
  it("deletes through the shared timesheet delete without a confirmation gate", async () => {
    expect(await runDeleteTimeEntry(ME, { id: "te-1" })).toEqual({ ok: true });
    expect(deleteTimeEntry).toHaveBeenCalledWith(ME, "te-1");
    expect(mockPrisma.timeEntry.delete).not.toHaveBeenCalled();
    expect(DELETE_TIME_ENTRY_TOOL.inputSchema.properties).not.toHaveProperty("confirmed");
  });

  it("refuses another member's entry", async () => {
    vi.mocked(deleteTimeEntry).mockResolvedValue({ ok: false, error: "Not found", status: 404 });
    await expect(runDeleteTimeEntry(ME, { id: "te-1" })).rejects.toThrow(TimeEntryNotFoundError);
  });
});

describe("list_my_time_entries", () => {
  it("scopes to the caller and marks Manual and Meeting rows editable", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      {
        id: "a",
        date: new Date("2026-07-29T00:00:00.000Z"),
        hours: 2,
        note: "n",
        source: "Manual",
        assignmentType: "Project",
        roleRefId: "pa-1",
        projectId: "proj-1",
        startTime: null,
        endTime: null,
      },
      {
        id: "b",
        date: new Date("2026-07-28T00:00:00.000Z"),
        hours: 1,
        note: null,
        source: "Meeting",
        assignmentType: "Core",
        roleRefId: "ca-1",
        projectId: null,
        startTime: null,
        endTime: null,
      },
    ]);
    const { entries } = await runListMyTimeEntries(ME, {});
    expect(mockPrisma.timeEntry.findMany.mock.calls[0][0].where.AND[0].userId).toBe(ME);
    expect(entries[0]).toMatchObject({ id: "a", date: "2026-07-29", source: "Manual", editable: true });
    expect(entries[1]).toMatchObject({ id: "b", source: "Meeting", editable: true });
  });

  it("caps the limit", async () => {
    await runListMyTimeEntries(ME, { limit: 5000 });
    expect(mockPrisma.timeEntry.findMany.mock.calls[0][0].take).toBe(201);
  });

  it("walks keyset pages on date, createdAt and id", async () => {
    const row = (id: string, day: string) => ({
      id,
      date: new Date(`${day}T00:00:00.000Z`),
      createdAt: new Date(`${day}T12:00:00.000Z`),
      hours: 1,
      note: null,
      source: "Manual",
      assignmentType: null,
      roleRefId: null,
      projectId: null,
      startTime: null,
      endTime: null,
    });
    mockPrisma.timeEntry.findMany.mockResolvedValueOnce([row("a", "2026-07-29"), row("b", "2026-07-29")]);
    const first = await runListMyTimeEntries(ME, { limit: 1 });
    expect(first.entries.map((e) => e.id)).toEqual(["a"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 1 });
    expect(first.page.nextCursor).toEqual(expect.any(String));

    mockPrisma.timeEntry.findMany.mockResolvedValueOnce([row("b", "2026-07-29")]);
    const second = await runListMyTimeEntries(ME, { limit: 1, cursor: first.page.nextCursor! });
    const args = mockPrisma.timeEntry.findMany.mock.calls[1][0];
    expect(args.orderBy).toEqual([{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
    expect(args.where.AND[1].OR).toHaveLength(3);
    expect(args.where.AND[0].userId).toBe(ME);
    expect(second.entries.map((e) => e.id)).toEqual(["b"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("rejects a bad cursor", async () => {
    await expect(runListMyTimeEntries(ME, { cursor: "nope" })).rejects.toThrow(/Invalid cursor/);
  });
});

describe("list_my_roles", () => {
  it("returns the ids needed to attribute time, labelled per role kind", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      {
        id: "pa-1",
        projectId: "proj-1",
        project: { name: "DALI OS" },
        domain: { displayName: "Fullstack Dev" },
        term: { code: "26X" },
      },
    ]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([
      { id: "ca-1", leadTitle: "Education Lead", term: { code: "26X" } },
    ]);
    mockPrisma.adminMembership.findMany.mockResolvedValue([{ id: "am-1" }]);

    const { roles } = await runListMyRoles(ME, {});
    expect(roles).toEqual(
      expect.arrayContaining([
        {
          assignmentType: "Project",
          roleRefId: "pa-1",
          label: "DALI OS — Fullstack Dev",
          termCode: "26X",
          projectId: "proj-1",
        },
        {
          assignmentType: "Core",
          roleRefId: "ca-1",
          label: "Education Lead",
          termCode: "26X",
          projectId: null,
        },
        { assignmentType: "Admin", roleRefId: "am-1", label: "Admin", termCode: null, projectId: null },
      ]),
    );
  });

  it("scopes to the current term unless allTerms is set", async () => {
    await runListMyRoles(ME, {});
    expect(mockPrisma.projectAssignment.findMany.mock.calls[0][0].where).toMatchObject({
      userId: ME,
      termId: "term-1",
    });

    vi.clearAllMocks();
    await runListMyRoles(ME, { allTerms: true });
    expect(mockPrisma.projectAssignment.findMany.mock.calls[0][0].where).toEqual({ userId: ME });
  });
});
