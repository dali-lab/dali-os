import type { Prisma } from "~/generated/prisma/client";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import type { Priority, TaskCardModel, TaskStatus } from "./task-board";

export const TASK_CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  position: true,
  epicId: true,
  sprintId: true,
  carryoverCount: true,
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
    select: {
      file: { select: { id: true, title: true, _count: { select: { versions: true } } } },
    },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskSelect;

export type TaskCardRow = Prisma.TaskGetPayload<{ select: typeof TASK_CARD_SELECT }>;

export function toTaskCard(t: TaskCardRow, viewedAt?: Date | null): TaskCardModel {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    position: t.position,
    epicId: t.epicId,
    sprintId: t.sprintId,
    carryoverCount: t.carryoverCount,
    checklist: (t.checklist as TaskCardModel["checklist"]) ?? null,
    assignees: t.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
    domain: t.domain ? { id: t.domain.id, name: t.domain.displayName } : null,
    githubIssueUrl: t.githubIssueUrl,
    githubIssueNumber: t.githubIssueNumber,
    files: t.files.map((l) => ({
      id: l.file.id,
      title: l.file.title,
      versionCount: l.file._count.versions,
    })),
    commentCount: t._count.comments,
    createdBy: { id: t.createdBy.id, name: fullName(t.createdBy) },
    createdAt: t.createdAt.toISOString(),
    activityAt: t.activityAt.toISOString(),
    hasUnread: !!viewedAt && t.activityAt > viewedAt,
  };
}
