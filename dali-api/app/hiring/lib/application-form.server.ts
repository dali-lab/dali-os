// Hiring application forms, built on the shared Drive Forms system. Each
// internal (Fellowship/Core) cycle gets its own Form referenced by
// ApplicationCycle.applicationFormId. Forms stay UNPUBLISHED — there is no
// public token; the hiring portal loads and validates the latest version
// directly and cycle eligibility is the fill gate. Mirrors the education
// pattern in app/education/lib/application-form.server.ts.

import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import { ensureHiringDriveRoot } from "~/lib/pages";
import type { Question } from "~/types";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import type { ApplicationCycleType } from "~/generated/prisma/client";

const HIRING_FOLDER = "Hiring";
const TEMPLATE_FOLDER = "Hiring Templates";
const TEMPLATE_NAME = "Internal Application Template";

function defaultQuestions(): Question[] {
  return [
    {
      key: randomUUID(),
      type: "textarea",
      required: true,
      data: {
        label: "Why do you want this role, and what would you bring to it?",
        maxWords: 300,
      },
    },
    {
      key: randomUUID(),
      type: "textarea",
      required: false,
      data: {
        label: "Anything else you'd like the reviewers to know? (optional)",
        maxWords: 200,
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
 * Idempotently create the hiring application template Form (in the "Hiring
 * Templates" folder). Editing it in the Forms UI and saving a new version
 * changes what future cycles are cloned from.
 */
export async function ensureHiringTemplate(actorId: string): Promise<string> {
  const folderId = await ensureFolder(TEMPLATE_FOLDER, actorId);
  const existing = await prisma.form.findFirst({
    where: { name: TEMPLATE_NAME, folderId },
    select: { id: true, versions: { select: { id: true }, take: 1 } },
  });
  if (existing?.versions.length) return existing.id;
  if (existing) {
    await prisma.formVersion.create({
      data: {
        formId: existing.id,
        versionNumber: 1,
        questions: defaultQuestions() as unknown as object,
        createdById: actorId,
      },
    });
    return existing.id;
  }
  const created = await prisma.form.create({
    data: {
      name: TEMPLATE_NAME,
      folderId,
      createdById: actorId,
      versions: {
        create: {
          versionNumber: 1,
          questions: defaultQuestions() as unknown as object,
          createdById: actorId,
        },
      },
    },
    select: { id: true },
  });
  return created.id;
}

const CYCLE_LABEL: Partial<Record<ApplicationCycleType, string>> = {
  Fellowship: "Fellowship",
  Core: "Core",
};

/**
 * Clone the hiring template's latest version into a new per-cycle Form (in the
 * "Hiring" folder) and bind it via ApplicationCycle.applicationFormId. No-op if
 * the cycle already has one. Returns the bound form id.
 */
export async function createCycleApplicationForm(
  cycleId: string,
  actorId: string,
): Promise<string | null> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, name: true, cycleType: true, applicationFormId: true },
  });
  if (!cycle) return null;
  if (cycle.applicationFormId) return cycle.applicationFormId;

  const templateId = await ensureHiringTemplate(actorId);
  const template = await prisma.form.findUnique({
    where: { id: templateId },
    select: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { questions: true, intro: true },
      },
    },
  });
  const templateVersion = template?.versions[0];
  const questions = (templateVersion?.questions as unknown as Question[]) ?? defaultQuestions();

  const folderId = await ensureFolder(HIRING_FOLDER, actorId);
  const folderPageId = (await ensureHiringDriveRoot(actorId))?.id ?? null;
  const label = CYCLE_LABEL[cycle.cycleType] ?? "Application";
  const form = await prisma.form.create({
    data: {
      name: `${cycle.name} — ${label} application`,
      folderId,
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
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { applicationFormId: form.id },
  });
  return form.id;
}

/**
 * Auto-create a per-domain challenge Form (in the "Hiring" folder) and link it
 * to the (cycle, domain) via CycleDomainForm. Returns the new form id. A domain
 * may have several challenge Forms — the applicant picks one.
 */
export async function createDomainChallengeForm(
  cycleId: string,
  domainId: string,
  actorId: string,
): Promise<string | null> {
  const [cycle, domain] = await Promise.all([
    prisma.applicationCycle.findUnique({ where: { id: cycleId }, select: { id: true, name: true } }),
    prisma.domain.findUnique({ where: { id: domainId }, select: { id: true, displayName: true } }),
  ]);
  if (!cycle || !domain) return null;

  const templateId = await ensureHiringTemplate(actorId);
  const template = await prisma.form.findUnique({
    where: { id: templateId },
    select: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { questions: true, intro: true } } },
  });
  const templateVersion = template?.versions[0];
  const questions = (templateVersion?.questions as unknown as Question[]) ?? defaultQuestions();

  const folderId = await ensureFolder(HIRING_FOLDER, actorId);
  const folderPageId = (await ensureHiringDriveRoot(actorId))?.id ?? null;
  const form = await prisma.form.create({
    data: {
      name: `${cycle.name} — ${domain.displayName} challenge`,
      folderId,
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
  await prisma.cycleDomainForm.create({
    data: { applicationCycleId: cycleId, domainId, formId: form.id },
  });
  return form.id;
}

export type HiringApplicationForm = {
  formId: string;
  name: string;
  versionId: string;
  description: unknown;
  questions: Question[];
};

/**
 * A hiring Form at its latest version, with `reference` options resolved for
 * this filler. Mirrors loadOfferingApplicationForm — goes by formId (no public
 * token; hiring forms are never published).
 */
export async function loadHiringForm(
  formId: string,
  userId?: string | null,
): Promise<HiringApplicationForm | null> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: {
      id: true,
      name: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, questions: true, intro: true },
      },
    },
  });
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

/**
 * The pinned version's questions for an in-progress/submitted application, used
 * by reviewer/viewer surfaces. Returns [] if unpinned.
 */
export async function loadPinnedFormQuestions(
  formVersionId: string | null | undefined,
): Promise<Question[]> {
  if (!formVersionId) return [];
  const v = await prisma.formVersion.findUnique({
    where: { id: formVersionId },
    select: { questions: true },
  });
  return (v?.questions as unknown as Question[]) ?? [];
}
