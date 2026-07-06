import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { syncCreditForAttendance } from "./ce-credits.server";
import type { AttendanceStatus } from "~/generated/prisma/client";

// Instructor attendance marking. The roster is the offering's Approved
// applications; marks upsert on (applicationId, sessionId). W8 hooks CE
// credit sync into the same transaction (Present grants, un-marking revokes).

export async function getSessionRoster(offeringId: string, sessionId: string) {
  const session = await prisma.educationSession.findUnique({
    where: { id: sessionId },
    select: { id: true, offeringId: true, sequence: true, datetime: true },
  });
  if (!session || session.offeringId !== offeringId) return null;

  const [roster, marks] = await Promise.all([
    prisma.educationApplication.findMany({
      where: { offeringId, status: "Approved" },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        applicant: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.educationAttendance.findMany({
      where: { sessionId },
      select: { applicationId: true, status: true },
    }),
  ]);
  const markByApplication = new Map(marks.map((m) => [m.applicationId, m.status]));
  return {
    session,
    roster: roster.map((r) => ({
      applicationId: r.id,
      name: `${r.applicant.firstName} ${r.applicant.lastName}`.trim(),
      status: markByApplication.get(r.id) ?? null,
    })),
  };
}

const STATUSES: AttendanceStatus[] = ["Present", "Absent", "Excused"];

/**
 * Bulk-save a session's roster. `marks` entries with a null status clear the
 * mark. Only Approved applications of the owning offering are accepted.
 */
export async function saveAttendance(args: {
  offeringId: string;
  sessionId: string;
  marks: { applicationId: string; status: AttendanceStatus | null }[];
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const session = await prisma.educationSession.findUnique({
    where: { id: args.sessionId },
    select: { offeringId: true, datetime: true },
  });
  if (!session || session.offeringId !== args.offeringId)
    return { error: "Session not found", status: 404 };

  for (const m of args.marks) {
    if (m.status !== null && !STATUSES.includes(m.status))
      return { error: "Invalid attendance status", status: 400 };
  }

  const valid = await prisma.educationApplication.findMany({
    where: {
      id: { in: args.marks.map((m) => m.applicationId) },
      offeringId: args.offeringId,
      status: "Approved",
    },
    select: { id: true, applicantUserId: true },
  });
  const userByApplication = new Map(valid.map((v) => [v.id, v.applicantUserId]));
  const marks = args.marks.filter((m) => userByApplication.has(m.applicationId));

  await prisma.$transaction(async (tx) => {
    for (const m of marks) {
      if (m.status === null) {
        await tx.educationAttendance.deleteMany({
          where: { applicationId: m.applicationId, sessionId: args.sessionId },
        });
      } else {
        await tx.educationAttendance.upsert({
          where: {
            applicationId_sessionId: {
              applicationId: m.applicationId,
              sessionId: args.sessionId,
            },
          },
          create: {
            applicationId: m.applicationId,
            sessionId: args.sessionId,
            status: m.status,
          },
          update: { status: m.status },
        });
      }
      // Ledger stays consistent with the mark in the same transaction:
      // Present grants a CE credit, anything else revokes the derived row.
      await syncCreditForAttendance(tx, {
        userId: userByApplication.get(m.applicationId)!,
        sessionId: args.sessionId,
        status: m.status,
        sessionDate: session.datetime,
      });
    }
  });

  await logAuditEvent({
    action: "education.attendance.update",
    userId: args.actorId,
    targetId: args.sessionId,
    metadata: { offeringId: args.offeringId, count: marks.length },
  });
  return { ok: true };
}
