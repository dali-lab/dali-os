// manage_task `update`: edit fields on a task. Mirrors api.tasks.$id PATCH
// (Core or project member). Status changes go through `set_status`.

import { prisma } from "~/lib/db.server";
import { canEditProject } from "./access";
import { TaskUpdateError, updateTask, type TaskPatch } from "~/projects/lib/task-update.server";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const UPDATE_TASK_PROPERTIES = {
  taskId: { type: "string", minLength: 1 },
  title: { type: "string", minLength: 1, maxLength: 500 },
  description: {
    type: "string",
    description:
      "Plain-text / Markdown description. Empty string clears.",
  },
  priority: { type: "string", enum: PRIORITIES as unknown as string[] },
  startsAt: {
    type: "string",
    description:
      "Timeline start (ISO timestamp, planning only). Empty string clears.",
  },
  dueAt: {
    type: "string",
    description: "ISO timestamp. Empty string clears.",
  },
  epicId: {
    type: "string",
    description: "Epic link. Empty string = unlinked.",
  },
  storyId: {
    type: "string",
    description:
      "Parent user story. Pins the epic to the story's epic (overrides epicId). Empty string unlinks. A bare epicId change drops a now-orphaned story.",
  },
  domainId: {
    type: "string",
    description: "Domain chip. Empty string = no domain.",
  },
  assigneeUserIds: {
    type: "array",
    items: { type: "string" },
    description: "Full replacement set. Empty array unassigns everyone.",
  },
};

type Input = {
  taskId: string;
  title?: string;
  description?: string;
  priority?: Priority;
  startsAt?: string;
  dueAt?: string;
  epicId?: string;
  storyId?: string;
  domainId?: string;
  assigneeUserIds?: string[];
};

export class UpdateTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateTaskError";
  }
}

export async function runUpdateTask(callerId: string, input: Input) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, projectId: true },
  });
  if (!task) throw new UpdateTaskError("Task not found", 404);

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new UpdateTaskError("Forbidden", 403);
  }

  const patch: TaskPatch = {};
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateTaskError("Title is required", 400);
    patch.title = trimmed;
  }
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    patch.description = trimmed === "" ? null : trimmed;
  }
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.startsAt !== undefined) patch.startsAt = parseDate(input.startsAt, "startsAt");
  if (input.dueAt !== undefined) patch.dueAt = parseDate(input.dueAt, "dueAt");
  if (input.epicId !== undefined) patch.epicId = input.epicId === "" ? null : input.epicId;
  if (input.storyId !== undefined) patch.storyId = input.storyId === "" ? null : input.storyId;
  if (input.domainId !== undefined) patch.domainId = input.domainId === "" ? null : input.domainId;
  if (Array.isArray(input.assigneeUserIds)) patch.assigneeUserIds = input.assigneeUserIds;

  try {
    const { noop } = await updateTask({ taskId: input.taskId, actorId: callerId, patch });
    return noop ? { ok: true, taskId: input.taskId, noop: true } : { ok: true, taskId: input.taskId };
  } catch (err) {
    if (err instanceof TaskUpdateError) throw new UpdateTaskError(err.message, err.status);
    throw err;
  }
}

function parseDate(raw: string, field: string): Date | null {
  if (raw === "") return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) throw new UpdateTaskError(`Invalid ${field}`, 400);
  return d;
}
