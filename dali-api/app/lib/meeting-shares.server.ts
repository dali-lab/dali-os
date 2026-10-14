import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { getPageAccess, PAGE_ACCESS_SELECT, type PageShape } from "~/lib/pageAccess.server";
import type { SharePrincipalType } from "~/generated/prisma/client";

type Principal = { principalType: SharePrincipalType; principalId: string };

const keyOf = (p: Principal) => `${p.principalType}:${p.principalId}`;

async function desiredPrincipals(
  meeting: {
    scopeType: string;
    scopeId: string | null;
    participantUserIds: string[];
    organizerId: string;
    notebook: PageShape | null;
  },
  request?: Request,
): Promise<Principal[]> {
  const { notebook } = meeting;
  if (!notebook) return [];

  const groupId = meeting.scopeType === "Group" ? meeting.scopeId : null;
  const groupMembers = new Set(groupId ? await resolveGroupMembers(groupId) : []);
  const people = [...new Set([meeting.organizerId, ...meeting.participantUserIds])].filter(
    (id) => !groupMembers.has(id),
  );
  const access = await Promise.all(
    people.map((id) => getPageAccess(id, notebook, request, { ignoreShares: true })),
  );

  return [
    ...(groupId ? [{ principalType: "Group" as const, principalId: groupId }] : []),
    ...people
      .filter((_, i) => !access[i].canEdit)
      .map((principalId) => ({ principalType: "User" as const, principalId })),
  ];
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

  const desired = await desiredPrincipals(meeting, request);
  const notebookId = meeting.notebook?.id ?? null;
  const desiredKeys = new Set(desired.map(keyOf));

  const grants = await prisma.meetingShareGrant.findMany({
    where: { scheduledMeetingId: meetingId },
    select: { id: true, pageId: true, principalType: true, principalId: true, pageShareId: true, createdShare: true },
  });
  const grantedHere = new Set(grants.filter((g) => g.pageId === notebookId).map(keyOf));
  const stale = grants.filter((g) => g.pageId !== notebookId || !desiredKeys.has(keyOf(g)));
  const toGrant = desired.filter((p) => !grantedHere.has(keyOf(p)));

  if (stale.length === 0 && toGrant.length === 0) return;

  await prisma.$transaction(async (tx) => {
    if (notebookId && toGrant.length > 0) {
      const existing = await tx.pageShare.findMany({
        where: { pageId: notebookId, OR: toGrant },
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
            pageId: notebookId,
            ...p,
            permission: "Edit" as const,
            createdById: meeting.organizerId,
          })),
          skipDuplicates: true,
        });
      }

      const shares = missing.length > 0
        ? await tx.pageShare.findMany({
            where: { pageId: notebookId, OR: toGrant },
            select: { id: true, principalType: true, principalId: true },
          })
        : existing;
      const missingKeys = new Set(missing.map(keyOf));
      await tx.meetingShareGrant.createMany({
        data: shares.map((s) => ({
          scheduledMeetingId: meetingId,
          pageId: notebookId,
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
