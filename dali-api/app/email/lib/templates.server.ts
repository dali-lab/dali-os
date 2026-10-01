// Read and write the unified email-template store.
//
// One row per registry key, edited in place, with an append-only version written
// on every save. That combines what the two live slot tables did (shared,
// edit-in-place, absence is meaningful) with the one capability only the dead
// library had (history you can roll back to).

import { prisma } from "~/lib/db";
import { renderEmail, type InterpolationVars } from "~/lib/email";

import {
  EMAIL_TEMPLATES,
  emailTemplateDef,
  type EmailTemplateKey,
} from "~/email/lib/registry";

export type EmailTemplateCopy = { subject: string; body: string };

export type StoredEmailTemplate = EmailTemplateCopy & {
  key: EmailTemplateKey;
  updatedAt: Date;
  updatedById: string | null;
};

export async function getEmailTemplate(
  key: EmailTemplateKey,
): Promise<EmailTemplateCopy | null> {
  const row = await prisma.emailTemplate.findUnique({ where: { key } });
  if (row) return { subject: row.subject, body: row.body };
  // Only "default" keys carry fallback copy; for the others, absence is the
  // operator's answer and must not be papered over.
  const def = emailTemplateDef(key);
  return def.whenMissing === "default" ? (def.defaults ?? null) : null;
}

export async function listEmailTemplates(): Promise<Map<EmailTemplateKey, StoredEmailTemplate>> {
  const rows = await prisma.emailTemplate.findMany();
  const out = new Map<EmailTemplateKey, StoredEmailTemplate>();
  for (const r of rows) {
    if (!(r.key in EMAIL_TEMPLATES)) continue; // a key retired in code, row not yet reaped
    out.set(r.key as EmailTemplateKey, {
      key: r.key as EmailTemplateKey,
      subject: r.subject,
      body: r.body,
      updatedAt: r.updatedAt,
      updatedById: r.updatedById,
    });
  }
  return out;
}

// Blanking both fields deletes the row, carried over from the slot tables: it is
// how an operator turns an email off, and it keeps "no row" as the single
// representation of off rather than adding an empty-string second one.
export async function saveEmailTemplate(
  key: EmailTemplateKey,
  copy: EmailTemplateCopy,
  actorId: string,
): Promise<void> {
  const subject = copy.subject.trim();
  const body = copy.body.trim();

  if (!subject && !body) {
    await prisma.emailTemplate.deleteMany({ where: { key } });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.emailTemplate.findUnique({
      where: { key },
      select: { subject: true, body: true },
    });
    // Nothing changed → no new version. Otherwise every visit to the editor
    // would pad the history.
    const changed = !existing || existing.subject !== subject || existing.body !== body;

    await tx.emailTemplate.upsert({
      where: { key },
      create: { key, subject, body, updatedById: actorId },
      update: { subject, body, updatedById: actorId },
    });

    if (!changed) return;

    const last = await tx.emailTemplateVersion.findFirst({
      where: { templateKey: key },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    await tx.emailTemplateVersion.create({
      data: {
        templateKey: key,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        subject,
        body,
        createdById: actorId,
      },
    });
  });
}

export async function listEmailTemplateVersions(key: EmailTemplateKey) {
  return prisma.emailTemplateVersion.findMany({
    where: { templateKey: key },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      subject: true,
      body: true,
      createdAt: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

// Rolling back appends rather than rewinds, so the history stays append-only and
// the rollback itself is visible in it.
export async function rollbackEmailTemplate(
  key: EmailTemplateKey,
  versionId: string,
  actorId: string,
): Promise<void> {
  const version = await prisma.emailTemplateVersion.findFirst({
    where: { id: versionId, templateKey: key },
    select: { subject: true, body: true },
  });
  if (!version) throw new Error(`version ${versionId} is not a version of ${key}`);
  await saveEmailTemplate(key, version, actorId);
}

export class MissingEmailTemplateError extends Error {
  constructor(public readonly key: EmailTemplateKey) {
    super(
      `There's no ${emailTemplateDef(key).label} email yet. Write one in Admin → Email before releasing.`,
    );
    this.name = "MissingEmailTemplateError";
  }
}

// Resolve and render in one step, applying the registry's whenMissing rule.
// Returns null when the rule is "skip", throws when it is "error".
export async function renderEmailTemplate(
  key: EmailTemplateKey,
  vars: InterpolationVars,
): Promise<{ subject: string; html: string } | null> {
  const copy = await getEmailTemplate(key);
  if (!copy) {
    if (emailTemplateDef(key).whenMissing === "error") throw new MissingEmailTemplateError(key);
    return null;
  }
  return renderEmail(copy, vars);
}
