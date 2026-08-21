// Hiring application forms, built on the shared Drive Forms system. Each
// internal (Fellowship/Core) cycle gets its own Form referenced by
// ApplicationCycle.applicationFormId. Forms stay UNPUBLISHED — there is no
// public token; the hiring portal loads and validates the latest version
// directly and cycle eligibility is the fill gate. Mirrors the education
// pattern in app/education/lib/application-form.server.ts.

import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import { ensureHiringDriveRoot, ensureHiringTemplatesFolder } from "~/lib/pages";
import type { Question } from "~/types";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import type { ApplicationCycleType } from "~/generated/prisma/client";

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

/**
 * Idempotently create the hiring application template Form, filed in the
 * Hiring ▸ Templates subfolder (inside the hiring-team-scoped Hiring drive).
 * Editing it in the Forms UI and saving a new version changes what future
 * cycles are cloned from.
 *
 * Re-homes any template created before this lived in the Hiring drive — earlier
 * builds placed it in a loose top-level "Hiring Templates" Lab folder, where it
 * floated in the Lab-wide drive (visible to the whole lab, invisible inside the
 * Hiring drive). We converge its placement on every call.
 */
export async function ensureHiringTemplate(actorId: string): Promise<string> {
  const folderPageId = await ensureHiringTemplatesFolder(actorId);
  // The old top-level "Hiring Templates" Lab folder, if a prior build made one.
  // We match the existing template within either the new or old home so we
  // re-home it in place rather than creating a duplicate.
  const legacyFolder = await prisma.page.findFirst({
    where: {
      title: TEMPLATE_FOLDER,
      kind: "Folder",
      workspaceType: "Lab",
      parentPageId: null,
      archivedAt: null,
    },
    select: { id: true },
  });
  const homeFolderIds = [folderPageId, ...(legacyFolder ? [legacyFolder.id] : [])];
  const existing = await prisma.form.findFirst({
    where: { name: TEMPLATE_NAME, folderPageId: { in: homeFolderIds } },
    select: { id: true, folderPageId: true, versions: { select: { id: true }, take: 1 } },
  });
  if (existing && existing.folderPageId !== folderPageId) {
    await prisma.form.update({ where: { id: existing.id }, data: { folderPageId } });
  }
  // Retire the now-empty legacy top-level folder so it no longer clutters the
  // Lab-wide drive. Best-effort and only when it holds nothing else.
  if (legacyFolder && legacyFolder.id !== folderPageId) {
    const [childPages, otherForms] = await Promise.all([
      prisma.page.count({ where: { parentPageId: legacyFolder.id, archivedAt: null } }),
      prisma.form.count({ where: { folderPageId: legacyFolder.id } }),
    ]);
    if (childPages === 0 && otherForms === 0) {
      await prisma.page.update({
        where: { id: legacyFolder.id },
        data: { archivedAt: new Date() },
      });
    }
  }
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
      folderPageId,
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

  const folderPageId = (await ensureHiringDriveRoot(actorId))?.id ?? null;
  const label = CYCLE_LABEL[cycle.cycleType] ?? "Application";
  const form = await prisma.form.create({
    data: {
      name: `${cycle.name} — ${label} application`,
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

  const folderPageId = (await ensureHiringDriveRoot(actorId))?.id ?? null;
  const form = await prisma.form.create({
    data: {
      name: `${cycle.name} — ${domain.displayName} challenge`,
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
