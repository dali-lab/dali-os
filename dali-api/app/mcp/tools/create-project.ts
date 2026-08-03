// MCP `create_project` — Core/Admin only, mirrors the web projects hub action
// (projects.hub.tsx) plus the scope fields the hub leaves to the settings
// modal (declared domains and their per-term challenges), so an agent can
// stand a project up in one call instead of create-then-edit.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { ensureProjectGroup } from "~/lib/groups";
import { githubTeamSlug } from "~/lib/github-slug";

const PROJECT_STATUSES = ["Active", "Paused", "Archived"] as const;
type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CREATE_PROJECT_TOOL = {
  name: "create_project",
  description:
    "Create a project. Requires Core or Admin access. Optionally seeds the " +
    "planned term set, declared domains, per-(domain, term) challenges, and " +
    "a partner org. Term and domain ids come from list_terms and the " +
    "domains reference (use list_projects on an existing project to see the " +
    "shape). Returns the new project's id.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: {
        type: "string",
        description: "Short plain-text blurb. Omit or empty string for none.",
      },
      iconEmoji: {
        type: "string",
        description: "Single emoji shown before the project name.",
      },
      status: {
        type: "string",
        enum: PROJECT_STATUSES as unknown as string[],
        description: "Defaults to 'Active'.",
      },
      termIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Terms this project runs. The start term is derived as the earliest of these.",
      },
      domainIds: {
        type: "array",
        items: { type: "string" },
        description: "Declared domains. Must be active domains.",
      },
      challenges: {
        type: "array",
        description:
          "Per-(domain, term) challenge text. Each domainId must be in " +
          "domainIds and each termId in termIds.",
        items: {
          type: "object",
          properties: {
            domainId: { type: "string", minLength: 1 },
            termId: { type: "string", minLength: 1 },
            scope: { type: "string", minLength: 1 },
          },
          required: ["domainId", "termId", "scope"],
          additionalProperties: false,
        },
      },
      partnerOrgId: {
        type: "string",
        description: "Optional partner org to link up front.",
      },
      termCount: {
        type: "integer",
        minimum: 1,
        description:
          "Expected span in terms. Defaults to the number of termIds given (min 1).",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Challenge = { domainId: string; termId: string; scope: string };

type Input = {
  name: string;
  description?: string;
  iconEmoji?: string;
  status?: ProjectStatus;
  termIds?: string[];
  domainIds?: string[];
  challenges?: Challenge[];
  partnerOrgId?: string;
  termCount?: number;
};

export class CreateProjectError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateProjectError";
  }
}

export async function runCreateProject(callerId: string, input: Input) {
  // Project creation is Core/Admin only on the web hub; there is no
  // project-member path here because the project doesn't exist yet.
  if (!(await isCore(callerId))) {
    throw new CreateProjectError("Forbidden", 403);
  }

  const name = input.name.trim();
  if (!name) throw new CreateProjectError("Name is required", 400);

  const status = input.status ?? "Active";
  if (!PROJECT_STATUSES.includes(status)) {
    throw new CreateProjectError("Invalid status", 400);
  }

  const termIds = dedupe(input.termIds ?? []);
  const domainIds = dedupe(input.domainIds ?? []);
  const challenges = input.challenges ?? [];

  if (termIds.length > 0) {
    const found = await prisma.term.findMany({
      where: { id: { in: termIds } },
      select: { id: true },
    });
    const missing = termIds.filter((id) => !found.some((t) => t.id === id));
    if (missing.length > 0) {
      throw new CreateProjectError(`Unknown term(s): ${missing.join(", ")}`, 400);
    }
  }

  if (domainIds.length > 0) {
    // Only active domains may be declared — same filter the settings modal's
    // domains handler applies.
    const found = await prisma.domain.findMany({
      where: { id: { in: domainIds }, active: true },
      select: { id: true },
    });
    const missing = domainIds.filter((id) => !found.some((d) => d.id === id));
    if (missing.length > 0) {
      throw new CreateProjectError(
        `Unknown or inactive domain(s): ${missing.join(", ")}`,
        400,
      );
    }
  }

  // A challenge cell is meaningless outside the project's declared domains and
  // planned terms, and the web grid can only ever address those. Reject rather
  // than silently drop, so a caller with a typo finds out.
  for (const c of challenges) {
    if (!domainIds.includes(c.domainId)) {
      throw new CreateProjectError(
        `Challenge domainId ${c.domainId} is not in domainIds`,
        400,
      );
    }
    if (!termIds.includes(c.termId)) {
      throw new CreateProjectError(
        `Challenge termId ${c.termId} is not in termIds`,
        400,
      );
    }
    if (!c.scope.trim()) {
      throw new CreateProjectError(
        `Challenge for domain ${c.domainId} has empty text`,
        400,
      );
    }
  }
  const dupe = firstDuplicateCell(challenges);
  if (dupe) {
    throw new CreateProjectError(
      `Duplicate challenge for domain ${dupe.domainId} in term ${dupe.termId}`,
      400,
    );
  }

  if (input.partnerOrgId) {
    const org = await prisma.partnerOrg.findUnique({
      where: { id: input.partnerOrgId },
      select: { id: true },
    });
    if (!org) throw new CreateProjectError("Unknown partnerOrgId", 400);
  }

  const description = input.description?.trim() ?? "";
  const iconEmoji = input.iconEmoji?.trim() ?? "";

  const created = await prisma.project.create({
    data: {
      name,
      // Derived from the name, editable later — same as the web hub, so the
      // roster→team sync works without a manual step.
      githubTeamSlug: githubTeamSlug(name) || null,
      description: description === "" ? null : description,
      iconEmoji: iconEmoji === "" ? null : iconEmoji,
      status,
      termCount: input.termCount ?? Math.max(1, termIds.length),
      ...(termIds.length > 0
        ? { projectTerms: { create: termIds.map((termId) => ({ termId })) } }
        : {}),
      ...(domainIds.length > 0
        ? { domains: { create: domainIds.map((domainId) => ({ domainId })) } }
        : {}),
      ...(challenges.length > 0
        ? {
            domainScopes: {
              create: challenges.map((c) => ({
                domainId: c.domainId,
                termId: c.termId,
                scope: c.scope,
                updatedById: callerId,
              })),
            },
          }
        : {}),
      ...(input.partnerOrgId
        ? { partners: { create: { partnerOrgId: input.partnerOrgId } } }
        : {}),
    },
    select: { id: true, name: true },
  });

  await ensureProjectGroup(created.id, created.name);

  return {
    id: created.id,
    name: created.name,
    termCount: termIds.length,
    domainCount: domainIds.length,
    challengeCount: challenges.length,
  };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function firstDuplicateCell(challenges: Challenge[]): Challenge | null {
  const seen = new Set<string>();
  for (const c of challenges) {
    const key = `${c.domainId}:${c.termId}`;
    if (seen.has(key)) return c;
    seen.add(key);
  }
  return null;
}
