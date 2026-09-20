import { prisma } from "~/lib/db";
import type { TemplateSlot } from "./email-variables";

// Hiring's emails: one per slot, shared by every cycle and edited in place
// (no versions). A slot with no email sends nothing.

export type HiringEmailContent = { subject: string; body: string };

export async function getHiringEmail(slot: TemplateSlot): Promise<HiringEmailContent | null> {
  return prisma.hiringEmail.findUnique({ where: { slot }, select: { subject: true, body: true } });
}

export async function listHiringEmails() {
  return prisma.hiringEmail.findMany({
    select: {
      slot: true,
      subject: true,
      body: true,
      updatedAt: true,
      updatedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Save a slot's email for every cycle. An empty subject and body turns the
 *  slot off (nothing sends). */
export async function saveHiringEmail(
  slot: TemplateSlot,
  content: HiringEmailContent,
  actorId: string,
): Promise<void> {
  if (!content.subject.trim() && !content.body.trim()) {
    await prisma.hiringEmail.deleteMany({ where: { slot } });
    return;
  }
  await prisma.hiringEmail.upsert({
    where: { slot },
    create: { slot, ...content, updatedById: actorId },
    update: { ...content, updatedById: actorId },
  });
}
