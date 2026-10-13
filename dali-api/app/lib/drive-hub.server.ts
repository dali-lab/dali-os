import { prisma } from "~/lib/db";
import type { DriveItem } from "~/lib/drive.server";

type Viewer = { userId: string; isCore: boolean; termId: string | null };

/**
 * The projects whose drives the viewer sees. Same access filter as
 * documents.hub: Core sees all projects; others see only projects they're
 * staffed on, scoped to the selected term ("All terms" drops the gate).
 */
export async function loadProjectWorkspaces({ userId, isCore, termId }: Viewer) {
  const rows = await prisma.project.findMany({
    where: {
      ...(termId ? { projectTerms: { some: { termId } } } : {}),
      ...(isCore ? {} : { assignments: { some: { userId } } }),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, iconEmoji: true },
  });
  return rows.map((p) => ({
    key: p.id,
    label: p.name,
    kind: "project" as const,
    projectIconEmoji: p.iconEmoji,
  }));
}

/**
 * The education workspaces the viewer sees. Access rule mirrors pageAccess.server:
 * Core sees all offerings; non-Core sees offerings where they are an instructor
 * (any term) OR have an Approved application. Offerings don't store a term — one
 * belongs to the selected term when its run starts inside that term's date window —
 * so the term gate is a date range on `startsAt`, not the instructor-assignment term.
 */
export async function loadEducationWorkspaces({ userId, isCore, termId }: Viewer) {
  const termWindow = termId
    ? await prisma.term.findUnique({
        where: { id: termId },
        select: { startDate: true, endDate: true },
      })
    : null;
  const startsInTerm = termWindow
    ? { startsAt: { gte: termWindow.startDate, lte: termWindow.endDate } }
    : {};
  const offerings = await prisma.educationOffering.findMany({
    where: isCore
      ? termWindow
        ? startsInTerm
        : undefined
      : {
          AND: [
            startsInTerm,
            {
              OR: [
                { instructors: { some: { userId } } },
                { applications: { some: { applicantUserId: userId, status: "Approved" } } },
              ],
            },
          ],
        },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
  return offerings.map((o) => ({ key: o.id, label: o.title, kind: "education" as const }));
}

/** Every live tag, so the filter control exists before anything is tagged. */
export function loadAllDocTags() {
  return prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });
}

/**
 * Tag ids per item id, keyed by the ids the scopes actually resolved to: two
 * bounded queries rather than a tag join on every scope loader, which keeps
 * drive.server knowing nothing about tags.
 */
export async function loadItemTagIds(
  scopes: ReadonlyArray<{ items: ReadonlyArray<Pick<DriveItem, "type" | "id">> }>,
): Promise<Record<string, string[]>> {
  const pageIds: string[] = [];
  const fileIds: string[] = [];
  for (const scope of scopes) {
    for (const item of scope.items) {
      if (item.type === "doc" || item.type === "folder") pageIds.push(item.id);
      else if (item.type === "file") fileIds.push(item.id);
    }
  }
  const [pageTags, fileTags] = await Promise.all([
    pageIds.length
      ? prisma.pageTag.findMany({
          where: { pageId: { in: pageIds }, tag: { archivedAt: null } },
          select: { pageId: true, tag: { select: { id: true } } },
        })
      : [],
    fileIds.length
      ? prisma.projectFileTag.findMany({
          where: { fileId: { in: fileIds }, tag: { archivedAt: null } },
          select: { fileId: true, tag: { select: { id: true } } },
        })
      : [],
  ]);
  const itemTagIds: Record<string, string[]> = {};
  for (const { pageId, tag } of pageTags) (itemTagIds[pageId] ??= []).push(tag.id);
  for (const { fileId, tag } of fileTags) (itemTagIds[fileId] ??= []).push(tag.id);
  return itemTagIds;
}
