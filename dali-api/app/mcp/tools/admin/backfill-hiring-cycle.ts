import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { createForm } from "~/forms/lib/form-page.server";
import { resolveFilingFolder, singletonSlot } from "~/drive/lib/drive-receivers.server";
import { ensureRoot } from "~/drive/lib/drive-roots.server";
import { DEFAULT_STAGES } from "~/hiring/lib/applicant-groups";
import { FIRST_INTERVIEW_ROUND_ID, defaultTimeline } from "~/hiring/lib/cycle-timeline";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

const MAX_APPLICATIONS = 200;
const TX_TIMEOUT_MS = 300_000;
const TX_MAX_WAIT_MS = 30_000;

export const BACKFILL_HIRING_CYCLE_TOOL = {
  name: "backfill_hiring_cycle",
  description:
    "Import ONE finished historical hiring cycle: the cycle (Completed, stamped with the dates you pass), " +
    "its application form, per-domain rubrics and challenge forms, applications, reviews, Released decisions " +
    "and completed interviews. Rows are written directly with the historical timestamps; nothing is released, " +
    "so no emails, notifications, Slack messages, members, or domain eligibility are created. Applicants without " +
    "an account get a plain User with no membership. A waitlisted applicant needs a final outcome: pass " +
    "outcome.waitlistedAt with Rejected (came off the waitlist) or Accepted (hired from it), so nobody lands on " +
    "the live waitlist. Omit the outcome for undecided applicants. Pass cycleId to append more applications to a cycle created by an " +
    "earlier call; reruns skip rows that already exist. Max 200 applications per call. Admins only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycle: {
        type: "object",
        description:
          "name, createdAt (ISO, required), applicants (Students|Interns|LabMembers, default Students), " +
          "termId, startTermIds[], openDate, closeDate, hasChallenges, hasInterviews.",
      },
      cycleId: {
        type: "string",
        description: "Append to this existing cycle instead of creating one.",
      },
      applicationForm: {
        type: "object",
        description: "{ name, questions: Question[] }. Created only when the cycle has no application form.",
      },
      domains: {
        type: "array",
        description:
          "[{ domainId, rubric?: { name, criteria: RubricCriterion[] }, challengeForm?: { name, questions } }]",
        items: { type: "object" },
      },
      applications: {
        type: "array",
        maxItems: MAX_APPLICATIONS,
        description:
          "[{ applicant: { userId?, email?, netId?, firstName?, lastName? }, createdAt, answers?, domainApplications: " +
          "[{ domainId, submittedAt, answers?, withdrawn?, outcome?: { type: Accepted|Rejected, decidedAt, notes?, " +
          "invitedToInterviewAt?, waitlistedAt? }, reviews?: [{ reviewerUserId, submittedAt, scores, feedback?, rejectionRationale?, " +
          "overallRecommendation? }], interview?: { startTime, endTime, interviewerUserIds?, notes? } }] }]",
        items: { type: "object" },
      },
    },
    required: ["cycle", "applications"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const iso = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const nonEmpty = z.string().trim().min(1);
const questionsSchema = z.array(z.object({ key: z.string(), type: z.string() }).passthrough());
const formSchema = z.object({ name: nonEmpty, questions: questionsSchema });
const criterionSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  maxScore: z.number(),
});

const reviewSchema = z.object({
  reviewerUserId: nonEmpty,
  submittedAt: iso,
  scores: z.record(z.string(), z.number()),
  feedback: z.string().optional(),
  rejectionRationale: z.string().optional(),
  overallRecommendation: z.string().optional(),
});

const outcomeSchema = z
  .object({
    type: z.enum(["Accepted", "Rejected"]),
    decidedAt: iso,
    notes: z.string().optional(),
    invitedToInterviewAt: iso.optional(),
    waitlistedAt: iso.optional(),
  })
  .refine((o) => !o.invitedToInterviewAt || o.invitedToInterviewAt < o.decidedAt, {
    message: "invitedToInterviewAt must be before decidedAt",
  })
  .refine((o) => !o.waitlistedAt || o.waitlistedAt < o.decidedAt, {
    message: "waitlistedAt must be before decidedAt",
  })
  .refine((o) => !o.waitlistedAt || !o.invitedToInterviewAt || o.invitedToInterviewAt < o.waitlistedAt, {
    message: "invitedToInterviewAt must be before waitlistedAt",
  });

const interviewSchema = z.object({
  startTime: iso,
  endTime: iso,
  interviewerUserIds: z.array(nonEmpty).optional(),
  notes: z.string().optional(),
});

const domainApplicationSchema = z.object({
  domainId: nonEmpty,
  submittedAt: iso,
  answers: z.record(z.string(), z.unknown()).optional(),
  withdrawn: z.boolean().optional(),
  outcome: outcomeSchema.optional(),
  reviews: z.array(reviewSchema).optional(),
  interview: interviewSchema.optional(),
});

const applicantSchema = z.object({
  userId: nonEmpty.optional(),
  email: nonEmpty.optional(),
  netId: nonEmpty.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const inputSchema = z.object({
  cycle: z.object({
    name: nonEmpty,
    applicants: z.enum(["Students", "Interns", "LabMembers"]).default("Students"),
    termId: nonEmpty.optional(),
    startTermIds: z.array(nonEmpty).default([]),
    openDate: iso.optional(),
    closeDate: iso.optional(),
    createdAt: iso,
    hasChallenges: z.boolean().optional(),
    hasInterviews: z.boolean().optional(),
  }),
  cycleId: nonEmpty.optional(),
  applicationForm: formSchema.optional(),
  domains: z
    .array(
      z.object({
        domainId: nonEmpty,
        rubric: z.object({ name: nonEmpty, criteria: z.array(criterionSchema) }).optional(),
        challengeForm: formSchema.optional(),
      }),
    )
    .default([]),
  applications: z
    .array(
      z.object({
        applicant: applicantSchema,
        createdAt: iso,
        answers: z.record(z.string(), z.unknown()).optional(),
        domainApplications: z.array(domainApplicationSchema),
      }),
    )
    .max(MAX_APPLICATIONS),
});

type Input = z.infer<typeof inputSchema>;
type Applicant = Input["applications"][number]["applicant"];
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const distinct = <T>(values: T[]) => [...new Set(values)];
const asJson = (v: unknown) => v as object;
const lower = (v?: string) => v?.trim().toLowerCase() || undefined;

function identityColumns(a: Applicant) {
  const email = lower(a.email);
  const columns: Record<string, string> = {};
  if (email) {
    columns[
      email.endsWith("@dali.dartmouth.edu")
        ? "daliEmail"
        : email.endsWith("@dartmouth.edu")
          ? "dartmouthEmail"
          : "personalEmail"
    ] = email;
  }
  const netId = lower(a.netId);
  if (netId) columns.netId = netId;
  return columns;
}

const EMAIL_COLUMNS = ["daliEmail", "dartmouthEmail", "personalEmail"] as const;

async function resolveApplicant(tx: Db, a: Applicant, createdAt: Date) {
  const identity = identityColumns(a);
  const select = {
    id: true,
    firstName: true,
    lastName: true,
    netId: true,
    daliEmail: true,
    dartmouthEmail: true,
    personalEmail: true,
  } as const;
  const emailValue = lower(a.email);

  let user = a.userId ? await tx.user.findUnique({ where: { id: a.userId }, select }) : null;
  if (!user && identity.netId) user = await tx.user.findFirst({ where: { netId: identity.netId }, select });
  if (!user && emailValue) {
    user = await tx.user.findFirst({
      where: { OR: EMAIL_COLUMNS.map((c) => ({ [c]: emailValue })) },
      select,
    });
  }

  if (!user) {
    const created = await tx.user.create({
      data: {
        firstName: a.firstName?.trim() ?? "",
        lastName: a.lastName?.trim() ?? "",
        ...identity,
        createdAt,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  const fill: Record<string, string> = {};
  const firstName = a.firstName?.trim();
  const lastName = a.lastName?.trim();
  if (firstName && !user.firstName) fill.firstName = firstName;
  if (lastName && !user.lastName) fill.lastName = lastName;
  for (const [column, value] of Object.entries(identity)) {
    if ((user as Record<string, unknown>)[column]) continue;
    const taken = await tx.user.findFirst({ where: { [column]: value }, select: { id: true } });
    if (!taken) fill[column] = value;
  }
  if (Object.keys(fill).length) await tx.user.update({ where: { id: user.id }, data: fill });
  return { id: user.id, created: false };
}

const missing = (kind: string, wanted: string[], found: { id: string }[]) => {
  const have = new Set(found.map((f) => f.id));
  const gone = wanted.filter((id) => !have.has(id));
  return gone.length ? `Unknown ${kind}(s): ${gone.join(", ")}` : null;
};

export async function runBackfillHiringCycle(ctx: McpCtx, rawArgs: unknown) {
  const callerId = ctx.user.id;

  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can backfill hiring cycles.");
  }

  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpInvalidError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join(". "),
    );
  }
  const { cycle: cycleInput, cycleId, applicationForm, domains, applications } = parsed.data;

  const das = applications.flatMap((a) => a.domainApplications);
  const domainIds = distinct([...domains.map((d) => d.domainId), ...das.map((d) => d.domainId)]);
  const termIds = distinct([...(cycleInput.termId ? [cycleInput.termId] : []), ...cycleInput.startTermIds]);
  const userIds = distinct([
    ...applications.flatMap((a) => (a.applicant.userId ? [a.applicant.userId] : [])),
    ...das.flatMap((d) => (d.reviews ?? []).map((r) => r.reviewerUserId)),
    ...das.flatMap((d) => d.interview?.interviewerUserIds ?? []),
  ]);

  const [users, domainRows, terms, existingCycle, sameName] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }),
    prisma.domain.findMany({ where: { id: { in: domainIds } }, select: { id: true, displayName: true } }),
    prisma.term.findMany({ where: { id: { in: termIds } }, select: { id: true } }),
    cycleId
      ? prisma.applicationCycle.findUnique({
          where: { id: cycleId },
          select: {
            id: true,
            name: true,
            createdAt: true,
            applicants: true,
            applicationFormId: true,
            domains: { select: { domainId: true, rubricVersionId: true } },
            domainChallengeForms: { select: { domainId: true } },
          },
        })
      : null,
    cycleId ? null : prisma.applicationCycle.findFirst({ where: { name: cycleInput.name }, select: { id: true } }),
  ]);

  const problems = [
    missing("userId", userIds, users),
    missing("domainId", domainIds, domainRows),
    missing("termId", termIds, terms),
    cycleId && !existingCycle ? `Unknown cycleId(s): ${cycleId}` : null,
    sameName
      ? `A cycle named "${cycleInput.name}" already exists (${sameName.id}). Pass cycleId to append to it`
      : null,
  ].filter((p): p is string => p !== null);

  const cycleDomainIds = new Set([
    ...domains.map((d) => d.domainId),
    ...(existingCycle?.domains.map((d) => d.domainId) ?? []),
  ]);
  const outside = distinct(das.map((d) => d.domainId).filter((id) => !cycleDomainIds.has(id)));
  const unknownDomain = new Set(domainIds.filter((id) => !domainRows.some((r) => r.id === id)));
  const notInCycle = outside.filter((id) => !unknownDomain.has(id));
  if (notInCycle.length) {
    problems.push(`Domain(s) used by applications but not in domains: ${notInCycle.join(", ")}`);
  }
  if (problems.length) throw new McpInvalidError(`${problems.join(". ")}.`);

  const cycleCreatedAt = existingCycle?.createdAt ?? cycleInput.createdAt;
  const applicants = existingCycle?.applicants ?? cycleInput.applicants;
  const cycleName = existingCycle?.name ?? cycleInput.name;
  const domainName = new Map(domainRows.map((d) => [d.id, d.displayName]));
  const existingDac = new Map((existingCycle?.domains ?? []).map((d) => [d.domainId, d]));
  const domainsWithChallenge = new Set((existingCycle?.domainChallengeForms ?? []).map((f) => f.domainId));

  const formsFolder = async () =>
    (await resolveFilingFolder(singletonSlot("HiringCycle", "HiringForms"), callerId)).folderId;
  const makeForm = async (name: string, questions: unknown[]) =>
    createForm(
      {
        name,
        folderPageId: await formsFolder(),
        createdById: callerId,
        createdAt: cycleCreatedAt,
        versions: {
          create: { versionNumber: 1, questions: asJson(questions), createdById: callerId, createdAt: cycleCreatedAt },
        },
      },
      { id: true },
    );

  const newApplicationFormId =
    applicationForm && !existingCycle?.applicationFormId
      ? (await makeForm(applicationForm.name, applicationForm.questions)).id
      : null;

  const newChallengeForms = new Map<string, string>();
  for (const d of domains) {
    if (d.challengeForm && !domainsWithChallenge.has(d.domainId)) {
      newChallengeForms.set(d.domainId, (await makeForm(d.challengeForm.name, d.challengeForm.questions)).id);
    }
  }
  const needsRubricFolder = domains.some((d) => d.rubric && !existingDac.get(d.domainId)?.rubricVersionId);
  const rubricFolderId = needsRubricFolder ? await ensureRoot("hiring", callerId) : null;

  const counts = {
    cycleCreated: false,
    cycleAppended: false,
    usersMatched: 0,
    usersCreated: 0,
    applicationsCreated: 0,
    applicationsUpdated: 0,
    domainApplicationsCreated: 0,
    reviewsUpserted: 0,
    decisionsWritten: 0,
    interviewsCreated: 0,
  };

  const resultCycleId = await prisma.$transaction(
    async (tx) => {
      let cycleRowId: string;
      let applicationFormId: string | null;
      if (existingCycle) {
        cycleRowId = existingCycle.id;
        applicationFormId = existingCycle.applicationFormId ?? newApplicationFormId;
        if (newApplicationFormId) {
          await tx.applicationCycle.update({
            where: { id: cycleRowId },
            data: { applicationFormId: newApplicationFormId },
          });
        }
        counts.cycleAppended = true;
      } else {
        const stages = DEFAULT_STAGES[applicants];
        const hasChallenges = cycleInput.hasChallenges ?? stages.hasChallenges;
        const hasInterviews = cycleInput.hasInterviews ?? stages.hasInterviews;
        const created = await tx.applicationCycle.create({
          data: {
            name: cycleName,
            applicants,
            hasChallenges,
            hasInterviews,
            anonymizeReview: stages.anonymizeReview,
            timeline: asJson(defaultTimeline({ firstDelib: applicants !== "Interns", interviews: hasInterviews })),
            termId: cycleInput.termId ?? null,
            startTermIds: cycleInput.startTermIds,
            openDate: cycleInput.openDate ?? null,
            closeDate: cycleInput.closeDate ?? null,
            applicationFormId: newApplicationFormId,
            createdAt: cycleInput.createdAt,
            statusUpdates: {
              create: {
                newStatus: "Completed",
                userId: callerId,
                createdAt: cycleInput.closeDate ?? cycleInput.createdAt,
              },
            },
          },
          select: { id: true },
        });
        cycleRowId = created.id;
        applicationFormId = newApplicationFormId;
        counts.cycleCreated = true;
      }

      const rubricVersionByDomain = new Map<string, string | null>();
      for (const d of domains) {
        let rubricVersionId = existingDac.get(d.domainId)?.rubricVersionId ?? null;
        if (d.rubric && !rubricVersionId) {
          const rubric = await tx.rubric.create({
            data: { name: d.rubric.name, folderPageId: rubricFolderId, createdAt: cycleCreatedAt },
            select: { id: true },
          });
          const version = await tx.rubricVersion.create({
            data: {
              rubricId: rubric.id,
              versionNumber: 1,
              criteria: asJson(d.rubric.criteria),
              createdById: callerId,
              createdAt: cycleCreatedAt,
            },
            select: { id: true },
          });
          rubricVersionId = version.id;
        }
        rubricVersionByDomain.set(d.domainId, rubricVersionId);
        await tx.domainApplicationCycle.upsert({
          where: { domainId_applicationCycleId: { domainId: d.domainId, applicationCycleId: cycleRowId } },
          create: { domainId: d.domainId, applicationCycleId: cycleRowId, isReady: true, rubricVersionId },
          update: { isReady: true, ...(rubricVersionId ? { rubricVersionId } : {}) },
        });
        const newForm = newChallengeForms.get(d.domainId);
        if (newForm) {
          await tx.cycleDomainForm.create({
            data: {
              applicationCycleId: cycleRowId,
              domainId: d.domainId,
              formId: newForm,
              createdAt: cycleCreatedAt,
            },
          });
        }
      }
      for (const [domainId, dac] of existingDac) {
        if (!rubricVersionByDomain.has(domainId)) rubricVersionByDomain.set(domainId, dac.rubricVersionId);
      }

      const latestVersion = { versions: { orderBy: { versionNumber: "desc" as const }, take: 1, select: { id: true } } };
      const applicationFormVersionId = applicationFormId
        ? ((await tx.form.findUnique({ where: { id: applicationFormId }, select: latestVersion }))?.versions[0]?.id ??
          null)
        : null;
      const challengeRows = await tx.cycleDomainForm.findMany({
        where: { applicationCycleId: cycleRowId },
        orderBy: { createdAt: "asc" },
        select: { domainId: true, form: { select: latestVersion } },
      });
      const challengeVersionByDomain = new Map<string, string>();
      for (const row of challengeRows) {
        const versionId = row.form.versions[0]?.id;
        if (versionId && !challengeVersionByDomain.has(row.domainId)) {
          challengeVersionByDomain.set(row.domainId, versionId);
        }
      }

      const reviewerCache = new Map<string, string>();
      const interviewerCache = new Map<string, string>();

      for (const app of applications) {
        const resolved = await resolveApplicant(tx, app.applicant, app.createdAt);
        if (resolved.created) counts.usersCreated++;
        else counts.usersMatched++;

        const existingApp = await tx.application.findUnique({
          where: { userId_applicationCycleId: { userId: resolved.id, applicationCycleId: cycleRowId } },
          select: { id: true, applicationFormVersionId: true },
        });
        let applicationId: string;
        if (existingApp) {
          applicationId = existingApp.id;
          if (!existingApp.applicationFormVersionId && applicationFormVersionId) {
            await tx.application.update({
              where: { id: applicationId },
              data: { applicationFormVersionId },
            });
          }
          counts.applicationsUpdated++;
        } else {
          const created = await tx.application.create({
            data: {
              userId: resolved.id,
              applicationCycleId: cycleRowId,
              answers: asJson(app.answers ?? {}),
              applicationFormVersionId,
              createdAt: app.createdAt,
            },
            select: { id: true },
          });
          applicationId = created.id;
          counts.applicationsCreated++;
        }

        const submittedTimes = app.domainApplications.map((d) => d.submittedAt.getTime());
        const earliest = new Date(Math.min(...submittedTimes));
        const alreadySubmitted = await tx.applicationStatusUpdate.findFirst({
          where: { applicationId, newStatus: "Submitted" },
          select: { id: true },
        });
        if (!alreadySubmitted && submittedTimes.length) {
          await tx.applicationStatusUpdate.create({
            data: { applicationId, userId: resolved.id, newStatus: "Submitted", createdAt: earliest },
          });
        }
        if (app.domainApplications.some((d) => d.withdrawn)) {
          const alreadyWithdrawn = await tx.applicationStatusUpdate.findFirst({
            where: { applicationId, newStatus: "Withdrawn" },
            select: { id: true },
          });
          if (!alreadyWithdrawn) {
            await tx.applicationStatusUpdate.create({
              data: {
                applicationId,
                userId: resolved.id,
                newStatus: "Withdrawn",
                createdAt: new Date(Math.max(earliest.getTime() + 1000, ...submittedTimes)),
              },
            });
          }
        }

        const accepted: { id: string; decidedAt: Date }[] = [];
        for (const da of app.domainApplications) {
          let domainApplicationId: string;
          const existingDa = await tx.domainApplication.findFirst({
            where: { applicationId, domainId: da.domainId },
            select: { id: true },
          });
          if (existingDa) domainApplicationId = existingDa.id;
          else {
            const created = await tx.domainApplication.create({
              data: {
                applicationId,
                domainId: da.domainId,
                submittedAt: da.submittedAt,
                answers: asJson(da.answers ?? {}),
                selected: true,
                challengeFormVersionId: challengeVersionByDomain.get(da.domainId) ?? null,
                createdAt: da.submittedAt,
              },
              select: { id: true },
            });
            domainApplicationId = created.id;
            counts.domainApplicationsCreated++;
          }

          for (const review of da.reviews ?? []) {
            const reviewerKey = `${review.reviewerUserId}|${da.domainId}`;
            let cycleReviewerId = reviewerCache.get(reviewerKey);
            if (!cycleReviewerId) {
              const reviewer = await tx.cycleReviewer.upsert({
                where: {
                  userId_applicationCycleId_domainId: {
                    userId: review.reviewerUserId,
                    applicationCycleId: cycleRowId,
                    domainId: da.domainId,
                  },
                },
                create: {
                  userId: review.reviewerUserId,
                  applicationCycleId: cycleRowId,
                  domainId: da.domainId,
                  createdAt: cycleCreatedAt,
                },
                update: {},
                select: { id: true },
              });
              cycleReviewerId = reviewer.id;
              reviewerCache.set(reviewerKey, cycleReviewerId);
            }
            await tx.applicationReview.upsert({
              where: { cycleReviewerId_domainApplicationId: { cycleReviewerId, domainApplicationId } },
              create: {
                cycleReviewerId,
                domainApplicationId,
                rubricVersionId: rubricVersionByDomain.get(da.domainId) ?? null,
                scores: asJson(review.scores),
                feedback: review.feedback ?? "",
                rejectionRationale: review.rejectionRationale ?? "",
                overallRecommendation: review.overallRecommendation ?? null,
                submittedAt: review.submittedAt,
                submittedById: review.reviewerUserId,
                createdAt: review.submittedAt,
              },
              update: {},
            });
            counts.reviewsUpserted++;
          }

          if (da.outcome) {
            const hasDecisions = (await tx.decision.count({ where: { domainApplicationId } })) > 0;
            if (!hasDecisions) {
              if (da.outcome.invitedToInterviewAt) {
                await tx.decision.create({
                  data: {
                    domainApplicationId,
                    type: "InvitedToInterview",
                    stage: "Released",
                    madeById: callerId,
                    interviewRoundId: FIRST_INTERVIEW_ROUND_ID,
                    createdAt: da.outcome.invitedToInterviewAt,
                  },
                });
                counts.decisionsWritten++;
              }
              if (da.outcome.waitlistedAt) {
                await tx.decision.create({
                  data: {
                    domainApplicationId,
                    type: "Waitlisted",
                    stage: "Released",
                    madeById: callerId,
                    createdAt: da.outcome.waitlistedAt,
                  },
                });
                counts.decisionsWritten++;
              }
              await tx.decision.create({
                data: {
                  domainApplicationId,
                  type: da.outcome.type,
                  stage: "Released",
                  madeById: callerId,
                  notes: da.outcome.notes ?? null,
                  createdAt: da.outcome.decidedAt,
                },
              });
              counts.decisionsWritten++;
            }
            if (da.outcome.type === "Accepted") accepted.push({ id: domainApplicationId, decidedAt: da.outcome.decidedAt });
          }

          if (da.interview) {
            const hasInterview = (await tx.interview.count({ where: { domainApplicationId } })) > 0;
            if (!hasInterview) {
              const interview = await tx.interview.create({
                data: {
                  domainApplicationId,
                  applicationCycleId: cycleRowId,
                  interviewRoundId: FIRST_INTERVIEW_ROUND_ID,
                  startTime: da.interview.startTime,
                  endTime: da.interview.endTime,
                  status: "Completed",
                  recommendationNotes: da.interview.notes ?? null,
                  createdAt: da.interview.startTime,
                },
                select: { id: true },
              });
              counts.interviewsCreated++;
              for (const interviewerUserId of distinct(da.interview.interviewerUserIds ?? [])) {
                const interviewerKey = `${interviewerUserId}|${da.domainId}`;
                let cycleInterviewerId = interviewerCache.get(interviewerKey);
                if (!cycleInterviewerId) {
                  const interviewer = await tx.cycleInterviewer.upsert({
                    where: {
                      userId_applicationCycleId_domainId_interviewRoundId: {
                        userId: interviewerUserId,
                        applicationCycleId: cycleRowId,
                        domainId: da.domainId,
                        interviewRoundId: FIRST_INTERVIEW_ROUND_ID,
                      },
                    },
                    create: {
                      userId: interviewerUserId,
                      applicationCycleId: cycleRowId,
                      domainId: da.domainId,
                      interviewRoundId: FIRST_INTERVIEW_ROUND_ID,
                      createdAt: cycleCreatedAt,
                    },
                    update: {},
                    select: { id: true },
                  });
                  cycleInterviewerId = interviewer.id;
                  interviewerCache.set(interviewerKey, cycleInterviewerId);
                }
                await tx.interviewAssignment.create({
                  data: {
                    interviewId: interview.id,
                    cycleInterviewerId,
                    role: "InDomain",
                    status: "Active",
                    createdAt: da.interview.startTime,
                  },
                });
              }
            }
          }
        }

        for (const { id, decidedAt } of accepted) {
          await tx.domainApplication.updateMany({
            where: {
              applicationId,
              id: { not: id },
              selected: true,
              closureReason: null,
              decisions: { none: { stage: "Released" } },
            },
            data: { closureReason: "AcceptedElsewhere", closedAt: decidedAt },
          });
        }
      }

      return cycleRowId;
    },
    { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
  );

  await logAuditEvent({
    action: "hiring.cycle.backfill",
    userId: callerId,
    targetId: resultCycleId,
    metadata: { name: cycleName, ...counts },
    request: ctx.request,
  });

  return { ok: true, cycleId: resultCycleId, ...counts };
}
