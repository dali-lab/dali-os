import { prisma } from "~/lib/db.server";

export type OnboardingFormBinding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  hasVersion: boolean;
};

export async function getOnboardingFormBinding(): Promise<OnboardingFormBinding | null> {
  const row = await prisma.onboardingProfileFormBinding.findFirst({
    orderBy: { updatedAt: "desc" },
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

export async function isOnboardingProfileForm(formId: string): Promise<boolean> {
  const row = await prisma.onboardingProfileFormBinding.findFirst({
    where: { formId },
    select: { id: true },
  });
  return Boolean(row);
}

export async function setOnboardingFormBinding(
  formId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = await prisma.form.findUnique({ where: { id: formId }, select: { id: true } });
  if (!form) return { ok: false, error: "That form no longer exists." };
  await prisma.$transaction([
    prisma.onboardingProfileFormBinding.deleteMany({}),
    prisma.onboardingProfileFormBinding.create({ data: { formId, updatedById: userId } }),
  ]);
  return { ok: true };
}

export async function clearOnboardingFormBinding(): Promise<void> {
  await prisma.onboardingProfileFormBinding.deleteMany({});
}
