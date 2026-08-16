// Project templates: capture a project's structure into a reusable blueprint,
// and instantiate a new project from one. The blueprint is stored as JSON on
// ProjectTemplate (no live FK back to the source project). We deliberately do
// NOT clone collab docs (epic/task descriptionDocId, sprint goalDocId) — those
// are left blank for the new project to author; only plain-text descriptions and
// checklists carry over.

import { prisma } from "~/lib/db";
import type {
  EpicStatus,
  SprintStatus,
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
// Refs (`e0`, `s0`, …) are blueprint-local ids used to wire tasks→sprint/epic
// and sprints→epic without leaking real cuids. Sprint dates are day-offsets
// from the earliest sprint start, rebased onto the chosen start date on
// instantiate.

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

export interface BlueprintSprint {
  ref: string;
  name: string;
  startOffsetDays: number;
  endOffsetDays: number;
  epicRef: string | null;
  status: SprintStatus;
}

export interface BlueprintTask {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  checklist: unknown;
  epicRef: string | null;
  sprintRef: string | null;
  // Domains are lab-global, so the id carries over verbatim.
  domainId: string | null;
}

export interface ProjectBlueprint {
  version: number;
  epics: BlueprintEpic[];
  sprints: BlueprintSprint[];
  tasks: BlueprintTask[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

// ─── Capture ─────────────────────────────────────────────────────────────────

export async function captureProjectBlueprint(projectId: string): Promise<ProjectBlueprint> {
  const [epics, sprints, tasks] = await Promise.all([
    prisma.epic.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      include: { stories: { orderBy: { position: "asc" } } },
    }),
    prisma.sprint.findMany({ where: { projectId }, orderBy: { startsAt: "asc" } }),
    prisma.task.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    }),
  ]);

  const epicRefById = new Map<string, string>();
  epics.forEach((e, i) => epicRefById.set(e.id, `e${i}`));
  const sprintRefById = new Map<string, string>();
  sprints.forEach((s, i) => sprintRefById.set(s.id, `s${i}`));

  // Rebase sprint dates onto day-offsets from the earliest sprint start.
  const anchor = sprints.length > 0 ? sprints[0].startsAt : new Date(0);

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
    sprints: sprints.map((s) => ({
      ref: sprintRefById.get(s.id)!,
      name: s.name,
      startOffsetDays: daysBetween(anchor, s.startsAt),
      endOffsetDays: daysBetween(anchor, s.endsAt),
      epicRef: s.epicId ? (epicRefById.get(s.epicId) ?? null) : null,
      status: s.status,
    })),
    tasks: tasks.map((t) => ({
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      checklist: t.checklist ?? null,
      epicRef: t.epicId ? (epicRefById.get(t.epicId) ?? null) : null,
      sprintRef: t.sprintId ? (sprintRefById.get(t.sprintId) ?? null) : null,
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
  startDate?: Date;
  initialTermId?: string | null;
  partnerOrgId?: string | null;
}): Promise<{ id: string }> {
  const template = await prisma.projectTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw new Error("Template not found");
  const blueprint = template.blueprint as unknown as ProjectBlueprint;

  const name = input.name.trim();
  if (!name) throw new Error("A project name is required");
  const start = input.startDate ?? new Date();

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
    // Epics first, so sprints/tasks can point at them.
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

    // Sprints, rebasing offsets onto the chosen start date.
    const sprintIdByRef = new Map<string, string>();
    for (const s of blueprint.sprints) {
      const sprint = await tx.sprint.create({
        data: {
          projectId: project.id,
          name: s.name,
          startsAt: new Date(start.getTime() + s.startOffsetDays * DAY_MS),
          endsAt: new Date(start.getTime() + s.endOffsetDays * DAY_MS),
          status: s.status,
          epicId: s.epicRef ? (epicIdByRef.get(s.epicRef) ?? null) : null,
        },
        select: { id: true },
      });
      sprintIdByRef.set(s.ref, sprint.id);
    }

    // Tasks, remapping epic/sprint refs; checklist JSON carries verbatim.
    // Position is per (status) column, in blueprint order.
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
          sprintId: t.sprintRef ? (sprintIdByRef.get(t.sprintRef) ?? null) : null,
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
