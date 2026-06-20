import { prisma } from "~/lib/db";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

export interface SubmitInput {
  applicantUserId: string;
  offeringId: string;
  answers: { questionId: string; content: string }[];
}

export interface SubmitResult {
  applicationId: string;
  status: EduApplicationStatus;
}

/**
 * Submit an application to an offering. For RSVP-style offerings
 * (requiresReview=false) the applicant is auto-approved if seats remain,
 * else placed on the waitlist. For review-required offerings the applicant
 * lands in Submitted and waits for an instructor decision.
 */
export async function submitApplication(input: SubmitInput): Promise<SubmitResult> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: input.offeringId },
    select: { id: true, status: true, capacity: true, requiresReview: true, registrationOpensAt: true, registrationClosesAt: true },
  });
  if (!offering) throw new Error("Offering not found");
  if (offering.status !== "Published") throw new Error("Offering is not open for applications");
  const now = new Date();
  if (now < offering.registrationOpensAt) throw new Error("Registration has not opened yet");
  if (now > offering.registrationClosesAt) throw new Error("Registration has closed");

  // Required questions must have answers.
  const questions = await prisma.educationApplicationQuestion.findMany({
    where: { offeringId: offering.id },
  });
  const answerByQ = new Map(input.answers.map((a) => [a.questionId, a.content?.trim() ?? ""]));
  for (const q of questions) {
    if (q.required && !answerByQ.get(q.id)) {
      throw new Error(`Question "${q.prompt}" requires an answer`);
    }
  }

  // Determine target status.
  let status: EduApplicationStatus;
  if (offering.requiresReview) {
    status = "Submitted";
  } else {
    const approvedCount = await prisma.educationApplication.count({
      where: { offeringId: offering.id, status: "Approved" },
    });
    status = approvedCount < offering.capacity ? "Approved" : "Waitlisted";
  }

  // Upsert: applicants resubmitting overwrite their previous answers and
  // transition from Withdrawn back into the pipeline. Pre-existing
  // non-terminal applications can be updated up until the window closes.
  const existing = await prisma.educationApplication.findUnique({
    where: { applicantUserId_offeringId: { applicantUserId: input.applicantUserId, offeringId: offering.id } },
  });

  if (existing && existing.status !== "Withdrawn" && existing.status !== "Rejected") {
    // Replace answers, preserve status if already Approved/Waitlisted/Submitted.
    await prisma.educationApplicationAnswer.deleteMany({ where: { applicationId: existing.id } });
    if (input.answers.length > 0) {
      await prisma.educationApplicationAnswer.createMany({
        data: input.answers
          .filter((a) => questions.some((q) => q.id === a.questionId))
          .map((a) => ({ applicationId: existing.id, questionId: a.questionId, content: a.content })),
      });
    }
    return { applicationId: existing.id, status: existing.status };
  }

  const application = await prisma.educationApplication.upsert({
    where: { applicantUserId_offeringId: { applicantUserId: input.applicantUserId, offeringId: offering.id } },
    update: { status, submittedAt: new Date(), reviewedAt: null, reviewedBy: null },
    create: {
      applicantUserId: input.applicantUserId,
      offeringId: offering.id,
      status,
    },
  });

  await prisma.educationApplicationAnswer.deleteMany({ where: { applicationId: application.id } });
  if (input.answers.length > 0) {
    await prisma.educationApplicationAnswer.createMany({
      data: input.answers
        .filter((a) => questions.some((q) => q.id === a.questionId))
        .map((a) => ({ applicationId: application.id, questionId: a.questionId, content: a.content })),
    });
  }

  return { applicationId: application.id, status };
}

export async function listApplicationsForOffering(offeringId: string) {
  return prisma.educationApplication.findMany({
    where: { offeringId },
    include: {
      applicant: { select: { id: true, firstName: true, lastName: true, dartmouthEmail: true, daliEmail: true, netId: true } },
      answers: { include: { question: true } },
    },
    orderBy: { submittedAt: "asc" },
  });
}

export async function listApplicationsForUser(userId: string) {
  return prisma.educationApplication.findMany({
    where: { applicantUserId: userId, status: { in: ["Submitted", "Approved", "Waitlisted"] } },
    include: {
      offering: {
        select: {
          id: true, title: true, type: true, status: true, startsAt: true, endsAt: true,
          sessions: { orderBy: { sequence: "asc" }, take: 1 },
        },
      },
    },
    orderBy: { submittedAt: "desc" },
  });
}

export async function getApplicationDetail(applicationId: string) {
  return prisma.educationApplication.findUnique({
    where: { id: applicationId },
    include: {
      applicant: { select: { id: true, firstName: true, lastName: true, dartmouthEmail: true, daliEmail: true, netId: true } },
      offering: true,
      answers: { include: { question: true }, orderBy: { question: { position: "asc" } } },
    },
  });
}

export async function getApplicationForUser(userId: string, offeringId: string) {
  return prisma.educationApplication.findUnique({
    where: { applicantUserId_offeringId: { applicantUserId: userId, offeringId } },
    include: {
      offering: {
        include: {
          sessions: { orderBy: { sequence: "asc" } },
          announcements: { orderBy: { sentAt: "desc" }, take: 20, include: { author: { select: { firstName: true, lastName: true } } } },
          assignments: { orderBy: { dueAt: "asc" } },
          instructors: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });
}
