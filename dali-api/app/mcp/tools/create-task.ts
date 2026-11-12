
import { canEditProject } from "./access";
import { getUserRoles, isCore } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getCoreBoardProject } from "~/core/lib/taskboard.server";
import { TASK_STATUSES } from "~/projects/lib/task-board";
import { createTask, TaskCreateError } from "~/projects/lib/task-create.server";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const CREATE_TASK_TOOL = {
  name: "create_task",
  description:
    "Create a project task. Requires Core or project-member access. Lands at end of target column. Without a status or dueAt the task goes to Backlog. Optionally mirrors to a GitHub issue (`mirrorToGithubRepo` must be one of the project's repoUrls).",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        description: "Required unless `core` is true.",
      },
      core: {
        type: "boolean",
        description:
          "Set true to file the task on the Core taskboard instead of a project. Core members only; projectId is ignored.",
      },
      title: { type: "string", minLength: 1, maxLength: 500 },
      description: {
        type: "string",
        description: "Optional plain-text / Markdown description.",
      },
      status: {
        type: "string",
        enum: TASK_STATUSES as unknown as string[],
        description: "Defaults to 'Todo' when dueAt is set, otherwise 'Backlog'.",
      },
      priority: { type: "string", enum: PRIORITIES as unknown as string[] },
      epicId: { type: "string", description: "Optional epic linkage." },
      storyId: {
        type: "string",
        description:
          "Optional parent user story. Pins the task's epic to the story's epic (overrides epicId).",
      },
      domainId: { type: "string", description: "Optional domain chip." },
      startsAt: {
        type: "string",
        description:
          "Timeline start (ISO timestamp, planning only). Empty string or omitted = no start.",
      },
      dueAt: {
        type: "string",
        description: "ISO timestamp. Empty string or omitted = no deadline.",
      },
      assigneeUserIds: {
        type: "array",
        items: { type: "string" },
        description: "User ids to assign. Omit or empty for unassigned.",
      },
      mirrorToGithubRepo: {
        type: "string",
        description:
          "If set, mirror this task to a GitHub issue in the given repo (must appear in the project's repoUrls). Empty string disables.",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId?: string;
  core?: boolean;
  title: string;
  description?: string;
  status?: string;
  priority?: Priority;
  epicId?: string;
  storyId?: string;
  domainId?: string;
  startsAt?: string;
  dueAt?: string;
  assigneeUserIds?: string[];
  mirrorToGithubRepo?: string;
  /** Meeting notes model (specs/meeting-notes-model.md §4): set only by the
   *  "Create tasks" action item flow, never by the MCP tool's own input
   *  schema — backlinks Task.sourceRecordingId to the meeting it came from. */
  sourceRecordingId?: string;
};

export class CreateTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateTaskError";
  }
}

export async function runCreateTask(callerId: string, rawInput: Input) {
  let projectId = rawInput.projectId ?? "";
  if (rawInput.core) {
    if (!(await isCore(callerId))) throw new CreateTaskError("Forbidden", 403);
    if (!(await isFeatureEnabled("core-taskboard", callerId, await getUserRoles(callerId)))) {
      throw new CreateTaskError("The Core taskboard isn't on for you", 403);
    }
    projectId = (await getCoreBoardProject()).id;
  } else if (!projectId) {
    throw new CreateTaskError("projectId or core is required", 400);
  } else if (!(await canEditProject(callerId, projectId))) {
    throw new CreateTaskError("Forbidden", 403);
  }

  const startsAt = parseDate(rawInput.startsAt, "startsAt");
  const dueAt = parseDate(rawInput.dueAt, "dueAt");
  try {
    return await createTask({
      projectId,
      actorId: callerId,
      title: rawInput.title,
      description: rawInput.description,
      status: rawInput.status,
      priority: rawInput.priority,
      startsAt,
      dueAt,
      epicId: rawInput.epicId,
      storyId: rawInput.storyId,
      domainId: rawInput.domainId,
      assigneeUserIds: rawInput.assigneeUserIds,
      mirrorToGithubRepo: rawInput.mirrorToGithubRepo,
      sourceRecordingId: rawInput.sourceRecordingId,
    });
  } catch (err) {
    if (err instanceof TaskCreateError) throw new CreateTaskError(err.message, err.status);
    throw err;
  }
}

function parseDate(raw: string | undefined, field: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) throw new CreateTaskError(`Invalid ${field}`, 400);
  return d;
}
