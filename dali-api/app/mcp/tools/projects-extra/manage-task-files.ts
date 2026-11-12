// MCP `manage_task_files` — link or unlink a ProjectFile artifact on a task.
//
// Mirrors POST/DELETE /api/tasks/:id/files. The file must belong to the same
// project as the task and must not be archived (same guards as the route).
//
// Gate: canEditProject (Core or project member).

import { prisma } from "~/lib/db.server";
import { linkTaskFile, TaskFileError, unlinkTaskFile } from "~/projects/lib/task-files.server";
import { McpNotFoundError, McpForbiddenError, McpInvalidError, requireForAction } from "./errors";
import { canEditProject } from "../access";

export const MANAGE_TASK_FILES_TOOL = {
  name: "manage_task_files",
  description:
    "Link or unlink a project file artifact on a task. action: 'link' attaches the file (idempotent); 'unlink' removes the link without deleting the file.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["link", "unlink"], description: "'link' or 'unlink'." },
      taskId: { type: "string", minLength: 1, description: "Task.id." },
      fileId: {
        type: "string",
        minLength: 1,
        description: "ProjectFile.id. Must belong to the same project as the task and be live (not archived).",
      },
    },
    required: ["action", "taskId", "fileId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageTaskFilesInput = { action: string; taskId: string; fileId: string };

export async function runManageTaskFiles(
  callerId: string,
  input: ManageTaskFilesInput,
): Promise<{ ok: true; id?: string; title?: string; versionCount?: number }> {
  requireForAction(input.action, input, {
    link: ["taskId", "fileId"],
    unlink: ["taskId", "fileId"],
  });

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, projectId: true },
  });
  if (!task) throw new McpNotFoundError("Task not found.");

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new McpForbiddenError("You don't have permission to edit this project.");
  }

  if (input.action === "unlink") {
    await unlinkTaskFile({ taskId: task.id, fileId: input.fileId });
    return { ok: true };
  }

  try {
    const { file } = await linkTaskFile({ taskId: task.id, fileId: input.fileId });
    return { ok: true, id: file.id, title: file.title, versionCount: file.versionCount };
  } catch (err) {
    if (err instanceof TaskFileError) {
      throw new McpNotFoundError("File not found, archived, or belongs to a different project.");
    }
    throw err;
  }
}
