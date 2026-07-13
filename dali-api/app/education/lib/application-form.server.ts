// Offering application forms, built on the shared Forms system. Each offering
// gets its own Form (cloned from an education template at creation) referenced
// by EducationOffering.applicationFormId. Forms stay UNPUBLISHED — there is no
// public token; the education apply routes load and validate the latest
// version directly, so submissions can't arrive outside an application.

import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import type { Question } from "~/types";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import type { OfferingType } from "~/generated/prisma/client";

const TEMPLATES_FOLDER = "Education Templates";
const OFFERINGS_FOLDER = "Education";

const TEMPLATE_NAMES: Record<OfferingType, string> = {
  Miniseries: "Miniseries Application Template",
  Workshop: "Workshop RSVP Template",
};

function defaultQuestions(type: OfferingType): Question[] {
  if (type === "Miniseries") {
    return [
      {
        key: randomUUID(),
        type: "textarea",
        required: true,
        data: {
          label: "Why do you want to take this miniseries?",
          maxWords: 200,
        },
      },
      {
        key: randomUUID(),
        type: "textarea",
        required: false,
        data: {
          label: "Any relevant experience? (None required — this helps us calibrate.)",
          maxWords: 150,
        },
      },
    ];
  }
  return [
    {
      key: randomUUID(),
      type: "text",
      required: false,
      data: {
        label: "Anything you'd like the instructors to know? (optional)",
      },
    },
  ];
}

async function ensureFolder(name: string, actorId: string): Promise<string> {
  const existing = await prisma.formFolder.findFirst({
    where: { name, parentId: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.formFolder.create({
    data: { name, parentId: null, createdById: actorId },
    select: { id: true },
  });
  return created.id;
}

/**
 * Idempotently create the education template forms (one per offering type)
 * inside the "Education Templates" folder. Editing a template in the Forms UI
 * and saving a new version changes what future offerings are cloned from.
 */
export async function ensureEducationTemplates(actorId: string): Promise<void> {
  const folderId = await ensureFolder(TEMPLATES_FOLDER, actorId);
  for (const type of ["Miniseries", "Workshop"] as const) {
    const name = TEMPLATE_NAMES[type];
    const existing = await prisma.form.findFirst({
      where: { name, folderId },
      select: { id: true, versions: { select: { id: true }, take: 1 } },
    });
    if (existing?.versions.length) continue;
    if (existing) {
      await prisma.formVersion.create({
        data: {
          formId: existing.id,
          versionNumber: 1,
          questions: defaultQuestions(type) as unknown as object,
          createdById: actorId,
        },
      });
      continue;
    }
    await prisma.form.create({
      data: {
        name,
        folderId,
        createdById: actorId,
        versions: {
          create: {
            versionNumber: 1,
            questions: defaultQuestions(type) as unknown as object,
            createdById: actorId,
          },
        },
      },
    });
  }
}

/**
 * Clone the matching template's latest version into a new per-offering form
 * and bind it via applicationFormId. No-op if the offering already has one.
 */
export async function createOfferingApplicationForm(
  offeringId: string,
  actorId: string,
): Promise<string | null> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: { id: true, type: true, title: true, applicationFormId: true },
  });
  if (!offering) return null;
  if (offering.applicationFormId) return offering.applicationFormId;

  await ensureEducationTemplates(actorId);
  const template = await prisma.form.findFirst({
    where: { name: TEMPLATE_NAMES[offering.type] },
    select: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { questions: true, intro: true },
      },
    },
  });
  const templateVersion = template?.versions[0];
  const questions = (templateVersion?.questions as unknown as Question[]) ?? defaultQuestions(offering.type);

  const folderId = await ensureFolder(OFFERINGS_FOLDER, actorId);
  const form = await prisma.form.create({
    data: {
      name: `${offering.title} — Application`,
      folderId,
      createdById: actorId,
      versions: {
        create: {
          versionNumber: 1,
          questions: questions as unknown as object,
          intro: templateVersion?.intro ?? null,
          createdById: actorId,
        },
      },
    },
    select: { id: true },
  });
  await prisma.educationOffering.update({
    where: { id: offeringId },
    data: { applicationFormId: form.id },
  });
  return form.id;
}

export type OfferingApplicationForm = {
  formId: string;
  name: string;
  versionId: string;
  description: unknown;
  questions: Question[];
};

/**
 * The offering's application form at its latest version, with reference
 * options resolved for this filler. Mirrors loadPublicForm but goes by
 * formId (no public token — education forms are never published).
 */
export async function loadOfferingApplicationForm(
  offeringId: string,
  userId?: string | null,
): Promise<OfferingApplicationForm | null> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: {
      applicationForm: {
        select: {
          id: true,
          name: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { id: true, questions: true, intro: true },
          },
        },
      },
    },
  });
  const form = offering?.applicationForm;
  const version = form?.versions[0];
  if (!form || !version) return null;

  const questions = (version.questions as unknown as Question[]) ?? [];
  const resolved = await Promise.all(
    questions.map(async (q) => {
      if (q.type !== "reference") return q;
      const options = await resolveReferenceOptions(q.data.referenceSource, {
        userId,
        termId: q.data.referenceTermId,
      });
      return { ...q, data: { ...q.data, referenceOptions: options } };
    }),
  );

  return {
    formId: form.id,
    name: form.name,
    versionId: version.id,
    description: safeParseJsonString(version.intro),
    questions: resolved,
  };
}
