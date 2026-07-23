// MCP `set_task_checklist` — replace the entire checklist (subtasks) on a
// task. Stored as JSON `[{text, done}]`. Allowed for the task's assignees and
// for project editors (Core or project members), matching the web task PATCH
// route plus the assignee self-service path shared with `update_task_status`.

import { prisma, Prisma } from "~/lib/db";
import { canEditProject } from "./access";

export const SET_TASK_CHECKLIST_TOOL = {
  name: "set_task_checklist",
  description:
    "Replace the entire checklist on a project task. Allowed for the task's assignees and for project editors (Core or project members). Pass an empty array to clear.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, maxLength: 500 },
            done: { type: "boolean" },
          },
          required: ["text"],
          additionalProperties: false,
        },
        maxItems: 100,
      },
    },
    required: ["taskId", "items"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ChecklistItem = { text: string; done?: boolean };
type Input = { taskId: string; items: ChecklistItem[] };

export class SetTaskChecklistError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "SetTaskChecklistError";
  }
}

export async function runSetTaskChecklist(callerId: string, input: Input) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      projectId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) throw new SetTaskChecklistError("Task not found", 404);

  const isAssignee = task.assignees.some((a) => a.userId === callerId);
  if (!isAssignee && !(await canEditProject(callerId, task.projectId))) {
    throw new SetTaskChecklistError("Forbidden", 403);
  }

  const normalized = input.items.map((it) => ({
    text: it.text.trim(),
    done: !!it.done,
  }));

  await prisma.task.update({
    where: { id: input.taskId },
    // Prisma 7 distinguishes "set to JSON null" vs "unset"; use the sentinel
    // for an empty checklist so the column is cleared rather than left stale.
    data: {
      checklist: normalized.length === 0 ? Prisma.JsonNull : normalized,
    },
  });

  return { ok: true, taskId: input.taskId, count: normalized.length };
}
