// Hiring's view of the unified email-template store. The slot vocabulary stays
// hiring's own (email-variables.ts TemplateSlot); the rows now live in
// EmailTemplate under the "hiring:" key prefix, shared with every other area.
//
// This stays a thin adapter on purpose: every hiring call site already speaks
// slots, and rewriting a dozen of them to speak registry keys would be churn
// with no benefit.

import {
  getEmailTemplate,
  listEmailTemplates,
  saveEmailTemplate,
} from "~/email/lib/templates.server";
import { hiringKey } from "~/email/lib/registry";
import { prisma } from "~/lib/db";

import type { TemplateSlot } from "./email-variables";

export type HiringEmailContent = { subject: string; body: string };

export async function getHiringEmail(slot: TemplateSlot): Promise<HiringEmailContent | null> {
  return getEmailTemplate(hiringKey(slot));
}

export async function listHiringEmails() {
  const all = await listEmailTemplates();
  const rows = [...all.values()].filter((t) => t.key.startsWith("hiring:"));
  const editorIds = [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))];
  const editors = editorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const byId = new Map(editors.map((u) => [u.id, u]));
  return rows.map((r) => ({
    slot: r.key.slice("hiring:".length) as TemplateSlot,
    subject: r.subject,
    body: r.body,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedById
      ? (byId.get(r.updatedById) ?? null)
      : null,
  }));
}

/** Save a slot's email for every cycle. An empty subject and body turns the
 *  slot off (nothing sends). */
export async function saveHiringEmail(
  slot: TemplateSlot,
  content: HiringEmailContent,
  actorId: string,
): Promise<void> {
  await saveEmailTemplate(hiringKey(slot), content, actorId);
}
