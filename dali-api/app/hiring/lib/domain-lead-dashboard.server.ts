import { delibsQualifier } from "~/hiring/lib/cycle-stages.server";
import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { requireAuth } from "~/lib/auth";
import { inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";
import { buildCriteriaList } from "~/hiring/lib/rubric-criteria";
import { confidentialityBlock, getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { Question } from "~/types";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";
import { HiringFormEmbed } from "~/hiring/components/HiringFormEmbed";
import { selectActiveCycleForDomainLead } from "~/hiring/lib/cycle-picker";
import { interviewerCalendars } from "~/hiring/lib/interview-availability.server";
import { FIRST_INTERVIEW_ROUND_ID, delibRounds, parseTimeline } from "~/hiring/lib/cycle-timeline";
import { getEngagementSummaries } from "~/hiring/lib/email-engagement.server";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";
import type { DomainRoundSummary } from "~/hiring/lib/domain-lead-types";

export async function loadDomainLeadDashboard({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { domainData: [], pillRoles: null };

  const [roles, assignments] = await Promise.all([
    getUserRoles(auth.user.sub, request),
    prisma.domainLeadAssignment.findMany({
      where: { userId: auth.user.sub },
      include: { domain: true },
    }),
  ]);
  const pillRoles = {
    isCore: roles.isCore,
    isDomainLead: roles.isDomainLead,
    isAdmin: roles.isAdmin,
    isInterviewer: roles.isInterviewer,
  };

  if (assignments.length === 0) {
    return { domainData: [], pillRoles };
  }

  // One query across every assignment's domain instead of one per domain
  // (previously an N+1: a separate 6-level-deep findMany per domain lead
  // assignment). Reshaped per assignment below to the exact shape a
  // per-domain query would have returned.
  const domainIds = assignments.map((a) => a.domainId);
  const allCyclesShared = await prisma.applicationCycle.findMany({
    where: {
      domains: { some: { domainId: { in: domainIds } } },
    },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domains: { where: { domainId: { in: domainIds } } },
      applications: {
        include: {
          user: true,
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domainApplications: {
            where: {
              selected: true,
              domainId: { in: domainIds },
            },
            include: {
              domain: true,
              reviews: {
                include: {
                  cycleReviewer: {
                    include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
                  },
                },
              },
              decisions: { orderBy: { createdAt: "desc" } },
              // Scheduled drives status inference; Completed feeds the
              // pre-decision "Post-interview" pill in the table.
              // Cancelled rows stay filtered out (audit-only).
              interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const [allForms, domainData] = await Promise.all([
    prisma.form.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    Promise.all(
    assignments.map(async (assignment) => {
      // Narrow the shared fetch to exactly what a per-domain query would
      // have returned: only this domain's DomainApplicationCycle row, and
      // only this domain's selected DomainApplications on each application.
      const allCycles = allCyclesShared
        .filter((c) => c.domains.some((d) => d.domainId === assignment.domainId))
        .map((c) => ({
          ...c,
          domains: c.domains.filter((d) => d.domainId === assignment.domainId),
          applications: c.applications.map((app) => ({
            ...app,
            domainApplications: app.domainApplications.filter((da) => da.domainId === assignment.domainId),
          })),
        }));

      // Cycles eligible for the picker: every cycle this domain has ever run,
      // in any status. Several can be active at once, and Completed ones are
      // offered so a lead can reopen a past cycle to read its reviews,
      // interviews and decisions back. Which one is shown *by default* is a
      // separate question — see selectActiveCycleForDomainLead, where a
      // Completed cycle is only ever reached through ?cycle=.
      // No extra query cost: allCycles above already loads them all.
      const candidateCycles = allCycles.filter((c) =>
        Boolean(c.statusUpdates[0]?.newStatus),
      );
      const availableCycles = candidateCycles.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.statusUpdates[0]?.newStatus ?? null,
      }));

      const requestedCycleId = new URL(request.url).searchParams.get("cycle");
      const activeCycle = selectActiveCycleForDomainLead(candidateCycles, requestedCycleId);

      if (!activeCycle) return [{ assignment, cycle: null, availableCycles, apps: [], linkedChallengeForms: [], isChallengeReady: false, interviews: [], reviewers: [], delibsSessions: [], draftDecisions: [], cycleReviewersForDomain: [], delibRounds: [] as DomainRoundSummary[], rubricVersionOptions: [], currentRubricVersionId: null, rubricCriteria: [], interviewers: [], hasApplicationReviews: false, confidentialityRequired: null as null | "no_agreement" | "unsigned" }];

      return [await (async (cycle) => {

      // Pure reads off `cycle` — no await needed — computed up front so the
      // batch below can use them.
      const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? "Draft";
      const daDomainMatch = { domainId: assignment.domainId };

      const currentRubricVersionId = cycle.domains[0]?.rubricVersionId ?? null;
      const reviewScope = {
        ...daDomainMatch,
        application: { applicationCycleId: cycle.id },
      };

      // Everything here depends only on cycle.id / domainId (or chains on a
      // true dependency inside its own entry), so it is one wave. Reads of
      // applicant data run alongside the confidentiality check and are dropped
      // by the sanitizing return below when it blocks.
      const [
        confState,
        linkedChallengeFormsRaw,
        interviews,
        reviewers,
        delibsSessions,
        delibRoundSummaries,
        draftDecisions,
        cycleReviewersForDomain,
        { rubricVersionOptions, rubricCriteria },
        interviewers,
        hasApplicationReviews,
      ] = await Promise.all([
        getCycleConfidentialityState(auth.user.sub, cycle.id),

        // Drive challenge Forms linked to this domain in this cycle. The latest
        // version's questions power the inline embed preview (HiringFormEmbed).
        prisma.cycleDomainForm.findMany({
          where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
          include: {
            form: {
              select: {
                id: true,
                name: true,
                versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { questions: true } },
              },
            },
          },
        }),

        // Interviews for this domain in this cycle. Both Scheduled and Completed
        // rows appear in the dashboard table — only cancelled rows are excluded
        // (audit-only). Load for any non-Draft cycle: an interview can be booked
        // while the cycle is still Open (a Released invite + scheduled slot), and
        // those applicants must surface in the Interviews section rather than
        // vanishing (they're excluded from Reviews).
        currentStatus !== "Draft" && cycle
          ? prisma.interview.findMany({
              where: {
                applicationCycleId: cycle.id,
                status: { in: ["Scheduled", "Completed"] },
                domainApplication: {
                  domainId: assignment.domainId,
                },
              },
              include: {
                domainApplication: {
                  include: {
                    domain: true,
                    application: {
                      include: {
                        user: { select: { firstName: true, lastName: true } },
                      },
                    },
                  },
                },
                room: { select: { id: true, name: true } },
                assignments: {
                  where: { status: "Active" },
                  include: {
                    cycleInterviewer: {
                      include: { user: true, domain: true },
                    },
                  },
                },
              },
              orderBy: { startTime: "asc" },
            })
          : Promise.resolve([] as never[]),

        // Reviewers for this domain in this cycle
        cycle
          ? prisma.cycleReviewer.findMany({
              where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
              include: { user: true, domain: true },
            })
          : Promise.resolve([] as never[]),

        // Delibs sessions for this domain+cycle
        cycle
          ? prisma.delibsSession.findMany({
              where: { domainId: assignment.domainId, applicationCycleId: cycle.id },
              orderBy: { createdAt: "desc" },
            })
          : Promise.resolve([] as never[]),

        // Each delib round in the cycle's timeline, with how many of this
        // domain's applicants qualify for its board right now.
        cycle
          ? Promise.all(
              delibRounds(parseTimeline(cycle.timeline)).map(async (r) => ({
                id: r.id,
                label: r.label,
                isFinal: r.isFinal,
                leadsToInterviews: r.leadsToInterviews,
                count: await prisma.domainApplication.count({
                  where: {
                    selected: true,
                    ...daDomainMatch,
                    application: { applicationCycleId: cycle.id, ...inReviewPipelineFilter },
                    ...(await delibsQualifier(cycle, r.id, assignment.domainId)),
                  },
                }),
              })),
            )
          : Promise.resolve([] as DomainRoundSummary[]),

        // Draft decisions (for finalization after delibs close)
        prisma.decision.findMany({
          where: { stage: "Draft", domainApplication: reviewScope },
          include: {
            domainApplication: {
              include: { application: { include: { user: { select: { firstName: true, lastName: true } } } } },
            },
          },
          orderBy: { createdAt: "desc" },
        }),

        // Cycle reviewers for this domain (for the reviewer assignment picker)
        prisma.cycleReviewer.findMany({
          where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
          include: { user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
        }),

        // Rubrics are not domain-specific, so every version is eligible. The
        // criteria list for the ReviewModal's score labels covers the current
        // domain rubric, the general rubric and any versions pinned on this
        // domain's reviews, so scores keyed by an older rubric version still
        // resolve instead of leaking raw crit-<ts>.
        Promise.all([
          prisma.rubricVersion.findMany({
            include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
            orderBy: { createdAt: "desc" },
          }),
          prisma.applicationReview.findMany({
            where: { domainApplication: reviewScope, rubricVersionId: { not: null } },
            select: { rubricVersionId: true },
            distinct: ["rubricVersionId"],
          }),
        ]).then(async ([rubricVersionOptions, pinned]) => {
          const generalCriteria = cycle.generalRubricVersionId
            ? ((rubricVersionOptions.find((rv) => rv.id === cycle.generalRubricVersionId)
                ?.criteria as any[] | null) ?? undefined)
            : undefined;
          return {
            rubricVersionOptions,
            rubricCriteria: await buildCriteriaList({
              domainRubricVersionId: currentRubricVersionId,
              generalCriteria,
              pinnedVersionIds: pinned.map((r) => r.rubricVersionId),
            }),
          };
        }),

        // Interviewers for this domain on the cycle's first Interviews round,
        // with the hours their DALI OS calendar leaves free inside its window.
        // Later rounds' rosters live on the cycle's own Interviews tabs.
        Promise.all([
          prisma.cycleInterviewer.findMany({
            where: {
              applicationCycleId: cycle.id,
              domainId: assignment.domainId,
              interviewRoundId: FIRST_INTERVIEW_ROUND_ID,
            },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
            },
          }),
          cycle.hasInterviews
            ? prisma.interviewConfig.findUnique({
                where: {
                  applicationCycleId_interviewRoundId: {
                    applicationCycleId: cycle.id,
                    interviewRoundId: FIRST_INTERVIEW_ROUND_ID,
                  },
                },
              })
            : null,
        ]).then(async ([interviewersRaw, interviewConfig]) => {
          const calendars = interviewConfig
            ? await interviewerCalendars(interviewersRaw.map((i) => i.userId), interviewConfig)
            : new Map();
          return interviewersRaw.map((i) => {
            const blocks: { startTime: Date; endTime: Date }[] = calendars.get(i.userId)?.available ?? [];
            const totalMs = blocks.reduce((sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()), 0);
            return {
              ...i,
              availabilityHours: totalMs / (1000 * 60 * 60),
              hasCalendar: calendars.get(i.userId)?.hasCalendar ?? false,
            };
          });
        }),

        prisma.applicationReview
          .count({ where: { domainApplication: reviewScope } })
          .then((n) => n > 0),
      ]);

      const confidentialityRequired = confidentialityBlock(confState);
      const linkedChallengeForms = linkedChallengeFormsRaw.map((cdf) => ({
        id: cdf.id,
        formId: cdf.formId,
        name: cdf.form.name,
        questions: normalizeQuestionBodies(
          (cdf.form.versions[0]?.questions as unknown as Question[]) ?? [],
        ),
      }));

      // isReady lives on DomainApplicationCycle (per domain+cycle, not per challenge version)
      const isChallengeReady = cycle.domains[0]?.isReady ?? false;

      const apps = cycle.applications.filter((app) => {
        const latestStatus = app.statusUpdates[0]?.newStatus;
        return (
          latestStatus === "Submitted" &&
          app.domainApplications.some((da) => da.submittedAt != null)
        );
      });

      // Compute inferred status for each domain application
      const appsWithStatus = apps.map((app: any) => ({
        ...app,
        domainApplications: app.domainApplications.map((da: any) => ({
          ...da,
          inferredStatus: inferDomainApplicationStatus(
            { ...da, application: { statusUpdates: app.statusUpdates } },
            currentStatus as ApplicationCycleStatus,
          ),
        })),
      }));

      // When the user has not signed the cycle's confidentiality agreement,
      // strip every sensitive data path: applicant identities (cycle.applications),
      // assigned applications, scheduled interviews, draft decisions, and delibs
      // sessions. The dashboard still loads so the domain lead can see static
      // setup (challenges, rubric, team, counts that depend only on staff side)
      // and gets a placeholder pointing at the sign page.
      if (confidentialityRequired) {
        const sanitizedCycle = { ...cycle, applications: [] };
        return {
          assignment,
          cycle: sanitizedCycle,
          availableCycles,
          apps: [] as never[],
          linkedChallengeForms,
          isChallengeReady,
          interviews: [] as never[],
          reviewers,
          delibsSessions: [] as never[],
          draftDecisions: [] as never[],
          cycleReviewersForDomain,
          delibRounds: [] as DomainRoundSummary[],
          rubricVersionOptions,
          currentRubricVersionId,
          rubricCriteria,
          interviewers,
          hasApplicationReviews,
          confidentialityRequired,
        };
      }

      return { assignment, cycle, availableCycles, apps: appsWithStatus, linkedChallengeForms, isChallengeReady, interviews, reviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, delibRounds: delibRoundSummaries, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews, confidentialityRequired: null as null | "no_agreement" | "unsigned" };
      })(activeCycle)];
    })
    ),
  ]);

  const flat = domainData.flat();
  const applicantUserIds = flat.flatMap((d: any) => (d.apps ?? []).map((a: any) => a.userId as string));
  const emailSummaries = await getEngagementSummaries(applicantUserIds);

  return { domainData: flat, pillRoles, allForms, emailEngagement: Object.fromEntries(emailSummaries) };
}

export type DomainLeadData = Awaited<ReturnType<typeof loadDomainLeadDashboard>>;
