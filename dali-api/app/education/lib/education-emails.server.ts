// Education's view of the unified email-template store. Mirrors
// hiring-emails.server.ts: the slot vocabulary stays education's own, the rows
// live in EmailTemplate under the "education:" key prefix.

import {
  getEmailTemplate,
  listEmailTemplates,
  saveEmailTemplate,
} from "~/email/lib/templates.server";
import { educationKey } from "~/email/lib/registry";
import { prisma } from "~/lib/db";

import type { EducationEmailSlot } from "./education-emails";

export type EducationEmailContent = { subject: string; body: string };

export async function getEducationEmail(
  slot: EducationEmailSlot,
): Promise<EducationEmailContent | null> {
  return getEmailTemplate(educationKey(slot));
}

export async function listEducationEmails() {
  const all = await listEmailTemplates();
  const rows = [...all.values()].filter((t) => t.key.startsWith("education:"));
  const editorIds = [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))];
  const editors = editorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const byId = new Map(editors.map((u) => [u.id, u]));
  return rows.map((r) => ({
    slot: r.key.slice("education:".length) as EducationEmailSlot,
    subject: r.subject,
    body: r.body,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedById ? (byId.get(r.updatedById) ?? null) : null,
  }));
}

/** Save a slot's email for every course. An empty subject and body turns the
 *  slot off (nothing sends; the in-app notification still fires). */
export async function saveEducationEmail(
  slot: EducationEmailSlot,
  content: EducationEmailContent,
  actorId: string,
): Promise<void> {
  await saveEmailTemplate(educationKey(slot), content, actorId);
}
