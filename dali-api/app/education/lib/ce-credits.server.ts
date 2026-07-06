import { prisma } from "~/lib/db";
import type { Prisma, AttendanceStatus } from "~/generated/prisma/client";
import { currentTermMemberWhere } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

// Continuing-education credit ledger. Policy: every lab member earns ≥1 CE
// credit per term; a `Present` attendance mark grants one (idempotent via
// @@unique([userId, sessionId])); un-marking revokes the derived row. Manual
// Core grants (sessionId null, reason set) cover the async CEC check-in path
// and special cases. Compliance is display-only — nothing hard-blocks on it.

/**
 * The Term a session date belongs to: the containing term, else the next
 * upcoming one (mirrors currentTerm()'s roll-forward so inter-term-gap
 * sessions don't fall into a void). Attribution is decided once, at grant
 * time, and frozen on the ledger row.
 */
export async function termForDate(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<{ id: string } | null> {
  const containing = await tx.term.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { sortKey: "desc" },
    select: { id: true },
  });
  if (containing) return containing;
  return tx.term.findFirst({
    where: { startDate: { gt: date } },
    orderBy: { sortKey: "asc" },
    select: { id: true },
  });
}

/**
 * Keep the ledger in sync with an attendance mark, inside the attendance
 * save transaction. Present → grant (upsert); anything else → revoke the
 * attendance-derived row. Manual grants are untouched (they have no
 * sessionId). No-ops silently when the Term table is empty.
 */
export async function syncCreditForAttendance(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    sessionId: string;
    status: AttendanceStatus | null;
    sessionDate: Date;
  },
): Promise<void> {
  if (args.status === "Present") {
    const term = await termForDate(tx, args.sessionDate);
    if (!term) return;
    await tx.cECredit.upsert({
      where: {
        userId_sessionId: { userId: args.userId, sessionId: args.sessionId },
      },
      create: {
        userId: args.userId,
        termId: term.id,
        sessionId: args.sessionId,
      },
      update: {},
    });
  } else {
    await tx.cECredit.deleteMany({
      where: { userId: args.userId, sessionId: args.sessionId },
    });
  }
}

export async function grantManualCredit(args: {
  userId: string;
  termId: string;
  reason: string;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const reason = args.reason.trim();
  if (!reason) return { error: "A reason is required for manual grants", status: 400 };
  const [user, term] = await Promise.all([
    prisma.user.findUnique({ where: { id: args.userId }, select: { id: true } }),
    prisma.term.findUnique({ where: { id: args.termId }, select: { id: true } }),
  ]);
  if (!user || !term) return { error: "Member or term not found", status: 404 };
  await prisma.cECredit.create({
    data: {
      userId: args.userId,
      termId: args.termId,
      grantedById: args.actorId,
      reason,
    },
  });
  await logAuditEvent({
    action: "education.cecredit.grant",
    userId: args.actorId,
    targetId: args.userId,
    metadata: { termId: args.termId, reason },
  });
  return { ok: true };
}

/** Revoke a MANUAL credit. Attendance-derived rows revoke via attendance. */
export async function revokeManualCredit(args: {
  creditId: string;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const credit = await prisma.cECredit.findUnique({
    where: { id: args.creditId },
    select: { id: true, sessionId: true, userId: true },
  });
  if (!credit) return { error: "Credit not found", status: 404 };
  if (credit.sessionId !== null)
    return {
      error: "Attendance-derived credits revoke by un-marking the attendance",
      status: 400,
    };
  await prisma.cECredit.delete({ where: { id: args.creditId } });
  await logAuditEvent({
    action: "education.cecredit.revoke",
    userId: args.actorId,
    targetId: credit.userId,
    metadata: { creditId: args.creditId },
  });
  return { ok: true };
}

export async function creditHistory(userId: string) {
  const credits = await prisma.cECredit.findMany({
    where: { userId },
    orderBy: { grantedAt: "desc" },
    select: {
      id: true,
      grantedAt: true,
      reason: true,
      sessionId: true,
      term: { select: { code: true } },
      session: {
        select: {
          sequence: true,
          offering: { select: { title: true } },
        },
      },
      grantedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return credits.map((c) => ({
    id: c.id,
    grantedAt: c.grantedAt,
    termCode: c.term.code,
    source: c.session
      ? `Attended ${c.session.offering.title} (session ${c.session.sequence})`
      : (c.reason ?? "Manual grant"),
    manual: c.sessionId === null,
    grantedByName: c.grantedBy
      ? `${c.grantedBy.firstName} ${c.grantedBy.lastName}`.trim()
      : null,
  }));
}

/**
 * Per-member credit counts for one term across current lab members —
 * the Core end-of-term compliance view. Display-only.
 */
export async function complianceForTerm(termId: string) {
  const members = await prisma.user.findMany({
    where: await currentTermMemberWhere(),
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const counts = await prisma.cECredit.groupBy({
    by: ["userId"],
    where: { termId, userId: { in: members.map((m) => m.id) } },
    _count: { _all: true },
  });
  const countByUser = new Map(counts.map((c) => [c.userId, c._count._all]));
  return members.map((m) => ({
    userId: m.id,
    name: `${m.firstName} ${m.lastName}`.trim(),
    credits: countByUser.get(m.id) ?? 0,
    compliant: (countByUser.get(m.id) ?? 0) >= 1,
  }));
}
