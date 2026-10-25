// Learner work on whiteboard and document labs, and mentor review of it.
// Mentors are the journey's owners and editors (and Core), never the learner.

import type { OnboardingLabSubmissionStatus } from "~/generated/prisma/enums";
import { prisma, Prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { notify } from "~/lib/notify.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { getModule, journeyTitle, moduleTitle } from "./journey";
import { roleOn, toDomain, type JourneyResult, type JourneyViewer } from "./journeys.server";
import { modulePath } from "./paths";
import { evaluateCriteria, needsMentor, readyForReview } from "./studio";
import type { StudioLab, StudioWork, SubmissionStatus } from "./studio-types";
import type { JourneyContent } from "./types";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const STATUS_FROM_DB: Record<OnboardingLabSubmissionStatus, SubmissionStatus> = {
  InProgress: "in-progress",
  Submitted: "submitted",
  Approved: "approved",
  ChangesRequested: "changes-requested",
};

export interface LabSubmission {
  id: string;
  status: SubmissionStatus;
  work: StudioWork;
  selfChecks: Record<string, boolean>;
  mentorChecks: Record<string, boolean>;
  mentorNote: string | null;
  reviewerName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

const SUBMISSION_SELECT = {
  id: true,
  status: true,
  work: true,
  selfChecks: true,
  mentorChecks: true,
  mentorNote: true,
  submittedAt: true,
  reviewedAt: true,
  reviewer: { select: { firstName: true, lastName: true } },
} as const;

type SubmissionRow = Prisma.OnboardingLabSubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;

const checks = (json: Prisma.JsonValue) => (json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, boolean>) : {});
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

function toSubmission(row: SubmissionRow): LabSubmission {
  return {
    id: row.id,
    status: STATUS_FROM_DB[row.status],
    work: row.work as unknown as StudioWork,
    selfChecks: checks(row.selfChecks),
    mentorChecks: checks(row.mentorChecks),
    mentorNote: row.mentorNote,
    reviewerName: row.reviewer ? fullName(row.reviewer) : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

const key = (viewer: JourneyViewer, journeyId: string, moduleId: string) => ({
  journeyId_moduleId_userId: { journeyId, moduleId, userId: viewer.id },
});

export async function loadMySubmission(viewer: JourneyViewer, journeyId: string, moduleId: string): Promise<LabSubmission | null> {
  const row = await prisma.onboardingLabSubmission.findUnique({ where: key(viewer, journeyId, moduleId), select: SUBMISSION_SELECT });
  return row ? toSubmission(row) : null;
}

/** The published studio lab for a module, with what notifications need to describe it. */
async function publishedStudio(journeyId: string, moduleId: string) {
  const row = await prisma.onboardingJourney.findUnique({
    where: { id: journeyId },
    select: { published: true, domain: { select: { code: true, displayName: true } }, collaborators: { select: { userId: true, role: true } } },
  });
  if (!row?.published) return null;
  const journey = row.published as unknown as JourneyContent;
  const mod = getModule(journey, moduleId);
  if (!mod?.studio) return null;
  return { journey, mod, studio: mod.studio, domain: toDomain(row.domain), collaborators: row.collaborators };
}

const LOCKED: OnboardingLabSubmissionStatus[] = ["Submitted", "Approved"];

/** Saves the learner's board or document and self-checks. Locked while a mentor reviews it or once approved. */
export async function saveMyWork(
  viewer: JourneyViewer,
  journeyId: string,
  moduleId: string,
  patch: { work?: StudioWork; selfChecks?: Record<string, boolean> },
): Promise<JourneyResult<{ submission: LabSubmission }>> {
  if (!(await publishedStudio(journeyId, moduleId))) return fail(404, "Lab not found.");
  const existing = await prisma.onboardingLabSubmission.findUnique({ where: key(viewer, journeyId, moduleId), select: { status: true } });
  if (existing && LOCKED.includes(existing.status)) return fail(409, "This work is locked while it's reviewed.");
  const data = {
    ...(patch.work ? { work: asJson(patch.work) } : {}),
    ...(patch.selfChecks ? { selfChecks: asJson(patch.selfChecks) } : {}),
  };
  const row = await prisma.onboardingLabSubmission.upsert({
    where: key(viewer, journeyId, moduleId),
    create: { journeyId, moduleId, userId: viewer.id, work: asJson(patch.work ?? {}), selfChecks: asJson(patch.selfChecks ?? {}) },
    update: data,
    select: SUBMISSION_SELECT,
  });
  return { ok: true, submission: toSubmission(row) };
}

export async function resetMyWork(viewer: JourneyViewer, journeyId: string, moduleId: string): Promise<JourneyResult> {
  const existing = await prisma.onboardingLabSubmission.findUnique({ where: key(viewer, journeyId, moduleId), select: { status: true } });
  if (existing && LOCKED.includes(existing.status)) return fail(409, "This work is locked while it's reviewed.");
  await prisma.onboardingLabSubmission.deleteMany({ where: { journeyId, moduleId, userId: viewer.id } });
  return { ok: true };
}

/** Sends the work to the journey's mentors. The server re-runs the checks, so a learner can't skip them. */
export async function submitMyWork(viewer: JourneyViewer, journeyId: string, moduleId: string): Promise<JourneyResult> {
  const lab = await publishedStudio(journeyId, moduleId);
  if (!lab) return fail(404, "Lab not found.");
  if (!needsMentor(lab.studio)) return fail(400, "This lab doesn't need a review.");
  const row = await prisma.onboardingLabSubmission.findUnique({ where: key(viewer, journeyId, moduleId), select: SUBMISSION_SELECT });
  if (!row) return fail(400, "Start the lab before submitting it.");
  if (LOCKED.includes(row.status)) return fail(409, "This work has already been sent for review.");
  const mine = toSubmission(row);
  if (!readyForReview(evaluateCriteria(lab.studio, mine.work, mine.selfChecks, {}, "in-progress"))) {
    return fail(400, "Finish the automatic checks and self-checks first.");
  }
  await prisma.onboardingLabSubmission.update({
    where: { id: row.id },
    data: { status: "Submitted", submittedAt: new Date(), reviewerId: null, reviewedAt: null },
  });

  const learner = await prisma.user.findUnique({ where: { id: viewer.id }, select: { firstName: true, lastName: true } });
  const mentors = lab.collaborators.map((c) => c.userId).filter((id) => id !== viewer.id);
  if (mentors.length) {
    await notify({
      eventType: "journey.lab_submitted",
      createdByUserId: viewer.id,
      message: {
        vars: { personName: learner ? fullName(learner) : "A learner", itemDetail: `${lab.studio.title} · ${journeyTitle(lab.journey)}` },
        link: `/journeys/reviews?submission=${row.id}`,
      },
      recipients: mentors.map((userId) => ({ userId })),
    });
  }
  return { ok: true };
}

/** True once a mentor approved this learner's work, or the lab never needed a review. */
export async function labApproved(userId: string, journeyId: string, moduleId: string, studio: StudioLab): Promise<boolean> {
  if (!needsMentor(studio)) return true;
  const row = await prisma.onboardingLabSubmission.findUnique({
    where: { journeyId_moduleId_userId: { journeyId, moduleId, userId } },
    select: { status: true },
  });
  return row?.status === "Approved";
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

export interface ReviewEntry {
  submission: LabSubmission;
  studio: StudioLab;
  learner: { id: string; name: string; photoUrl: string | null };
  moduleTitle: string;
  journeyTitle: string;
  labHref: string;
}

/** Work sent for review on journeys the viewer can edit, newest first. Their own work never shows. */
export async function listReviews(viewer: JourneyViewer): Promise<ReviewEntry[]> {
  const rows = await prisma.onboardingLabSubmission.findMany({
    where: {
      status: { not: "InProgress" },
      userId: { not: viewer.id },
      journey: viewer.isCore ? {} : { collaborators: { some: { userId: viewer.id } } },
    },
    select: {
      ...SUBMISSION_SELECT,
      moduleId: true,
      journeyId: true,
      user: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      journey: { select: { published: true, domain: { select: { code: true, displayName: true } } } },
    },
    orderBy: { submittedAt: "desc" },
    take: 200,
  });
  const entries: ReviewEntry[] = [];
  for (const row of rows) {
    const journey = row.journey.published as unknown as JourneyContent | null;
    const mod = journey ? getModule(journey, row.moduleId) : undefined;
    if (!journey || !mod?.studio) continue;
    entries.push({
      submission: toSubmission(row),
      studio: mod.studio,
      learner: { id: row.user.id, name: fullName(row.user), photoUrl: await resolvePhotoUrl(row.user.photoUrl) },
      moduleTitle: moduleTitle(mod),
      journeyTitle: journeyTitle(journey),
      labHref: `${modulePath(toDomain(row.journey.domain).slug, row.journeyId, row.moduleId)}?view=lab`,
    });
  }
  return entries;
}

/** Whether the viewer mentors anything: Core, or an owner or editor of some journey. */
export async function isJourneyMentor(viewer: JourneyViewer): Promise<boolean> {
  if (viewer.isCore) return true;
  return (await prisma.onboardingJourneyCollaborator.count({ where: { userId: viewer.id } })) > 0;
}

export async function countWaitingReviews(viewer: JourneyViewer): Promise<number> {
  return prisma.onboardingLabSubmission.count({
    where: {
      status: "Submitted",
      userId: { not: viewer.id },
      journey: viewer.isCore ? {} : { collaborators: { some: { userId: viewer.id } } },
    },
  });
}

export async function reviewSubmission(
  viewer: JourneyViewer,
  submissionId: string,
  review: { mentorChecks: Record<string, boolean>; note: string; decision: "approved" | "changes-requested" },
): Promise<JourneyResult> {
  const row = await prisma.onboardingLabSubmission.findUnique({
    where: { id: submissionId },
    select: {
      status: true,
      userId: true,
      journeyId: true,
      moduleId: true,
      journey: { select: { collaborators: { select: { userId: true, role: true } } } },
    },
  });
  if (!row || !roleOn(viewer, row.journey.collaborators) || row.userId === viewer.id) return fail(404, "Submission not found.");
  if (row.status !== "Submitted") return fail(409, "This work has already been reviewed.");
  const lab = await publishedStudio(row.journeyId, row.moduleId);
  if (!lab) return fail(404, "Lab not found.");
  const note = review.note.trim();
  const mentorIds = lab.studio.criteria.filter((c) => c.mode === "mentor").map((c) => c.id);
  const mentorChecks = Object.fromEntries(mentorIds.map((id) => [id, Boolean(review.mentorChecks[id])]));
  if (review.decision === "approved" && !mentorIds.every((id) => mentorChecks[id])) return fail(400, "Tick every review item to approve.");
  if (review.decision === "changes-requested" && !note) return fail(400, "Say what to change in the feedback.");

  await prisma.onboardingLabSubmission.update({
    where: { id: submissionId },
    data: {
      status: review.decision === "approved" ? "Approved" : "ChangesRequested",
      mentorChecks: asJson(mentorChecks),
      mentorNote: note || null,
      reviewerId: viewer.id,
      reviewedAt: new Date(),
    },
  });

  const reviewer = await prisma.user.findUnique({ where: { id: viewer.id }, select: { firstName: true, lastName: true } });
  await notify({
    eventType: "journey.lab_reviewed",
    createdByUserId: viewer.id,
    message: {
      copyKey: review.decision === "approved" ? "journey.lab_approved" : "journey.lab_changes",
      vars: { personName: reviewer ? fullName(reviewer) : "A mentor", itemDetail: note || lab.studio.title },
      link: `${modulePath(lab.domain.slug, row.journeyId, row.moduleId)}?view=lab`,
    },
    recipients: [{ userId: row.userId }],
  });
  return { ok: true };
}
