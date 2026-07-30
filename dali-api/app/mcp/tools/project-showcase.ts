// MCP showcase tools — read and curate a project's public card on
// dali.website.
//
// Mirrors the Public view's action (projects.$id.public-view.tsx), including
// its permission split: content is editable by Core or anyone staffed on the
// project (requireProjectEditAccess's rule), but changing `status` is Core-only
// because Published is what puts the project in front of the public.
//
// The status change also refuses without `confirmed: true`, the same gate the
// timesheet tools use. Publishing is the one operation here with consequences
// outside the lab, and an agent drafting a showcase card shouldn't be able to
// ship it in the same breath.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { logAuditEvent } from "~/lib/audit";
import type { ProjectShowcaseStatus } from "~/generated/prisma/client";

const STATUSES = ["NotStarted", "InProgress", "NeedsReview", "Published", "Archive"] as const;

export class ShowcaseNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found`);
    this.name = "ShowcaseNotFoundError";
  }
}

export class ShowcaseForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShowcaseForbiddenError";
  }
}

export class ShowcaseInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShowcaseInvalidError";
  }
}

// ─── get_project_showcase ────────────────────────────────────────────────────

export const GET_PROJECT_SHOWCASE_TOOL = {
  name: "get_project_showcase",
  description:
    "Read a project's public showcase card — the statement, tags, links and publication status shown on dali.website — plus which page is its public write-up. Returns nulls when the project has no showcase row yet.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1, description: "Project.id." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export type ShowcaseOut = {
  projectId: string;
  projectName: string;
  exists: boolean;
  status: ProjectShowcaseStatus | null;
  /** True only when status is Published — i.e. actually live on the site. */
  liveOnWebsite: boolean;
  displayName: string | null;
  tagline: string | null;
  year: number | null;
  partners: string[];
  products: string[];
  sectors: string[];
  techStack: string[];
  appUrl: string | null;
  websiteUrl: string | null;
  blogUrl: string | null;
  pressUrl: string | null;
  heroImageUrl: string | null;
  writeupPage: { id: string; title: string } | null;
};

export async function runGetProjectShowcase(
  _callerId: string,
  input: { projectId: string },
): Promise<ShowcaseOut> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, name: true, showcase: true },
  });
  if (!project) throw new ShowcaseNotFoundError(input.projectId);

  const writeup = await prisma.page.findFirst({
    where: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      archivedAt: null,
      publicVisible: true,
    },
    orderBy: { position: "asc" },
    select: { id: true, title: true },
  });

  const s = project.showcase;
  return {
    projectId: project.id,
    projectName: project.name,
    exists: s !== null,
    status: s?.status ?? null,
    liveOnWebsite: s?.status === "Published",
    displayName: s?.displayName ?? null,
    tagline: s?.tagline ?? null,
    year: s?.year ?? null,
    partners: s?.partners ?? [],
    products: s?.products ?? [],
    sectors: s?.sectors ?? [],
    techStack: s?.techStack ?? [],
    appUrl: s?.appUrl ?? null,
    websiteUrl: s?.websiteUrl ?? null,
    blogUrl: s?.blogUrl ?? null,
    pressUrl: s?.pressUrl ?? null,
    heroImageUrl: await resolvePhotoUrl(s?.heroImageUrl ?? null),
    writeupPage: writeup,
  };
}

// ─── update_project_showcase ─────────────────────────────────────────────────

export const UPDATE_PROJECT_SHOWCASE_TOOL = {
  name: "update_project_showcase",
  description:
    "Create or update a project's public showcase card. Content fields are editable by Core or anyone staffed on the project. Changing `status` is Core-only and requires `confirmed: true` — call once without it to see what would change, show the user, then re-call. Setting status to Published puts the project on dali.website within about a minute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      displayName: {
        type: "string",
        description:
          "Public name, when it differs from the internal one. Empty string clears it and falls back to the project name.",
      },
      tagline: {
        type: "string",
        description:
          "One-line public statement — what the card leads with (e.g. 'Assessing personal risk during COVID'). Empty string clears it.",
      },
      year: { type: "number", description: "Calendar year the project ran, 1990-2100." },
      partners: { type: "array", items: { type: "string" }, description: "e.g. Student Founder." },
      products: { type: "array", items: { type: "string" }, description: "e.g. Mobile, Web, XR." },
      sectors: { type: "array", items: { type: "string" }, description: "e.g. Health, Education." },
      techStack: { type: "array", items: { type: "string" }, description: "e.g. React Native." },
      appUrl: { type: "string" },
      websiteUrl: { type: "string" },
      blogUrl: { type: "string" },
      pressUrl: { type: "string" },
      status: {
        type: "string",
        enum: [...STATUSES],
        description: "Publication status. Core-only, and requires confirmed: true.",
      },
      confirmed: {
        type: "boolean",
        description: "Required only when changing `status`.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type UpdateInput = {
  projectId: string;
  displayName?: string;
  tagline?: string;
  year?: number;
  partners?: string[];
  products?: string[];
  sectors?: string[];
  techStack?: string[];
  appUrl?: string;
  websiteUrl?: string;
  blogUrl?: string;
  pressUrl?: string;
  status?: ProjectShowcaseStatus;
  confirmed?: boolean;
};

export type UpdateShowcaseResult =
  | { ok: true; created: boolean; status: ProjectShowcaseStatus }
  | { ok: false; preview: Record<string, unknown>; needsConfirmation: true };

/** Empty string clears a nullable text field; undefined leaves it alone. */
function textPatch(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function runUpdateProjectShowcase(
  callerId: string,
  input: UpdateInput,
): Promise<UpdateShowcaseResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, name: true, showcase: { select: { status: true } } },
  });
  if (!project) throw new ShowcaseNotFoundError(input.projectId);

  const core = await isCore(callerId);
  if (!core && !(await isProjectMember(callerId, input.projectId))) {
    throw new ShowcaseForbiddenError(
      "Only Core or a member staffed on this project can edit its showcase",
    );
  }
  if (input.status !== undefined && !core) {
    throw new ShowcaseForbiddenError(
      "Only Core or Admin can change what is published publicly",
    );
  }
  if (input.year !== undefined && (input.year < 1990 || input.year > 2100)) {
    throw new ShowcaseInvalidError("year must be between 1990 and 2100");
  }

  const data: Record<string, unknown> = {
    displayName: textPatch(input.displayName),
    tagline: textPatch(input.tagline),
    appUrl: textPatch(input.appUrl),
    websiteUrl: textPatch(input.websiteUrl),
    blogUrl: textPatch(input.blogUrl),
    pressUrl: textPatch(input.pressUrl),
    year: input.year,
    partners: input.partners,
    products: input.products,
    sectors: input.sectors,
    techStack: input.techStack,
    status: input.status,
  };
  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }
  if (Object.keys(data).length === 0) {
    throw new ShowcaseInvalidError("No fields to update");
  }

  // Only the publish flip is gated — content edits are as reversible here as
  // they are in the UI, and gating every field would make the tool unusable
  // for the drafting it exists to do.
  if (input.status !== undefined && !input.confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      preview: {
        action: "update-showcase",
        projectId: input.projectId,
        projectName: project.name,
        statusFrom: project.showcase?.status ?? null,
        statusTo: input.status,
        goesLive: input.status === "Published",
        otherFields: Object.keys(data).filter((k) => k !== "status"),
      },
    };
  }

  const existed = project.showcase !== null;
  const row = await prisma.projectShowcase.upsert({
    where: { projectId: input.projectId },
    create: { projectId: input.projectId, updatedById: callerId, ...data },
    update: { updatedById: callerId, ...data },
    select: { status: true },
  });

  if (input.status !== undefined) {
    await logAuditEvent({
      action: "project.showcase-status",
      userId: callerId,
      targetId: input.projectId,
      metadata: { projectId: input.projectId, status: input.status, via: "mcp" },
    });
  }

  return { ok: true, created: !existed, status: row.status };
}
