import { prisma } from "~/lib/db";
import type { AttendanceStatus } from "~/generated/prisma/enums";

export async function listSessionRoster(sessionId: string) {
  const session = await prisma.educationSession.findUnique({
    where: { id: sessionId },
    select: { id: true, offeringId: true, sequence: true, datetime: true },
  });
  if (!session) return null;

  const applications = await prisma.educationApplication.findMany({
    where: { offeringId: session.offeringId, status: "Approved" },
    include: {
      applicant: { select: { id: true, firstName: true, lastName: true, netId: true } },
      attendances: { where: { sessionId } },
    },
    orderBy: [{ applicant: { lastName: "asc" } }, { applicant: { firstName: "asc" } }],
  });

  return {
    session,
    roster: applications.map((a) => ({
      applicationId: a.id,
      applicant: a.applicant,
      status: a.attendances[0]?.status ?? null,
    })),
  };
}

export async function bulkSetAttendance(
  sessionId: string,
  rows: { applicationId: string; status: AttendanceStatus }[],
) {
  // Upsert one row per (application, session). Could be a transaction but
  // attendance writes are low-frequency and idempotent.
  for (const row of rows) {
    await prisma.educationAttendance.upsert({
      where: {
        applicationId_sessionId: {
          applicationId: row.applicationId,
          sessionId,
        },
      },
      update: { status: row.status },
      create: {
        applicationId: row.applicationId,
        sessionId,
        status: row.status,
      },
    });
  }
}

export async function listMyAttendance(userId: string, offeringId: string) {
  const application = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: { applicantUserId: userId, offeringId },
    },
    select: { id: true },
  });
  if (!application) return [];
  return prisma.educationAttendance.findMany({
    where: { applicationId: application.id },
    include: { session: { select: { id: true, sequence: true, datetime: true } } },
    orderBy: { session: { sequence: "asc" } },
  });
}
