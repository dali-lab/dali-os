import { prisma } from "~/lib/db";
import { loadPublicForm, type PublicForm } from "~/forms/lib/public-form";

// The lab-configurable application form for /partner/apply. Core binds one
// generic Form (PartnerApplicationFormBinding — at most one row, app-enforced)
// and partners answer its questions alongside the built-in structured pitch
// fields. Answers are stored as a FormSubmission linked from the
// PartnerApplication, so the existing forms tooling sees them.

export type ApplicationFormBinding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  hasVersion: boolean;
};

export async function getApplicationFormBinding(): Promise<ApplicationFormBinding | null> {
  const row = await prisma.partnerApplicationFormBinding.findFirst({
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

// Replace-the-singleton. `formId` is validated against an existing form so a
// stale/forged id can't create a dangling binding (same defence as
// setSlotBinding).
export async function setApplicationFormBinding(
  formId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { id: true },
  });
  if (!form) return { ok: false, error: "That form no longer exists." };
  await prisma.$transaction([
    prisma.partnerApplicationFormBinding.deleteMany({}),
    prisma.partnerApplicationFormBinding.create({
      data: { formId, updatedById: userId },
    }),
  ]);
  return { ok: true };
}

export async function clearApplicationFormBinding(): Promise<void> {
  await prisma.partnerApplicationFormBinding.deleteMany({});
}

// The bound form as a partner fills it: latest version with reference options
// resolved, via the same loadPublicForm path members use. Null when nothing
// is bound or the bound form isn't published / has no versions — the apply
// page then shows only its structured fields.
export async function loadApplicationForm(
  userId?: string | null,
): Promise<PublicForm | null> {
  const binding = await getApplicationFormBinding();
  if (!binding?.publicToken) return null;
  return loadPublicForm(binding.publicToken, userId);
}

