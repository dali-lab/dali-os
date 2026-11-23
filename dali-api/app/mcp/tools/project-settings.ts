import { prisma } from "~/lib/db.server";
import { resolvePhotoUrl } from "~/lib/photo";

export class ProjectSettingsNotFoundError extends Error {
  status = 404;
  constructor(id: string) {
    super(`Project ${id} not found`);
    this.name = "ProjectSettingsNotFoundError";
  }
}

export type ProjectSettings = {
  id: string;
  name: string;
  status: string;
  description: string | null;
  imageUrl: string | null;
  /** How many terms the project is *planned* to run — not derived from `terms`. */
  termCount: number;
  terms: string[];
  domains: { id: string; code: string; displayName: string }[];
  repoUrls: string[];
  figmaUrls: string[];
  deploymentUrl: string | null;
  slackChannelName: string | null;
  slackChannelId: string | null;
  githubTeamSlug: string | null;
  calendarEmail: string | null;
  teamGroupEmail: string | null;
  overviewPageId: string | null;
  prdPageId: string | null;
  /** One entry per (domain, term) cell that has text. Empty cells are omitted. */
  scopes: { domain: string; term: string; scope: string }[];
  showcaseStatus: string | null;
};

export async function runGetProjectSettings(
  _callerId: string,
  input: { projectId: string },
): Promise<ProjectSettings> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      status: true,
      description: true,
      imageUrl: true,
      termCount: true,
      repoUrls: true,
      figmaUrls: true,
      deploymentUrl: true,
      slackChannelName: true,
      slackChannelId: true,
      githubTeamSlug: true,
      calendarEmail: true,
      teamGroupEmail: true,
      overviewPageId: true,
      prdPageId: true,
      projectTerms: { select: { term: { select: { code: true, sortKey: true } } } },
      domains: {
        select: { domain: { select: { id: true, code: true, displayName: true } } },
      },
      domainScopes: {
        select: {
          scope: true,
          domain: { select: { displayName: true } },
          term: { select: { code: true, sortKey: true } },
        },
      },
      showcase: { select: { status: true } },
    },
  });
  if (!project) throw new ProjectSettingsNotFoundError(input.projectId);

  return {
    id: project.id,
    name: project.name,
    status: project.status,
    description: project.description,
    imageUrl: await resolvePhotoUrl(project.imageUrl),
    termCount: project.termCount,
    terms: [...project.projectTerms]
      .sort((a, b) => a.term.sortKey - b.term.sortKey)
      .map((t) => t.term.code),
    domains: project.domains.map((d) => d.domain),
    repoUrls: project.repoUrls,
    figmaUrls: project.figmaUrls,
    deploymentUrl: project.deploymentUrl,
    slackChannelName: project.slackChannelName,
    slackChannelId: project.slackChannelId,
    githubTeamSlug: project.githubTeamSlug,
    calendarEmail: project.calendarEmail,
    teamGroupEmail: project.teamGroupEmail,
    overviewPageId: project.overviewPageId,
    prdPageId: project.prdPageId,
    scopes: [...project.domainScopes]
      .sort((a, b) => a.term.sortKey - b.term.sortKey)
      .map((s) => ({
        domain: s.domain.displayName,
        term: s.term.code,
        scope: s.scope,
      })),
    showcaseStatus: project.showcase?.status ?? null,
  };
}
