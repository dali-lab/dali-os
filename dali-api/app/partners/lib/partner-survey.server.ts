// Post-project survey (specs/partner-crm.md §11). Mirrors
// application-form.server.ts: one PartnerSurveyFormBinding row (app-enforced
// singleton), registered in formUsages() so the forms admin shows usage and
// refuses destructive edits. `sendPartnerSurvey` is called by the
// partner-survey-send job once a ProjectPartner's endedAt is set.

import { prisma } from "~/lib/db";
import { loadPublicForm, type PublicForm } from "~/forms/lib/public-form";
import { getFrontendUrl } from "~/lib/app-env";
import { sendPartnerSurveyEmail } from "./partner-emails.server";

export type SurveyFormBinding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  hasVersion: boolean;
};

export async function getSurveyFormBinding(): Promise<SurveyFormBinding | null> {
  const row = await prisma.partnerSurveyFormBinding.findFirst({
    select: {
      form: {
        select: {
          id: true,
          name: true,
          published: true,
          publicToken: true,
          _count: { select: { versions: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    formId: row.form.id,
    formName: row.form.name,
    published: row.form.published,
    publicToken: row.form.publicToken,
    hasVersion: row.form._count.versions > 0,
  };
}

// Replace-the-singleton, same defence as setApplicationFormBinding: validate
// the formId exists so a stale/forged id can't create a dangling binding.
export async function setSurveyFormBinding(
  formId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = await prisma.form.findUnique({ where: { id: formId }, select: { id: true } });
  if (!form) return { ok: false, error: "That form no longer exists." };
  await prisma.$transaction([
    prisma.partnerSurveyFormBinding.deleteMany({}),
    prisma.partnerSurveyFormBinding.create({ data: { formId, updatedById: userId } }),
  ]);
  return { ok: true };
}

export async function clearSurveyFormBinding(): Promise<void> {
  await prisma.partnerSurveyFormBinding.deleteMany({});
}

// The bound survey form as a partner fills it, via the same loadPublicForm
// path members and the apply page use. Null when nothing is bound or the
// bound form isn't published / has no version yet.
export async function loadSurveyForm(userId?: string | null): Promise<PublicForm | null> {
  const binding = await getSurveyFormBinding();
  if (!binding?.publicToken) return null;
  return loadPublicForm(binding.publicToken, userId);
}

// Resolve a contact to email for a ProjectPartner's org: the org's designated
// primary contact (PartnerMembership.id — see PartnerOrg.primaryContactId's
// comment), falling back to its earliest membership. Mirrors
// partner-renewal-sweep.server's resolution.
async function resolveOrgContact(
  orgId: string,
  primaryContactId: string | null,
): Promise<{ id: string; name: string; email: string } | null> {
  let contactId: string | null = null;
  if (primaryContactId) {
    const primary = await prisma.partnerMembership.findUnique({
      where: { id: primaryContactId },
      select: { contactId: true },
    });
    contactId = primary?.contactId ?? null;
  }
  if (!contactId) {
    const earliest = await prisma.partnerMembership.findFirst({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: { contactId: true },
    });
    contactId = earliest?.contactId ?? null;
  }
  if (!contactId) return null;
  return prisma.partnerContact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Email the org's contact a link to fill the bound survey form for this
 * ended partnership, and stamp surveySentAt. Called by the
 * partner-survey-send job (once per ProjectPartner — the job's own query
 * excludes rows with surveySentAt already set) and available for a manual
 * resend.
 */
export async function sendPartnerSurvey(params: {
  projectPartnerId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const link = await prisma.projectPartner.findUnique({
    where: { id: params.projectPartnerId },
    select: {
      id: true,
      partnerOrg: { select: { id: true, name: true, primaryContactId: true } },
      project: { select: { name: true } },
    },
  });
  if (!link) return { ok: false, error: "Partnership not found" };

  const contact = await resolveOrgContact(link.partnerOrg.id, link.partnerOrg.primaryContactId);
  if (!contact) return { ok: false, error: "This organization has no contact to email." };

  const surveyUrl = `${getFrontendUrl()}/partner/survey/${link.id}`;
  await sendPartnerSurveyEmail(contact.email, contact.name, link.project.name, surveyUrl, link.id);

  await prisma.projectPartner.update({
    where: { id: link.id },
    data: { surveySentAt: new Date() },
  });

  return { ok: true };
}
