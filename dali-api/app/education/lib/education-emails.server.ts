import { prisma } from "~/lib/db";
import type { EducationEmailSlot } from "./education-emails";

// Education's emails: one per slot, shared by every course and edited in
// place (no versions). A slot with no email sends nothing.

export type EducationEmailContent = { subject: string; body: string };

export async function getEducationEmail(
  slot: EducationEmailSlot,
): Promise<EducationEmailContent | null> {
  return prisma.educationEmail.findUnique({
    where: { slot },
    select: { subject: true, body: true },
  });
}

export async function listEducationEmails() {
  return prisma.educationEmail.findMany({
    select: {
      slot: true,
      subject: true,
      body: true,
      updatedAt: true,
      updatedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Save a slot's email for every course. An empty subject and body turns the
 *  slot off (nothing sends; the in-app notification still fires). */
export async function saveEducationEmail(
  slot: EducationEmailSlot,
  content: EducationEmailContent,
  actorId: string,
): Promise<void> {
  if (!content.subject.trim() && !content.body.trim()) {
    await prisma.educationEmail.deleteMany({ where: { slot } });
    return;
  }
  await prisma.educationEmail.upsert({
    where: { slot },
    create: { slot, ...content, updatedById: actorId },
    update: { ...content, updatedById: actorId },
  });
}
