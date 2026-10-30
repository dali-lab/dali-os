// MCP timesheet tools. Writes go to TimeEntry (what the Timesheet tab renders),
// never TimesheetEntry, which mirrors Dartmouth payroll exports.
//
// Writes go through ~/lib/time-entries.server, the same functions the Calendar
// route and the mobile app use, so the Google Timesheet mirror and the
// cross-machine calendar marker stay in step with every surface.
//
// `add` and `update` are gated on `confirmed: true` server-side: an agent
// logging payroll-adjacent hours must show the user the preview first.

import { prisma } from "~/lib/db.server";
import { resolveRoleRef, currentTerm, coreRoleLabel } from "~/lib/roles";
import { validateTimeEntryRange, ASSIGNMENT_TYPES } from "~/lib/calendar-schemas";
import { addTimeEntry, updateTimeEntry, deleteTimeEntry } from "~/lib/time-entries.server";
import type { AssignmentType } from "~/generated/prisma/client";
import { keysetPage, keysetWindow, pageProps, type PageArgs, type PageInfo } from "../pagination";

const TIME_ENTRY_PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const CONFIRM_PROPERTY = {
  confirmed: {
    type: "boolean",
    description:
      "Must be true to write. Call once without it to get a preview, show the user exactly what will be logged (date, hours, role, note), and only pass true once they have agreed or amended it. Never set true on the first call.",
  },
} as const;

export class TimeEntryNotFoundError extends Error {
  status = 404;
  constructor(id: string) {
    super(`Time entry ${id} not found`);
    this.name = "TimeEntryNotFoundError";
  }
}

export class TimeEntryInvalidError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "TimeEntryInvalidError";
  }
}

// ─── list_my_roles ───────────────────────────────────────────────────────────
// Attribution needs an (assignmentType, roleRefId) pair, and those ids aren't
// discoverable anywhere else over MCP, so this is a prerequisite for logging.

export const LIST_MY_ROLES_TOOL = {
  name: "list_my_roles",
  description:
    "List the authenticated member's paid roles for the current term, each with the assignmentType and roleRefId needed to attribute a time entry or a work block. Call this before adding time.",
  inputSchema: {
    type: "object" as const,
    properties: {
      allTerms: {
        type: "boolean",
        description:
          "Include roles from every term rather than just the current one. Defaults to false.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type MyRole = {
  assignmentType: AssignmentType;
  roleRefId: string;
  label: string;
  termCode: string | null;
  projectId: string | null;
};

export async function runListMyRoles(
  callerId: string,
  input: { allTerms?: boolean } = {},
): Promise<{ roles: MyRole[] }> {
  const current = input.allTerms ? null : await currentTerm();
  const termFilter = current ? { termId: current.id } : {};

  const [projects, cores, instructors, domainLeads, admin] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { userId: callerId, ...termFilter },
      select: {
        id: true,
        projectId: true,
        project: { select: { name: true } },
        domain: { select: { displayName: true } },
        term: { select: { code: true } },
      },
    }),
    prisma.coreAssignment.findMany({
      where: { userId: callerId, ...termFilter },
      select: { id: true, leadTitle: true, term: { select: { code: true } } },
    }),
    prisma.instructorAssignment.findMany({
      where: { userId: callerId, ...termFilter },
      select: {
        id: true,
        offering: { select: { title: true } },
        term: { select: { code: true } },
      },
    }),
    prisma.domainLeadAssignment.findMany({
      where: { userId: callerId, ...termFilter },
      select: {
        id: true,
        domain: { select: { displayName: true } },
        term: { select: { code: true } },
      },
    }),
    // AdminMembership is not term-scoped — one row per admin, always current.
    prisma.adminMembership.findMany({
      where: { userId: callerId },
      select: { id: true },
    }),
  ]);

  const roles: MyRole[] = [
    ...projects.map((r) => ({
      assignmentType: "Project" as const,
      roleRefId: r.id,
      label: `${r.project.name} — ${r.domain.displayName}`,
      termCode: r.term.code,
      projectId: r.projectId,
    })),
    ...cores.map((r) => ({
      assignmentType: "Core" as const,
      roleRefId: r.id,
      label: coreRoleLabel(r.leadTitle),
      termCode: r.term.code,
      projectId: null,
    })),
    ...instructors.map((r) => ({
      assignmentType: "Instructor" as const,
      roleRefId: r.id,
      label: `Instructor — ${r.offering.title}`,
      termCode: r.term.code,
      projectId: null,
    })),
    ...domainLeads.map((r) => ({
      assignmentType: "DomainLead" as const,
      roleRefId: r.id,
      label: `Domain Lead — ${r.domain.displayName}`,
      termCode: r.term.code,
      projectId: null,
    })),
    ...admin.map((r) => ({
      assignmentType: "Admin" as const,
      roleRefId: r.id,
      label: "Admin",
      termCode: null,
      projectId: null,
    })),
  ];

  return { roles };
}

// ─── list_my_time_entries ────────────────────────────────────────────────────

export const LIST_MY_TIME_ENTRIES_TOOL = {
  name: "list_my_time_entries",
  description:
    "List the authenticated member's logged time entries, newest first. Use it to find the id of an entry to update or delete, or to check what is already logged before adding more. Pass page.nextCursor as cursor to read older entries until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: {
        type: "string",
        description: "Only entries on or after this date (YYYY-MM-DD).",
      },
      to: { type: "string", description: "Only entries on or before this date (YYYY-MM-DD)." },
      ...pageProps(TIME_ENTRY_PAGE_LIMITS),
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type TimeEntryOut = {
  id: string;
  date: string;
  hours: number;
  note: string | null;
  source: string;
  assignmentType: AssignmentType | null;
  roleRefId: string | null;
  projectId: string | null;
  startTime: string | null;
  endTime: string | null;
  editable: boolean;
};

function parseDay(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) {
    throw new TimeEntryInvalidError(`${label} must be a YYYY-MM-DD date`);
  }
  return d;
}

export async function runListMyTimeEntries(
  callerId: string,
  input: PageArgs & { from?: string; to?: string } = {},
): Promise<{ entries: TimeEntryOut[]; page: PageInfo }> {
  const from = parseDay(input.from, "from");
  const to = parseDay(input.to, "to");
  const window = keysetWindow(input, TIME_ENTRY_PAGE_LIMITS, [
    { field: "date", direction: "desc", type: "date" },
    { field: "createdAt", direction: "desc", type: "date" },
  ]);

  const fetched = await prisma.timeEntry.findMany({
    where: {
      AND: [
        {
          userId: callerId,
          ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        window.where,
      ],
    },
    orderBy: window.orderBy,
    take: window.take,
    select: {
      id: true,
      createdAt: true,
      date: true,
      hours: true,
      note: true,
      source: true,
      assignmentType: true,
      roleRefId: true,
      projectId: true,
      startTime: true,
      endTime: true,
    },
  });

  const { rows, page } = keysetPage(fetched, window);

  return {
    page,
    entries: rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      hours: r.hours,
      note: r.note,
      source: r.source,
      assignmentType: r.assignmentType,
      roleRefId: r.roleRefId,
      projectId: r.projectId,
      startTime: r.startTime?.toISOString() ?? null,
      endTime: r.endTime?.toISOString() ?? null,
      editable: true,
    })),
  };
}


function throwWriteError(id: string | undefined, result: { error: string; status: number }): never {
  if (result.status === 404) throw new TimeEntryNotFoundError(id ?? "");
  throw new TimeEntryInvalidError(result.error);
}

// ─── add_time_entry ──────────────────────────────────────────────────────────

export const ADD_TIME_ENTRY_TOOL = {
  name: "add_time_entry",
  description:
    "Log a manual time entry against one of the member's roles. Derive `hours` and `note` from the work actually done in this session — the note should say what was worked on, not just 'development'. Two-step: call without `confirmed` to get a preview, show it to the user for approval or amendment, then re-call with `confirmed: true`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      date: { type: "string", description: "Date of the work (YYYY-MM-DD)." },
      hours: {
        type: "number",
        description: "Hours worked, > 0 and ≤ 24. Must match the startTime/endTime span.",
      },
      assignmentType: {
        type: "string",
        enum: [...ASSIGNMENT_TYPES],
        description: "Role kind, from `list_my_roles`.",
      },
      roleRefId: { type: "string", description: "Role id, from `list_my_roles`." },
      note: {
        type: "string",
        description:
          "What was worked on. Summarize the session's actual work concretely (e.g. 'Rebased the showcase importer onto staging and fixed the image mapper').",
      },
      startTime: {
        type: "string",
        description:
          "ISO start with an explicit offset (e.g. 2026-10-14T13:00:00-04:00). Payroll reads clock times, so every entry needs one.",
      },
      endTime: { type: "string", description: "ISO end with an explicit offset." },
      ...CONFIRM_PROPERTY,
    },
    required: ["date", "hours", "assignmentType", "roleRefId", "startTime", "endTime"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type AddInput = {
  date: string;
  hours: number;
  assignmentType: AssignmentType;
  roleRefId: string;
  note?: string;
  startTime: string;
  endTime: string;
  confirmed?: boolean;
};

export type AddTimeEntryResult =
  | { ok: true; id: string; preview?: undefined }
  | { ok: false; preview: Record<string, unknown>; needsConfirmation: true };

export async function runAddTimeEntry(
  callerId: string,
  input: AddInput,
): Promise<AddTimeEntryResult> {
  if (!(input.hours > 0)) {
    throw new TimeEntryInvalidError("hours must be greater than 0");
  }
  parseDay(input.date, "date");
  if (!input.startTime || !input.endTime) {
    throw new TimeEntryInvalidError("startTime and endTime are required");
  }
  const rangeError = validateTimeEntryRange({
    startTime: input.startTime,
    endTime: input.endTime,
    hours: input.hours,
  });
  if (rangeError) throw new TimeEntryInvalidError(rangeError);

  const resolved = await resolveRoleRef(callerId, input.assignmentType, input.roleRefId);
  if (!resolved) {
    throw new TimeEntryInvalidError("roleRefId is not one of this member's roles");
  }

  if (!input.confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      preview: {
        action: "add",
        date: input.date,
        hours: input.hours,
        assignmentType: input.assignmentType,
        roleRefId: input.roleRefId,
        projectId: resolved.projectId,
        note: input.note ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    };
  }

  const result = await addTimeEntry(callerId, {
    date: input.date,
    hours: input.hours,
    assignmentType: input.assignmentType,
    roleRefId: input.roleRefId,
    note: input.note ?? null,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  if (!result.ok) throwWriteError(undefined, result);
  return { ok: true, id: result.entry.id };
}

// ─── update_time_entry ───────────────────────────────────────────────────────

export const UPDATE_TIME_ENTRY_TOOL = {
  name: "update_time_entry",
  description:
    "Change one of the member's time entries: date, hours, role, note, or time range. Works on Manual and Meeting entries alike (a Meeting entry is how attendance lands on the timesheet; give it a role and note here). Same two-step confirmation as `add_time_entry`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "TimeEntry.id from `list_my_time_entries`." },
      date: { type: "string", description: "New date (YYYY-MM-DD)." },
      hours: { type: "number", description: "New hours, > 0 and ≤ 24." },
      assignmentType: { type: "string", enum: [...ASSIGNMENT_TYPES] },
      roleRefId: { type: "string" },
      note: { type: "string", description: "New note. Pass an empty string to clear it." },
      startTime: { type: "string" },
      endTime: { type: "string" },
      ...CONFIRM_PROPERTY,
    },
    required: ["id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type UpdateInput = {
  id: string;
  date?: string;
  hours?: number;
  assignmentType?: AssignmentType;
  roleRefId?: string;
  note?: string;
  startTime?: string;
  endTime?: string;
  confirmed?: boolean;
};

export type UpdateTimeEntryResult =
  | { ok: true; preview?: undefined }
  | { ok: false; preview: Record<string, unknown>; needsConfirmation: true };

export async function runUpdateTimeEntry(
  callerId: string,
  input: UpdateInput,
): Promise<UpdateTimeEntryResult> {
  const existing = await prisma.timeEntry.findUnique({
    where: { id: input.id },
    select: {
      userId: true,
      source: true,
      date: true,
      hours: true,
      note: true,
      assignmentType: true,
      roleRefId: true,
      projectId: true,
      startTime: true,
      endTime: true,
    },
  });
  if (!existing || existing.userId !== callerId) {
    throw new TimeEntryNotFoundError(input.id);
  }

  const hours = input.hours ?? existing.hours;
  if (!(hours > 0)) throw new TimeEntryInvalidError("hours must be greater than 0");

  const startTime =
    input.startTime === undefined ? existing.startTime : new Date(input.startTime);
  const endTime = input.endTime === undefined ? existing.endTime : new Date(input.endTime);
  const rangeError = validateTimeEntryRange({
    startTime: startTime?.toISOString() ?? null,
    endTime: endTime?.toISOString() ?? null,
    hours,
  });
  if (rangeError) throw new TimeEntryInvalidError(rangeError);

  let assignmentType = existing.assignmentType;
  let roleRefId = existing.roleRefId;
  let projectId = existing.projectId;
  if (input.assignmentType !== undefined || input.roleRefId !== undefined) {
    assignmentType = input.assignmentType ?? existing.assignmentType;
    roleRefId = input.roleRefId ?? existing.roleRefId;
    if (!assignmentType || !roleRefId) {
      throw new TimeEntryInvalidError("A complete role (assignmentType and roleRefId) is required");
    }
    const resolved = await resolveRoleRef(callerId, assignmentType, roleRefId);
    if (!resolved) {
      throw new TimeEntryInvalidError("roleRefId is not one of this member's roles");
    }
    projectId = resolved.projectId;
  }

  const date = input.date ? parseDay(input.date, "date")! : existing.date;
  const note = input.note === undefined ? existing.note : input.note === "" ? null : input.note;

  if (!input.confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      preview: {
        action: "update",
        id: input.id,
        source: existing.source,
        before: {
          date: existing.date.toISOString().slice(0, 10),
          hours: existing.hours,
          note: existing.note,
          assignmentType: existing.assignmentType,
          roleRefId: existing.roleRefId,
          startTime: existing.startTime?.toISOString() ?? null,
          endTime: existing.endTime?.toISOString() ?? null,
        },
        after: {
          date: date.toISOString().slice(0, 10),
          hours,
          note,
          assignmentType,
          roleRefId,
          projectId,
          startTime: startTime?.toISOString() ?? null,
          endTime: endTime?.toISOString() ?? null,
        },
      },
    };
  }

  const result = await updateTimeEntry(callerId, {
    id: input.id,
    date: input.date,
    hours: input.hours,
    assignmentType: input.assignmentType,
    roleRefId: input.roleRefId,
    note: input.note === undefined ? undefined : note,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  if (!result.ok) throwWriteError(input.id, result);
  return { ok: true };
}

// ─── delete_time_entry ───────────────────────────────────────────────────────
// No confirmation gate: it can't invent hours, the id has to come from a list
// call the user can see, and the entry can be logged again.

export const DELETE_TIME_ENTRY_TOOL = {
  name: "delete_time_entry",
  description:
    "Delete one of the member's time entries, Manual or Meeting. Deleting a Meeting entry takes the meeting's hours off the timesheet; it does not change attendance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "TimeEntry.id from `list_my_time_entries`." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runDeleteTimeEntry(
  callerId: string,
  input: { id: string },
): Promise<{ ok: true }> {
  const result = await deleteTimeEntry(callerId, input.id);
  if (!result.ok) throwWriteError(input.id, result);
  return { ok: true };
}
