import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { logAuditEvent } from "~/lib/audit";
import { requestInstructorExitSurveys } from "./feedback.server";
import { lockOffering } from "./apply.server";
import { currentTerm } from "~/lib/roles";

// Completion certificates. Pure derived data — the HTML page and PDF are
// generated on demand from the EducationCertificate row; nothing is stored in
// S3, so design fixes apply retroactively. Issued by an explicit instructor/
// Core "close out course" action (not a cron): deterministic, lets attendance
// get fixed first, and idempotent — re-running only issues missing
// certificates.

/**
 * Completion policy: Miniseries — (Present + Excused) / total sessions ≥ threshold
 * (excused absences are forgiven for completion; they still don't earn CE
 * credit). Workshops — at least one Present mark. No sessions → not eligible.
 *
 * `threshold` defaults to 0.8 (80%) but can be overridden per-offering via
 * EducationOffering.completionThreshold.
 */
export function certificateEligibility(args: {
  type: "Miniseries" | "Workshop";
  totalSessions: number;
  present: number;
  excused: number;
  threshold?: number;
}): boolean {
  if (args.totalSessions === 0) return false;
  if (args.type === "Workshop") return args.present >= 1;
  const threshold = args.threshold ?? 0.8;
  return (args.present + args.excused) / args.totalSessions >= threshold;
}

export type CloseOutResult =
  | { ok: true; issued: number; alreadyIssued: number; ineligible: number }
  | { error: string; status: number };

export async function closeOutOffering(args: {
  offeringId: string;
  actorId: string;
}): Promise<CloseOutResult> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: {
      id: true,
      title: true,
      type: true,
      closedOutAt: true,
      completionThreshold: true,
      _count: { select: { sessions: true } },
      applications: {
        where: { status: "Approved" },
        select: {
          id: true,
          attendances: { select: { status: true } },
          certificate: { select: { id: true } },
          applicant: {
            select: {
              id: true,
              firstName: true,
              daliEmail: true,
              dartmouthEmail: true,
              personalEmail: true,
              netId: true,
            },
          },
        },
      },
      instructors: { select: { userId: true } },
    },
  });
  if (!offering) return { error: "Offering not found", status: 404 };

  const firstCloseOut = offering.closedOutAt === null;
  const totalSessions = offering._count.sessions;

  let issued = 0;
  let alreadyIssued = 0;
  let ineligible = 0;
  const toNotify: {
    applicantId: string;
    certificateId: string;
    applicant: (typeof offering.applications)[number]["applicant"];
  }[] = [];

  for (const application of offering.applications) {
    if (application.certificate) {
      alreadyIssued += 1;
      continue;
    }
    const present = application.attendances.filter((a) => a.status === "Present").length;
    const excused = application.attendances.filter((a) => a.status === "Excused").length;
    if (!certificateEligibility({ type: offering.type, totalSessions, present, excused, threshold: offering.completionThreshold })) {
      ineligible += 1;
      continue;
    }
    const certificate = await prisma.educationCertificate.create({
      data: { applicationId: application.id, issuedById: args.actorId },
      select: { id: true },
    });
    issued += 1;
    toNotify.push({
      applicantId: application.applicant.id,
      certificateId: certificate.id,
      applicant: application.applicant,
    });
  }

  // Teaching earns a CE credit too — but only on the FIRST close-out, since
  // manual-style rows (sessionId null) have no uniqueness to lean on. Grant the
  // credits and stamp closedOutAt atomically under the offering row lock: a
  // concurrent or retried close-out re-reads closedOutAt inside the lock and
  // bails, so instructors can never be double-granted.
  if (firstCloseOut) {
    const term = await currentTerm();
    await prisma.$transaction(async (tx) => {
      await lockOffering(tx, args.offeringId);
      const fresh = await tx.educationOffering.findUnique({
        where: { id: args.offeringId },
        select: { closedOutAt: true },
      });
      if (fresh?.closedOutAt) return; // another close-out won the race
      if (term) {
        for (const instructor of offering.instructors) {
          await tx.cECredit.create({
            data: {
              userId: instructor.userId,
              termId: term.id,
              grantedById: args.actorId,
              reason: `Taught ${offering.title}`,
            },
          });
        }
      }
      await tx.educationOffering.update({
        where: { id: args.offeringId },
        data: { closedOutAt: new Date(), closedOutById: args.actorId },
      });
    });
  }

  // Notifications + emails after the writes; best-effort. education.certificate
  // defaults to Instant email, matching the old everyone-gets-email behavior.
  if (toNotify.length > 0) {
    try {
      await notify({
        eventType: "education.certificate",
        createdByUserId: args.actorId,
        message: {
          title: `Certificate: ${offering.title}`,
          body: "Congratulations on completing the course — your certificate is ready.",
        },
        recipients: toNotify.map((n) => ({
          userId: n.applicantId,
          link: `/education/certificates/${n.certificateId}`,
        })),
      });
    } catch (err) {
      console.error("certificate notifications failed", {
        offeringId: args.offeringId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Exit surveys for instructors (deduped inside; no-op without a binding).
  await requestInstructorExitSurveys(args.offeringId).catch((err) => {
    console.error("exit survey fan-out failed", {
      offeringId: args.offeringId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await logAuditEvent({
    action: "education.offering.close-out",
    userId: args.actorId,
    targetId: args.offeringId,
    metadata: { issued, alreadyIssued, ineligible, firstCloseOut },
  });
  if (issued > 0) {
    await logAuditEvent({
      action: "education.certificate.issue",
      userId: args.actorId,
      targetId: args.offeringId,
      metadata: { count: issued },
    });
  }
  return { ok: true, issued, alreadyIssued, ineligible };
}

export type CloseOutPreview = {
  eligible: string[];
  belowThreshold: string[];
  alreadyIssued: number;
};

/**
 * Dry-run of close-out: who would get a certificate vs who's below the
 * attendance threshold, without issuing anything or sending mail. Lets the
 * instructor sanity-check before the irreversible fan-out.
 */
export async function previewCloseOut(offeringId: string): Promise<CloseOutPreview | null> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: {
      type: true,
      completionThreshold: true,
      _count: { select: { sessions: true } },
      applications: {
        where: { status: "Approved" },
        select: {
          attendances: { select: { status: true } },
          certificate: { select: { id: true } },
          applicant: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!offering) return null;
  const totalSessions = offering._count.sessions;
  const eligible: string[] = [];
  const belowThreshold: string[] = [];
  let alreadyIssued = 0;
  for (const app of offering.applications) {
    const name = `${app.applicant.firstName} ${app.applicant.lastName}`.trim();
    if (app.certificate) {
      alreadyIssued += 1;
      continue;
    }
    const present = app.attendances.filter((a) => a.status === "Present").length;
    const excused = app.attendances.filter((a) => a.status === "Excused").length;
    if (certificateEligibility({ type: offering.type, totalSessions, present, excused, threshold: offering.completionThreshold })) {
      eligible.push(name);
    } else {
      belowThreshold.push(name);
    }
  }
  return { eligible, belowThreshold, alreadyIssued };
}

/**
 * Certificate data for the page/PDF. Caller gates access (owner, offering
 * manager, or Core) — this only assembles display data, including the
 * student-visible feedback lane (never the internal one).
 */
export async function getCertificate(certificateId: string) {
  const certificate = await prisma.educationCertificate.findUnique({
    where: { id: certificateId },
    select: {
      id: true,
      issuedAt: true,
      application: {
        select: {
          id: true,
          applicantUserId: true,
          applicant: { select: { firstName: true, lastName: true } },
          offering: {
            select: {
              id: true,
              title: true,
              type: true,
              startsAt: true,
              endsAt: true,
              instructors: {
                select: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
          note: { select: { feedback: true } },
        },
      },
    },
  });
  if (!certificate) return null;
  const { application } = certificate;
  return {
    id: certificate.id,
    issuedAt: certificate.issuedAt,
    applicantUserId: application.applicantUserId,
    studentName:
      `${application.applicant.firstName} ${application.applicant.lastName}`.trim(),
    offeringId: application.offering.id,
    offeringTitle: application.offering.title,
    offeringType: application.offering.type,
    startsAt: application.offering.startsAt,
    endsAt: application.offering.endsAt,
    instructorNames: application.offering.instructors.map((i) =>
      `${i.user.firstName} ${i.user.lastName}`.trim(),
    ),
    feedback: application.note?.feedback ?? null,
  };
}
