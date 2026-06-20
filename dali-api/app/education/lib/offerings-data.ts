import { prisma } from "~/lib/db";
import type { OfferingStatus, OfferingType } from "~/generated/prisma/enums";

export interface CreateOfferingInput {
  type: OfferingType;
  title: string;
  capacity: number;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  requiresReview: boolean;
  descriptionDocId?: string | null;
  calendarEmail?: string | null;
}

export async function listPublishedOfferings() {
  return prisma.educationOffering.findMany({
    where: { status: "Published" },
    orderBy: { startsAt: "asc" },
    include: {
      instructors: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      _count: { select: { sessions: true, applications: { where: { status: "Approved" } } } },
    },
  });
}

export async function listManageableOfferings(scope: string[] | "all") {
  return prisma.educationOffering.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          applications: { where: { status: "Submitted" } },
          sessions: true,
        },
      },
    },
  });
}

export async function getOfferingDetail(id: string) {
  return prisma.educationOffering.findUnique({
    where: { id },
    include: {
      instructors: { include: { user: { select: { id: true, firstName: true, lastName: true, dartmouthEmail: true } } } },
      sessions: { orderBy: { sequence: "asc" } },
      applicationQuestions: { orderBy: { position: "asc" } },
      assignments: { orderBy: { dueAt: "asc" } },
      announcements: { orderBy: { sentAt: "desc" }, take: 20, include: { author: { select: { firstName: true, lastName: true } } } },
      _count: { select: { applications: { where: { status: "Approved" } } } },
    },
  });
}

export async function createOffering(input: CreateOfferingInput) {
  return prisma.educationOffering.create({
    data: {
      type: input.type,
      title: input.title,
      capacity: input.capacity,
      registrationOpensAt: input.registrationOpensAt,
      registrationClosesAt: input.registrationClosesAt,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      requiresReview: input.requiresReview,
      descriptionDocId: input.descriptionDocId ?? null,
      calendarEmail: input.calendarEmail ?? null,
      status: "Draft",
    },
  });
}

export async function updateOffering(id: string, patch: Partial<CreateOfferingInput>) {
  return prisma.educationOffering.update({
    where: { id },
    data: {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.capacity !== undefined && { capacity: patch.capacity }),
      ...(patch.registrationOpensAt !== undefined && { registrationOpensAt: patch.registrationOpensAt }),
      ...(patch.registrationClosesAt !== undefined && { registrationClosesAt: patch.registrationClosesAt }),
      ...(patch.startsAt !== undefined && { startsAt: patch.startsAt }),
      ...(patch.endsAt !== undefined && { endsAt: patch.endsAt }),
      ...(patch.requiresReview !== undefined && { requiresReview: patch.requiresReview }),
      ...(patch.descriptionDocId !== undefined && { descriptionDocId: patch.descriptionDocId }),
      ...(patch.calendarEmail !== undefined && { calendarEmail: patch.calendarEmail }),
    },
  });
}

export async function setOfferingStatus(id: string, status: OfferingStatus) {
  // Draft → Published requires capacity ≥ 1, registration window valid, and
  // at least one session for Miniseries. Workshops can publish with no
  // sessions (instructor will add a single session before it starts).
  if (status === "Published") {
    const o = await prisma.educationOffering.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { sessions: true } } },
    });
    if (o.capacity < 1) throw new Error("Capacity must be at least 1");
    if (o.registrationOpensAt >= o.registrationClosesAt) {
      throw new Error("Registration opens must be before it closes");
    }
    if (o.type === "Miniseries" && o._count.sessions < 1) {
      throw new Error("Miniseries must have at least one session before publishing");
    }
  }
  return prisma.educationOffering.update({ where: { id }, data: { status } });
}

export async function addInstructor(offeringId: string, userId: string, termId: string) {
  const existing = await prisma.instructorAssignment.findFirst({
    where: { userId, offeringId, termId },
  });
  if (existing) return existing;
  return prisma.instructorAssignment.create({ data: { userId, termId, offeringId } });
}

export async function removeInstructor(offeringId: string, userId: string, termId: string) {
  await prisma.instructorAssignment.deleteMany({ where: { userId, offeringId, termId } });
}

export async function addSession(
  offeringId: string,
  input: { sequence: number; datetime: Date; location?: string | null; materialsDocId?: string | null; recordingUrl?: string | null },
) {
  return prisma.educationSession.create({
    data: {
      offeringId,
      sequence: input.sequence,
      datetime: input.datetime,
      location: input.location ?? null,
      materialsDocId: input.materialsDocId ?? null,
      recordingUrl: input.recordingUrl ?? null,
    },
  });
}

export async function updateSession(
  id: string,
  patch: { sequence?: number; datetime?: Date; location?: string | null; materialsDocId?: string | null; recordingUrl?: string | null },
) {
  return prisma.educationSession.update({ where: { id }, data: patch });
}

export async function deleteSession(id: string) {
  return prisma.educationSession.delete({ where: { id } });
}

export async function replaceQuestions(
  offeringId: string,
  questions: { prompt: string; required: boolean }[],
) {
  await prisma.educationApplicationQuestion.deleteMany({ where: { offeringId } });
  if (questions.length === 0) return [];
  await prisma.educationApplicationQuestion.createMany({
    data: questions.map((q, i) => ({
      offeringId,
      prompt: q.prompt,
      required: q.required,
      position: i,
    })),
  });
  return prisma.educationApplicationQuestion.findMany({
    where: { offeringId },
    orderBy: { position: "asc" },
  });
}

export async function duplicateQuestionsFromOffering(
  sourceOfferingId: string,
  targetOfferingId: string,
) {
  const source = await prisma.educationApplicationQuestion.findMany({
    where: { offeringId: sourceOfferingId },
    orderBy: { position: "asc" },
  });
  return replaceQuestions(
    targetOfferingId,
    source.map((q) => ({ prompt: q.prompt, required: q.required })),
  );
}
