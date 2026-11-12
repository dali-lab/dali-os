import { prisma } from "~/lib/db.server";
import { ensureProjectGroup } from "~/lib/groups";
import { BadRequestError, ForbiddenError } from "~/lib/http-error";
import { PROJECT_STATUSES, type ProjectStatus } from "./project-lifecycle";

export type ProjectSettingsPatch = {
  name?: string;
  status?: string;
  iconEmoji?: string;
  description?: string;
  imageUrl?: string;
  isPrivate?: boolean;
  recordingPolicy?: "Allowed" | "Disabled";
  calendarEmail?: string;
  repoUrls?: string[];
  figmaUrls?: string[];
  deploymentUrl?: string;
  termCount?: number;
  githubTeamSlug?: string;
  slackChannelName?: string;
};

const CORE_ONLY_FIELDS = ["status", "isPrivate", "recordingPolicy"] as const;

export function normalizeGithubTeamSlug(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSlackChannelName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export function linesToList(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeTermCount(n: number): number {
  return Math.max(1, Math.floor(n) || 1);
}

const blankToNull = (s: string) => s.trim() || null;
const cleanList = (urls: string[]) => urls.map((u) => u.trim()).filter(Boolean);

export async function updateProjectSettings(opts: {
  projectId: string;
  isCore: boolean;
  patch: ProjectSettingsPatch;
}): Promise<void> {
  const { projectId, patch } = opts;
  const provided = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);

  const coreOnly = CORE_ONLY_FIELDS.filter((f) => provided.includes(f));
  if (coreOnly.length > 0 && !opts.isCore) {
    throw new ForbiddenError(`Only Core can change project ${coreOnly.join(", ")}.`);
  }
  if (patch.status !== undefined && !PROJECT_STATUSES.includes(patch.status as ProjectStatus)) {
    throw new BadRequestError(`Invalid status. Must be one of: ${PROJECT_STATUSES.join(", ")}.`);
  }

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new BadRequestError("Project name is required.");
    data.name = name;
  }
  if (patch.status !== undefined) data.status = patch.status as ProjectStatus;
  if (patch.iconEmoji !== undefined) data.iconEmoji = blankToNull(patch.iconEmoji);
  if (patch.description !== undefined) data.description = blankToNull(patch.description);
  if (patch.imageUrl !== undefined) data.imageUrl = blankToNull(patch.imageUrl);
  if (patch.isPrivate !== undefined) data.isPrivate = patch.isPrivate;
  if (patch.recordingPolicy !== undefined) data.recordingPolicy = patch.recordingPolicy;
  if (patch.calendarEmail !== undefined) data.calendarEmail = blankToNull(patch.calendarEmail);
  if (patch.repoUrls !== undefined) data.repoUrls = cleanList(patch.repoUrls);
  if (patch.figmaUrls !== undefined) data.figmaUrls = cleanList(patch.figmaUrls);
  if (patch.deploymentUrl !== undefined) data.deploymentUrl = blankToNull(patch.deploymentUrl);
  if (patch.termCount !== undefined) data.termCount = normalizeTermCount(patch.termCount);
  if (patch.githubTeamSlug !== undefined) data.githubTeamSlug = normalizeGithubTeamSlug(patch.githubTeamSlug);
  if (patch.slackChannelName !== undefined) {
    data.slackChannelName = normalizeSlackChannelName(patch.slackChannelName);
  }

  if (Object.keys(data).length === 0) {
    throw new BadRequestError("No fields to update were provided.");
  }

  await prisma.project.update({ where: { id: projectId }, data });
  if (typeof data.name === "string") await ensureProjectGroup(projectId, data.name);
}
