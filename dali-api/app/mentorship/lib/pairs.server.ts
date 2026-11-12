import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";

type Actor = { actorId: string; request?: Request };

export async function upsertMentorshipPair(
  a: {
    menteeUserId: string;
    mentorUserId: string;
    projectId: string;
    termId: string;
    domainId: string;
  } & Actor,
): Promise<{ id: string; created: boolean }> {
  const { menteeUserId, mentorUserId, projectId, termId, domainId, actorId, request } = a;
  const existing = await prisma.mentorshipPair.findMany({
    where: { menteeUserId, projectId, termId, domainId },
    select: { id: true, mentorUserId: true },
  });
  if (existing.length > 0) {
    const [keep, ...extra] = existing;
    if (extra.length > 0) {
      await prisma.mentorshipPair.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
    }
    const updated = await prisma.mentorshipPair.update({
      where: { id: keep.id },
      data: { mentorUserId, manual: true },
      select: { id: true },
    });
    await logAuditEvent({
      action: "mentorship.pair.update",
      userId: actorId,
      targetId: updated.id,
      metadata: {
        menteeUserId,
        fromMentorUserId: keep.mentorUserId,
        toMentorUserId: mentorUserId,
        projectId,
        termId,
        domainId,
        collapsedExtras: extra.length,
      },
      request,
    });
    return { id: updated.id, created: false };
  }
  const created = await prisma.mentorshipPair.create({
    data: { menteeUserId, mentorUserId, projectId, termId, domainId, manual: true },
    select: { id: true },
  });
  await logAuditEvent({
    action: "mentorship.pair.create",
    userId: actorId,
    targetId: created.id,
    metadata: { menteeUserId, mentorUserId, projectId, termId, domainId },
    request,
  });
  return { id: created.id, created: true };
}

export async function reassignMentorshipPair(
  a: { id: string; mentorUserId: string } & Actor,
): Promise<{ id: string; merged: boolean } | null> {
  const { id, mentorUserId, actorId, request } = a;
  const pair = await prisma.mentorshipPair.findUnique({
    where: { id },
    select: { menteeUserId: true, mentorUserId: true, projectId: true, termId: true, domainId: true },
  });
  if (!pair) return null;

  const existing = await prisma.mentorshipPair.findFirst({
    where: {
      menteeUserId: pair.menteeUserId,
      mentorUserId,
      projectId: pair.projectId,
      termId: pair.termId,
      domainId: pair.domainId,
    },
    select: { id: true },
  });
  if (existing && existing.id !== id) {
    await prisma.mentorshipPair.delete({ where: { id } });
    await logAuditEvent({
      action: "mentorship.pair.update",
      userId: actorId,
      targetId: existing.id,
      metadata: {
        menteeUserId: pair.menteeUserId,
        fromMentorUserId: pair.mentorUserId,
        toMentorUserId: mentorUserId,
        mergedFromPairId: id,
      },
      request,
    });
    return { id: existing.id, merged: true };
  }
  const updated = await prisma.mentorshipPair.update({
    where: { id },
    data: { mentorUserId, manual: true },
    select: { id: true },
  });
  await logAuditEvent({
    action: "mentorship.pair.update",
    userId: actorId,
    targetId: updated.id,
    metadata: {
      menteeUserId: pair.menteeUserId,
      fromMentorUserId: pair.mentorUserId,
      toMentorUserId: mentorUserId,
    },
    request,
  });
  return { id: updated.id, merged: false };
}

export async function deleteMentorshipPairs(a: { ids: string[] } & Actor): Promise<{ deleted: number }> {
  const result = await prisma.mentorshipPair.deleteMany({ where: { id: { in: a.ids } } });
  await logAuditEvent({
    action: "mentorship.pair.delete",
    userId: a.actorId,
    targetId: a.ids[0],
    metadata: { ids: a.ids, deleted: result.count },
    request: a.request,
  });
  return { deleted: result.count };
}
