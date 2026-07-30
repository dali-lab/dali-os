import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  resolveRoleRef: vi.fn(),
  currentTerm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { resolveRoleRef, currentTerm } from "~/lib/roles";
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
  hours: 2,
  assignmentType: "Project" as const,
  roleRefId: "pa-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveRoleRef).mockResolvedValue({ projectId: "proj-1" });
  vi.mocked(currentTerm).mockResolvedValue({ id: "term-1", code: "26X" } as never);
});

describe("add_time_entry confirmation gate", () => {
  it("previews instead of writing when confirmed is absent", async () => {
    const res = await runAddTimeEntry(ME, { ...VALID, note: "Fixed the importer" });
    expect(res.ok).toBe(false);
    expect((res as any).needsConfirmation).toBe(true);
    expect((res as any).preview).toMatchObject({
      action: "add",
      hours: 2,
      note: "Fixed the importer",
      projectId: "proj-1",
    });
    // The whole point of the gate.
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("writes once confirmed", async () => {
    mockPrisma.timeEntry.create.mockResolvedValue({ id: "te-1" });
    const res = await runAddTimeEntry(ME, { ...VALID, note: "n", confirmed: true });
    expect(res).toEqual({ ok: true, id: "te-1" });
    expect(mockPrisma.timeEntry.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.timeEntry.create.mock.calls[0][0].data).toMatchObject({
      userId: ME,
      source: "Manual",
      hours: 2,
      projectId: "proj-1",
    });
  });

  it("validates before previewing, so an approved preview is one that would succeed", async () => {
    vi.mocked(resolveRoleRef).mockResolvedValue(null);
    await expect(runAddTimeEntry(ME, VALID)).rejects.toThrow(TimeEntryInvalidError);
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
  });
});

describe("add_time_entry validation", () => {
  it("rejects a role that isn't the caller's", async () => {
    vi.mocked(resolveRoleRef).mockResolvedValue(null);
    await expect(
      runAddTimeEntry(ME, { ...VALID, confirmed: true }),
    ).rejects.toThrow(/not one of this member's roles/);
  });

  it("rejects non-positive hours", async () => {
    await expect(runAddTimeEntry(ME, { ...VALID, hours: 0 })).rejects.toThrow(
      /greater than 0/,
    );
  });

  it("rejects hours that disagree with the start/end span", async () => {
    // Reuses validateTimeEntryRange — an 8h claim on a 1h window.
    await expect(
      runAddTimeEntry(ME, {
        ...VALID,
        hours: 8,
        startTime: "2026-07-29T09:00:00.000Z",
        endTime: "2026-07-29T10:00:00.000Z",
      }),
    ).rejects.toThrow(/match the start\/end range/);
  });

  it("accepts hours matching the span", async () => {
    const res = await runAddTimeEntry(ME, {
      ...VALID,
      hours: 1,
      startTime: "2026-07-29T09:00:00.000Z",
      endTime: "2026-07-29T10:00:00.000Z",
    });
    expect((res as any).preview.hours).toBe(1);
  });

  it("rejects a malformed date", async () => {
    await expect(runAddTimeEntry(ME, { ...VALID, date: "29/07/2026" })).rejects.toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("declares confirmed in its schema but does not require it", () => {
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

  it("refuses an entry belonging to someone else", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ ...existing, userId: "someone-else" });
    await expect(runUpdateTimeEntry(ME, { id: "te-1" })).rejects.toThrow(TimeEntryNotFoundError);
  });

  it("refuses Meeting- and Block-sourced entries, which are owned elsewhere", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ ...existing, source: "Meeting" });
    await expect(runUpdateTimeEntry(ME, { id: "te-1", hours: 3 })).rejects.toThrow(
      /meeting attendance/,
    );
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ ...existing, source: "Block" });
    await expect(runUpdateTimeEntry(ME, { id: "te-1", hours: 3 })).rejects.toThrow(
      /calendar block/,
    );
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it("previews a before/after diff before writing", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    const res = await runUpdateTimeEntry(ME, { id: "te-1", hours: 3, note: "new" });
    expect(res.ok).toBe(false);
    expect((res as any).preview.before).toMatchObject({ hours: 2, note: "old" });
    expect((res as any).preview.after).toMatchObject({ hours: 3, note: "new" });
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it("writes once confirmed", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    const res = await runUpdateTimeEntry(ME, { id: "te-1", hours: 3, confirmed: true });
    expect(res).toEqual({ ok: true });
    expect(mockPrisma.timeEntry.update.mock.calls[0][0].data).toMatchObject({ hours: 3 });
  });

  it("clears the note on an empty string", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(existing);
    await runUpdateTimeEntry(ME, { id: "te-1", note: "", confirmed: true });
    expect(mockPrisma.timeEntry.update.mock.calls[0][0].data.note).toBeNull();
  });

  it("won't let a half-specified role clear the attribution", async () => {
    // Mirrors the calendar action: patching either half must land on a real role.
    mockPrisma.timeEntry.findUnique.mockResolvedValue({
      ...existing,
      assignmentType: null,
      roleRefId: null,
    });
    await expect(
      runUpdateTimeEntry(ME, { id: "te-1", assignmentType: "Core", confirmed: true }),
    ).rejects.toThrow(/complete role/);
  });
});

describe("delete_time_entry", () => {
  it("deletes a manual entry without a confirmation gate", async () => {
    // Recoverable and can't invent hours, so it isn't gated — but the id still
    // has to come from a list the user saw.
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ userId: ME, source: "Manual" });
    expect(await runDeleteTimeEntry(ME, { id: "te-1" })).toEqual({ ok: true });
    expect(mockPrisma.timeEntry.delete).toHaveBeenCalledWith({ where: { id: "te-1" } });
    expect(DELETE_TIME_ENTRY_TOOL.inputSchema.properties).not.toHaveProperty("confirmed");
  });

  it("refuses another member's entry", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ userId: "other", source: "Manual" });
    await expect(runDeleteTimeEntry(ME, { id: "te-1" })).rejects.toThrow(TimeEntryNotFoundError);
    expect(mockPrisma.timeEntry.delete).not.toHaveBeenCalled();
  });

  it("refuses a Block-sourced entry", async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ userId: ME, source: "Block" });
    await expect(runDeleteTimeEntry(ME, { id: "te-1" })).rejects.toThrow(/Block-sourced/);
  });
});

describe("list_my_time_entries", () => {
  it("scopes to the caller and flags which rows are editable", async () => {
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
        source: "Block",
        assignmentType: "Core",
        roleRefId: "ca-1",
        projectId: null,
        startTime: null,
        endTime: null,
      },
    ]);
    const { entries } = await runListMyTimeEntries(ME, {});
    expect(mockPrisma.timeEntry.findMany.mock.calls[0][0].where.userId).toBe(ME);
    expect(entries[0]).toMatchObject({ id: "a", date: "2026-07-29", editable: true });
    expect(entries[1]).toMatchObject({ id: "b", editable: false });
  });

  it("caps the limit", async () => {
    await runListMyTimeEntries(ME, { limit: 5000 });
    expect(mockPrisma.timeEntry.findMany.mock.calls[0][0].take).toBe(200);
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
          label: "Core — Education Lead",
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
