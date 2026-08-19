// Offering application forms, built on the shared Forms system. Each offering
// gets its own Form (cloned from an education template at creation) referenced
// by EducationOffering.applicationFormId. Forms stay UNPUBLISHED — there is no
// public token; the education apply routes load and validate the latest
// version directly, so submissions can't arrive outside an application.

import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import { ensureCoreDriveRoot, ensureOfferingFormsFolder } from "~/lib/pages";
import type { Question } from "~/types";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import type { OfferingType } from "~/generated/prisma/client";

const TEMPLATES_FOLDER = "Education Templates";
// Managed home for the template forms: Core ▸ Templates ▸ Education, created by
// ensureCoreDriveRoot. Keeping them inside the Core scope (mirroring hiring's
// Application Templates folder) stops them floating loose in the Lab-wide drive.
const CORE_TEMPLATES_EDUCATION_KEY = "drive:core-templates-education";

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

// Find or create the top-level Lab Page folder (kind=Folder) that holds the
// template forms in the Drive. Matches by title so it converges on the mirror
// Page the form-folder-mirror job created from the old FormFolder of the same
// name.
async function ensureFolder(name: string, actorId: string): Promise<string> {
  const existing = await prisma.page.findFirst({
    where: {
      title: name,
      kind: "Folder",
      workspaceType: "Lab",
      parentPageId: null,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.page.create({
    data: {
      title: name,
      kind: "Folder",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      createdById: actorId,
    },
    select: { id: true },
  });
  return created.id;
}

// Resolve the managed Core ▸ Templates ▸ Education folder. Cheap in the common
// case (a single findUnique once the Core drive is provisioned); only the very
// first call provisions it. Falls back to a loose top-level "Education
// Templates" folder if the Core drive can't be created yet (e.g. the Core group
// isn't seeded) — a later call re-homes anything left there.
async function ensureTemplatesFolder(actorId: string): Promise<string> {
  const existing = await prisma.page.findUnique({
    where: { systemKey: CORE_TEMPLATES_EDUCATION_KEY },
    select: { id: true },
  });
  if (existing) return existing.id;
  await ensureCoreDriveRoot(actorId);
  const managed = await prisma.page.findUnique({
    where: { systemKey: CORE_TEMPLATES_EDUCATION_KEY },
    select: { id: true },
  });
  return managed?.id ?? ensureFolder(TEMPLATES_FOLDER, actorId);
}

// One-time re-home: move template forms out of the legacy loose "Education
// Templates" folder into the managed folder, then archive the emptied legacy
// folder. Idempotent — a no-op once the legacy folder is gone or its templates
// already live in the managed folder. Runs on every ensureEducationTemplates
// call, so an existing prod/staging drive converges on the next education action.
async function rehomeLegacyEducationTemplates(managedFolderId: string): Promise<void> {
  const legacy = await prisma.page.findFirst({
    where: {
      title: TEMPLATES_FOLDER,
      kind: "Folder",
      workspaceType: "Lab",
      parentPageId: null,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!legacy || legacy.id === managedFolderId) return;
  await prisma.form.updateMany({
    where: { folderPageId: legacy.id, name: { in: Object.values(TEMPLATE_NAMES) } },
    data: { folderPageId: managedFolderId },
  });
  const [childPages, otherForms] = await Promise.all([
    prisma.page.count({ where: { parentPageId: legacy.id, archivedAt: null } }),
    prisma.form.count({ where: { folderPageId: legacy.id } }),
  ]);
  if (childPages === 0 && otherForms === 0) {
    await prisma.page.update({ where: { id: legacy.id }, data: { archivedAt: new Date() } });
  }
}

/**
 * Idempotently create the education template forms (one per offering type)
 * inside the managed Core ▸ Templates ▸ Education folder. Editing a template in
 * the Forms UI and saving a new version changes what future offerings are
 * cloned from.
 */
export async function ensureEducationTemplates(actorId: string): Promise<void> {
  const folderPageId = await ensureTemplatesFolder(actorId);
  await rehomeLegacyEducationTemplates(folderPageId);
  for (const type of ["Miniseries", "Workshop"] as const) {
    const name = TEMPLATE_NAMES[type];
    const existing = await prisma.form.findFirst({
      where: { name, folderPageId },
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
        folderPageId,
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

  const folderPageId = await ensureOfferingFormsFolder(offering.id, actorId);
  const form = await prisma.form.create({
    data: {
      name: `${offering.title} — Application`,
      folderPageId,
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
  // Fingerprint echoed back on submit so a mid-fill in-place edit is caught.
  versionUpdatedAt: string;
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
            select: { id: true, questions: true, intro: true, updatedAt: true },
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
    versionUpdatedAt: version.updatedAt.toISOString(),
    description: safeParseJsonString(version.intro),
    questions: resolved,
  };
}
