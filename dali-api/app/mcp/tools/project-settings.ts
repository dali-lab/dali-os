// MCP `get_project_settings` — the project's configuration, as shown on the
// detail page's settings surfaces.
//
// Read-only by design. `get_project_overview` already covers the working state
// (roster, active sprint, task counts, description); this fills the other half:
// the term set, declared domains, the per-(domain, term) scope grid, and the
// integration identities. Nothing here writes — the project record is edited on
// its detail page, where the term/domain pickers carry validation an agent
// shouldn't be reimplementing from a flat argument list.
//
// `chartString` / `chartStringType` are deliberately NOT returned. They're
// Dartmouth payroll GL codes, admin-edited, and nothing an agent needs to do
// its job — the same reasoning that keeps the payroll TimesheetEntry model out
// of the timesheet tools.

import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";

export class ProjectSettingsNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found`);
    this.name = "ProjectSettingsNotFoundError";
  }
}

export const GET_PROJECT_SETTINGS_TOOL = {
  name: "get_project_settings",
  description:
    "Read a project's configuration: its planned terms, declared domains, the per-domain-per-term scope grid, repos, deployment URL, and its Slack/GitHub/Google identities. Complements `get_project_overview`, which covers the live working state instead. Payroll chart strings are not included.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        description: "Project.id, as returned by `list_projects` or `list_my_projects`.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

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
