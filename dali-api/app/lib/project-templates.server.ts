// Project templates: capture a project's structure into a reusable blueprint,
// and instantiate a new project from one. The blueprint is stored as JSON on
// ProjectTemplate (no live FK back to the source project). We deliberately do
// NOT clone collab docs (epic/task descriptionDocId) — those are left blank for
// the new project to author; only plain-text descriptions and checklists carry
// over. Sprints are the computed term grid, not stored rows, so they aren't
// captured; instantiated tasks land in the backlog until they're dated.

import { prisma } from "~/lib/db";
import type {
  EpicStatus,
  TaskStatus,
  Priority,
  UserStoryStatus,
  StoryPriority,
  ProjectStatus,
} from "~/generated/prisma/enums";
import { githubTeamSlug } from "~/lib/github-slug";
import { ensureProjectGroup } from "~/lib/groups";
import { duplicatePage } from "~/lib/page-copy.server";

// ─── Blueprint shape (version 1) ─────────────────────────────────────────────
// Refs (`e0`, …) are blueprint-local ids used to wire tasks→epic without leaking
// real cuids.

export const PROJECT_BLUEPRINT_VERSION = 1;

export interface BlueprintStory {
  title: string;
  notes: string | null;
  status: UserStoryStatus;
  successMetric: string | null;
  acceptanceCriteria: string | null;
  category: string | null;
  priority: StoryPriority | null;
}

export interface BlueprintEpic {
  ref: string;
  title: string;
  description: string | null;
  status: EpicStatus;
  stories: BlueprintStory[];
}

export interface BlueprintTask {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  checklist: unknown;
  epicRef: string | null;
  // Domains are lab-global, so the id carries over verbatim.
  domainId: string | null;
}

export interface ProjectBlueprint {
  version: number;
  epics: BlueprintEpic[];
  tasks: BlueprintTask[];
}

// ─── Capture ─────────────────────────────────────────────────────────────────

export async function captureProjectBlueprint(projectId: string): Promise<ProjectBlueprint> {
  const [epics, tasks] = await Promise.all([
    prisma.epic.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      include: { stories: { orderBy: { position: "asc" } } },
    }),
    prisma.task.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    }),
  ]);

  const epicRefById = new Map<string, string>();
  epics.forEach((e, i) => epicRefById.set(e.id, `e${i}`));

  return {
    version: PROJECT_BLUEPRINT_VERSION,
    epics: epics.map((e) => ({
      ref: epicRefById.get(e.id)!,
      title: e.title,
      description: e.description,
      status: e.status,
      stories: e.stories.map((s) => ({
        title: s.title,
        notes: s.notes,
        status: s.status,
        successMetric: s.successMetric,
        acceptanceCriteria: s.acceptanceCriteria,
        category: s.category,
        priority: s.priority,
      })),
    })),
    tasks: tasks.map((t) => ({
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      checklist: t.checklist ?? null,
      epicRef: t.epicId ? (epicRefById.get(t.epicId) ?? null) : null,
      domainId: t.domainId,
    })),
  };
}

export async function captureProjectTemplate(input: {
  projectId: string;
  name: string;
  description?: string | null;
  createdBy: string;
  includeOverviewPage?: boolean;
}): Promise<{ id: string }> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, iconEmoji: true, overviewPageId: true },
  });
  if (!project) throw new Error("Project not found");

  const blueprint = await captureProjectBlueprint(input.projectId);

  const created = await prisma.projectTemplate.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      iconEmoji: project.iconEmoji,
      blueprint: blueprint as unknown as object,
      overviewSourcePageId: input.includeOverviewPage ? project.overviewPageId : null,
      createdBy: input.createdBy,
    },
    select: { id: true },
  });
  return created;
}

// ─── Instantiate ─────────────────────────────────────────────────────────────

export async function instantiateProjectTemplate(input: {
  templateId: string;
  name: string;
  createdBy: string;
  initialTermId?: string | null;
  partnerOrgId?: string | null;
}): Promise<{ id: string }> {
  const template = await prisma.projectTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw new Error("Template not found");
  const blueprint = template.blueprint as unknown as ProjectBlueprint;

  const name = input.name.trim();
  if (!name) throw new Error("A project name is required");

  // Create the project shell (mirrors projects.hub create action), then rebuild
  // its structure in a single transaction so a mid-way failure leaves nothing.
  const project = await prisma.project.create({
    data: {
      name,
      githubTeamSlug: githubTeamSlug(name) || null,
      iconEmoji: template.iconEmoji,
      status: "Active" satisfies ProjectStatus as ProjectStatus,
      ...(input.initialTermId ? { projectTerms: { create: { termId: input.initialTermId } } } : {}),
      ...(input.partnerOrgId ? { partners: { create: { partnerOrgId: input.partnerOrgId } } } : {}),
    },
    select: { id: true, name: true },
  });

  await prisma.$transaction(async (tx) => {
    // Epics first, so tasks can point at them.
    const epicIdByRef = new Map<string, string>();
    for (const [i, e] of blueprint.epics.entries()) {
      const epic = await tx.epic.create({
        data: {
          projectId: project.id,
          title: e.title,
          description: e.description,
          status: e.status,
          position: i,
          stories: {
            create: e.stories.map((s, si) => ({
              title: s.title,
              notes: s.notes,
              status: s.status,
              position: si,
              successMetric: s.successMetric,
              acceptanceCriteria: s.acceptanceCriteria,
              category: s.category,
              priority: s.priority,
            })),
          },
        },
        select: { id: true },
      });
      epicIdByRef.set(e.ref, epic.id);
    }

    // Tasks, remapping epic refs; checklist JSON carries verbatim. Position is
    // per (status) column, in blueprint order. Tasks land undated (backlog) —
    // their sprint is derived from dates the new project will set.
    const posByStatus = new Map<string, number>();
    for (const t of blueprint.tasks) {
      const pos = posByStatus.get(t.status) ?? 0;
      posByStatus.set(t.status, pos + 1);
      await tx.task.create({
        data: {
          projectId: project.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          position: pos,
          checklist: (t.checklist ?? undefined) as object | undefined,
          epicId: t.epicRef ? (epicIdByRef.get(t.epicRef) ?? null) : null,
          domainId: t.domainId,
          createdById: input.createdBy,
        },
      });
    }
  });

  // Optional: seed the Overview page from the template's source page.
  if (template.overviewSourcePageId) {
    try {
      const overview = await duplicatePage({
        sourcePageId: template.overviewSourcePageId,
        createdById: input.createdBy,
        titleOverride: name,
        workspaceTypeOverride: "Project",
        workspaceIdOverride: project.id,
        parentPageIdOverride: null,
      });
      await prisma.project.update({
        where: { id: project.id },
        data: { overviewPageId: overview.id },
      });
    } catch {
      // Non-fatal: the project still exists without a seeded overview.
    }
  }

  await ensureProjectGroup(project.id, project.name);
  return { id: project.id };
}
