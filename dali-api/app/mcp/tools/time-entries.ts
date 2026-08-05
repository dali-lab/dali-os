// MCP timesheet tools — list the caller's paid roles and their logged time,
// and add / update / delete Manual entries.
//
// Writes go to TimeEntry (the app's own tracking, what the Timesheet tab
// renders), never TimesheetEntry — that one is a mirror of Dartmouth payroll
// exports keyed on shift/chart-string fields, and hand-written rows have no
// business sitting next to imported payroll data.
//
// Business rules are the ones the Calendar route's action already enforces:
// validateTimeEntryRange (hours must match the start/end span, ≤24h) and
// resolveRoleRef (the role must actually belong to the caller). Both are
// imported rather than restated so the two surfaces can't drift.
//
// CONFIRMATION: `add` and `update` refuse to write unless `confirmed: true`.
// The intended flow is that the agent derives hours and note from the session
// it's in, shows the user what it's about to log, and only then re-calls with
// confirmed. A dry call returns `{ preview }` describing the write. This is a
// server-side gate, not just guidance in the description — an agent that logs
// hours against someone's timesheet without them seeing it first would be
// writing payroll-adjacent data unsupervised.

import { prisma } from "~/lib/db";
import { resolveRoleRef, currentTerm } from "~/lib/roles";
import { validateTimeEntryRange } from "~/lib/calendar-schemas";
import type { AssignmentType } from "~/generated/prisma/client";

const ASSIGNMENT_TYPES = ["Project", "Core", "Instructor", "DomainLead", "Admin"] as const;

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
      label: r.leadTitle ? `Core — ${r.leadTitle}` : "Core",
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
    "List the authenticated member's logged time entries, newest first. Use it to find the id of an entry to update or delete, or to check what is already logged before adding more.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: {
        type: "string",
        description: "Only entries on or after this date (YYYY-MM-DD).",
      },
      to: { type: "string", description: "Only entries on or before this date (YYYY-MM-DD)." },
      limit: {
        type: "number",
        description: "Maximum entries to return, 1-200. Defaults to 50.",
      },
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
  /** Block- and Meeting-sourced rows are owned by the thing that created them. */
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
  input: { from?: string; to?: string; limit?: number } = {},
): Promise<{ entries: TimeEntryOut[] }> {
  const from = parseDay(input.from, "from");
  const to = parseDay(input.to, "to");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const rows = await prisma.timeEntry.findMany({
    where: {
      userId: callerId,
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
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

  return {
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
      // A Meeting row follows attendance and a Block row follows its calendar
      // block; editing either here would be undone by its owner on next sync.
      editable: r.source === "Manual",
    })),
  };
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
        description:
          "Hours worked, > 0 and ≤ 24. If startTime/endTime are given this must match that span.",
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
          "Optional ISO start. Supply both start and end to place the entry on the week grid; `hours` must match the span.",
      },
      endTime: { type: "string", description: "Optional ISO end." },
      ...CONFIRM_PROPERTY,
    },
    required: ["date", "hours", "assignmentType", "roleRefId"],
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
  startTime?: string;
  endTime?: string;
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
  const date = parseDay(input.date, "date")!;
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

  // Validate first, then gate — so the preview the user approves is one that
  // would actually have been accepted.
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
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
      },
    };
  }

  const created = await prisma.timeEntry.create({
    data: {
      userId: callerId,
      source: "Manual",
      date,
      hours: input.hours,
      assignmentType: input.assignmentType,
      roleRefId: input.roleRefId,
      projectId: resolved.projectId,
      note: input.note ?? null,
      startTime: input.startTime ? new Date(input.startTime) : null,
      endTime: input.endTime ? new Date(input.endTime) : null,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

// ─── update_time_entry ───────────────────────────────────────────────────────

export const UPDATE_TIME_ENTRY_TOOL = {
  name: "update_time_entry",
  description:
    "Change a manual time entry's date, hours, role, note, or time range. Only Manual entries are editable — Meeting entries follow attendance and Block entries follow their calendar block. Same two-step confirmation as `add_time_entry`.",
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
  if (existing.source !== "Manual") {
    throw new TimeEntryInvalidError(
      `Only Manual entries can be edited; this one is ${existing.source}-sourced and follows its ${
        existing.source === "Meeting" ? "meeting attendance" : "calendar block"
      }.`,
    );
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

  // Mirrors the calendar action: a patch touching either half of the role must
  // land on a complete, real role rather than clearing back to unassigned.
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
        before: {
          date: existing.date.toISOString().slice(0, 10),
          hours: existing.hours,
          note: existing.note,
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

  await prisma.timeEntry.update({
    where: { id: input.id },
    data: { date, hours, note, assignmentType, roleRefId, projectId, startTime, endTime },
  });
  return { ok: true };
}

// ─── delete_time_entry ───────────────────────────────────────────────────────
// No confirmation gate: unlike add/update it can't invent hours, the id has to
// come from a list call the user can see, and the failure mode is recoverable
// by logging the entry again.

export const DELETE_TIME_ENTRY_TOOL = {
  name: "delete_time_entry",
  description:
    "Delete one of the member's manual time entries. Meeting- and Block-sourced entries can't be deleted here — remove the underlying meeting attendance or calendar block instead.",
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
  const existing = await prisma.timeEntry.findUnique({
    where: { id: input.id },
    select: { userId: true, source: true },
  });
  if (!existing || existing.userId !== callerId) {
    throw new TimeEntryNotFoundError(input.id);
  }
  if (existing.source !== "Manual") {
    throw new TimeEntryInvalidError(
      `Only Manual entries can be deleted; this one is ${existing.source}-sourced.`,
    );
  }
  await prisma.timeEntry.delete({ where: { id: input.id } });
  return { ok: true };
}
