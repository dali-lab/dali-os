import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { isManualCheckInOpen } from "~/lib/check-in-window";
import { isOfferingManager } from "./access.server";
import { saveAttendance } from "./attendance.server";

const DEFAULT_SESSION_MS = 3 * 60 * 60 * 1000;

type SessionWindow = { datetime: Date; endsAt: Date | null; checkInOpenAt: Date | null };

export function isSessionCheckInOpen(s: SessionWindow, now: Date = new Date()): boolean {
  return isManualCheckInOpen(
    { checkInOpenAt: s.checkInOpenAt, endsAt: s.endsAt ?? new Date(s.datetime.getTime() + DEFAULT_SESSION_MS) },
    now,
  );
}

export async function setSessionCheckInOpen(args: {
  offeringId: string;
  sessionId: string;
  open: boolean;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  if (!(await isOfferingManager(args.actorId, args.offeringId))) {
    return { error: "Forbidden", status: 403 };
  }
  const session = await prisma.educationSession.findUnique({
    where: { id: args.sessionId },
    select: { offeringId: true },
  });
  if (!session || session.offeringId !== args.offeringId) {
    return { error: "Session not found", status: 404 };
  }
  await prisma.educationSession.update({
    where: { id: args.sessionId },
    data: { checkInOpenAt: args.open ? new Date() : null },
  });
  await logAuditEvent({
    action: args.open ? "education.session.checkin.open" : "education.session.checkin.close",
    userId: args.actorId,
    targetId: args.sessionId,
    metadata: { offeringId: args.offeringId },
  });
  return { ok: true };
}

export type SelfCheckInResult =
  | { ok: true; alreadyPresent: boolean }
  | { error: string; status: number };

/**
 * Mark the caller present for a session by scanning the projected QR. The user
 * is always the caller's own session (never anything in the request), so this
 * can't mark anyone else. Requires an Approved enrollment and an open window.
 */
export async function selfCheckInToSession(args: {
  sessionId: string;
  userId: string;
}): Promise<SelfCheckInResult> {
  const session = await prisma.educationSession.findUnique({
    where: { id: args.sessionId },
    select: { id: true, offeringId: true, datetime: true, endsAt: true, checkInOpenAt: true },
  });
  if (!session) return { error: "Session not found", status: 404 };

  if (!isSessionCheckInOpen(session)) {
    return { error: "Check-in isn't open for this session", status: 403 };
  }

  const application = await prisma.educationApplication.findFirst({
    where: {
      offeringId: session.offeringId,
      applicantUserId: args.userId,
      status: "Approved",
    },
    select: { id: true },
  });
  if (!application) {
    return { error: "You're not enrolled in this course", status: 403 };
  }

  const existing = await prisma.educationAttendance.findUnique({
    where: {
      applicationId_sessionId: { applicationId: application.id, sessionId: session.id },
    },
    select: { status: true },
  });
  if (existing?.status === "Present") return { ok: true, alreadyPresent: true };

  const result = await saveAttendance({
    offeringId: session.offeringId,
    sessionId: session.id,
    marks: [{ applicationId: application.id, status: "Present" }],
    // The student is the actor for their own check-in.
    actorId: args.userId,
  });
  if ("error" in result) return result;
  return { ok: true, alreadyPresent: false };
}
