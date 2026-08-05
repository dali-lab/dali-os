// MCP calendar-block tools — list / add / update / delete the caller's manual
// calendar blocks, optionally marking one as work so it also logs time.
//
// Mirrors the add/update/remove-manual-block handlers in
// app/calendar/routes/calendar.tsx, reusing syncManualBlockTimeEntry so a block
// marked isWork produces (and keeps in sync) the same Block-sourced TimeEntry
// the UI would. Two rules carried over from there:
//
//   - endTime must be after startTime.
//   - A recurring block can't be marked as work: TimeEntry has no recurrence
//     expansion, so one row would stand in for every occurrence.
//
// Marking a block as work writes time, so isWork blocks go through the same
// confirmed-gate as add_time_entry. A plain (non-work) block is just a calendar
// entry and writes straight through.

import { prisma } from "~/lib/db";
import { resolveRoleRef } from "~/lib/roles";
import { syncManualBlockTimeEntry } from "~/lib/time-entry-sync";
import type { AssignmentType } from "~/generated/prisma/client";

const ASSIGNMENT_TYPES = ["Project", "Core", "Instructor", "DomainLead", "Admin"] as const;

export class ManualBlockNotFoundError extends Error {
  status = 404;
  constructor(id: string) {
    super(`Manual block ${id} not found`);
    this.name = "ManualBlockNotFoundError";
  }
}

export class ManualBlockInvalidError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ManualBlockInvalidError";
  }
}

const WORK_PROPERTIES = {
  isWork: {
    type: "boolean",
    description:
      "Mark the block as work, which also logs a time entry for its duration against the given role. Requires assignmentType and roleRefId. Cannot be combined with recurrenceRule.",
  },
  assignmentType: {
    type: "string",
    enum: [...ASSIGNMENT_TYPES],
    description: "Role kind to attribute the work to, from `list_my_roles`. Required when isWork.",
  },
  roleRefId: {
    type: "string",
    description: "Role id, from `list_my_roles`. Required when isWork.",
  },
  confirmed: {
    type: "boolean",
    description:
      "Required only when isWork is true, because that logs time. Call once without it to get a preview, show the user what will be logged, then re-call with true.",
  },
} as const;

function parseRange(startTime: string, endTime: string): { start: Date; end: Date } {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new ManualBlockInvalidError("startTime and endTime must be ISO datetimes");
  }
  if (end <= start) {
    throw new ManualBlockInvalidError("endTime must be after startTime");
  }
  return { start, end };
}

// Shared by add and update: a work block needs a complete, real role, and
// recurrence rules out logging time at all.
async function validateWork(
  callerId: string,
  isWork: boolean,
  assignmentType: AssignmentType | null,
  roleRefId: string | null,
  recurrenceRule: string | null,
): Promise<void> {
  if (!isWork) return;
  if (recurrenceRule) {
    throw new ManualBlockInvalidError("Recurring blocks can't be marked as work yet");
  }
  if (!assignmentType || !roleRefId) {
    throw new ManualBlockInvalidError(
      "isWork requires both assignmentType and roleRefId — call `list_my_roles` for the values",
    );
  }
  const resolved = await resolveRoleRef(callerId, assignmentType, roleRefId);
  if (!resolved) {
    throw new ManualBlockInvalidError("roleRefId is not one of this member's roles");
  }
}

// ─── list_my_manual_blocks ───────────────────────────────────────────────────

export const LIST_MY_MANUAL_BLOCKS_TOOL = {
  name: "list_my_manual_blocks",
  description:
    "List the authenticated member's manual calendar blocks, soonest first. Use it to find the id of a block to update or delete.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: { type: "string", description: "Only blocks ending on or after this ISO datetime." },
      to: { type: "string", description: "Only blocks starting on or before this ISO datetime." },
      limit: { type: "number", description: "Maximum blocks to return, 1-200. Defaults to 50." },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type ManualBlockOut = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  recurrenceRule: string | null;
  isWork: boolean;
  assignmentType: AssignmentType | null;
  roleRefId: string | null;
  /** Hours logged via this block, when it's marked as work. */
  loggedHours: number | null;
};

export async function runListMyManualBlocks(
  callerId: string,
  input: { from?: string; to?: string; limit?: number } = {},
): Promise<{ blocks: ManualBlockOut[] }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const from = input.from ? new Date(input.from) : undefined;
  const to = input.to ? new Date(input.to) : undefined;
  if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
    throw new ManualBlockInvalidError("from and to must be ISO datetimes");
  }

  const rows = await prisma.manualBlock.findMany({
    where: {
      userId: callerId,
      ...(from ? { endTime: { gte: from } } : {}),
      ...(to ? { startTime: { lte: to } } : {}),
    },
    orderBy: { startTime: "asc" },
    take: limit,
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      allDay: true,
      recurrenceRule: true,
      isWork: true,
      assignmentType: true,
      roleRefId: true,
      timeEntries: { select: { hours: true }, take: 1 },
    },
  });

  return {
    blocks: rows.map((b) => ({
      id: b.id,
      title: b.title,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      allDay: b.allDay,
      recurrenceRule: b.recurrenceRule,
      isWork: b.isWork,
      assignmentType: b.assignmentType,
      roleRefId: b.roleRefId,
      loggedHours: b.timeEntries[0]?.hours ?? null,
    })),
  };
}

// ─── add_manual_block ────────────────────────────────────────────────────────

export const ADD_MANUAL_BLOCK_TOOL = {
  name: "add_manual_block",
  description:
    "Add a manual block to the member's calendar — busy time, focus time, anything that isn't a scheduled meeting. Set isWork to also log it as time against a role, in which case confirm with the user first.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", minLength: 1, description: "What the block is." },
      startTime: { type: "string", description: "ISO start datetime." },
      endTime: { type: "string", description: "ISO end datetime, after startTime." },
      allDay: { type: "boolean", description: "Render as an all-day block. Defaults to false." },
      recurrenceRule: {
        type: "string",
        description:
          "Optional iCalendar RRULE for a repeating block. Cannot be combined with isWork.",
      },
      ...WORK_PROPERTIES,
    },
    required: ["title", "startTime", "endTime"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type AddInput = {
  title: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  recurrenceRule?: string;
  isWork?: boolean;
  assignmentType?: AssignmentType;
  roleRefId?: string;
  confirmed?: boolean;
};

export type AddManualBlockResult =
  | { ok: true; id: string; loggedHours: number | null }
  | { ok: false; preview: Record<string, unknown>; needsConfirmation: true };

export async function runAddManualBlock(
  callerId: string,
  input: AddInput,
): Promise<AddManualBlockResult> {
  const { start, end } = parseRange(input.startTime, input.endTime);
  const isWork = input.isWork ?? false;
  const recurrenceRule = input.recurrenceRule ?? null;
  const assignmentType = input.assignmentType ?? null;
  const roleRefId = input.roleRefId ?? null;

  await validateWork(callerId, isWork, assignmentType, roleRefId, recurrenceRule);

  const hours = (end.getTime() - start.getTime()) / 3_600_000;

  // Only work blocks need confirming — they're the ones that write time.
  if (isWork && !input.confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      preview: {
        action: "add-work-block",
        title: input.title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        hoursToLog: hours,
        assignmentType,
        roleRefId,
      },
    };
  }

  const block = await prisma.manualBlock.create({
    data: {
      userId: callerId,
      title: input.title,
      startTime: start,
      endTime: end,
      allDay: input.allDay ?? false,
      recurrenceRule,
      isWork,
      assignmentType,
      roleRefId,
    },
    select: { id: true },
  });

  const sync = await syncManualBlockTimeEntry({
    manualBlockId: block.id,
    userId: callerId,
    isWork,
    assignmentType,
    roleRefId,
    title: input.title,
    startTime: start,
    endTime: end,
  });
  if (!sync.ok) {
    // Don't leave a block behind that claims to be work but logged nothing.
    await prisma.manualBlock.delete({ where: { id: block.id } });
    throw new ManualBlockInvalidError(sync.error);
  }

  return { ok: true, id: block.id, loggedHours: isWork ? hours : null };
}

// ─── update_manual_block ─────────────────────────────────────────────────────

export const UPDATE_MANUAL_BLOCK_TOOL = {
  name: "update_manual_block",
  description:
    "Change a manual block's title, times, recurrence, or work attribution. Turning isWork on (or moving a work block's times) rewrites its logged time, so confirm with the user first; turning it off removes the logged entry.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "ManualBlock.id from `list_my_manual_blocks`." },
      title: { type: "string", minLength: 1 },
      startTime: { type: "string" },
      endTime: { type: "string" },
      allDay: { type: "boolean" },
      recurrenceRule: {
        type: "string",
        description: "Pass an empty string to clear the recurrence.",
      },
      ...WORK_PROPERTIES,
    },
    required: ["id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type UpdateInput = {
  id: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  recurrenceRule?: string;
  isWork?: boolean;
  assignmentType?: AssignmentType;
  roleRefId?: string;
  confirmed?: boolean;
};

export type UpdateManualBlockResult =
  | { ok: true; loggedHours: number | null }
  | { ok: false; preview: Record<string, unknown>; needsConfirmation: true };

export async function runUpdateManualBlock(
  callerId: string,
  input: UpdateInput,
): Promise<UpdateManualBlockResult> {
  const existing = await prisma.manualBlock.findUnique({ where: { id: input.id } });
  if (!existing || existing.userId !== callerId) {
    throw new ManualBlockNotFoundError(input.id);
  }

  const title = input.title ?? existing.title;
  const start = input.startTime ? new Date(input.startTime) : existing.startTime;
  const end = input.endTime ? new Date(input.endTime) : existing.endTime;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new ManualBlockInvalidError("startTime and endTime must be ISO datetimes");
  }
  if (end <= start) throw new ManualBlockInvalidError("endTime must be after startTime");

  const recurrenceRule =
    input.recurrenceRule === undefined
      ? existing.recurrenceRule
      : input.recurrenceRule === ""
        ? null
        : input.recurrenceRule;
  const isWork = input.isWork ?? existing.isWork;
  const assignmentType =
    input.assignmentType === undefined ? existing.assignmentType : input.assignmentType;
  const roleRefId = input.roleRefId === undefined ? existing.roleRefId : input.roleRefId;

  await validateWork(callerId, isWork, assignmentType, roleRefId, recurrenceRule);

  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  // Confirm whenever the result logs time — a times-only edit to an existing
  // work block silently rewrites how many hours are on the timesheet.
  if (isWork && !input.confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      preview: {
        action: "update-work-block",
        id: input.id,
        before: {
          title: existing.title,
          startTime: existing.startTime.toISOString(),
          endTime: existing.endTime.toISOString(),
          isWork: existing.isWork,
        },
        after: {
          title,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          hoursToLog: hours,
          assignmentType,
          roleRefId,
        },
      },
    };
  }

  await prisma.manualBlock.update({
    where: { id: input.id },
    data: {
      title,
      startTime: start,
      endTime: end,
      allDay: input.allDay ?? existing.allDay,
      recurrenceRule,
      isWork,
      assignmentType,
      roleRefId,
    },
  });

  const sync = await syncManualBlockTimeEntry({
    manualBlockId: input.id,
    userId: callerId,
    isWork,
    assignmentType,
    roleRefId,
    title,
    startTime: start,
    endTime: end,
  });
  if (!sync.ok) throw new ManualBlockInvalidError(sync.error);

  return { ok: true, loggedHours: isWork ? hours : null };
}

// ─── delete_manual_block ─────────────────────────────────────────────────────

export const DELETE_MANUAL_BLOCK_TOOL = {
  name: "delete_manual_block",
  description:
    "Delete one of the member's manual calendar blocks. If it was marked as work, its logged time entry goes with it.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "ManualBlock.id from `list_my_manual_blocks`." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runDeleteManualBlock(
  callerId: string,
  input: { id: string },
): Promise<{ ok: true; removedTimeEntry: boolean }> {
  const existing = await prisma.manualBlock.findUnique({
    where: { id: input.id },
    select: { userId: true, isWork: true },
  });
  if (!existing || existing.userId !== callerId) {
    throw new ManualBlockNotFoundError(input.id);
  }
  // TimeEntry.manualBlockId is a restrict-by-default FK, so the linked entry
  // has to go first or the delete fails.
  const removed = await prisma.timeEntry.deleteMany({
    where: { manualBlockId: input.id, userId: callerId },
  });
  await prisma.manualBlock.delete({ where: { id: input.id } });
  return { ok: true, removedTimeEntry: removed.count > 0 };
}
