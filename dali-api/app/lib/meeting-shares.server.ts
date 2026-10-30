import { prisma } from "~/lib/db.server";
import { resolveGroupMembers } from "~/lib/groups";
import { getPageAccess, PAGE_ACCESS_SELECT, type PageShape } from "~/lib/pageAccess.server";
import type { SharePrincipalType } from "~/generated/prisma/client";

type Principal = { principalType: SharePrincipalType; principalId: string };
type Target = PageShape & { id: string };

const keyOf = (p: Principal) => `${p.principalType}:${p.principalId}`;
const grantKey = (pageId: string, p: Principal) => `${pageId}:${keyOf(p)}`;

/** The pages this meeting justifies sharing: its series notebook, the notebook
 *  each live note sits in, and its live whiteboards. */
async function justifiedPages(meetingId: string, seriesNotebook: Target | null): Promise<Target[]> {
  const rows = await prisma.page.findMany({
    where: { archivedAt: null, OR: [{ meetingNoteId: meetingId }, { meetingWhiteboardId: meetingId }] },
    select: {
      ...PAGE_ACCESS_SELECT,
      meetingNoteId: true,
      meetingWhiteboardId: true,
      parent: { select: { ...PAGE_ACCESS_SELECT, kind: true } },
    },
  });
  const pages = new Map<string, Target>();
  if (seriesNotebook) pages.set(seriesNotebook.id, seriesNotebook);
  for (const row of rows) {
    if (row.meetingWhiteboardId === meetingId) pages.set(row.id, row);
    const parent = row.parent;
    if (row.meetingNoteId === meetingId && parent?.kind === "Notebook" && parent.archivedAt === null) {
      pages.set(parent.id, parent);
    }
  }
  return [...pages.values()];
}

async function desiredPrincipals(
  meeting: { scopeType: string; scopeId: string | null; participantUserIds: string[]; organizerId: string },
  pages: Target[],
  request?: Request,
): Promise<Map<string, Principal[]>> {
  const out = new Map<string, Principal[]>();
  if (pages.length === 0) return out;

  const groupId = meeting.scopeType === "Group" ? meeting.scopeId : null;
  const groupMembers = new Set(groupId ? await resolveGroupMembers(groupId) : []);
  const people = [...new Set([meeting.organizerId, ...meeting.participantUserIds])].filter(
    (id) => !groupMembers.has(id),
  );
  for (const page of pages) {
    const access = await Promise.all(
      people.map((id) => getPageAccess(id, page, request, { ignoreShares: true })),
    );
    out.set(page.id, [
      ...(groupId ? [{ principalType: "Group" as const, principalId: groupId }] : []),
      ...people
        .filter((_, i) => !access[i].canEdit)
        .map((principalId) => ({ principalType: "User" as const, principalId })),
    ]);
  }
  return out;
}

async function applyMeetingShares(meetingId: string, request?: Request): Promise<void> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      notebookId: true,
      scopeType: true,
      scopeId: true,
      participantUserIds: true,
      organizerId: true,
      notebook: { select: PAGE_ACCESS_SELECT },
    },
  });
  if (!meeting) return;

  const pages = await justifiedPages(meetingId, meeting.notebook);
  const desired = await desiredPrincipals(meeting, pages, request);
  const desiredKeys = new Set(pages.flatMap((p) => (desired.get(p.id) ?? []).map((d) => grantKey(p.id, d))));

  const grants = await prisma.meetingShareGrant.findMany({
    where: { scheduledMeetingId: meetingId },
    select: { id: true, pageId: true, principalType: true, principalId: true, pageShareId: true, createdShare: true },
  });
  const grantedKeys = new Set(grants.map((g) => grantKey(g.pageId, g)));
  const stale = grants.filter((g) => !desiredKeys.has(grantKey(g.pageId, g)));
  const toGrantByPage = pages
    .map((page) => ({
      pageId: page.id,
      toGrant: (desired.get(page.id) ?? []).filter((p) => !grantedKeys.has(grantKey(page.id, p))),
    }))
    .filter((entry) => entry.toGrant.length > 0);

  if (stale.length === 0 && toGrantByPage.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const { pageId, toGrant } of toGrantByPage) {
      const existing = await tx.pageShare.findMany({
        where: { pageId, OR: toGrant },
        select: { id: true, principalType: true, principalId: true, permission: true },
      });
      const existingKeys = new Set(existing.map(keyOf));
      const missing = toGrant.filter((p) => !existingKeys.has(keyOf(p)));

      const lower = existing.filter((s) => s.permission === "View" || s.permission === "Comment");
      if (lower.length > 0) {
        await tx.pageShare.updateMany({
          where: { id: { in: lower.map((s) => s.id) } },
          data: { permission: "Edit" },
        });
      }
      if (missing.length > 0) {
        await tx.pageShare.createMany({
          data: missing.map((p) => ({
            pageId,
            ...p,
            permission: "Edit" as const,
            createdById: meeting.organizerId,
          })),
          skipDuplicates: true,
        });
      }

      const shares = missing.length > 0
        ? await tx.pageShare.findMany({
            where: { pageId, OR: toGrant },
            select: { id: true, principalType: true, principalId: true },
          })
        : existing;
      const missingKeys = new Set(missing.map(keyOf));
      await tx.meetingShareGrant.createMany({
        data: shares.map((s) => ({
          scheduledMeetingId: meetingId,
          pageId,
          principalType: s.principalType,
          principalId: s.principalId,
          pageShareId: s.id,
          createdShare: missingKeys.has(keyOf(s)),
        })),
        skipDuplicates: true,
      });
    }

    if (stale.length > 0) {
      const staleIds = stale.map((g) => g.id);
      await tx.meetingShareGrant.deleteMany({ where: { id: { in: staleIds } } });

      const candidateShareIds = stale.filter((g) => g.createdShare).map((g) => g.pageShareId);
      if (candidateShareIds.length > 0) {
        const stillGranted = await tx.meetingShareGrant.findMany({
          where: { pageShareId: { in: candidateShareIds } },
          select: { pageShareId: true },
        });
        const inUse = new Set(stillGranted.map((g) => g.pageShareId));
        const deletable = candidateShareIds.filter((id) => !inUse.has(id));
        if (deletable.length > 0) await tx.pageShare.deleteMany({ where: { id: { in: deletable } } });
      }
    }
  });
}

/** Never throws: a share failure must not fail the roster or notebook change that triggered it. */
export async function syncMeetingShares(meetingId: string, request?: Request): Promise<void> {
  try {
    await applyMeetingShares(meetingId, request);
  } catch (err) {
    console.error(`meeting ${meetingId}: notebook share sync failed`, err);
  }
}

/** Call after the meeting's notebook pointer has been nulled. */
export const removeMeetingShares = (meetingId: string) => syncMeetingShares(meetingId);
