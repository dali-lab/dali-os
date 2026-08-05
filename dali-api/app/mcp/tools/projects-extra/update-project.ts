// MCP `update_project` — edit writable project settings.
//
// Mirrors the intent handlers in projects.$id.tsx (header, description,
// details, visibility) but collapsed into a single flat tool. Core-only fields
// (chartString*) are silently ignored for non-Core callers to match the web
// form behaviour. Scope/domain/term assignment is intentionally excluded — those
// are full-replacement writes with complex validation that belong on the UI.
//
// Gate: canEditProject (Core or current project member).

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { canEditProject } from "../access";

const STATUSES = ["Active", "Paused", "Archived"] as const;
type ProjectStatus = (typeof STATUSES)[number];

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
    "Edit a project's settings. Writable fields: name, status (Active/Paused/Archived), iconEmoji, description, imageUrl, isPrivate, calendarEmail, repoUrls, deploymentUrl, termCount, githubTeamSlug, slackChannelName. Requires Core or project-member access. Pairs with `get_project_settings` which reads these same fields.",
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

  // Validate status if provided.
  if (input.status !== undefined && !STATUSES.includes(input.status as ProjectStatus)) {
    throw new UpdateProjectError(`Invalid status. Must be one of: ${STATUSES.join(", ")}.`);
  }

  // Build the update payload incrementally — only include keys the caller passed.
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name.trim();
  if (input.status !== undefined) data.status = input.status as ProjectStatus;
  if (input.iconEmoji !== undefined) data.iconEmoji = input.iconEmoji.trim() || null;
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl.trim() || null;
  if (input.isPrivate !== undefined) data.isPrivate = input.isPrivate;
  if (input.calendarEmail !== undefined) data.calendarEmail = input.calendarEmail.trim() || null;
  if (input.repoUrls !== undefined) {
    data.repoUrls = input.repoUrls.map((u) => u.trim()).filter(Boolean);
  }
  if (input.deploymentUrl !== undefined) data.deploymentUrl = input.deploymentUrl.trim() || null;
  if (input.termCount !== undefined) {
    data.termCount = Math.max(1, Math.floor(input.termCount));
  }
  if (input.githubTeamSlug !== undefined) {
    const raw = input.githubTeamSlug.trim();
    data.githubTeamSlug =
      raw === ""
        ? null
        : raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (input.slackChannelName !== undefined) {
    const raw = input.slackChannelName.trim();
    data.slackChannelName =
      raw === ""
        ? null
        : raw.toLowerCase().replace(/[^a-z0-9-_\s]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
  }

  if (Object.keys(data).length === 0) {
    throw new UpdateProjectError("No fields to update were provided.");
  }

  await prisma.project.update({ where: { id: input.projectId }, data });

  return { ok: true, projectId: input.projectId };
}
