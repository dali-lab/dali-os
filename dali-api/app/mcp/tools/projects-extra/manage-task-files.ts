import { prisma } from "~/lib/db.server";
import { linkTaskFile, TaskFileError, unlinkTaskFile } from "~/projects/lib/task-files.server";
import { McpNotFoundError, McpForbiddenError } from "./errors";
import { canEditProject } from "../access";

export async function runManageTaskFiles(
  callerId: string,
  input: { action: "link" | "unlink"; taskId: string; fileId: string },
): Promise<{ ok: true; id?: string; title?: string; versionCount?: number }> {
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
