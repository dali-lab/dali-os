import { prisma } from "~/lib/db.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { HttpError } from "~/lib/http-error";
import { updateProjectSettings } from "~/projects/lib/project-settings.server";
import { PROJECT_STATUSES as STATUSES } from "~/projects/lib/project-lifecycle";

export class UpdateProjectError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UpdateProjectError";
    this.status = status;
  }
}

export const UPDATE_PROJECT_TOOL = {
  name: "update_project",
  description:
    "Edit a project's settings. Writable fields: name, status (Active/Paused/Archived), iconEmoji, description, imageUrl, isPrivate, calendarEmail, repoUrls, deploymentUrl, termCount, githubTeamSlug, slackChannelName. Requires Core or project-member access; status and isPrivate are Core only. Pairs with `get_project_settings` which reads these same fields.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1, description: "Project.id to update." },
      name: { type: "string", minLength: 1, description: "Display name." },
      status: {
        type: "string",
        enum: [...STATUSES],
        description: "Project lifecycle status.",
      },
      iconEmoji: {
        type: "string",
        description: "Single emoji icon. Pass an empty string to clear.",
      },
      description: {
        type: "string",
        description: "Short plain-text description. Pass an empty string to clear.",
      },
      imageUrl: {
        type: "string",
        description: "Banner image URL. Pass an empty string to clear.",
      },
      isPrivate: {
        type: "boolean",
        description: "When true the project is hidden from non-members.",
      },
      calendarEmail: {
        type: "string",
        description: "Google Calendar email for the project. Pass an empty string to clear.",
      },
      repoUrls: {
        type: "array",
        items: { type: "string" },
        description: "GitHub repo URLs / slugs (one per entry). Replaces the full list.",
      },
      deploymentUrl: {
        type: "string",
        description: "Live deployment URL. Pass an empty string to clear.",
      },
      termCount: {
        type: "integer",
        minimum: 1,
        description: "Planned number of terms for this project.",
      },
      githubTeamSlug: {
        type: "string",
        description: "GitHub team slug (will be normalised to lowercase-hyphenated). Pass an empty string to clear.",
      },
      slackChannelName: {
        type: "string",
        description: "Slack channel name (will be normalised to Slack rules). Pass an empty string to clear.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type UpdateProjectInput = {
  projectId: string;
  name?: string;
  status?: string;
  iconEmoji?: string;
  description?: string;
  imageUrl?: string;
  isPrivate?: boolean;
  calendarEmail?: string;
  repoUrls?: string[];
  deploymentUrl?: string;
  termCount?: number;
  githubTeamSlug?: string;
  slackChannelName?: string;
};

export async function runUpdateProject(
  callerId: string,
  input: UpdateProjectInput,
): Promise<{ ok: true; projectId: string }> {
  const [core, member] = await Promise.all([
    isCore(callerId),
    isProjectMember(callerId, input.projectId),
  ]);
  if (!core && !member) {
    throw new UpdateProjectError("You don't have permission to edit this project.", 403);
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) {
    throw new UpdateProjectError("Project not found.", 404);
  }

  const { projectId, ...patch } = input;
  try {
    await updateProjectSettings({ projectId, isCore: core, patch });
  } catch (err) {
    if (err instanceof HttpError) throw new UpdateProjectError(err.message, err.status);
    throw err;
  }

  return { ok: true, projectId };
}
