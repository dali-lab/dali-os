import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { activeDomainOptions } from "~/lib/reference-cache.server";
import { listActiveCoreMembers } from "~/partners/lib/core-members.server";
import type { Priority, TaskBoardOptions, TaskCardModel, TaskStatus } from "~/projects/lib/task-board";

const CORE_BOARD_SELECT = { id: true, name: true } as const;
const TASK_LIMIT = 1000;

export async function getCoreBoardProject(): Promise<{ id: string; name: string }> {
  const existing = await prisma.project.findFirst({ where: { kind: "CoreBoard" }, select: CORE_BOARD_SELECT });
  if (existing) return existing;
  try {
    return await prisma.project.create({ data: { name: "Core", kind: "CoreBoard" }, select: CORE_BOARD_SELECT });
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    const raced = await prisma.project.findFirst({ where: { kind: "CoreBoard" }, select: CORE_BOARD_SELECT });
    if (!raced) throw err;
    return raced;
  }
}

export async function loadCoreTaskboard(userId: string, request: Request) {
  const [project, members, domains] = await Promise.all([
    getCoreBoardProject(),
    listActiveCoreMembers(request),
    activeDomainOptions(),
  ]);
  const rows = await prisma.task.findMany({
    where: { projectId: project.id, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: TASK_LIMIT,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      position: true,
      dueAt: true,
      startsAt: true,
      epicId: true,
      storyId: true,
      checklist: true,
      githubIssueNumber: true,
      githubIssueUrl: true,
      createdAt: true,
      activityAt: true,
      createdBy: { select: USER_NAME_SELECT },
      domain: { select: { id: true, displayName: true } },
      assignees: { select: { user: { select: USER_NAME_SELECT } } },
      files: {
        where: { file: { archivedAt: null } },
        select: { file: { select: { id: true, title: true, _count: { select: { versions: true } } } } },
      },
      _count: { select: { comments: true } },
      dependencies: { select: { dependsOnTaskId: true } },
    },
  });
  const views = rows.length
    ? await prisma.taskView.findMany({
        where: { userId, taskId: { in: rows.map((t) => t.id) } },
        select: { taskId: true, viewedAt: true },
      })
    : [];
  const viewedAt = new Map(views.map((v) => [v.taskId, v.viewedAt]));

  const tasks: TaskCardModel[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    position: t.position,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    startsAt: t.startsAt ? t.startsAt.toISOString() : null,
    epicId: t.epicId,
    storyId: t.storyId,
    dependsOn: t.dependencies.map((d) => d.dependsOnTaskId),
    checklist: (t.checklist as TaskCardModel["checklist"]) ?? null,
    assignees: t.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
    domain: t.domain ? { id: t.domain.id, name: t.domain.displayName } : null,
    githubIssueUrl: t.githubIssueUrl,
    githubIssueNumber: t.githubIssueNumber,
    files: t.files.map((l) => ({ id: l.file.id, title: l.file.title, versionCount: l.file._count.versions })),
    commentCount: t._count.comments,
    createdBy: { id: t.createdBy.id, name: fullName(t.createdBy) },
    createdAt: t.createdAt.toISOString(),
    activityAt: t.activityAt.toISOString(),
    hasUnread: (() => {
      const seen = viewedAt.get(t.id);
      return !!seen && t.activityAt > seen;
    })(),
  }));

  const options: TaskBoardOptions = {
    members: members.map((m) => ({ id: m.userId, name: m.name, photoUrl: null, domainId: null })),
    domains: domains.map((d) => ({ id: d.id, name: d.displayName })),
    repoUrls: [],
    termSpans: [],
    epics: [],
    stories: [],
    projectFiles: [],
    terms: [],
    currentTermId: null,
  };

  return { projectId: project.id, tasks, options };
}
