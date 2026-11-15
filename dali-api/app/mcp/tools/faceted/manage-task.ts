import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, requireForAction } from "../../errors";
import { CREATE_TASK_PROPERTIES, runCreateTask } from "../create-task";
import { UPDATE_TASK_PROPERTIES, runUpdateTask } from "../update-task";
import { UPDATE_TASK_STATUS_PROPERTIES, runUpdateTaskStatus } from "../update-task-status";
import { runDeleteTask } from "../delete-task";
import { SET_TASK_CHECKLIST_PROPERTIES, runSetTaskChecklist } from "../set-task-checklist";
import { LINK_TASK_TO_GITHUB_PROPERTIES, runLinkTaskToGithub } from "../link-task-to-github";
import { runUnlinkTaskFromGithub } from "../unlink-task-from-github";

const ACTIONS = ["create", "update", "set_status", "set_checklist", "delete", "link_github", "unlink_github"] as const;

const MANAGE_TASK_DEF = {
  name: "manage_task",
  description: `Create and edit project or Core tasks. Pass \`action\`:
- \`create\`: file a task at the end of its column. Requires title, plus projectId unless core is true. With no status and no dueAt it goes to Backlog. Optional mirrorToGithubRepo (one of the project's repoUrls) mirrors it to a GitHub issue.
- \`update\`: edit title, description, priority, startsAt, dueAt, epicId, storyId, domainId, assigneeUserIds. Requires taskId. Omit a field to keep it; empty string clears it. A task's sprint follows its dates. A story pins its epic.
- \`set_status\`: move a task to another column, e.g. Done. Requires taskId, status. Assignees can do this too.
- \`set_checklist\`: replace the whole checklist. Requires taskId, items (empty array clears). Assignees can do this too.
- \`delete\`: hard-delete a task with its assignees and comments. Requires taskId. Prefer status Cancelled to keep history.
- \`link_github\`: mirror a task to a new GitHub issue. Requires taskId, repo (one of the project's repoUrls).
- \`unlink_github\`: stop mirroring; the GitHub issue stays. Requires taskId.
Everything except set_status and set_checklist needs Core or project-member access.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Operation to perform." },
      ...CREATE_TASK_PROPERTIES,
      ...UPDATE_TASK_PROPERTIES,
      status: {
        ...UPDATE_TASK_STATUS_PROPERTIES.status,
        description: "set_status: the target column. create: defaults to Todo when dueAt is set, otherwise Backlog.",
      },
      items: { ...SET_TASK_CHECKLIST_PROPERTIES.items, description: "set_checklist: the whole checklist." },
      repo: LINK_TASK_TO_GITHUB_PROPERTIES.repo,
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const ACTION_REQUIRED: Record<(typeof ACTIONS)[number], string[]> = {
  create: ["title"],
  update: ["taskId"],
  set_status: ["taskId", "status"],
  set_checklist: ["taskId", "items"],
  delete: ["taskId"],
  link_github: ["taskId", "repo"],
  unlink_github: ["taskId"],
};

function pick(args: Record<string, unknown>, keys: string[]): any {
  return Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
}

const CREATE_KEYS = Object.keys(CREATE_TASK_PROPERTIES);
const UPDATE_KEYS = Object.keys(UPDATE_TASK_PROPERTIES);

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);
  const id = ctx.user.id;
  switch (action) {
    case "create":
      return runCreateTask(id, pick(args, CREATE_KEYS));
    case "update":
      return runUpdateTask(id, pick(args, UPDATE_KEYS));
    case "set_status":
      return runUpdateTaskStatus(id, pick(args, ["taskId", "status"]));
    case "set_checklist":
      return runSetTaskChecklist(id, pick(args, ["taskId", "items"]));
    case "delete":
      return runDeleteTask(id, pick(args, ["taskId"]), ctx);
    case "link_github":
      return runLinkTaskToGithub(id, pick(args, ["taskId", "repo"]));
    case "unlink_github":
      return runUnlinkTaskFromGithub(id, pick(args, ["taskId"]));
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_TASK_TOOL: McpTool = { def: MANAGE_TASK_DEF, run };
