import { prisma } from "./db";

let seq = 0;
const next = () => ++seq;

export async function makeUser(over: { firstName?: string; lastName?: string; daliEmail?: string } = {}) {
  const n = next();
  return prisma.user.create({
    data: {
      firstName: over.firstName ?? "Ada",
      lastName: over.lastName ?? `Lovelace${n}`,
      daliEmail: over.daliEmail ?? `ada${n}@example.edu`,
    },
  });
}

export async function makeOffering(
  creatorId: string,
  over: { capacity?: number; requiresReview?: boolean } = {},
) {
  const n = next();
  const page = await prisma.page.create({
    data: { id: `form-page-${n}`, workspaceType: "Lab", title: "Application", kind: "Form", createdById: creatorId },
  });
  const form = await prisma.form.create({ data: { id: page.id, name: "Application", createdById: creatorId } });
  await prisma.formVersion.create({
    data: {
      formId: form.id,
      versionNumber: 1,
      createdById: creatorId,
      questions: [{ key: "q1", type: "text", required: false, data: { label: "Why?" } }],
    },
  });
  return prisma.educationOffering.create({
    data: {
      type: "Workshop",
      title: "Intro Workshop",
      capacity: over.capacity ?? 2,
      registrationOpensAt: new Date("2026-09-01T00:00:00Z"),
      registrationClosesAt: new Date("2026-10-31T00:00:00Z"),
      status: "Published",
      requiresReview: over.requiresReview ?? false,
      applicationFormId: form.id,
    },
  });
}

export async function makeMeeting(organizerId: string, over: { title?: string } = {}) {
  return prisma.scheduledMeeting.create({
    data: {
      organizerId,
      title: over.title ?? "Lab night",
      durationMinutes: 60,
      scopeType: "None",
      ownerCalendarEmail: "lab@example.edu",
      attendanceMode: "SelfCheckIn",
    },
  });
}
